// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
	"github.com/Jan1701/OpenIntraPDF/kern/export"
)

// Auftraege (Texterkennung, Analyse fuer den Export) wie pdf_jobs im
// Server, nur im Speicher: eine Goroutine je Auftrag, Abbruch per
// Kontext, Ergebnisse in einem eigenen Temp-Ordner, der beim Beenden
// weggeraeumt wird (Vertrag Etappe 6).
//
// Anders als im Server rastert nicht der Arbeiter die Seiten, sondern
// pdf.js in der Oberflaeche: Der Auftrag nennt in render_pages, welche
// Seiten er als Bild braucht; der Gastgeber rendert sie in dpi (wie der
// Dienst mit pdftoppm) und liefert sie ueber SeiteLiefern. Die Goroutine
// nimmt die Bilder in Reihenfolge ihres Eintreffens, laesst das
// mitgelieferte Tesseract darueberlaufen und baut am Ende das Ergebnis:
// bei ocr die Textebene (dokument.TextebeneBauen), bei analyse das
// Dokumentmodell (export.Erkennen) als JSON.
//
// Die Antworten tragen dieselben Felder wie GET /api/pdf/jobs/{id}
// (typen.ts: PdfAuftrag), dazu render_pages und dpi fuer den Gastgeber.

const (
	auftragWartet      = "queued"
	auftragLaeuft      = "running"
	auftragFertig      = "succeeded"
	auftragGescheitert = "failed"
	auftragAbgebrochen = "cancelled"
	auftragArtOCR      = "ocr"
	auftragArtAnalyse  = "analyse"

	grundQuerliegend    = "page_sideways"
	grundNichtsGefunden = "no_text_found"
	grundOhneErkennung  = "ocr_unavailable_pages"
)

// erlaubteSprachen sind die mitgelieferten Sprachpakete.
var erlaubteSprachen = []string{"deu+eng", "deu", "eng"}

type Fortschritt struct {
	Done  int `json:"done"`
	Total int `json:"total"`
}

type AuftragFehler struct {
	Code string `json:"code"`
}

type AuftragErgebnis struct {
	Size   int64           `json:"size"`
	SHA256 string          `json:"sha256"`
	Meta   json.RawMessage `json:"meta"`
}

type AuftragOptionen struct {
	Pages     []int  `json:"pages"`
	Languages string `json:"languages"`
}

// Auftrag ist ein Auftrag, wie die Oberflaeche ihn sieht.
type Auftrag struct {
	ID          string           `json:"id"`
	FileID      string           `json:"file_id"`
	Kind        string           `json:"kind"`
	State       string           `json:"state"`
	BaseVersion int              `json:"base_version"`
	BaseSHA256  string           `json:"base_sha256"`
	Options     AuftragOptionen  `json:"options"`
	Progress    Fortschritt      `json:"progress"`
	Error       *AuftragFehler   `json:"error"`
	Result      *AuftragErgebnis `json:"result"`
	CreatedAt   time.Time        `json:"created_at"`
	FinishedAt  *time.Time       `json:"finished_at"`
	ExpiresAt   *time.Time       `json:"expires_at"`
	// RenderPages (ab 0) muss der Gastgeber als Bild liefern; DPI sagt, wie.
	RenderPages []int `json:"render_pages"`
	DPI         int   `json:"dpi"`
}

type seiteUebersprungen struct {
	Page   int    `json:"page"`
	Reason string `json:"reason"`
}

// ocrMeta ist result.meta eines OCR-Auftrags (wie drive.pdfOcrMeta).
type ocrMeta struct {
	PagesRecognized    []int                `json:"pages_recognized"`
	PagesSkipped       []seiteUebersprungen `json:"pages_skipped"`
	LowConfidencePages []int                `json:"low_confidence_pages"`
	Words              int                  `json:"words"`
	Report             dokument.Bericht     `json:"report"`
}

type analyseTabelle struct {
	Index int `json:"index"`
	Page  int `json:"page"`
	Rows  int `json:"rows"`
	Cols  int `json:"cols"`
}

// analyseMeta ist result.meta eines Analyse-Auftrags (wie drive.pdfAnalyseMeta).
type analyseMeta struct {
	Pages         int              `json:"pages"`
	Paragraphs    int              `json:"paragraphs"`
	Headings      int              `json:"headings"`
	Lists         int              `json:"lists"`
	Tables        []analyseTabelle `json:"tables"`
	OCRPages      []int            `json:"ocr_pages"`
	LowConfidence []int            `json:"low_confidence"`
	Warnings      []export.Warnung `json:"warnings"`
}

// bild ist eine gelieferte Seite; fehler nennt, warum das Rastern
// scheiterte (dann ohne Datei).
type bild struct {
	seite  int
	pfad   string
	fehler string
}

// auftrag ist ein Auftrag samt allem, was die Goroutine braucht.
type auftrag struct {
	mu sync.Mutex
	Auftrag
	ctx       context.Context
	abbrechen context.CancelFunc
	bilder    chan bild
	geliefert map[int]bool
	ordner    string
	ergebnis  string
	basis     []byte
	// texte: Textebene je Seite (Analyse), Nr ab 0.
	texte map[int]dokument.Seitentext
	// fertig schliesst, wenn die Goroutine zu Ende ist (Tests, Beenden).
	fertig chan struct{}
}

// Auftraege haelt die Auftraege dieser Sitzung.
type Auftraege struct {
	mu     sync.Mutex
	liste  map[string]*auftrag
	wurzel string
	tess   erkennung.Tesseract
	// ocr: das mitgelieferte Tesseract laeuft. Ohne es entstehen keine
	// OCR-Auftraege; Analysen tragen dann nur die Textebene.
	ocr   bool
	jetzt func() time.Time
}

func neueAuftraege(wurzel string, tess erkennung.Tesseract, ocr bool) *Auftraege {
	return &Auftraege{liste: map[string]*auftrag{}, wurzel: wurzel, tess: tess, ocr: ocr, jetzt: time.Now}
}

// Aufraeumen bricht alles ab und loescht den Temp-Ordner (beim Beenden).
func (as *Auftraege) Aufraeumen() {
	as.mu.Lock()
	liste := make([]*auftrag, 0, len(as.liste))
	for _, a := range as.liste {
		liste = append(liste, a)
	}
	as.mu.Unlock()
	for _, a := range liste {
		a.abbrechen()
		<-a.fertig
	}
	if as.wurzel != "" {
		os.RemoveAll(as.wurzel)
	}
}

// anlegen registriert den Auftrag und startet seine Goroutine.
func (as *Auftraege) anlegen(d *Datei, art string, seiten, rendern []int, sprachen string, texte map[int]dokument.Seitentext) (*Auftrag, error) {
	ordner, err := os.MkdirTemp(as.wurzel, "auftrag-")
	if err != nil {
		return nil, intern(err)
	}
	ctx, abbrechen := context.WithCancel(context.Background())
	a := &auftrag{
		Auftrag: Auftrag{
			ID: kennung(), FileID: d.ID, Kind: art, State: auftragLaeuft, BaseVersion: d.Version, BaseSHA256: d.SHA256,
			Options: AuftragOptionen{Pages: seiten, Languages: sprachen}, Progress: Fortschritt{Total: len(seiten)},
			CreatedAt: as.jetzt(), RenderPages: rendern, DPI: erkennung.VorgabeDPI,
		},
		ctx: ctx, abbrechen: abbrechen, bilder: make(chan bild, len(rendern)+1), geliefert: map[int]bool{},
		ordner: ordner, basis: d.Basis, texte: texte, fertig: make(chan struct{}),
	}
	as.mu.Lock()
	as.liste[a.ID] = a
	as.mu.Unlock()
	go as.ausfuehren(a)
	return a.stand(), nil
}

// OcrStarten prueft die Seitenwahl wie der Server (drive.seitenAuswaehlen)
// und reiht den Auftrag ein: nil heisst alle Seiten ohne Text; genannte
// Seiten mit Text werden nie doppelt belegt (422 pdf.ocr_page_has_text).
func (as *Auftraege) OcrStarten(ctx context.Context, d *Datei, gewaehlt *[]int, sprachen string) (*Auftrag, error) {
	if !as.ocr {
		return nil, fehler(http.StatusServiceUnavailable, "pdf.ocr_unavailable", nil)
	}
	arten, err := seitenartenFuer(ctx, d)
	if err != nil {
		return nil, err
	}
	if len(arten.Pages) > dokument.HoechstSeiten {
		return nil, kernFehler(dokument.ErrZuVieleSeiten)
	}
	hatText := func(k string) bool { return k == "text" || k == "gemischt" }
	var seiten, mitText []int
	if gewaehlt == nil {
		for _, s := range arten.Pages {
			if !hatText(s.Kind) {
				seiten = append(seiten, s.Page)
			}
		}
	} else {
		art := map[int]string{}
		for _, s := range arten.Pages {
			art[s.Page] = s.Kind
		}
		gesehen := map[int]bool{}
		for _, n := range *gewaehlt {
			k, bekannt := art[n]
			if !bekannt {
				return nil, fehler(http.StatusUnprocessableEntity, "pdf.invalid_plan", nil)
			}
			if gesehen[n] {
				continue
			}
			gesehen[n] = true
			if hatText(k) {
				mitText = append(mitText, n)
			} else {
				seiten = append(seiten, n)
			}
		}
	}
	slices.Sort(seiten)
	slices.Sort(mitText)
	if len(mitText) > 0 {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.ocr_page_has_text", map[string]any{"pages": mitText})
	}
	if len(seiten) == 0 {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.no_pages", nil)
	}
	return as.anlegen(d, auftragArtOCR, seiten, seiten, sprachen, nil)
}

// AnalyseStarten liest die Textebene der gewaehlten Seiten (nil = alle);
// Seiten ohne Textebene braucht der Auftrag als Bild — wenn Tesseract da
// ist. Ohne Tesseract und ohne jede Textebene: 503 wie im Server.
func (as *Auftraege) AnalyseStarten(ctx context.Context, d *Datei, gewaehlt *[]int, sprachen string) (*Auftrag, error) {
	insp, err := dokument.Inspizieren(ctx, bytes.NewReader(d.Basis))
	if err != nil {
		return nil, kernFehler(err)
	}
	var seiten []int
	if gewaehlt == nil {
		seiten = make([]int, insp.Seiten)
		for i := range seiten {
			seiten[i] = i
		}
	} else {
		gesehen := map[int]bool{}
		for _, n := range *gewaehlt {
			if n < 0 || n >= insp.Seiten {
				return nil, fehler(http.StatusUnprocessableEntity, "pdf.invalid_plan", nil)
			}
			if !gesehen[n] {
				gesehen[n] = true
				seiten = append(seiten, n)
			}
		}
		slices.Sort(seiten)
	}
	if len(seiten) == 0 {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.no_pages", nil)
	}
	if len(seiten) > export.HoechstSeiten {
		return nil, fehler(http.StatusRequestEntityTooLarge, "pdf.export_too_large",
			map[string]any{"max_pages": export.HoechstSeiten, "max_cells": export.HoechstZellen, "pages": len(seiten)})
	}
	texte, err := dokument.TextebeneLesen(ctx, d.Basis, seiten)
	if err != nil {
		return nil, kernFehler(err)
	}
	jeSeite := map[int]dokument.Seitentext{}
	var rendern []int
	hat := false
	for _, st := range texte {
		jeSeite[st.Nr] = st
		if zeichenDerSeite(st) >= erkennung.MindestzeichenJeSeite {
			hat = true
		} else if as.ocr {
			rendern = append(rendern, st.Nr)
		}
	}
	if !as.ocr && !hat {
		return nil, fehler(http.StatusServiceUnavailable, "pdf.ocr_unavailable", map[string]any{"reason": "no_text_layer"})
	}
	return as.anlegen(d, auftragArtAnalyse, seiten, rendern, sprachen, jeSeite)
}

// holen liefert den Auftrag zu einer Kennung.
func (as *Auftraege) holen(id string) (*auftrag, error) {
	as.mu.Lock()
	defer as.mu.Unlock()
	a, ok := as.liste[id]
	if !ok {
		return nil, fehler(http.StatusNotFound, "pdf.job_not_found", nil)
	}
	return a, nil
}

// stand ist eine Kopie fuer die Oberflaeche.
func (a *auftrag) stand() *Auftrag {
	a.mu.Lock()
	defer a.mu.Unlock()
	k := a.Auftrag
	k.Options.Pages = slices.Clone(a.Options.Pages)
	k.RenderPages = slices.Clone(a.RenderPages)
	if k.Options.Pages == nil {
		k.Options.Pages = []int{}
	}
	if k.RenderPages == nil {
		k.RenderPages = []int{}
	}
	return &k
}

// Auftrag liefert den Stand eines Auftrags.
func (as *Auftraege) Auftrag(id string) (*Auftrag, error) {
	a, err := as.holen(id)
	if err != nil {
		return nil, err
	}
	return a.stand(), nil
}

// Liste nennt die Auftraege zu einer Datei, die abgebrochenen nicht,
// juengste zuerst.
func (as *Auftraege) Liste(dateiID string) []*Auftrag {
	as.mu.Lock()
	defer as.mu.Unlock()
	aus := []*Auftrag{}
	for _, a := range as.liste {
		k := a.stand()
		if k.FileID == dateiID && k.State != auftragAbgebrochen {
			aus = append(aus, k)
		}
	}
	slices.SortFunc(aus, func(x, y *Auftrag) int { return y.CreatedAt.Compare(x.CreatedAt) })
	return aus
}

// SeiteLiefern nimmt ein gerastertes Seitenbild (PNG) entgegen; ein
// leeres Bild mit grund meldet, dass das Rastern scheiterte.
func (as *Auftraege) SeiteLiefern(id string, seite int, png []byte, grund string) error {
	a, err := as.holen(id)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.State != auftragLaeuft {
		return fehler(http.StatusConflict, "pdf.job_not_ready", map[string]any{"state": a.State})
	}
	if !slices.Contains(a.RenderPages, seite) {
		return ungueltig(fmt.Sprintf("Seite %d gehoert nicht zum Auftrag", seite))
	}
	if a.geliefert[seite] {
		return ungueltig(fmt.Sprintf("Seite %d schon geliefert", seite))
	}
	a.geliefert[seite] = true
	if grund != "" || len(png) == 0 {
		if grund == "" {
			grund = "render_failed"
		}
		a.bilder <- bild{seite: seite, fehler: grund}
		return nil
	}
	pfad := filepath.Join(a.ordner, fmt.Sprintf("seite-%d.png", seite))
	if err := os.WriteFile(pfad, png, 0o600); err != nil {
		return intern(err)
	}
	a.bilder <- bild{seite: seite, pfad: pfad}
	return nil
}

// Abbrechen bricht einen laufenden Auftrag ab oder verwirft ein Ergebnis;
// der Ordner geht mit. Liefert den Stand danach.
func (as *Auftraege) Abbrechen(id string) (*Auftrag, error) {
	a, err := as.holen(id)
	if err != nil {
		return nil, err
	}
	a.abbrechen()
	<-a.fertig
	a.mu.Lock()
	if a.State != auftragAbgebrochen {
		a.State = auftragAbgebrochen
		t := as.jetzt()
		a.FinishedAt = &t
		a.Result = nil
	}
	a.mu.Unlock()
	os.RemoveAll(a.ordner)
	return a.stand(), nil
}

// Ergebnis liest das Ergebnis eines fertigen Auftrags und prueft die
// Pruefsumme. art muss passen (ocr: PDF, analyse: JSON).
func (as *Auftraege) Ergebnis(id, art string) ([]byte, *Auftrag, error) {
	a, err := as.holen(id)
	if err != nil {
		return nil, nil, err
	}
	k := a.stand()
	if k.Kind != art {
		return nil, nil, ungueltig("Auftrag hat eine andere Art: " + k.Kind)
	}
	switch k.State {
	case auftragFertig:
	case auftragGescheitert:
		code := ""
		if k.Error != nil {
			code = k.Error.Code
		}
		return nil, nil, fehler(http.StatusUnprocessableEntity, "pdf.job_failed", map[string]any{"reason": code})
	case auftragAbgebrochen:
		return nil, nil, fehler(http.StatusNotFound, "pdf.job_not_found", nil)
	default:
		return nil, nil, fehler(http.StatusConflict, "pdf.job_not_ready", map[string]any{"state": k.State})
	}
	roh, err := os.ReadFile(a.ergebnis)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, fehler(http.StatusUnprocessableEntity, "pdf.job_failed", map[string]any{"reason": "result_missing"})
	}
	if err != nil {
		return nil, nil, intern(err)
	}
	if k.Result != nil && k.Result.SHA256 != "" && !strings.EqualFold(pruefsumme(roh), k.Result.SHA256) {
		return nil, nil, intern(fmt.Errorf("Ergebnis %s: Pruefsumme passt nicht", id))
	}
	return roh, k, nil
}

// Verbraucht raeumt einen veroeffentlichten Auftrag weg.
func (as *Auftraege) Verbraucht(id string) {
	as.mu.Lock()
	a, ok := as.liste[id]
	delete(as.liste, id)
	as.mu.Unlock()
	if ok {
		os.RemoveAll(a.ordner)
	}
}

// ausfuehren ist die Goroutine eines Auftrags.
func (as *Auftraege) ausfuehren(a *auftrag) {
	defer close(a.fertig)
	scheitern := func(code string) {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.State != auftragLaeuft {
			return
		}
		a.State = auftragGescheitert
		a.Error = &AuftragFehler{Code: code}
		t := as.jetzt()
		a.FinishedAt = &t
	}
	fortschritt := func(n int) {
		a.mu.Lock()
		a.Progress.Done = n
		a.mu.Unlock()
	}

	erkannt := map[int][]erkennung.Block{}
	var quer []int
	// Seiten aus der Textebene zaehlen sofort als erledigt.
	done := len(a.Options.Pages) - len(a.RenderPages)
	fortschritt(done)
	for range a.RenderPages {
		var b bild
		select {
		case <-a.ctx.Done():
			return
		case b = <-a.bilder:
		}
		if b.fehler != "" {
			scheitern(b.fehler)
			return
		}
		bloecke, err := as.tess.SeiteErkennen(a.ctx, b.pfad, a.DPI)
		os.Remove(b.pfad)
		if err != nil {
			if a.ctx.Err() != nil {
				return
			}
			scheitern("ocr_failed")
			return
		}
		if erkennung.MeistSenkrecht(bloecke) {
			quer = append(quer, b.seite)
		} else {
			erkannt[b.seite] = bloecke
		}
		done++
		fortschritt(done)
	}
	if a.ctx.Err() != nil {
		return
	}

	var roh []byte
	var meta any
	var err error
	if a.Kind == auftragArtOCR {
		roh, meta, err = as.textebeneBauen(a, erkannt, quer)
	} else {
		roh, meta, err = as.modellBauen(a, erkannt, quer)
	}
	if err != nil {
		if a.ctx.Err() != nil {
			return
		}
		scheitern(baufehlerCode(err))
		return
	}
	endung := ".pdf"
	if a.Kind == auftragArtAnalyse {
		endung = ".json"
	}
	pfad := filepath.Join(a.ordner, "ergebnis"+endung)
	if err := os.WriteFile(pfad, roh, 0o600); err != nil {
		scheitern("result_not_written")
		return
	}
	metaRoh, err := json.Marshal(meta)
	if err != nil {
		scheitern("build_failed")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.State != auftragLaeuft {
		os.Remove(pfad)
		return
	}
	a.ergebnis = pfad
	a.State = auftragFertig
	a.Progress.Done = a.Progress.Total
	a.Result = &AuftragErgebnis{Size: int64(len(roh)), SHA256: pruefsumme(roh), Meta: metaRoh}
	t := as.jetzt()
	a.FinishedAt = &t
}

// textebeneBauen macht aus den erkannten Seiten die Textebene (ocr).
func (as *Auftraege) textebeneBauen(a *auftrag, erkannt map[int][]erkennung.Block, quer []int) ([]byte, any, error) {
	meta := ocrMeta{PagesRecognized: []int{}, PagesSkipped: []seiteUebersprungen{}, LowConfidencePages: []int{}}
	woerter := map[int][]dokument.Wort{}
	for _, seite := range a.Options.Pages {
		if slices.Contains(quer, seite) {
			meta.PagesSkipped = append(meta.PagesSkipped, seiteUebersprungen{Page: seite, Reason: grundQuerliegend})
			continue
		}
		ws, unsicher := auswerten(erkannt[seite])
		if len(ws) == 0 {
			meta.PagesSkipped = append(meta.PagesSkipped, seiteUebersprungen{Page: seite, Reason: grundNichtsGefunden})
			continue
		}
		if erkennung.Unsicher(unsicher, len(ws)) {
			meta.LowConfidencePages = append(meta.LowConfidencePages, seite)
		}
		woerter[seite] = ws
		meta.PagesRecognized = append(meta.PagesRecognized, seite)
	}
	var aus bytes.Buffer
	bericht, n, err := dokument.TextebeneBauen(a.ctx, bytes.NewReader(a.basis), woerter, &aus)
	if err != nil {
		return nil, nil, err
	}
	meta.Words, meta.Report = n, bericht
	return aus.Bytes(), meta, nil
}

// modellBauen macht aus Textebene und Erkennung das Dokumentmodell
// (analyse) — wie drive.pdfAnalyseAusfuehren.
func (as *Auftraege) modellBauen(a *auftrag, erkannt map[int][]erkennung.Block, quer []int) ([]byte, any, error) {
	var seiten []export.Seitenwoerter
	var warnungen []export.Warnung
	var ohneErkennung []int
	for _, nr := range a.Options.Pages {
		st := a.texte[nr]
		if bloecke, ok := erkannt[nr]; ok {
			s := seitenwoerterVonErkennung(st, bloecke)
			seiten = append(seiten, s)
			continue
		}
		s := seitenwoerterVonTextebene(st)
		if slices.Contains(quer, nr) {
			s.Quelle = export.QuelleOCR
			s.Bloecke = nil
		} else if s.Quelle == export.QuelleLeer && !as.ocr && (st.Bild || st.Unlesbar) {
			ohneErkennung = append(ohneErkennung, nr)
		}
		seiten = append(seiten, s)
	}
	if len(quer) > 0 {
		warnungen = append(warnungen, export.Warnung{Code: grundQuerliegend, Count: len(quer), Pages: quer})
	}
	if len(ohneErkennung) > 0 {
		warnungen = append(warnungen, export.Warnung{Code: grundOhneErkennung, Count: len(ohneErkennung), Pages: ohneErkennung})
	}
	dok := export.Erkennen(seiten)
	dok.Quelle.Sha256 = a.BaseSHA256
	dok.Warnungen = append(warnungen, dok.Warnungen...)
	roh, err := json.Marshal(dok)
	if err != nil {
		return nil, nil, err
	}
	return roh, analyseMetaFuer(dok), nil
}

func analyseMetaFuer(dok export.Dokument) analyseMeta {
	z := dok.Zaehlen()
	meta := analyseMeta{Pages: z.Seiten, Paragraphs: z.Absaetze, Headings: z.Ueberschrift, Lists: z.Listen,
		Tables: []analyseTabelle{}, OCRPages: z.OCRSeiten, LowConfidence: z.Unsichere, Warnings: dok.Warnungen}
	if meta.OCRPages == nil {
		meta.OCRPages = []int{}
	}
	if meta.LowConfidence == nil {
		meta.LowConfidence = []int{}
	}
	if meta.Warnings == nil {
		meta.Warnings = []export.Warnung{}
	}
	for _, t := range z.Tabellen {
		seite := 0
		if len(t.Seiten) > 0 {
			seite = t.Seiten[0]
		}
		meta.Tables = append(meta.Tables, analyseTabelle{Index: t.Index, Page: seite, Rows: len(t.Zeilen), Cols: t.Spalten})
	}
	return meta
}

// seitenwoerterVonErkennung uebersetzt erkannte Bloecke in die Typen des
// Exportpakets; Groesse und Bildanteil kommen von der Textebene-Auskunft.
func seitenwoerterVonErkennung(st dokument.Seitentext, bloecke []erkennung.Block) export.Seitenwoerter {
	aus := export.Seitenwoerter{Nr: st.Nr, Breite: st.Breite, Hoehe: st.Hoehe, Quelle: export.QuelleLeer}
	if st.Bild {
		aus.Bildanteil = 1
	}
	woerter := 0
	for _, b := range bloecke {
		var block export.Wortblock
		for _, z := range b.Zeilen {
			var zeile export.Wortzeile
			for _, w := range z.Woerter {
				if strings.TrimSpace(w.Text) == "" {
					continue
				}
				zeile.Woerter = append(zeile.Woerter, export.Wort{X0: w.X0, Y0: w.Y0, X1: w.X1, Y1: w.Y1, Text: w.Text, Konf: w.Konf})
			}
			if len(zeile.Woerter) > 0 {
				block.Zeilen = append(block.Zeilen, zeile)
				woerter += len(zeile.Woerter)
			}
		}
		if len(block.Zeilen) > 0 {
			aus.Bloecke = append(aus.Bloecke, block)
		}
	}
	if woerter > 0 {
		aus.Quelle = export.QuelleOCR
	}
	return aus
}

// seitenwoerterVonTextebene uebersetzt eine Seite des lokalen Lesers —
// wie drive.seitenwoerterVonTextebene.
func seitenwoerterVonTextebene(st dokument.Seitentext) export.Seitenwoerter {
	aus := export.Seitenwoerter{Nr: st.Nr, Breite: st.Breite, Hoehe: st.Hoehe, Quelle: export.QuelleLeer}
	if st.Bild {
		aus.Bildanteil = 1
	}
	for _, b := range st.Bloecke {
		var block export.Wortblock
		for _, z := range b {
			var zeile export.Wortzeile
			for _, w := range z.Woerter {
				zeile.Woerter = append(zeile.Woerter, export.Wort{X0: w.X0, Y0: w.Y0, X1: w.X1, Y1: w.Y1, Text: w.Text, Konf: -1})
			}
			if len(zeile.Woerter) > 0 {
				block.Zeilen = append(block.Zeilen, zeile)
			}
		}
		if len(block.Zeilen) > 0 {
			aus.Bloecke = append(aus.Bloecke, block)
			aus.Quelle = export.QuelleTextebene
		}
	}
	return aus
}

// baufehlerCode uebersetzt die Fehler des Adapters in error.code — wie
// drive.pdfBaufehlerCode.
func baufehlerCode(err error) string {
	switch {
	case errors.Is(err, dokument.ErrPasswort):
		return "requires_password"
	case errors.Is(err, dokument.ErrZuGross):
		return "too_large"
	case errors.Is(err, dokument.ErrZuVieleSeiten):
		return "too_many_pages"
	case errors.Is(err, dokument.ErrKeinPDF), errors.Is(err, dokument.ErrUnlesbar):
		return "unreadable"
	case errors.Is(err, dokument.ErrPruefung):
		return "verification_failed"
	}
	return "build_failed"
}

// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
	"github.com/Jan1701/OpenIntraPDF/kern/export"
)

// App traegt die Bindungen fuer die Oberflaeche: dieselben Fachfunktionen
// wie die Drive-Routen (core/coremodule/drive/pdf*.go), gerufen ueber den
// Go-Kern openintrapdf — kein freies ReadFile, WriteFile oder Exec
// (Konzept Kap. 07). Pfade kommen nur aus nativen Dialogen, Drag & Drop
// oder dem Oeffnen aus dem Finder; die Webseite sieht nur Kennungen.
//
// Die Bytes einer Datei (und das Ergebnis eines OCR-Auftrags) holt die
// Oberflaeche nicht ueber eine Bindung, sondern ueber den Asset-Server
// (GET /datei/{id}, GET /auftrag/{id}/ergebnis, dateiHandler): Wails reicht
// Bindungsergebnisse als JSON durch, und ein PDF von 50 MB als Base64 im
// JSON waere zu langsam.
type App struct {
	ctx        context.Context
	ablage     *Ablage
	auftraege  *Auftraege
	vorgaenge  *Vorgaenge
	zuletzt    *Zuletzt
	tess       erkennung.Tesseract
	ocr        erkennung.Zustand
	ocrFehler  string
	person     string
	tempWurzel string
	jetzt      func() time.Time

	// Dateien, die das System oeffnen liess, bevor die Oberflaeche bereit
	// war (Finder-Doppelklick beim Start): Start() holt sie ab.
	mu      sync.Mutex
	bereit  bool
	wartend []string

	// Texte des Menues in der Sprache des Systems (menue.go, MenueSprache).
	menueTexte map[string]string
}

// neueApp baut die App mit ihrem Temp-Ordner und dem gefundenen Tesseract.
func neueApp() *App {
	wurzel, err := os.MkdirTemp("", "openintrapdf-")
	if err != nil {
		wurzel = ""
	}
	tess := tesseractFinden()
	a := &App{ablage: neueAblage(), vorgaenge: neueVorgaenge(), tess: tess, tempWurzel: wurzel, jetzt: time.Now}
	if z, err := tesseractPruefen(tess); err == nil {
		a.ocr = z
	} else {
		a.ocrFehler = err.Error()
	}
	a.auftraege = neueAuftraege(wurzel, tess, a.ocrGesund())
	a.person = personName()
	a.zuletzt = zuletztLaden(zuletztPfad())
	return a
}

func (a *App) ocrGesund() bool { return a.ocr.Fassung != "" }

// personName ist der volle Name der angemeldeten Person (os/user), sonst
// der Benutzername — er steht als Autor in Anmerkungen und am Stempel.
func personName() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	if n := strings.TrimSpace(u.Name); n != "" {
		return n
	}
	return u.Username
}

// zuletztPfad ist die Liste der zuletzt geoeffneten Dateien im
// Einstellungsordner der Person.
func zuletztPfad() string {
	ordner, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(ordner, "OpenIntraPDF", "zuletzt.json")
}

// startup merkt sich den Kontext (Dialoge, Ereignisse) und hoert auf
// Drag & Drop.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	runtime.OnFileDrop(ctx, func(_, _ int, pfade []string) {
		for _, p := range pfade {
			if strings.EqualFold(filepath.Ext(p), ".pdf") {
				a.dateiVomSystem(p)
				return
			}
		}
	})
}

// shutdown raeumt auf: laufende Auftraege abbrechen, Temp-Ordner weg.
func (a *App) shutdown(context.Context) {
	a.auftraege.Aufraeumen()
	if a.tempWurzel != "" {
		os.RemoveAll(a.tempWurzel)
	}
}

// dateiVomSystem: Finder („Oeffnen mit“), Drag & Drop, Kommandozeile. Ist
// die Oberflaeche bereit, bekommt sie die geoeffnete Datei als Ereignis;
// sonst wartet der Pfad auf Start().
func (a *App) dateiVomSystem(pfad string) {
	a.mu.Lock()
	if !a.bereit {
		a.wartend = append(a.wartend, pfad)
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()
	g, err := a.oeffnen(pfad)
	if err != nil {
		runtime.EventsEmit(a.ctx, "oeffnenFehler", err.Error())
		return
	}
	runtime.EventsEmit(a.ctx, "geoeffnet", g)
}

// ------------------------------------------------------------------
// Bindungen: Start und Oeffnen
// ------------------------------------------------------------------

// StartInfo ist, was die Oberflaeche beim Start braucht.
type StartInfo struct {
	Person string `json:"person"`
	// OCR: das mitgelieferte Tesseract laeuft (Fassung), sonst der Grund.
	OCR       string           `json:"ocr"`
	OCRFehler string           `json:"ocr_fehler,omitempty"`
	Zuletzt   []ZuletztEintrag `json:"zuletzt"`
	// Geoeffnet: eine Datei, die das System schon vor dem Start uebergab.
	Geoeffnet *Geoeffnet `json:"geoeffnet"`
	// Schnelldruck: Es gibt einen Weg auf den Standarddrucker ohne Dialog
	// (Linux lp, macOS lpr) — Etappe 8.
	Schnelldruck bool `json:"schnelldruck"`
	// Fassung, Bau und Urheber fuer das Info-Fenster (ueber.go).
	Fassung string `json:"fassung"`
	Bau     string `json:"bau"`
	Urheber string `json:"urheber"`
}

// Geoeffnet ist eine geoeffnete Datei aus Sicht der Oberflaeche.
type Geoeffnet struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Start meldet die Oberflaeche bereit und liefert Person, Erkennung und
// die zuletzt geoeffneten Dateien.
func (a *App) Start() StartInfo {
	a.mu.Lock()
	a.bereit = true
	wartend := a.wartend
	a.wartend = nil
	a.mu.Unlock()
	info := StartInfo{Person: a.person, OCR: a.ocr.Fassung, OCRFehler: a.ocrFehler, Zuletzt: a.zuletzt.Eintraege(),
		Schnelldruck: schnelldruckMoeglich(), Fassung: fassung, Bau: bau, Urheber: urheber}
	for _, p := range wartend {
		if g, err := a.oeffnen(p); err == nil {
			info.Geoeffnet = g
			break
		}
	}
	return info
}

// oeffnen registriert einen Pfad und merkt ihn in der Liste.
func (a *App) oeffnen(pfad string) (*Geoeffnet, error) {
	d, err := a.ablage.Oeffnen(pfad)
	if err != nil {
		return nil, kernFehler(err)
	}
	a.zuletzt.Merken(d.Pfad)
	return &Geoeffnet{ID: d.ID, Name: d.Name}, nil
}

// OeffnenDialog zeigt den nativen Oeffnen-Dialog; nil heisst abgebrochen.
func (a *App) OeffnenDialog() (*Geoeffnet, error) {
	pfad, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "PDF öffnen",
		Filters: []runtime.FileFilter{{DisplayName: "PDF", Pattern: "*.pdf"}},
	})
	if err != nil {
		return nil, intern(err)
	}
	if pfad == "" {
		return nil, nil
	}
	return a.oeffnen(pfad)
}

// ZuletztOeffnen oeffnet einen Eintrag der Liste ueber seinen Schluessel.
func (a *App) ZuletztOeffnen(schluessel string) (*Geoeffnet, error) {
	pfad, ok := a.zuletzt.Pfad(schluessel)
	if !ok {
		return nil, nichtGefunden()
	}
	g, err := a.oeffnen(pfad)
	if err != nil {
		if _, statErr := os.Stat(pfad); os.IsNotExist(statErr) {
			a.zuletzt.Entfernen(pfad)
		}
		return nil, err
	}
	return g, nil
}

// Zuletzt liefert die Liste neu (nach dem Schliessen eines Dokuments).
func (a *App) Zuletzt() []ZuletztEintrag { return a.zuletzt.Eintraege() }

// Schliessen vergisst eine geoeffnete Datei (Dokument zu).
func (a *App) Schliessen(id string) {
	a.ablage.Vergessen(id)
}

// Info liefert Stand, Inspektion und Faehigkeiten (GET /api/pdf/files/{id}).
func (a *App) Info(id string) (*Info, error) {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return nil, err
	}
	return infoFuer(a.ctxOderHintergrund(), d, a.ocrGesund())
}

func (a *App) ctxOderHintergrund() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

// ------------------------------------------------------------------
// Bindungen: Speichern, Extrahieren, Ziel
// ------------------------------------------------------------------

// Ziel ist ein Ablageort (typen.ts: PdfZiel/CommitZiel): folder_id ist
// die Kennung eines Ordners aus dem Sichern-Dialog.
type Ziel struct {
	Kind     string  `json:"kind,omitempty"`
	DriveID  string  `json:"drive_id"`
	FolderID *string `json:"folder_id"`
	Name     string  `json:"name"`
}

type CommitBefehl struct {
	ExpectedVersion int                         `json:"expected_version"`
	ExpectedSHA256  string                      `json:"expected_sha256"`
	Pages           *[]dokument.Seite           `json:"pages"`
	Annotations     *dokument.Anmerkungsbefehle `json:"annotations"`
	// Properties (Etappe 8): Titel, Thema, Autor, Stichwoerter.
	Properties *dokument.Eigenschaften `json:"properties"`
	// Password und OwnerPassword (Etappe 9): Oeffnen- und Rechte-Kennwort einer
	// geschuetzten Datei — nur fuer diesen Aufruf, nie gespeichert.
	Password      string   `json:"password"`
	OwnerPassword string   `json:"owner_password"`
	Destination   Ziel     `json:"destination"`
	Comment       string   `json:"comment"`
	AcceptLosses  []string `json:"accept_losses"`
}

// Ergebnis ist eine neue Fassung oder neue Datei samt Bericht.
type Ergebnis struct {
	FileID      string                       `json:"file_id"`
	Name        string                       `json:"name"`
	Version     int                          `json:"version"`
	SHA256      string                       `json:"sha256"`
	Report      dokument.Bericht             `json:"report"`
	Annotations *dokument.Anmerkungsergebnis `json:"annotations,omitempty"`
}

// zielOrdner loest ein Ziel in einen Ordner auf.
func (a *App) zielOrdner(z Ziel) (string, error) {
	if z.FolderID == nil || strings.TrimSpace(*z.FolderID) == "" {
		return "", ungueltig("destination.folder_id fehlt")
	}
	return a.ablage.Ziel(strings.TrimSpace(*z.FolderID))
}

// anmerkungenVorbereiten setzt, was im Server aus der Datenbank kommt:
// Autor und Zeit (Name und Datum am Stempel setzt die Go-Seite, nie die
// Oberflaeche). Eigene Anmerkungen: alle — die Datei gehoert der Person.
func (a *App) anmerkungenVorbereiten(b *dokument.Anmerkungsbefehle) {
	b.Autor = a.person
	b.Zeit = a.jetzt()
	b.NurEigene = false
}

// Speichern ist POST /api/pdf/files/{id}/commit: Seitenplan und/oder
// Anmerkungsbefehle als neue Fassung (die Datei wird atomar
// ueberschrieben) oder als neue Datei im gewaehlten Ordner.
func (a *App) Speichern(id string, befehl CommitBefehl, schluessel string) (*Ergebnis, error) {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return nil, err
	}
	hatSeiten := befehl.Pages != nil
	hatAnmerkungen := !befehl.Annotations.Leer()
	hatEigenschaften := !befehl.Properties.Leer()
	if !hatSeiten && !hatAnmerkungen && !hatEigenschaften {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.nothing_to_do", nil)
	}
	if hatSeiten && len(*befehl.Pages) == 0 {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.no_pages", nil)
	}
	if hatAnmerkungen {
		if err := befehl.Annotations.Pruefen(); err != nil {
			return nil, kernFehler(err)
		}
	}
	if hatEigenschaften {
		if err := befehl.Properties.Pruefen(); err != nil {
			return nil, kernFehler(err)
		}
	}
	if befehl.ExpectedVersion < 1 {
		return nil, ungueltig("expected_version fehlt")
	}
	neueFassung := false
	switch befehl.Destination.Kind {
	case "new_version":
		neueFassung = true
	case "new_file":
	default:
		return nil, ungueltig("destination.kind muss new_version oder new_file sein")
	}
	var ordner string
	if !neueFassung {
		if ordner, err = a.zielOrdner(befehl.Destination); err != nil {
			return nil, err
		}
	}
	var erg Ergebnis
	err = a.vorgaenge.Ausfuehren(schluessel, "commit", id, befehl, &erg, func() (any, error) {
		basis, err := a.ablage.BasisFuer(d, befehl.ExpectedVersion, befehl.ExpectedSHA256, neueFassung)
		if err != nil {
			return nil, err
		}
		var plan []dokument.Seite
		if hatSeiten {
			plan = *befehl.Pages
		}
		var anm *dokument.Anmerkungsbefehle
		if hatAnmerkungen {
			anm = befehl.Annotations
			a.anmerkungenVorbereiten(anm)
		}
		var eig *dokument.Eigenschaften
		if hatEigenschaften {
			eig = befehl.Properties
		}
		var aus bytes.Buffer
		bericht, anmerkungen, err := dokument.CommitAusfuehren(a.ctxOderHintergrund(), bytes.NewReader(basis), dokument.Commit{
			Anmerkungen: anm, Plan: plan, Eigenschaften: eig, Passwort: befehl.Password, Besitzerpasswort: befehl.OwnerPassword,
		}, &aus)
		if err != nil {
			return nil, kernFehler(err)
		}
		quelle := bericht.Quelle()
		if neueFassung && quelle.Signiert {
			return nil, fehler(http.StatusUnprocessableEntity, "pdf.signed_original", nil)
		}
		if quelle.XFA {
			return nil, fehler(http.StatusUnprocessableEntity, "pdf.unsupported", map[string]any{"reason": "xfa_form"})
		}
		if err := verlustePruefen(bericht, befehl.AcceptLosses); err != nil {
			return nil, err
		}
		var anmErg *dokument.Anmerkungsergebnis
		if hatAnmerkungen {
			anmErg = &anmerkungen
		}
		if neueFassung {
			if err := a.ablage.Ueberschreiben(d, aus.Bytes(), befehl.ExpectedVersion, befehl.ExpectedSHA256); err != nil {
				return nil, err
			}
			return Ergebnis{FileID: d.ID, Name: d.Name, Version: d.Version, SHA256: d.SHA256, Report: bericht, Annotations: anmErg}, nil
		}
		name := dateinameMitEndung(befehl.Destination.Name, stamm(d.Name)+" (bearbeitet)", ".pdf")
		pfad, err := neueDateiSchreiben(ordner, name, aus.Bytes())
		if err != nil {
			return nil, intern(err)
		}
		a.zuletzt.Merken(pfad)
		return Ergebnis{FileID: "", Name: filepath.Base(pfad), Version: 1, SHA256: pruefsumme(aus.Bytes()), Report: bericht, Annotations: anmErg}, nil
	})
	if err != nil {
		return nil, err
	}
	return &erg, nil
}

type ExtraktBefehl struct {
	Pages           []int    `json:"pages"`
	Mode            string   `json:"mode"`
	Destination     Ziel     `json:"destination"`
	ExpectedVersion int      `json:"expected_version"`
	AcceptLosses    []string `json:"accept_losses"`
}

type ExtraktErgebnis struct {
	Files []Ergebnis `json:"files"`
}

// Extrahieren ist POST /api/pdf/files/{id}/extract: Seiten als eine neue
// Datei oder je Seite eine, im gewaehlten Ordner.
func (a *App) Extrahieren(id string, befehl ExtraktBefehl, schluessel string) (*ExtraktErgebnis, error) {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return nil, err
	}
	if len(befehl.Pages) == 0 {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.no_pages", nil)
	}
	jeSeite := false
	switch befehl.Mode {
	case "", "one":
	case "each":
		jeSeite = true
	default:
		return nil, ungueltig("mode muss one oder each sein")
	}
	if len(befehl.Pages) > dokument.HoechstSeiten {
		return nil, kernFehler(dokument.ErrZuVieleSeiten)
	}
	ordner, err := a.zielOrdner(befehl.Destination)
	if err != nil {
		return nil, err
	}
	var erg ExtraktErgebnis
	err = a.vorgaenge.Ausfuehren(schluessel, "extract", id, befehl, &erg, func() (any, error) {
		if befehl.ExpectedVersion > 0 && befehl.ExpectedVersion != d.Version {
			return nil, konflikt(d.Version)
		}
		type teil struct {
			name    string
			inhalt  []byte
			bericht dokument.Bericht
		}
		name := dateinameMitEndung(befehl.Destination.Name, stamm(d.Name)+" (Auszug)", ".pdf")
		gruppen := [][]int{befehl.Pages}
		if jeSeite {
			gruppen = gruppen[:0]
			for _, s := range befehl.Pages {
				gruppen = append(gruppen, []int{s})
			}
		}
		var teile []teil
		for _, g := range gruppen {
			var aus bytes.Buffer
			b, err := dokument.Extrahieren(a.ctxOderHintergrund(), bytes.NewReader(d.Basis), g, &aus)
			if err != nil {
				return nil, kernFehler(err)
			}
			if b.Quelle().XFA {
				return nil, fehler(http.StatusUnprocessableEntity, "pdf.unsupported", map[string]any{"reason": "xfa_form"})
			}
			if err := verlustePruefen(b, befehl.AcceptLosses); err != nil {
				return nil, err
			}
			n := name
			if jeSeite {
				n = fmt.Sprintf("%s – Seite %d.pdf", stamm(name), g[0]+1)
			}
			teile = append(teile, teil{n, aus.Bytes(), b})
		}
		antwort := ExtraktErgebnis{Files: []Ergebnis{}}
		for _, t := range teile {
			pfad, err := neueDateiSchreiben(ordner, t.name, t.inhalt)
			if err != nil {
				return nil, intern(err)
			}
			antwort.Files = append(antwort.Files, Ergebnis{Name: filepath.Base(pfad), Version: 1, SHA256: pruefsumme(t.inhalt), Report: t.bericht})
		}
		return antwort, nil
	})
	if err != nil {
		return nil, err
	}
	return &erg, nil
}

// ZielAnfrage ist, wofuer ein Ziel gewaehlt wird (typen.ts: ZielAnfrage).
type ZielAnfrage struct {
	Zweck string `json:"zweck"`
	Name  string `json:"name"`
}

// ZielWaehlen zeigt den Sichern-Dialog und liefert Ordnerkennung und
// Namen; nil heisst abgebrochen.
func (a *App) ZielWaehlen(anfrage ZielAnfrage) (*Ziel, error) {
	titel := map[string]string{
		"neue_datei": "Als neue Datei sichern", "extrahieren": "Auszug sichern", "teilen": "Seiten sichern",
		"exportieren": "Export sichern", "binden": "Gebundene Datei sichern",
	}[anfrage.Zweck]
	if titel == "" {
		titel = "Sichern"
	}
	filter := []runtime.FileFilter{{DisplayName: "PDF", Pattern: "*.pdf"}}
	if anfrage.Zweck == "exportieren" {
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(anfrage.Name)), ".")
		if ext != "" {
			filter = []runtime.FileFilter{{DisplayName: strings.ToUpper(ext), Pattern: "*." + ext}}
		}
	}
	pfad, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: titel, DefaultFilename: anfrage.Name, Filters: filter, CanCreateDirectories: true,
	})
	if err != nil {
		return nil, intern(err)
	}
	if pfad == "" {
		return nil, nil
	}
	zielID := a.ablage.ZielAnlegen(filepath.Dir(pfad))
	return &Ziel{DriveID: "", FolderID: &zielID, Name: filepath.Base(pfad)}, nil
}

// ------------------------------------------------------------------
// Bindungen: Texterkennung und Analyse (Auftraege)
// ------------------------------------------------------------------

type AuftragOptionenRumpf struct {
	Pages     *[]int `json:"pages"`
	Languages string `json:"languages"`
}

type AuftragBefehl struct {
	Kind            string               `json:"kind"`
	ExpectedVersion int                  `json:"expected_version"`
	Options         AuftragOptionenRumpf `json:"options"`
	// OwnerPassword: das Rechte-Kennwort einer geschuetzten Quelle, deren
	// Rechte-Bits den Auftrag sonst verbieten — nur fuer diesen Aufruf.
	OwnerPassword string `json:"owner_password"`
}

// Seitenarten ist GET /api/pdf/files/{id}/pages.
func (a *App) Seitenarten(id string) (*Seitenarten, error) {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return nil, err
	}
	return seitenartenFuer(a.ctxOderHintergrund(), d)
}

// AuftragStarten ist POST /api/pdf/files/{id}/jobs (ocr oder analyse).
func (a *App) AuftragStarten(id string, befehl AuftragBefehl, schluessel string) (*Auftrag, error) {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return nil, err
	}
	if befehl.Kind != auftragArtOCR && befehl.Kind != auftragArtAnalyse {
		return nil, ungueltig("kind muss ocr oder analyse sein")
	}
	if befehl.ExpectedVersion < 1 {
		return nil, ungueltig("expected_version fehlt")
	}
	sprachen := strings.TrimSpace(befehl.Options.Languages)
	if sprachen == "" {
		sprachen = erkennung.VorgabeSprachen
	}
	if !slices.Contains(erlaubteSprachen, sprachen) {
		return nil, ungueltig("languages muss deu+eng, deu oder eng sein")
	}
	// Der Hash des Vorgangs ohne das Kennwort.
	ohneKennwort := befehl
	ohneKennwort.OwnerPassword = ""
	var erg Auftrag
	err = a.vorgaenge.Ausfuehren(schluessel, "jobs", id, ohneKennwort, &erg, func() (any, error) {
		if befehl.ExpectedVersion != d.Version {
			return nil, konflikt(d.Version)
		}
		// Rechte-Bits einer geschuetzten Quelle wie im Server: Analyse braucht
		// das Kopier-Bit, Texterkennung (neue Fassung) das Aendern-Bit — oder
		// das Rechte-Kennwort, das nirgends bleibt.
		recht := "modify"
		if befehl.Kind == auftragArtAnalyse {
			recht = "copy"
		}
		if err := dokument.RechtPruefen(a.ctxOderHintergrund(), bytes.NewReader(d.Basis), befehl.OwnerPassword, recht); err != nil {
			return nil, kernFehler(err)
		}
		if befehl.Kind == auftragArtOCR {
			return a.auftraege.OcrStarten(a.ctxOderHintergrund(), d, befehl.Options.Pages, sprachen)
		}
		return a.auftraege.AnalyseStarten(a.ctxOderHintergrund(), d, befehl.Options.Pages, sprachen)
	})
	if err != nil {
		return nil, err
	}
	// Die Wiederholung bekommt den AKTUELLEN Stand, nicht den vom Anlegen.
	if stand, err := a.auftraege.Auftrag(erg.ID); err == nil {
		return stand, nil
	}
	return &erg, nil
}

// Auftraege ist GET /api/pdf/jobs?file_id=.
func (a *App) Auftraege(dateiID string) ([]*Auftrag, error) {
	if _, err := a.ablage.Datei(dateiID); err != nil {
		return nil, err
	}
	return a.auftraege.Liste(dateiID), nil
}

// Auftrag ist GET /api/pdf/jobs/{id}.
func (a *App) Auftrag(id string) (*Auftrag, error) { return a.auftraege.Auftrag(id) }

// AuftragAbbrechen ist DELETE /api/pdf/jobs/{id}.
func (a *App) AuftragAbbrechen(id string) (*Auftrag, error) { return a.auftraege.Abbrechen(id) }

// SeiteLiefern nimmt ein von pdf.js gerastertes Seitenbild (PNG, Base64)
// entgegen; grund nennt, warum das Rastern scheiterte (dann ohne Bild).
func (a *App) SeiteLiefern(auftragID string, seite int, pngBase64 string, grund string) error {
	var png []byte
	if pngBase64 != "" {
		roh, err := base64.StdEncoding.DecodeString(pngBase64)
		if err != nil {
			return ungueltig("Bild ist kein Base64")
		}
		png = roh
	}
	return a.auftraege.SeiteLiefern(auftragID, seite, png, grund)
}

type AuftragCommit struct {
	Destination  Ziel     `json:"destination"`
	Comment      string   `json:"comment"`
	AcceptLosses []string `json:"accept_losses"`
}

type auftragCommitAnfrage struct {
	JobID string
	Rumpf AuftragCommit
}

// AuftragVeroeffentlichen ist POST /api/pdf/jobs/{id}/commit: das
// Ergebnis-PDF als neue Fassung (Basis muss noch aktuell sein) oder als
// neue Datei.
func (a *App) AuftragVeroeffentlichen(id string, rumpf AuftragCommit, schluessel string) (*Ergebnis, error) {
	neueFassung := false
	switch rumpf.Destination.Kind {
	case "new_version":
		neueFassung = true
	case "new_file":
	default:
		return nil, ungueltig("destination.kind muss new_version oder new_file sein")
	}
	var ordner string
	var err error
	if !neueFassung {
		if ordner, err = a.zielOrdner(rumpf.Destination); err != nil {
			return nil, err
		}
	}
	var erg Ergebnis
	err = a.vorgaenge.Ausfuehren(schluessel, "job_commit", "", auftragCommitAnfrage{JobID: id, Rumpf: rumpf}, &erg, func() (any, error) {
		ergebnis, k, err := a.auftraege.Ergebnis(id, auftragArtOCR)
		if err != nil {
			return nil, err
		}
		d, err := a.ablage.Datei(k.FileID)
		if err != nil {
			return nil, err
		}
		var meta ocrMeta
		if len(k.Result.Meta) > 0 {
			if err := json.Unmarshal(k.Result.Meta, &meta); err != nil {
				return nil, intern(err)
			}
		}
		meta.Report.Warnungen = orLeer(meta.Report.Warnungen)
		meta.Report.Verluste = orLeer(meta.Report.Verluste)
		if err := verlustePruefen(meta.Report, rumpf.AcceptLosses); err != nil {
			return nil, err
		}
		if neueFassung {
			insp, err := dokument.Inspizieren(a.ctxOderHintergrund(), bytes.NewReader(ergebnis))
			if err != nil {
				return nil, kernFehler(err)
			}
			if insp.Signiert {
				return nil, fehler(http.StatusUnprocessableEntity, "pdf.signed_original", nil)
			}
			if err := a.ablage.Ueberschreiben(d, ergebnis, k.BaseVersion, k.BaseSHA256); err != nil {
				return nil, err
			}
			a.auftraege.Verbraucht(id)
			return Ergebnis{FileID: d.ID, Name: d.Name, Version: d.Version, SHA256: d.SHA256, Report: meta.Report}, nil
		}
		name := dateinameMitEndung(rumpf.Destination.Name, stamm(d.Name)+" (Text erkannt)", ".pdf")
		pfad, err := neueDateiSchreiben(ordner, name, ergebnis)
		if err != nil {
			return nil, intern(err)
		}
		a.zuletzt.Merken(pfad)
		a.auftraege.Verbraucht(id)
		return Ergebnis{Name: filepath.Base(pfad), Version: 1, SHA256: pruefsumme(ergebnis), Report: meta.Report}, nil
	})
	if err != nil {
		return nil, err
	}
	return &erg, nil
}

func orLeer(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// ------------------------------------------------------------------
// Bindungen: Export
// ------------------------------------------------------------------

var exportFormate = map[string]string{"docx": ".docx", "odt": ".odt", "xlsx": ".xlsx", "csv": ".csv"}

type ExportCSV struct {
	Delimiter string `json:"delimiter"`
	Table     int    `json:"table"`
}

type ExportBefehl struct {
	Format       string                `json:"format"`
	Tables       []export.Tabellenwahl `json:"tables"`
	NumberLocale string                `json:"number_locale"`
	CSV          ExportCSV             `json:"csv"`
	Destination  Ziel                  `json:"destination"`
}

type exportAnfrage struct {
	JobID string
	Rumpf ExportBefehl
}

type ExportErgebnis struct {
	FileID   string           `json:"file_id"`
	Name     string           `json:"name"`
	Size     int64            `json:"size"`
	SHA256   string           `json:"sha256"`
	Warnings []export.Warnung `json:"warnings"`
}

// Modell ist GET /api/pdf/jobs/{id}/model: das Dokumentmodell einer
// fertigen Analyse.
func (a *App) Modell(id string) (*export.Dokument, error) {
	roh, _, err := a.auftraege.Ergebnis(id, auftragArtAnalyse)
	if err != nil {
		return nil, err
	}
	var dok export.Dokument
	if err := json.Unmarshal(roh, &dok); err != nil {
		return nil, intern(err)
	}
	return &dok, nil
}

// Exportieren ist POST /api/pdf/jobs/{id}/export: DOCX, ODT, XLSX oder
// CSV aus dem Modell als neue Datei im gewaehlten Ordner.
func (a *App) Exportieren(id string, befehl ExportBefehl, schluessel string) (*ExportErgebnis, error) {
	format := strings.ToLower(strings.TrimSpace(befehl.Format))
	endung, bekannt := exportFormate[format]
	if !bekannt {
		return nil, fehler(http.StatusBadRequest, "pdf.export_format_invalid", map[string]any{"formats": []string{"docx", "odt", "xlsx", "csv"}})
	}
	befehl.Format = format
	ordner, err := a.zielOrdner(befehl.Destination)
	if err != nil {
		return nil, err
	}
	dok, err := a.Modell(id)
	if err != nil {
		return nil, err
	}
	opt := export.Optionen{Tabellen: befehl.Tables, Zahlenformat: befehl.NumberLocale, CSVTrenner: befehl.CSV.Delimiter, CSVTabelle: befehl.CSV.Table}
	zellen, err := export.Zellen(*dok, opt)
	if err != nil {
		return nil, kernFehler(err)
	}
	if zellen > export.HoechstZellen {
		return nil, fehler(http.StatusRequestEntityTooLarge, "pdf.export_too_large",
			map[string]any{"max_pages": export.HoechstSeiten, "max_cells": export.HoechstZellen, "cells": zellen})
	}
	var erg ExportErgebnis
	err = a.vorgaenge.Ausfuehren(schluessel, "job_export", "", exportAnfrage{JobID: id, Rumpf: befehl}, &erg, func() (any, error) {
		var aus bytes.Buffer
		var warnungen []export.Warnung
		var err error
		switch format {
		case "docx":
			warnungen, err = export.DOCX(&aus, *dok, opt)
		case "odt":
			warnungen, err = export.ODT(&aus, *dok, opt)
		case "xlsx":
			warnungen, err = export.XLSX(&aus, *dok, opt)
		default:
			warnungen, err = export.CSV(&aus, *dok, opt)
		}
		if err != nil {
			return nil, kernFehler(err)
		}
		if warnungen == nil {
			warnungen = []export.Warnung{}
		}
		k, err := a.auftraege.Auftrag(id)
		if err != nil {
			return nil, err
		}
		ersatz := "Export"
		if d, err := a.ablage.Datei(k.FileID); err == nil {
			ersatz = stamm(d.Name)
		}
		name := dateinameMitEndung(befehl.Destination.Name, ersatz, endung)
		pfad, err := neueDateiSchreiben(ordner, name, aus.Bytes())
		if err != nil {
			return nil, intern(err)
		}
		return ExportErgebnis{Name: filepath.Base(pfad), Size: int64(aus.Len()), SHA256: pruefsumme(aus.Bytes()), Warnings: warnungen}, nil
	})
	if err != nil {
		return nil, err
	}
	return &erg, nil
}

// ------------------------------------------------------------------
// Bindungen: Dateien binden
// ------------------------------------------------------------------

type BindeQuelle struct {
	FileID          string `json:"file_id"`
	ExpectedVersion int    `json:"expected_version"`
	Pages           []int  `json:"pages"`
}

type BindeBefehl struct {
	Sources            []BindeQuelle `json:"sources"`
	Destination        Ziel          `json:"destination"`
	BookmarksPerSource bool          `json:"bookmarks_per_source"`
	AcceptLosses       []string      `json:"accept_losses"`
}

// DateiWahl ist eine gewaehlte Quelle (typen.ts: DateiWahl).
type DateiWahl struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// DateienWaehlen zeigt den nativen Dialog mit Mehrfachauswahl fuer
// weitere Quellen; leer heisst abgebrochen.
func (a *App) DateienWaehlen() ([]DateiWahl, error) {
	pfade, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "PDF-Dateien zum Binden wählen",
		Filters: []runtime.FileFilter{{DisplayName: "PDF", Pattern: "*.pdf"}},
	})
	if err != nil {
		return nil, intern(err)
	}
	aus := []DateiWahl{}
	for _, p := range pfade {
		d, err := a.ablage.Oeffnen(p)
		if err != nil {
			return nil, kernFehler(err)
		}
		aus = append(aus, DateiWahl{ID: d.ID, Name: d.Name})
	}
	return aus, nil
}

// Binden ist POST /api/pdf/merge: mehrere geoeffnete Dateien zu einer
// neuen im gewaehlten Ordner.
func (a *App) Binden(befehl BindeBefehl, schluessel string) (*Ergebnis, error) {
	if len(befehl.Sources) == 0 {
		return nil, fehler(http.StatusUnprocessableEntity, "pdf.nothing_to_do", nil)
	}
	if len(befehl.Sources) > dokument.HoechstQuellen {
		return nil, kernFehler(dokument.ErrZuVieleQuellen)
	}
	for _, q := range befehl.Sources {
		if q.Pages != nil && len(q.Pages) == 0 {
			return nil, fehler(http.StatusUnprocessableEntity, "pdf.no_pages", map[string]any{"file_id": q.FileID})
		}
		if _, err := a.ablage.Datei(q.FileID); err != nil {
			return nil, err
		}
	}
	ordner, err := a.zielOrdner(befehl.Destination)
	if err != nil {
		return nil, err
	}
	var erg Ergebnis
	err = a.vorgaenge.Ausfuehren(schluessel, "merge", "", befehl, &erg, func() (any, error) {
		quellen := make([]dokument.Quelle, 0, len(befehl.Sources))
		for _, q := range befehl.Sources {
			d, err := a.ablage.Datei(q.FileID)
			if err != nil {
				return nil, err
			}
			if q.ExpectedVersion > 0 && q.ExpectedVersion != d.Version {
				return nil, fehler(http.StatusPreconditionFailed, "pdf.version_conflict", map[string]any{"file_id": q.FileID, "current_version": d.Version})
			}
			quellen = append(quellen, dokument.Quelle{Inhalt: bytes.NewReader(d.Basis), Seiten: q.Pages, Titel: stamm(d.Name)})
		}
		var aus bytes.Buffer
		bericht, err := dokument.Binden(a.ctxOderHintergrund(), quellen, befehl.BookmarksPerSource, &aus)
		if err != nil {
			return nil, kernFehler(err)
		}
		if err := verlustePruefen(bericht, befehl.AcceptLosses); err != nil {
			return nil, err
		}
		pfad, err := neueDateiSchreiben(ordner, dateinameMitEndung(befehl.Destination.Name, "Gebunden", ".pdf"), aus.Bytes())
		if err != nil {
			return nil, intern(err)
		}
		a.zuletzt.Merken(pfad)
		return Ergebnis{Name: filepath.Base(pfad), Version: 1, SHA256: pruefsumme(aus.Bytes()), Report: bericht}, nil
	})
	if err != nil {
		return nil, err
	}
	return &erg, nil
}

// QuelleInfo ist GET /api/pdf/files/{id} fuer eine Quelle beim Binden.
func (a *App) QuelleInfo(id string) (*Info, error) { return a.Info(id) }

// ------------------------------------------------------------------
// Bindungen: Kopie sichern, Drucken, Lizenzen
// ------------------------------------------------------------------

// KopieSichern ist „Herunterladen“: den gespeicherten Stand unter einem
// gewaehlten Namen ablegen.
func (a *App) KopieSichern(id string) error {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return err
	}
	pfad, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Kopie sichern unter", DefaultFilename: d.Name, CanCreateDirectories: true,
		Filters: []runtime.FileFilter{{DisplayName: "PDF", Pattern: "*.pdf"}},
	})
	if err != nil {
		return intern(err)
	}
	if pfad == "" {
		return nil
	}
	if err := atomarSchreiben(pfad, d.Basis); err != nil {
		return intern(err)
	}
	return nil
}

// Drucken uebergibt den gespeicherten Stand als Kopie an das
// PDF-Programm des Systems (auf dem Mac die Vorschau), das den
// Druckdialog kennt — WKWebView druckt keine PDFs.
func (a *App) Drucken(id string) error {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return err
	}
	pfad, err := a.druckdatei(d.Name, d.Basis)
	if err != nil {
		return err
	}
	return intern(druckenUebergeben(a.ctx, pfad))
}

// druckdatei legt Bytes als Datei im Druckordner ab und liefert den Pfad.
func (a *App) druckdatei(name string, inhalt []byte) (string, error) {
	ordner := filepath.Join(a.tempWurzel, "drucken")
	if err := os.MkdirAll(ordner, 0o700); err != nil {
		return "", intern(err)
	}
	pfad := filepath.Join(ordner, filepath.Base(name))
	if err := os.WriteFile(pfad, inhalt, 0o600); err != nil {
		return "", intern(err)
	}
	return pfad, nil
}

// DruckBefehl ist POST /api/pdf/files/{id}/print (typen.ts: DruckBefehl):
// Seiten ab 0 (leer = alle), mit oder ohne Anmerkungen; Password und
// OwnerPassword (#247) wie beim Commit, nur fuer diesen Aufruf.
type DruckBefehl struct {
	Pages           []int  `json:"pages"`
	Annotations     *bool  `json:"annotations"`
	ExpectedVersion int    `json:"expected_version"`
	Password        string `json:"password"`
	OwnerPassword   string `json:"owner_password"`
}

// Druckfassung baut die Teil-PDF zum Drucken (Etappe 8) aus dem
// gespeicherten Stand und liefert sie als Base64 — nichts wird gespeichert.
func (a *App) Druckfassung(id string, befehl DruckBefehl) (string, error) {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return "", err
	}
	if befehl.ExpectedVersion > 0 && befehl.ExpectedVersion != d.Version {
		return "", konflikt(d.Version)
	}
	anmerkungen := befehl.Annotations == nil || *befehl.Annotations
	var aus bytes.Buffer
	if err := dokument.Druckfassung(a.ctxOderHintergrund(), bytes.NewReader(d.Basis), befehl.Pages, anmerkungen, befehl.Password, befehl.OwnerPassword, &aus); err != nil {
		return "", kernFehler(err)
	}
	return base64.StdEncoding.EncodeToString(aus.Bytes()), nil
}

// RechteKennwortPruefen ist POST /api/pdf/files/{id}/owner-password (#247):
// nil, wenn kennwort das Rechte-Kennwort der Datei ist, sonst 422
// pdf.wrong_password. Gespeichert wird nichts.
func (a *App) RechteKennwortPruefen(id string, kennwort string) error {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return err
	}
	return kernFehler(dokument.RechteKennwortPruefen(a.ctxOderHintergrund(), bytes.NewReader(d.Basis), kennwort))
}

// BytesDrucken druckt eine Teil-PDF (Base64) ueber denselben Weg wie
// Drucken: als Datei im Druckordner an den Druckweg des Systems.
func (a *App) BytesDrucken(name string, inhaltBase64 string) error {
	inhalt, err := base64.StdEncoding.DecodeString(inhaltBase64)
	if err != nil {
		return ungueltig("Inhalt ist kein Base64")
	}
	if !bytes.HasPrefix(inhalt, []byte("%PDF-")) {
		return ungueltig("Inhalt ist kein PDF")
	}
	pfad, err := a.druckdatei(dateinameMitEndung(name, "Druck", ".pdf"), inhalt)
	if err != nil {
		return err
	}
	return intern(druckenUebergeben(a.ctx, pfad))
}

// Schnelldruck gibt den gespeicherten Stand ohne Dialog an den
// Standarddrucker (Linux: lp, macOS: lpr). Wo es den Weg nicht gibt,
// bietet die Oberflaeche den Knopf nicht an (StartInfo.Schnelldruck).
func (a *App) Schnelldruck(id string) error {
	d, err := a.ablage.Datei(id)
	if err != nil {
		return err
	}
	pfad, err := a.druckdatei(d.Name, d.Basis)
	if err != nil {
		return err
	}
	return schnelldruckAusfuehren(pfad)
}

// ------------------------------------------------------------------
// Asset-Server: Bytes der Dateien und Ergebnisse
// ------------------------------------------------------------------

// dateiHandler liefert GET /datei/{id} (die geladenen Bytes) und
// GET /auftrag/{id}/ergebnis (das Ergebnis-PDF einer Erkennung). Nur
// Kennungen, nie Pfade; alles andere ist 404.
func (a *App) dateiHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /datei/{id}", func(w http.ResponseWriter, r *http.Request) {
		d, err := a.ablage.Datei(r.PathValue("id"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-File-Version", fmt.Sprint(d.Version))
		w.Header().Set("ETag", `"`+d.SHA256+`"`)
		w.Write(d.Basis)
	})
	mux.HandleFunc("GET /auftrag/{id}/ergebnis", func(w http.ResponseWriter, r *http.Request) {
		roh, _, err := a.auftraege.Ergebnis(r.PathValue("id"), auftragArtOCR)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(roh)
	})
	return mux
}

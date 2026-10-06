// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Anmerkungen (Etappe 2, Vertrag vom 29.09.2026).
//
// Eine Anmerkung aus OpenIntraPDF steht IM PDF, mit eigenem
// Erscheinungsbild (AP), und ist ohne OIH-Konto in jedem PDF-Programm
// sichtbar (Konzept Kap. 04). Der Adapter schreibt die Objekte selbst in
// das pdfcpu-Objektmodell — pdfcpus eigene Anmerkungsfunktionen erzeugen
// keine Erscheinungsbilder, und ohne AP zeichnet jedes Programm etwas
// anderes (Engineprobe 29.09.2026).
//
// Geometrie: alle Angaben im PDF-Benutzerraum der Seite, page ist der
// 0-basierte Index im Basisdokument. Bestehende Anmerkungen werden wie in
// pdf.js ueber "<objnr>R" angesprochen.
//
// Fremde Anmerkungen — auch unbekannter Art — bleiben unveraendert; der
// Adapter fasst nur an, was ein Befehl nennt.

// Grenzen laut Vertrag Etappe 2 (413 pdf.too_many_operations).
const (
	// HoechstBefehle: Anmerkungsbefehle je Commit (add+update+delete+state).
	HoechstBefehle = 500
	// HoechstZeichen: Laenge von contents.
	HoechstZeichen = 10000
	// HoechstPunkte: Punkte aller Freihandpfade eines Commits zusammen.
	HoechstPunkte = 5000
)

// Arten neuer Anmerkungen (Feld kind) und ihr PDF-Subtype. sticky (Post-it)
// und stamp (Stempel) kamen mit Etappe 5 dazu (postit.go, stempel.go), link
// (Verknuepfung ohne sichtbaren Rahmen, mit URI- oder GoTo-Aktion) mit
// Etappe 9.
var anmerkungsArten = map[string]string{
	"note": "Text", "highlight": "Highlight", "underline": "Underline", "strikeout": "StrikeOut",
	"freetext": "FreeText", "ink": "Ink", "line": "Line", "arrow": "Line", "square": "Square", "circle": "Circle",
	"sticky": "FreeText", "stamp": "Stamp", "link": "Link",
}

// anmerkungsReihenfolge ist die Reihenfolge, in der die Faehigkeitsauskunft
// die Arten nennt.
var anmerkungsReihenfolge = []string{"note", "highlight", "underline", "strikeout", "freetext", "ink", "line",
	"arrow", "square", "circle", "sticky", "stamp", "link"}

// HoechstAdresse ist die laengste Web-Adresse eines Links.
const HoechstAdresse = 2000

// linkSchemata sind die einzigen erlaubten Schemata einer Link-Adresse
// (Vertrag Abschnitt 4): alles andere — javascript:, file:, data: — wird
// abgewiesen.
var linkSchemata = map[string]bool{"http": true, "https": true, "mailto": true}

// AnmerkungsArten nennt die Werte, die kind annehmen darf — fuer
// features.annotation_kinds der Faehigkeitsauskunft.
func AnmerkungsArten() []string {
	return append([]string(nil), anmerkungsReihenfolge...)
}

var (
	// ErrZuVieleBefehle: mehr Befehle, Text oder Punkte als die Grenzen erlauben.
	ErrZuVieleBefehle = errors.New("dokument: zu viele Anmerkungsbefehle")
	// ErrAnmerkungUngueltig: ein Befehl ist unvollstaendig, nennt eine
	// unbekannte Art, eine Seite oder ein Objekt, das es nicht gibt oder das
	// keine Anmerkung ist.
	ErrAnmerkungUngueltig = errors.New("dokument: Anmerkungsbefehl ungueltig")
	// ErrAnmerkungHatAntworten: Die Anmerkung soll weg, aber an ihr haengen
	// Antworten, die nicht mitgehen duerfen (siehe Anmerkungsbefehle.Eigene).
	ErrAnmerkungHatAntworten = errors.New("dokument: Anmerkung hat fremde Antworten")
	// ErrFremdeAnmerkung: Der Befehl trifft eine Anmerkung, die dem Aufrufer
	// nicht gehoert, und er darf nur eigene aendern.
	ErrFremdeAnmerkung = errors.New("dokument: fremde Anmerkung")
)

// Anmerkungsfehler traegt zu einem der Fehler oben, welcher Befehl ihn
// ausloeste. Antworten sind die Verweise ("<objnr>R") der Antworten, die
// eine Loeschung verhindern.
type Anmerkungsfehler struct {
	Art       error
	Ref       string
	Detail    string
	Antworten []string
}

func (f *Anmerkungsfehler) Error() string {
	s := f.Art.Error()
	if f.Ref != "" {
		s += " " + f.Ref
	}
	if f.Detail != "" {
		s += ": " + f.Detail
	}
	return s
}

func (f *Anmerkungsfehler) Unwrap() error { return f.Art }

func ungueltig(ref, detail string) error {
	return &Anmerkungsfehler{Art: ErrAnmerkungUngueltig, Ref: ref, Detail: detail}
}

// Anmerkungsbefehle ist das Feld annotations eines Commits.
type Anmerkungsbefehle struct {
	Add    []NeueAnmerkung     `json:"add"`
	Update []Anmerkungstext    `json:"update"`
	Delete []Anmerkungsverweis `json:"delete"`
	State  []Anmerkungsstatus  `json:"state"`

	// Autor wird als T in jede neue Anmerkung geschrieben — der
	// Anzeigename der angemeldeten Person, den der Gastgeber kennt.
	Autor string `json:"-"`
	// Zeit fuer M und CreationDate; leer heisst jetzt.
	Zeit time.Time `json:"-"`
	// Eigene nennt die NM der Anmerkungen, die der Aufrufer selbst
	// geschrieben hat (der Gastgeber weiss das aus seiner Urheberschaft; der
	// Autorname im PDF zaehlt nicht). Antworten mit diesen NM gehen beim
	// Loeschen ihres Elternteils mit, alle anderen verhindern die Loeschung.
	Eigene map[string]bool `json:"-"`
	// NurEigene: update, delete und state nur auf Anmerkungen aus Eigene
	// (Kommentarrecht). Antworten auf fremde Anmerkungen sind immer erlaubt.
	NurEigene bool `json:"-"`
	// Zusatzdrehung: Seitenindex -> Drehung, die ein Seitenplan derselben
	// Fassung DANACH auf die Seite legt (CommitBauen setzt sie). Ein
	// Textfeld steht dann in der Anzeige aufrecht, wie die Person es im
	// gedrehten Entwurf gesetzt hat.
	Zusatzdrehung map[int]int `json:"-"`
}

// NeueAnmerkung ist ein add-Befehl. Welche Geometrie zaehlt, haengt von
// kind ab: note nimmt den Ankerpunkt rect[0..1]; highlight, underline und
// strikeout quads; freetext, sticky, stamp, square und circle rect; ink
// paths; line und arrow line.
type NeueAnmerkung struct {
	ClientID string      `json:"client_id"`
	Page     int         `json:"page"`
	Kind     string      `json:"kind"`
	Rect     []float64   `json:"rect"`
	Quads    [][]float64 `json:"quads"`
	Paths    [][]float64 `json:"paths"`
	Line     []float64   `json:"line"`
	Contents string      `json:"contents"`
	Color    []float64   `json:"color"`
	Width    float64     `json:"width"`
	FontSize float64     `json:"font_size"`
	// ReplyTo: "<objnr>R" einer bestehenden oder client_id einer im selben
	// Commit davor angelegten Anmerkung; leer heisst keine Antwort.
	ReplyTo string `json:"reply_to"`
	// Stamp gehoert zu kind stamp (Pflicht dort, sonst verboten).
	Stamp *Stempel `json:"stamp,omitempty"`
	// URI oder PageTarget gehoert zu kind link (genau eines; Etappe 9): eine
	// Web-Adresse (http, https, mailto) oder die Zielseite im Basisdokument
	// (ab 0).
	URI        string `json:"uri,omitempty"`
	PageTarget *int   `json:"page_target,omitempty"`
}

// Anmerkungstext ist ein update-Befehl: neuer Text einer Anmerkung.
type Anmerkungstext struct {
	Ref      string `json:"ref"`
	Page     *int   `json:"page"`
	Contents string `json:"contents"`
}

// Anmerkungsverweis ist ein delete-Befehl. Er kommt als "14R" oder als
// {"ref": "14R", "page": 0} — der Vertrag zeigt beides.
type Anmerkungsverweis struct {
	Ref  string `json:"ref"`
	Page *int   `json:"page"`
}

func (v *Anmerkungsverweis) UnmarshalJSON(roh []byte) error {
	if len(roh) > 0 && roh[0] == '"' {
		v.Page = nil
		return json.Unmarshal(roh, &v.Ref)
	}
	type schlicht Anmerkungsverweis
	return json.Unmarshal(roh, (*schlicht)(v))
}

// Anmerkungsstatus ist ein state-Befehl: completed oder none.
type Anmerkungsstatus struct {
	Ref   string `json:"ref"`
	Page  *int   `json:"page"`
	State string `json:"state"`
}

// Leer sagt, ob kein Befehl darin steht.
func (b *Anmerkungsbefehle) Leer() bool {
	return b == nil || len(b.Add)+len(b.Update)+len(b.Delete)+len(b.State) == 0
}

// Pruefen weist Befehle ab, die ohne Dokument schon falsch sind: Grenzen
// (ErrZuVieleBefehle), unbekannte Arten, fehlende oder unsinnige Geometrie,
// ungueltige Verweise (ErrAnmerkungUngueltig).
func (b *Anmerkungsbefehle) Pruefen() error {
	if b == nil {
		return nil
	}
	if len(b.Add)+len(b.Update)+len(b.Delete)+len(b.State) > HoechstBefehle {
		return fmt.Errorf("%w: mehr als %d Befehle", ErrZuVieleBefehle, HoechstBefehle)
	}
	punkte := 0
	kennungen := map[string]bool{}
	for i, a := range b.Add {
		wo := "add[" + strconv.Itoa(i) + "]"
		if err := textPruefen(a.Contents); err != nil {
			return err
		}
		if a.ClientID != "" {
			if kennungen[a.ClientID] {
				return ungueltig(wo, "client_id doppelt: "+a.ClientID)
			}
			kennungen[a.ClientID] = true
		}
		if a.ReplyTo != "" && !istVerweis(a.ReplyTo) && !kennungen[a.ReplyTo] {
			return ungueltig(wo, "reply_to nennt weder eine Anmerkung noch eine client_id davor: "+a.ReplyTo)
		}
		if a.Page < 0 {
			return ungueltig(wo, "page negativ")
		}
		if _, ok := anmerkungsArten[a.Kind]; !ok {
			return ungueltig(wo, "unbekannte Art "+strconv.Quote(a.Kind))
		}
		if len(a.Color) != 0 && len(a.Color) != 3 {
			return ungueltig(wo, "color braucht drei Werte")
		}
		for _, c := range a.Color {
			if !(c >= 0 && c <= 1) {
				return ungueltig(wo, "color ausserhalb 0..1")
			}
		}
		if a.Width < 0 || a.Width > 50 || a.FontSize < 0 || a.FontSize > 200 {
			return ungueltig(wo, "width oder font_size ausserhalb des Bereichs")
		}
		if a.Stamp != nil && a.Kind != "stamp" {
			return ungueltig(wo, "stamp nur bei kind stamp")
		}
		if (a.URI != "" || a.PageTarget != nil) && a.Kind != "link" {
			return ungueltig(wo, "uri und page_target nur bei kind link")
		}
		switch a.Kind {
		case "note":
			if len(a.Rect) < 2 || !endlich(a.Rect[:2]) {
				return ungueltig(wo, "note braucht rect[0..1] als Ankerpunkt")
			}
		case "freetext", "square", "circle", "sticky", "stamp":
			if len(a.Rect) != 4 || !endlich(a.Rect) || a.Rect[0] == a.Rect[2] || a.Rect[1] == a.Rect[3] {
				return ungueltig(wo, a.Kind+" braucht rect mit Flaeche")
			}
			if a.Kind == "stamp" {
				if a.Stamp == nil {
					return ungueltig(wo, "stamp fehlt")
				}
				if err := a.Stamp.pruefen(wo); err != nil {
					return err
				}
			}
		case "link":
			if len(a.Rect) != 4 || !endlich(a.Rect) || a.Rect[0] == a.Rect[2] || a.Rect[1] == a.Rect[3] {
				return ungueltig(wo, "link braucht rect mit Flaeche")
			}
			if (a.URI == "") == (a.PageTarget == nil) {
				return ungueltig(wo, "link braucht entweder uri oder page_target")
			}
			if a.PageTarget != nil && *a.PageTarget < 0 {
				return ungueltig(wo, "page_target negativ")
			}
			if a.URI != "" {
				if err := adressePruefen(a.URI); err != nil {
					return ungueltig(wo, err.Error())
				}
			}
		case "highlight", "underline", "strikeout":
			if len(a.Quads) == 0 {
				return ungueltig(wo, a.Kind+" braucht quads")
			}
			for _, q := range a.Quads {
				if len(q) != 8 || !endlich(q) {
					return ungueltig(wo, "jedes quad hat acht Zahlen")
				}
			}
		case "ink":
			if len(a.Paths) == 0 {
				return ungueltig(wo, "ink braucht paths")
			}
			for _, p := range a.Paths {
				if len(p) < 4 || len(p)%2 != 0 || !endlich(p) {
					return ungueltig(wo, "jeder Pfad hat mindestens zwei Punkte als x,y-Paare")
				}
				punkte += len(p) / 2
			}
		case "line", "arrow":
			if len(a.Line) != 4 || !endlich(a.Line) {
				return ungueltig(wo, a.Kind+" braucht line mit vier Zahlen")
			}
		}
	}
	if punkte > HoechstPunkte {
		return fmt.Errorf("%w: mehr als %d Punkte in Freihandpfaden", ErrZuVieleBefehle, HoechstPunkte)
	}
	for _, u := range b.Update {
		if err := textPruefen(u.Contents); err != nil {
			return err
		}
		if err := verweisPruefen(u.Ref, u.Page); err != nil {
			return err
		}
	}
	for _, d := range b.Delete {
		if err := verweisPruefen(d.Ref, d.Page); err != nil {
			return err
		}
	}
	for _, s := range b.State {
		if err := verweisPruefen(s.Ref, s.Page); err != nil {
			return err
		}
		if s.State != "completed" && s.State != "none" {
			return ungueltig(s.Ref, "state muss completed oder none sein")
		}
	}
	return nil
}

// adressePruefen laesst nur http-, https- und mailto-Adressen durch —
// absolut, ohne Steuerzeichen, hoechstens HoechstAdresse Zeichen.
func adressePruefen(s string) error {
	if utf8.RuneCountInString(s) > HoechstAdresse {
		return fmt.Errorf("uri laenger als %d Zeichen", HoechstAdresse)
	}
	if !utf8.ValidString(s) || strings.ContainsFunc(s, func(r rune) bool { return r < 32 || r == 127 }) {
		return errors.New("uri enthaelt Steuerzeichen")
	}
	u, err := url.Parse(s)
	if err != nil || !linkSchemata[strings.ToLower(u.Scheme)] {
		return errors.New("uri muss mit http:, https: oder mailto: beginnen")
	}
	if u.Scheme != "mailto" && u.Host == "" {
		return errors.New("uri ohne Host")
	}
	return nil
}

func textPruefen(s string) error {
	if utf8.RuneCountInString(s) > HoechstZeichen {
		return fmt.Errorf("%w: Text laenger als %d Zeichen", ErrZuVieleBefehle, HoechstZeichen)
	}
	if !utf8.ValidString(s) {
		return ungueltig("", "contents ist kein gueltiges UTF-8")
	}
	return nil
}

func verweisPruefen(ref string, seite *int) error {
	if !istVerweis(ref) {
		return ungueltig(ref, "ref muss die Form <objnr>R haben")
	}
	if seite != nil && *seite < 0 {
		return ungueltig(ref, "page negativ")
	}
	return nil
}

// istVerweis erkennt "<objnr>R".
func istVerweis(s string) bool {
	_, ok := objNrVon(s)
	return ok
}

func objNrVon(s string) (int, bool) {
	if len(s) < 2 || !strings.HasSuffix(s, "R") {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimSuffix(s, "R"))
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func verweisVon(nr int) string { return strconv.Itoa(nr) + "R" }

func endlich(v []float64) bool {
	for _, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) || math.Abs(x) > 1e6 {
			return false
		}
	}
	return true
}

// AnmerkungHinzugefuegt ordnet einer client_id die neue Anmerkung zu.
type AnmerkungHinzugefuegt struct {
	ClientID string `json:"client_id"`
	Ref      string `json:"ref"`
	NM       string `json:"nm"`
}

// Anmerkungsergebnis sagt, was AnmerkungenAnwenden getan hat. Die
// JSON-Form ist das Feld annotations der Commit-Antwort.
type Anmerkungsergebnis struct {
	Added []AnmerkungHinzugefuegt `json:"added"`

	// vorher: Objektnummer -> Seitenindex jeder Anmerkung (ohne Widgets,
	// Links, Popups), wie sie VOR den Befehlen da war.
	vorher map[int]int
	// entfernt: Objektnummern der geloeschten Anmerkungen (ohne Popups).
	entfernt map[int]bool
	// neu: alle in diesem Lauf angelegten Anmerkungen (auch Status).
	neu []neueAnmerkung
	// warnungen: Hinweise fuer den Bericht (sticky_text_truncated,
	// glyphs_missing); CommitBauen traegt sie ein.
	warnungen []string
}

func (e *Anmerkungsergebnis) warnung(code string) {
	if !slices.Contains(e.warnungen, code) {
		e.warnungen = append(e.warnungen, code)
	}
}

// Kennungen nennt die NM aller angelegten Anmerkungen — auch der
// Statusanmerkungen, die nicht in Added stehen. Der Gastgeber vermerkt
// dazu die Urheberschaft.
func (e Anmerkungsergebnis) Kennungen() []string {
	aus := make([]string, 0, len(e.neu))
	for _, n := range e.neu {
		aus = append(aus, n.nm)
	}
	return aus
}

type neueAnmerkung struct {
	nr    int
	nm    string
	seite int
}

// anwender fuehrt die Befehle an einem geoeffneten Dokument aus.
type anwender struct {
	c      context.Context
	ctx    *model.Context
	x      *model.XRefTable
	seiten []blatt
	b      Anmerkungsbefehle
	jetzt  string
	zeit   time.Time

	// noto: die Noto-Verwendung des Laufs je Schnitt (false normal, true
	// fett); leer, solange jeder Text in WinAnsi darstellbar war.
	noto map[bool]*notoVerwendung

	// bestand: jede Annotation mit indirektem Verweis, nach Objektnummer.
	bestand map[int]eintrag
	// antworten: Objektnummer -> Objektnummern der Antworten (IRT).
	antworten map[int][]int
	// eigene: Eigene plus alles, was dieser Lauf anlegt.
	eigene map[string]bool
	// kennungen: client_id -> Verweis der angelegten Anmerkung.
	kennungen map[string]types.IndirectRef
	erg       Anmerkungsergebnis
}

type eintrag struct {
	anmerkung
	seite int
}

// AnmerkungenAnwenden fuehrt die Befehle am geoeffneten Dokument aus —
// erst add, dann update, state, delete. Geschrieben wird hier nichts; das
// tut der Aufrufer (CommitBauen), der das Ergebnis danach wieder oeffnet und
// prueft.
func AnmerkungenAnwenden(c context.Context, ctx *model.Context, b Anmerkungsbefehle) (Anmerkungsergebnis, error) {
	if err := b.Pruefen(); err != nil {
		return Anmerkungsergebnis{}, err
	}
	seiten, err := blaetter(ctx)
	if err != nil {
		return Anmerkungsergebnis{}, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	zeit := b.Zeit
	if zeit.IsZero() {
		zeit = time.Now()
	}
	a := &anwender{
		c: c, ctx: ctx, x: ctx.XRefTable, seiten: seiten, b: b, jetzt: types.DateString(zeit), zeit: zeit,
		bestand: map[int]eintrag{}, antworten: map[int][]int{}, eigene: map[string]bool{},
		kennungen: map[string]types.IndirectRef{},
		erg:       Anmerkungsergebnis{Added: []AnmerkungHinzugefuegt{}, vorher: map[int]int{}, entfernt: map[int]bool{}},
	}
	for nm := range b.Eigene {
		a.eigene[nm] = true
	}
	a.erg.vorher = anmerkungsbestand(a.x, seiten)
	for i, s := range seiten {
		for _, an := range anmerkungen(a.x, s.dict) {
			if an.ref == nil {
				continue
			}
			a.bestand[an.nr()] = eintrag{an, i}
			if eltern, ok := objNr(an.dict["IRT"]); ok {
				a.antworten[eltern] = append(a.antworten[eltern], an.nr())
			}
		}
	}

	for i, n := range b.Add {
		if err := a.hinzufuegen(n, "add["+strconv.Itoa(i)+"]"); err != nil {
			return Anmerkungsergebnis{}, err
		}
	}
	for _, u := range b.Update {
		if err := a.aendern(u); err != nil {
			return Anmerkungsergebnis{}, err
		}
	}
	for _, s := range b.State {
		if err := a.status(s); err != nil {
			return Anmerkungsergebnis{}, err
		}
	}
	if err := a.loeschen(b.Delete); err != nil {
		return Anmerkungsergebnis{}, err
	}
	// Erst jetzt steht fest, welche Glyphen die Erscheinungsbilder brauchen.
	if err := a.schriftenAbschliessen(); err != nil {
		return Anmerkungsergebnis{}, err
	}
	return a.erg, c.Err()
}

// anmerkungsbestand: Objektnummer -> Seitenindex jeder Anmerkung (ohne
// Widgets, Links, Popups), die ein Verweis erreichen kann.
func anmerkungsbestand(x *model.XRefTable, seiten []blatt) map[int]int {
	aus := map[int]int{}
	for i, s := range seiten {
		for _, an := range anmerkungen(x, s.dict) {
			if an.ref != nil && an.art() == artAnmerkung {
				aus[an.nr()] = i
			}
		}
	}
	return aus
}

// ziel loest einen Verweis auf eine bestehende Anmerkung auf und prueft,
// dass sie eine Anmerkung (oder ein Link, Etappe 9) ist, auf der genannten
// Seite haengt und — bei NurEigene — dem Aufrufer gehoert.
func (a *anwender) ziel(ref string, seite *int, nurEigene bool) (eintrag, error) {
	nr, _ := objNrVon(ref)
	e, ok := a.bestand[nr]
	if !ok || (e.art() != artAnmerkung && e.art() != artLink) {
		return eintrag{}, ungueltig(ref, "keine Anmerkung dieses Dokuments")
	}
	if seite != nil && *seite != e.seite {
		return eintrag{}, ungueltig(ref, fmt.Sprintf("liegt auf Seite %d, nicht %d", e.seite, *seite))
	}
	if nurEigene && a.b.NurEigene {
		nm, _ := alsText(a.x, e.dict["NM"])
		if nm == "" || !a.b.Eigene[nm] {
			return eintrag{}, &Anmerkungsfehler{Art: ErrFremdeAnmerkung, Ref: ref}
		}
	}
	return e, nil
}

// ============================================================
// add
// ============================================================

func (a *anwender) hinzufuegen(n NeueAnmerkung, wo string) error {
	if n.Page >= len(a.seiten) {
		return ungueltig(wo, fmt.Sprintf("page %d, das Dokument hat %d Seiten", n.Page, len(a.seiten)))
	}
	seite := a.seiten[n.Page]
	var antwortAuf *types.IndirectRef
	if n.ReplyTo != "" {
		if r, ok := a.kennungen[n.ReplyTo]; ok {
			antwortAuf = &r
		} else {
			e, err := a.ziel(n.ReplyTo, nil, false)
			if err != nil {
				return err
			}
			if e.art() == artLink {
				return ungueltig(wo, "auf einen Link gibt es keine Antwort")
			}
			if e.seite != n.Page {
				return ungueltig(wo, "Antwort liegt nicht auf der Seite der Anmerkung "+n.ReplyTo)
			}
			antwortAuf = e.ref
		}
	}
	nm := neueKennung()
	if n.Kind == "link" {
		return a.linkAnlegen(n, seite, nm, wo)
	}
	d := a.grunddict(seite, nm, n.Contents, antwortAuf)
	farbe := n.Color
	if len(farbe) != 3 {
		switch n.Kind {
		case "note", "highlight":
			farbe = []float64{1, 0.85, 0.1}
		case "sticky":
			farbe = postitGelb
		case "stamp":
			farbe = stempelRot
		default:
			farbe = []float64{0.85, 0.1, 0.1}
		}
	}
	// Das Post-it traegt seine Farbe in OIHFill, nicht in C (Begruendung in
	// postit.go).
	if n.Kind != "sticky" {
		d["C"] = types.NewNumberArray(farbe[0], farbe[1], farbe[2])
	}
	d["Subtype"] = types.Name(anmerkungsArten[n.Kind])
	breite := n.Width
	if breite <= 0 {
		breite = 1
	}

	var rect, bbox [4]float64
	var inhalt string
	var res types.Dict
	var matrix []float64
	switch n.Kind {
	case "note":
		d["Name"] = types.Name("Comment")
		d["F"] = types.Integer(4 | 8 | 16) // Print NoZoom NoRotate: das Symbol bleibt aufrecht
		x, y := n.Rect[0], n.Rect[1]
		// Eine Antwort gehoert an die Stelle ihrer Ursprungsanmerkung --
		// links oben in deren Rechteck, bei einer Notiz deckungsgleich (so
		// legt Acrobat Antworten an). Das mitgeschickte Rechteck zaehlt
		// dann nicht: Mit [0 0] stand die Antwort sonst als eigenes Symbol
		// unten links auf der Seite (Dev-Probe 29.09.2026).
		if antwortAuf != nil {
			if eltern, err := a.x.DereferenceDict(*antwortAuf); err == nil && eltern != nil {
				if r := rectVon(a.x, eltern); r != nil {
					x, y = r[0], r[3]-20
				}
			}
		}
		rect = [4]float64{x, y, x + 20, y + 20}
		bbox = [4]float64{0, 0, 20, 20}
		inhalt = farbeOp(farbe, "rg") + " 0 0 0 RG 0.6 w 1 4 m 1 19 l 19 19 l 19 4 l 9 4 l 5 0 l 6 4 l h B" +
			" 0 g 4 15 m 16 15 l 4 11.5 m 16 11.5 l 4 8 m 12 8 l S"
	case "highlight", "underline", "strikeout":
		rect, bbox, inhalt, res = markierung(d, n.Kind, n.Quads, farbe)
	case "freetext":
		rect = geordnet(n.Rect)
		drehung := ((a.drehung(seite)+a.b.Zusatzdrehung[n.Page])%360 + 360) % 360
		var err error
		if bbox, inhalt, res, matrix, err = a.textfeld(d, rect, n.Contents, farbe, n.FontSize, drehung); err != nil {
			return err
		}
	case "sticky":
		rect = geordnet(n.Rect)
		drehung := ((a.drehung(seite)+a.b.Zusatzdrehung[n.Page])%360 + 360) % 360
		var gekuerzt bool
		var err error
		if bbox, inhalt, res, matrix, gekuerzt, err = a.postit(d, rect, n.Contents, farbe, n.FontSize, drehung); err != nil {
			return err
		}
		if gekuerzt {
			a.erg.warnung(WarnungPostitGekuerzt)
		}
	case "stamp":
		rect = geordnet(n.Rect)
		drehung := ((a.drehung(seite)+a.b.Zusatzdrehung[n.Page])%360 + 360) % 360
		var err error
		if bbox, inhalt, res, matrix, err = a.stempel(d, rect, *n.Stamp, farbe, drehung); err != nil {
			return err
		}
	case "ink":
		d["BS"] = types.Dict{"W": types.Float(breite)}
		var liste types.Array
		var alle []float64
		var s strings.Builder
		fmt.Fprintf(&s, "%s w 1 J 1 j %s ", zahl(breite), farbeOp(farbe, "RG"))
		for _, p := range n.Paths {
			var arr types.Array
			for i := 0; i+1 < len(p); i += 2 {
				arr = append(arr, types.Float(p[i]), types.Float(p[i+1]))
				op := "l"
				if i == 0 {
					op = "m"
				}
				fmt.Fprintf(&s, "%s %s %s ", zahl(p[i]), zahl(p[i+1]), op)
			}
			s.WriteString("S ")
			liste = append(liste, arr)
			alle = append(alle, p...)
		}
		d["InkList"] = liste
		rect = umschliessend(alle, breite)
		bbox = rect
		inhalt = s.String()
	case "line", "arrow":
		l := n.Line
		d["L"] = types.NewNumberArray(l[0], l[1], l[2], l[3])
		d["BS"] = types.Dict{"W": types.Float(breite)}
		var s strings.Builder
		fmt.Fprintf(&s, "%s w 1 J 1 j %s %s %s m %s %s l S ", zahl(breite), farbeOp(farbe, "RG"),
			zahl(l[0]), zahl(l[1]), zahl(l[2]), zahl(l[3]))
		punkte := []float64{l[0], l[1], l[2], l[3]}
		if n.Kind == "arrow" {
			d["LE"] = types.Array{types.Name("None"), types.Name("OpenArrow")}
			w := math.Atan2(l[3]-l[1], l[2]-l[0])
			g := 6 + 2*breite
			x1, y1 := l[2]-g*math.Cos(w-0.45), l[3]-g*math.Sin(w-0.45)
			x2, y2 := l[2]-g*math.Cos(w+0.45), l[3]-g*math.Sin(w+0.45)
			fmt.Fprintf(&s, "%s %s m %s %s l %s %s l S", zahl(x1), zahl(y1), zahl(l[2]), zahl(l[3]), zahl(x2), zahl(y2))
			punkte = append(punkte, x1, y1, x2, y2)
		}
		rect = umschliessend(punkte, breite+1)
		bbox = rect
		inhalt = s.String()
	case "square", "circle":
		d["BS"] = types.Dict{"W": types.Float(breite)}
		rect = geordnet(n.Rect)
		bbox = rect
		inhalt = form(n.Kind, rect, breite, farbe)
	}
	d["Rect"] = types.NewNumberArray(rect[0], rect[1], rect[2], rect[3])
	ap, err := a.erscheinung(bbox, inhalt, res, matrix)
	if err != nil {
		return err
	}
	d["AP"] = types.Dict{"N": *ap}

	ref, err := a.x.IndRefForNewObject(d)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	neu := types.Array{*ref}
	// Haftnotiz: Popup dazu, wie Acrobat es anlegt — rechts neben dem
	// Symbol, geschlossen.
	if n.Kind == "note" && antwortAuf == nil {
		popup := types.Dict{
			"Type": types.Name("Annot"), "Subtype": types.Name("Popup"),
			"Parent": *ref, "P": seite.ref,
			"Rect": types.NewNumberArray(rect[2]+10, rect[3]-100, rect[2]+210, rect[3]),
			"Open": types.Boolean(false), "F": types.Integer(28),
		}
		pref, err := a.x.IndRefForNewObject(popup)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		d["Popup"] = *pref
		neu = append(neu, *pref)
	}
	if err := a.anhaengen(seite, neu); err != nil {
		return err
	}
	a.merken(*ref, nm, n.Page, d)
	if n.ClientID != "" {
		a.kennungen[n.ClientID] = *ref
	}
	a.erg.Added = append(a.erg.Added, AnmerkungHinzugefuegt{ClientID: n.ClientID, Ref: verweisVon(ref.ObjectNumber.Value()), NM: nm})
	return nil
}

// linkAnlegen schreibt eine Verknuepfung (Etappe 9): /Subtype /Link ohne
// sichtbaren Rahmen (/Border [0 0 0]), mit /A << /S /URI >> oder
// /A << /S /GoTo /D [Seite /Fit] >>. Kein Erscheinungsbild, kein Autor im
// PDF — die Urheberschaft haengt wie sonst an NM. Ein Link ist keine
// Markup-Anmerkung, darum ohne T und ohne Popup.
func (a *anwender) linkAnlegen(n NeueAnmerkung, seite blatt, nm, wo string) error {
	rect := geordnet(n.Rect)
	d := types.Dict{
		"Type": types.Name("Annot"), "Subtype": types.Name("Link"), "P": seite.ref,
		"NM": utf16(nm), "M": types.StringLiteral(a.jetzt), "F": types.Integer(4),
		"Rect":   types.NewNumberArray(rect[0], rect[1], rect[2], rect[3]),
		"Border": types.NewIntegerArray(0, 0, 0),
	}
	if n.URI != "" {
		d["A"] = types.Dict{"S": types.Name("URI"), "URI": types.StringLiteral(adresseMaskiert(n.URI))}
	} else {
		if *n.PageTarget >= len(a.seiten) {
			return ungueltig(wo, fmt.Sprintf("page_target %d, das Dokument hat %d Seiten", *n.PageTarget, len(a.seiten)))
		}
		d["A"] = types.Dict{"S": types.Name("GoTo"), "D": types.Array{a.seiten[*n.PageTarget].ref, types.Name("Fit")}}
	}
	ref, err := a.x.IndRefForNewObject(d)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	if err := a.anhaengen(seite, types.Array{*ref}); err != nil {
		return err
	}
	a.merken(*ref, nm, n.Page, d)
	if n.ClientID != "" {
		a.kennungen[n.ClientID] = *ref
	}
	a.erg.Added = append(a.erg.Added, AnmerkungHinzugefuegt{ClientID: n.ClientID, Ref: verweisVon(ref.ObjectNumber.Value()), NM: nm})
	return nil
}

// adresseMaskiert schreibt eine Adresse als PDF-Stringliteral: Nicht-ASCII
// prozentkodiert (die Norm verlangt ASCII in /URI), Klammern und
// Rueckstrich maskiert.
func adresseMaskiert(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c == '(' || c == ')' || c == '\\':
			b.WriteByte('\\')
			b.WriteByte(c)
		case c >= 32 && c < 127:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// grunddict ist, was jede neue Anmerkung traegt: NM, T, Zeiten, Print.
func (a *anwender) grunddict(seite blatt, nm, text string, antwortAuf *types.IndirectRef) types.Dict {
	d := types.Dict{
		"Type": types.Name("Annot"), "P": seite.ref,
		"NM": utf16(nm), "M": types.StringLiteral(a.jetzt), "CreationDate": types.StringLiteral(a.jetzt),
		"F": types.Integer(4),
	}
	if text != "" {
		d["Contents"] = utf16(text)
	}
	if a.b.Autor != "" {
		d["T"] = utf16(a.b.Autor)
	}
	if antwortAuf != nil {
		d["IRT"] = *antwortAuf
		d["RT"] = types.Name("R")
	}
	return d
}

// merken nimmt eine neue Anmerkung in Bestand, Antwortbaum und Ergebnis auf.
func (a *anwender) merken(ref types.IndirectRef, nm string, seite int, d types.Dict) {
	r := ref
	a.bestand[ref.ObjectNumber.Value()] = eintrag{anmerkung{ref: &r, dict: d, typ: alsName(a.x, d["Subtype"])}, seite}
	if eltern, ok := objNr(d["IRT"]); ok {
		a.antworten[eltern] = append(a.antworten[eltern], ref.ObjectNumber.Value())
	}
	a.eigene[nm] = true
	a.erg.neu = append(a.erg.neu, neueAnmerkung{nr: ref.ObjectNumber.Value(), nm: nm, seite: seite})
}

// anhaengen setzt Verweise ans Ende von /Annots der Seite — auch, wenn
// die Liste ein eigenes Objekt ist.
func (a *anwender) anhaengen(seite blatt, refs types.Array) error {
	alt, _ := seite.dict.Find("Annots")
	liste := append(types.Array{}, alsArray(a.x, alt)...)
	return a.annotsSetzen(seite, append(liste, refs...))
}

func (a *anwender) annotsSetzen(seite blatt, liste types.Array) error {
	if alt, ok := seite.dict.Find("Annots"); ok {
		if ir, ok := alt.(types.IndirectRef); ok {
			e, ok := a.x.FindTableEntry(ir.ObjectNumber.Value(), ir.GenerationNumber.Value())
			if !ok || e == nil {
				return fmt.Errorf("%w: Annots-Objekt %d fehlt", ErrNichtUnterstuetzt, ir.ObjectNumber.Value())
			}
			e.Object = liste
			return nil
		}
	}
	if len(liste) == 0 {
		seite.dict.Delete("Annots")
		return nil
	}
	seite.dict["Annots"] = liste
	return nil
}

// drehung ist die wirksame Drehung der Seite (eigen oder geerbt).
func (a *anwender) drehung(seite blatt) int {
	d := seite.dict
	if _, ok := d.Find("Rotate"); !ok {
		if v, ok := seite.geerbt["Rotate"]; ok {
			d = types.Dict{"Rotate": v}
		}
	}
	return ((drehungVon(a.x, d) % 360) + 360) % 360
}

// ============================================================
// update
// ============================================================

// aendern setzt den Text neu. Ein Textfeld bekommt sein Erscheinungsbild
// neu gezeichnet, sonst zeigte jedes Programm den alten Text; ein Post-it
// (FreeText mit OIHKind sticky) wird als Post-it neu gezeichnet, mit
// gleicher Farbe und gleichem Rect. Reicher Text (/RC) faellt weg: Acrobat
// zeigte sonst ihn statt Contents. Ein Stempel ist nicht bearbeitbar.
func (a *anwender) aendern(u Anmerkungstext) error {
	e, err := a.ziel(u.Ref, u.Page, true)
	if err != nil {
		return err
	}
	if e.typ == "Stamp" {
		return ungueltig(u.Ref, "contents eines Stempels ist nicht bearbeitbar: loeschen und neu setzen")
	}
	if e.art() == artLink {
		return ungueltig(u.Ref, "ein Link hat keinen Text: loeschen und neu setzen")
	}
	e.dict["Contents"] = utf16(u.Contents)
	e.dict["M"] = types.StringLiteral(a.jetzt)
	e.dict.Delete("RC")
	if e.typ != "FreeText" {
		return nil
	}
	rect := rectVon(a.x, e.dict)
	if rect == nil {
		return ungueltig(u.Ref, "Textfeld ohne Rect")
	}
	gr, farbe := darstellungVon(a.x, e.dict)
	drehung := 0
	if r, ok := aufloesen(a.x, e.dict["Rotate"]).(types.Integer); ok {
		drehung = ((int(r) % 360) + 360) % 360
	}
	var bbox [4]float64
	var inhalt string
	var res types.Dict
	var matrix []float64
	if alsName(a.x, e.dict["OIHKind"]) == "sticky" {
		fuellung := postitGelb
		if f := zahlenVon(a.x, e.dict["OIHFill"]); len(f) == 3 {
			fuellung = f
		}
		var gekuerzt bool
		if bbox, inhalt, res, matrix, gekuerzt, err = a.postit(e.dict, *rect, u.Contents, fuellung, gr, drehung); err != nil {
			return err
		}
		if gekuerzt {
			a.erg.warnung(WarnungPostitGekuerzt)
		}
	} else if bbox, inhalt, res, matrix, err = a.textfeld(e.dict, *rect, u.Contents, farbe, gr, drehung); err != nil {
		return err
	}
	ap, err := a.erscheinung(bbox, inhalt, res, matrix)
	if err != nil {
		return err
	}
	e.dict["AP"] = types.Dict{"N": *ap}
	return nil
}

// ============================================================
// state
// ============================================================

// status legt eine Statusanmerkung an, wie ISO 32000-1 12.5.6.3 sie
// beschreibt: eine Text-Antwort mit StateModel Review und State. Sie ist
// versteckt (Hidden, NoZoom, NoRotate, Print — wie Acrobat sie schreibt);
// Programme zeigen den Status an der Anmerkung selbst.
func (a *anwender) status(s Anmerkungsstatus) error {
	e, err := a.ziel(s.Ref, s.Page, true)
	if err != nil {
		return err
	}
	if e.art() == artLink {
		return ungueltig(s.Ref, "ein Link hat keinen Status")
	}
	zustand := "None"
	if s.State == "completed" {
		zustand = "Completed"
	}
	seite := a.seiten[e.seite]
	d := a.grunddict(seite, neueKennung(), zustand, e.ref)
	d["Subtype"] = types.Name("Text")
	d["F"] = types.Integer(2 | 4 | 8 | 16)
	d["State"] = types.StringLiteral(zustand)
	d["StateModel"] = types.StringLiteral("Review")
	if rect := rectVon(a.x, e.dict); rect != nil {
		d["Rect"] = types.NewNumberArray(rect[0], rect[1], rect[2], rect[3])
	} else {
		d["Rect"] = types.NewNumberArray(0, 0, 0, 0)
	}
	ref, err := a.x.IndRefForNewObject(d)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	if err := a.anhaengen(seite, types.Array{*ref}); err != nil {
		return err
	}
	nm, _ := alsText(a.x, d["NM"])
	a.merken(*ref, nm, e.seite, d)
	return nil
}

// ============================================================
// delete
// ============================================================

// loeschen nimmt die genannten Anmerkungen von ihren Seiten — mit Popup
// und mit den Antworten, die mitgehen duerfen: eigene (Eigene und in
// diesem Lauf angelegte) und Statusanmerkungen. Jede andere Antwort ist
// Inhalt eines anderen Menschen und verhindert die Loeschung
// (ErrAnmerkungHatAntworten nennt sie); wer sie mitloeschen darf, nennt sie
// selbst im Befehl.
func (a *anwender) loeschen(befehle []Anmerkungsverweis) error {
	genannt := map[int]bool{}
	var reihe []int
	for _, d := range befehle {
		e, err := a.ziel(d.Ref, d.Page, true)
		if err != nil {
			return err
		}
		if !genannt[e.nr()] {
			genannt[e.nr()] = true
			reihe = append(reihe, e.nr())
		}
	}
	weg := map[int]bool{}
	for _, nr := range reihe {
		var fremd []string
		a.baum(nr, genannt, weg, &fremd, 0)
		if len(fremd) > 0 {
			return &Anmerkungsfehler{Art: ErrAnmerkungHatAntworten, Ref: verweisVon(nr), Antworten: fremd}
		}
	}
	if len(weg) == 0 {
		return nil
	}
	// Popups der entfernten Anmerkungen — ueber /Popup und ueber /Parent,
	// falls ein Programm nur eines von beiden schreibt.
	for nr := range weg {
		if p, ok := objNr(a.bestand[nr].dict["Popup"]); ok {
			weg[p] = true
		}
	}
	for nr, e := range a.bestand {
		if e.art() == artPopup {
			if eltern, ok := objNr(e.dict["Parent"]); ok && weg[eltern] {
				weg[nr] = true
			}
		}
	}
	for _, s := range a.seiten {
		alt, ok := s.dict.Find("Annots")
		if !ok {
			continue
		}
		liste := alsArray(a.x, alt)
		neu := make(types.Array, 0, len(liste))
		for _, o := range liste {
			if nr, ok := objNr(o); ok && weg[nr] {
				continue
			}
			neu = append(neu, o)
		}
		if len(neu) != len(liste) {
			if err := a.annotsSetzen(s, neu); err != nil {
				return err
			}
		}
	}
	for nr := range weg {
		if e, ok := a.bestand[nr]; ok && (e.art() == artAnmerkung || e.art() == artLink) {
			a.erg.entfernt[nr] = true
		}
		delete(a.bestand, nr)
	}
	return nil
}

// baum sammelt nr und seine Antworten in weg; Antworten, die nicht
// mitgehen duerfen, kommen nach fremd.
func (a *anwender) baum(nr int, genannt, weg map[int]bool, fremd *[]string, t int) {
	if weg[nr] || t > tiefe {
		return
	}
	weg[nr] = true
	for _, kind := range a.antworten[nr] {
		e, ok := a.bestand[kind]
		if !ok {
			continue
		}
		nm, _ := alsText(a.x, e.dict["NM"])
		_, status := e.dict.Find("StateModel")
		if !genannt[kind] && !status && !(nm != "" && a.eigene[nm]) {
			*fremd = append(*fremd, verweisVon(kind))
			continue
		}
		a.baum(kind, genannt, weg, fremd, t+1)
	}
}

// ============================================================
// Erscheinungsbilder
// ============================================================

// erscheinung legt ein Form-XObject als normales Erscheinungsbild an.
// matrix (6 Zahlen) dreht die BBox in den Benutzerraum; nil heisst
// Einheit.
func (a *anwender) erscheinung(bbox [4]float64, inhalt string, res types.Dict, matrix []float64) (*types.IndirectRef, error) {
	sd, err := a.x.NewStreamDictForBuf([]byte(inhalt))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	sd.InsertName("Type", "XObject")
	sd.InsertName("Subtype", "Form")
	sd.Insert("BBox", types.NewNumberArray(bbox[0], bbox[1], bbox[2], bbox[3]))
	if len(matrix) == 6 {
		sd.Insert("Matrix", types.NewNumberArray(matrix...))
	}
	if res != nil {
		sd.Insert("Resources", res)
	}
	if err := sd.Encode(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	ref, err := a.x.IndRefForNewObject(*sd)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	return ref, nil
}

// markierung zeichnet Hervorheben, Unterstreichen, Durchstreichen ueber
// die Vierecke. Reihenfolge je Viereck wie Acrobat: oben links, oben
// rechts, unten links, unten rechts.
func markierung(d types.Dict, art string, quads [][]float64, farbe []float64) (rect, bbox [4]float64, inhalt string, res types.Dict) {
	var alle []float64
	var qp types.Array
	var s strings.Builder
	for _, q := range quads {
		alle = append(alle, q...)
		for _, v := range q {
			qp = append(qp, types.Float(v))
		}
		h := math.Hypot(q[0]-q[4], q[1]-q[5])
		switch art {
		case "highlight":
			fmt.Fprintf(&s, "%s %s m %s %s l %s %s l %s %s l h f ", zahl(q[4]), zahl(q[5]), zahl(q[6]), zahl(q[7]),
				zahl(q[2]), zahl(q[3]), zahl(q[0]), zahl(q[1]))
		case "underline":
			dx, dy := 0.0, 1.0
			if h > 0 {
				dx, dy = (q[0]-q[4])/h, (q[1]-q[5])/h
			}
			o := h * 0.07
			fmt.Fprintf(&s, "%s w %s %s m %s %s l S ", zahl(math.Max(0.5, h*0.06)),
				zahl(q[4]+dx*o), zahl(q[5]+dy*o), zahl(q[6]+dx*o), zahl(q[7]+dy*o))
		case "strikeout":
			fmt.Fprintf(&s, "%s w %s %s m %s %s l S ", zahl(math.Max(0.5, h*0.06)),
				zahl((q[0]+q[4])/2), zahl((q[1]+q[5])/2), zahl((q[2]+q[6])/2), zahl((q[3]+q[7])/2))
		}
	}
	d["QuadPoints"] = qp
	rect = umschliessend(alle, 1)
	bbox = rect
	if art == "highlight" {
		res = types.Dict{"ExtGState": types.Dict{"G0": types.Dict{"Type": types.Name("ExtGState"),
			"BM": types.Name("Multiply"), "ca": types.Float(1)}}}
		inhalt = "/G0 gs " + farbeOp(farbe, "rg") + " " + s.String()
	} else {
		inhalt = farbeOp(farbe, "RG") + " " + s.String()
	}
	return rect, bbox, inhalt, res
}

var helvetica = types.Dict{
	"Type": types.Name("Font"), "Subtype": types.Name("Type1"),
	"BaseFont": types.Name("Helvetica"), "Encoding": types.Name("WinAnsiEncoding"),
}

// textfeld baut das Erscheinungsbild eines Textfelds (FreeText) und setzt
// DA, DS und Rotate.
//
// Auf einer gedrehten Seite steht der Text in der Anzeige aufrecht: Die
// BBox hat die Masse des Felds, wie es angezeigt wird, und die Matrix
// dreht sie um die Seitendrehung zurueck in den Benutzerraum; das
// Programm bildet die gedrehte BBox auf Rect ab (ISO 32000-1 12.5.5).
// Rotate am Annot sagt es Programmen, die den Text selbst neu setzen.
//
// Die Schrift waehlt satz (schrift.go): Helvetica, solange WinAnsi den
// Text darstellt, sonst eingebettetes Noto Sans. DA nennt weiter Helv —
// es gilt nur fuer Programme, die den Text selbst neu setzen.
func (a *anwender) textfeld(d types.Dict, rect [4]float64, text string, farbe []float64, gr float64, drehung int) (bbox [4]float64, inhalt string, res types.Dict, matrix []float64, err error) {
	if gr <= 0 {
		gr = 12
	}
	s, err := a.satz(text, false)
	if err != nil {
		return bbox, "", nil, nil, err
	}
	d["DA"] = types.StringLiteral(fmt.Sprintf("/Helv %s Tf %s", zahl(gr), farbeOp(farbe, "rg")))
	d["DS"] = types.StringLiteral(fmt.Sprintf("font: Helvetica %spt; color: #%02x%02x%02x", zahl(gr),
		int(math.Round(farbe[0]*255)), int(math.Round(farbe[1]*255)), int(math.Round(farbe[2]*255))))
	w, h, matrix := drehmatrix(drehung, rect)
	if drehung != 0 {
		d["Rotate"] = types.Integer(drehung)
	} else {
		d.Delete("Rotate")
	}
	bbox = [4]float64{0, 0, w, h}
	name, obj := s.ressource()
	res = types.Dict{"Font": types.Dict{name: obj}}
	var b strings.Builder
	fmt.Fprintf(&b, "/Tx BMC q BT /%s %s Tf %s %s TL 2 %s Td ", name, zahl(gr), farbeOp(farbe, "rg"), zahl(gr*1.2), zahl(h-2-gr))
	for i, z := range strings.Split(text, "\n") {
		if i > 0 {
			b.WriteString("T* ")
		}
		fmt.Fprintf(&b, "%s Tj ", s.tj(z))
	}
	b.WriteString("ET Q EMC")
	return bbox, b.String(), res, matrix, nil
}

// form zeichnet Rechteck oder Ellipse innerhalb von rect.
func form(art string, r [4]float64, breite float64, farbe []float64) string {
	h := breite / 2
	if art == "square" {
		return fmt.Sprintf("%s w %s %s %s %s %s re S", zahl(breite), farbeOp(farbe, "RG"),
			zahl(r[0]+h), zahl(r[1]+h), zahl(r[2]-r[0]-breite), zahl(r[3]-r[1]-breite))
	}
	cx, cy := (r[0]+r[2])/2, (r[1]+r[3])/2
	rx, ry := (r[2]-r[0])/2-h, (r[3]-r[1])/2-h
	k := 0.5523
	return fmt.Sprintf("%s w %s %s %s m %s %s %s %s %s %s c %s %s %s %s %s %s c %s %s %s %s %s %s c %s %s %s %s %s %s c S",
		zahl(breite), farbeOp(farbe, "RG"), zahl(cx+rx), zahl(cy),
		zahl(cx+rx), zahl(cy+k*ry), zahl(cx+k*rx), zahl(cy+ry), zahl(cx), zahl(cy+ry),
		zahl(cx-k*rx), zahl(cy+ry), zahl(cx-rx), zahl(cy+k*ry), zahl(cx-rx), zahl(cy),
		zahl(cx-rx), zahl(cy-k*ry), zahl(cx-k*rx), zahl(cy-ry), zahl(cx), zahl(cy-ry),
		zahl(cx+k*rx), zahl(cy-ry), zahl(cx+rx), zahl(cy-k*ry), zahl(cx+rx), zahl(cy))
}

// darstellungVon liest Schriftgroesse und Farbe aus DA eines bestehenden
// Textfelds ("/Helv 12 Tf 0.8 0.1 0.1 rg"); Ersatz: 12 pt, schwarz.
func darstellungVon(x *model.XRefTable, d types.Dict) (float64, []float64) {
	gr, farbe := 12.0, []float64{0, 0, 0}
	da, _ := alsText(x, d["DA"])
	teile := strings.Fields(da)
	for i, t := range teile {
		switch {
		case t == "Tf" && i >= 1:
			if v, err := strconv.ParseFloat(teile[i-1], 64); err == nil && v > 0 && v <= 200 {
				gr = v
			}
		case t == "rg" && i >= 3:
			var f [3]float64
			ok := true
			for j := range f {
				v, err := strconv.ParseFloat(teile[i-3+j], 64)
				if err != nil || v < 0 || v > 1 {
					ok = false
				}
				f[j] = v
			}
			if ok {
				farbe = f[:]
			}
		case t == "g" && i >= 1:
			if v, err := strconv.ParseFloat(teile[i-1], 64); err == nil && v >= 0 && v <= 1 {
				farbe = []float64{v, v, v}
			}
		}
	}
	return gr, farbe
}

func rectVon(x *model.XRefTable, d types.Dict) *[4]float64 {
	return viereck(x, d["Rect"])
}

// geordnet sortiert ein Rechteck so, dass llx<urx und lly<ury.
func geordnet(r []float64) [4]float64 {
	return [4]float64{math.Min(r[0], r[2]), math.Min(r[1], r[3]), math.Max(r[0], r[2]), math.Max(r[1], r[3])}
}

func umschliessend(punkte []float64, rand float64) [4]float64 {
	r := [4]float64{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	for i := 0; i+1 < len(punkte); i += 2 {
		r[0] = math.Min(r[0], punkte[i])
		r[1] = math.Min(r[1], punkte[i+1])
		r[2] = math.Max(r[2], punkte[i])
		r[3] = math.Max(r[3], punkte[i+1])
	}
	return [4]float64{r[0] - rand, r[1] - rand, r[2] + rand, r[3] + rand}
}

func zahl(v float64) string {
	s := strconv.FormatFloat(v, 'f', 3, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" || s == "-0" {
		return "0"
	}
	return s
}

func farbeOp(f []float64, op string) string {
	return zahl(f[0]) + " " + zahl(f[1]) + " " + zahl(f[2]) + " " + op
}

// utf16 schreibt Text als UTF-16BE-Literal mit Byte-Order-Mark — so
// bleiben Umlaute und Euro in jedem Programm lesbar.
func utf16(s string) types.StringLiteral {
	e, err := types.EscapedUTF16String(s)
	if err != nil || e == nil {
		e, _ = types.EscapedUTF16String(strings.ToValidUTF8(s, "?"))
	}
	if e == nil {
		return types.StringLiteral("")
	}
	return types.StringLiteral(*e)
}

// winAnsiSonder sind die Zeichen von CP1252 oberhalb von ASCII, die nicht
// in Latin-1 liegen (0x80–0x9F): Euro, typografische Anfuehrungszeichen
// und Striche, wie die Texterkennung sie bei deutschem Text liefert.
var winAnsiSonder = map[rune]byte{
	'€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
	'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
	'–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
}

// winAnsiKodiert kodiert Text als WinAnsi (CP1252), ein Byte je Zeichen;
// was WinAnsi nicht kennt, wird zum Fragezeichen. In dieser Form misst
// pdfcpu die Breite der Kernschriften (je Byte ueber die CP1252-Tabelle).
func winAnsiKodiert(s string) []byte {
	aus := make([]byte, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 32 && r < 127, r >= 160 && r < 256:
			aus = append(aus, byte(r))
		default:
			if b, ok := winAnsiSonder[r]; ok {
				aus = append(aus, b)
			} else {
				aus = append(aus, '?')
			}
		}
	}
	return aus
}

// winAnsi maskiert Text fuer einen Inhaltsstrom mit Helvetica in
// WinAnsiEncoding (Erscheinungsbild eines Textfelds, Textebene). Contents
// behaelt den vollen Unicode-Text; was WinAnsi nicht kennt, wird hier zum
// Fragezeichen.
func winAnsi(s string) string {
	var b strings.Builder
	for _, c := range winAnsiKodiert(s) {
		switch {
		case c == '(' || c == ')' || c == '\\':
			b.WriteByte('\\')
			b.WriteByte(c)
		case c >= 32 && c < 127:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "\\%03o", c)
		}
	}
	return b.String()
}

// neueKennung erzeugt eine UUID (Variante 4) fuer NM. crypto/rand.Read
// liefert seit Go 1.24 nie einen Fehler.
func neueKennung() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

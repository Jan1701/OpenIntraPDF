// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Anmerkungen (Etappe 2): Was der Adapter schreibt, wird im wieder
// geoeffneten Ergebnis nachgelesen — nie aus dem, was er zu schreiben
// glaubte.

// anmerkungsbild ist eine Anmerkung des Ergebnisses, wie ein anderes
// Programm sie liest.
type anmerkungsbild struct {
	nr, seite  int
	typ        string
	nm, autor  string
	inhalt     string
	antwortAuf int
	popup      int
	rect       string
	quads      string
	hatAP      bool
	flags      int
	status     string
	drehung    int
}

func anmerkungsbilder(t *testing.T, pdf []byte) []anmerkungsbild {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	x := ctx.XRefTable
	seiten, err := blaetter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var aus []anmerkungsbild
	for i, s := range seiten {
		for _, a := range anmerkungen(x, s.dict) {
			b := anmerkungsbild{nr: a.nr(), seite: i, typ: a.typ}
			b.nm, _ = alsText(x, a.dict["NM"])
			b.autor, _ = alsText(x, a.dict["T"])
			b.inhalt, _ = alsText(x, a.dict["Contents"])
			b.status, _ = alsText(x, a.dict["State"])
			b.antwortAuf, _ = objNr(a.dict["IRT"])
			b.popup, _ = objNr(a.dict["Popup"])
			b.rect = zahlen(x, a.dict["Rect"])
			b.quads = zahlen(x, a.dict["QuadPoints"])
			if f, ok := aufloesen(x, a.dict["F"]).(types.Integer); ok {
				b.flags = int(f)
			}
			if r, ok := aufloesen(x, a.dict["Rotate"]).(types.Integer); ok {
				b.drehung = int(r)
			}
			if ap := alsDict(x, a.dict["AP"]); ap != nil {
				if sd, ok := aufloesen(x, ap["N"]).(types.StreamDict); ok {
					k := sd
					b.hatAP = k.Decode() == nil && len(k.Content) > 0
				}
			}
			aus = append(aus, b)
		}
	}
	return aus
}

func bildVon(t *testing.T, bilder []anmerkungsbild, nm string) anmerkungsbild {
	t.Helper()
	for _, b := range bilder {
		if b.nm == nm {
			return b
		}
	}
	t.Fatalf("Anmerkung %q fehlt", nm)
	return anmerkungsbild{}
}

func bildNr(t *testing.T, bilder []anmerkungsbild, nr int) anmerkungsbild {
	t.Helper()
	for _, b := range bilder {
		if b.nr == nr {
			return b
		}
	}
	t.Fatalf("Objekt %d fehlt", nr)
	return anmerkungsbild{}
}

// apStrom liefert Inhalt, BBox und Matrix des Erscheinungsbilds.
func apStrom(t *testing.T, pdf []byte, nr int) (inhalt, bbox, matrix string) {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	x := ctx.XRefTable
	d := alsDict(x, *types.NewIndirectRef(nr, 0))
	ap := alsDict(x, d["AP"])
	sd, ok := aufloesen(x, ap["N"]).(types.StreamDict)
	if !ok {
		t.Fatalf("Objekt %d ohne Erscheinungsbild", nr)
	}
	if err := sd.Decode(); err != nil {
		t.Fatal(err)
	}
	return string(sd.Content), zahlen(x, sd.Dict["BBox"]), zahlen(x, sd.Dict["Matrix"])
}

// zahlen schreibt eine Zahlenliste kurz: "[220 700 240 720]".
func zahlen(x *model.XRefTable, o types.Object) string {
	a := alsArray(x, o)
	if a == nil {
		return ""
	}
	teile := make([]string, len(a))
	for i, v := range a {
		switch n := aufloesen(x, v).(type) {
		case types.Float:
			teile[i] = zahl(float64(n))
		case types.Integer:
			teile[i] = zahl(float64(n))
		default:
			teile[i] = "?"
		}
	}
	return "[" + strings.Join(teile, " ") + "]"
}

func commit(t *testing.T, quelle []byte, anm *Anmerkungsbefehle, plan []Seite) ([]byte, Bericht, Anmerkungsergebnis) {
	t.Helper()
	if anm != nil && anm.Autor == "" {
		anm.Autor = "Erika Musterfrau"
	}
	var aus bytes.Buffer
	b, erg, err := CommitBauen(context.Background(), bytes.NewReader(quelle), anm, plan, &aus)
	if err != nil {
		t.Fatalf("CommitBauen: %v", err)
	}
	return aus.Bytes(), b, erg
}

func commitFehler(t *testing.T, quelle []byte, anm *Anmerkungsbefehle) error {
	t.Helper()
	var aus bytes.Buffer
	_, _, err := CommitBauen(context.Background(), bytes.NewReader(quelle), anm, nil, &aus)
	if err == nil {
		t.Fatal("CommitBauen: kein Fehler")
	}
	return err
}

var (
	gelb = []float64{1, 0.85, 0.1}
	rot  = []float64{0.85, 0.1, 0.1}
	blau = []float64{0.13, 0.37, 0.77}
	// hallo ist ein Wort auf der Seite: 100..154.672 x 695.032..717.232.
	hallo = [][]float64{{100, 717.232, 154.672, 717.232, 100, 695.032, 154.672, 695.032}}
)

func alleArten() *Anmerkungsbefehle {
	return &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "n1", Page: 0, Kind: "note", Rect: []float64{220, 700}, Contents: "Rückfrage: Stimmt der Betrag? Ä Ö Ü ß €", Color: gelb},
		{ClientID: "n2", Page: 0, Kind: "note", Rect: []float64{220, 700}, Contents: "Ja, geprüft.", ReplyTo: "n1"},
		{ClientID: "h", Page: 0, Kind: "highlight", Quads: hallo, Contents: "markiert", Color: gelb},
		{ClientID: "u", Page: 0, Kind: "underline", Quads: hallo, Color: blau},
		{ClientID: "s", Page: 0, Kind: "strikeout", Quads: hallo, Color: rot},
		{ClientID: "f", Page: 0, Kind: "freetext", Rect: []float64{100, 560, 360, 620}, Contents: "Bitte bis Freitag klären.\nZweite Zeile äöü €", Color: rot, FontSize: 14},
		{ClientID: "i", Page: 0, Kind: "ink", Paths: [][]float64{{120, 480, 140, 500, 160, 470, 180, 510, 200, 480}}, Color: blau, Width: 2},
		{ClientID: "l", Page: 1, Kind: "line", Line: []float64{100, 400, 300, 400}, Color: rot, Width: 2},
		{ClientID: "a", Page: 1, Kind: "arrow", Line: []float64{300, 450, 160, 690}, Color: rot, Width: 2},
		{ClientID: "q", Page: 1, Kind: "square", Rect: []float64{215, 722, 95, 690}, Color: rot, Width: 1.5},
		{ClientID: "c", Page: 1, Kind: "circle", Rect: []float64{380, 400, 480, 460}, Color: blau, Width: 1.5},
	}}
}

// Jede Art aus dem Vertrag: als Objekt mit Erscheinungsbild, NM, Autor,
// Zeiten und Print-Flag im Ergebnis; die Antwort haengt per IRT an der
// Notiz aus demselben Commit; die Zuordnung client_id -> ref stimmt.
func TestAnmerkungenAlleArten(t *testing.T) {
	anm := alleArten()
	anm.Zeit = time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	aus, b, erg := commit(t, korpus.Textseiten(2), anm, nil)
	if len(erg.Added) != 11 || b.AnmerkungenNeu != 11 || b.AnmerkungenEntfernt != 0 || b.AnmerkungenFremdBehalten != 0 {
		t.Fatalf("Ergebnis %+v, Bericht %+v", erg, b)
	}
	if i := inspektion(t, aus); i.Anmerkungen != 11 || i.Seiten != 2 {
		t.Errorf("Inspektion %+v", i)
	}
	bilder := anmerkungsbilder(t, aus)
	if mitAP, lesbar := erscheinungsbilder(t, aus); mitAP != 11 || lesbar != 11 {
		t.Errorf("%d mit AP, %d lesbar, erwartet 11/11", mitAP, lesbar)
	}
	ref := map[string]AnmerkungHinzugefuegt{}
	for _, z := range erg.Added {
		ref[z.ClientID] = z
		nr, ok := objNrVon(z.Ref)
		if !ok {
			t.Fatalf("ref %q", z.Ref)
		}
		bild := bildNr(t, bilder, nr)
		if bild.nm != z.NM || bild.autor != "Erika Musterfrau" || bild.flags&4 == 0 || !bild.hatAP {
			t.Errorf("%s: %+v", z.ClientID, bild)
		}
		if len(z.NM) != 36 || z.NM[14] != '4' {
			t.Errorf("%s: NM %q ist keine UUID", z.ClientID, z.NM)
		}
	}
	erwartet := map[string]string{"n1": "Text", "n2": "Text", "h": "Highlight", "u": "Underline", "s": "StrikeOut",
		"f": "FreeText", "i": "Ink", "l": "Line", "a": "Line", "q": "Square", "c": "Circle"}
	for id, typ := range erwartet {
		if bild := bildVon(t, bilder, ref[id].NM); bild.typ != typ {
			t.Errorf("%s: Subtype %s, erwartet %s", id, bild.typ, typ)
		}
	}
	notiz := bildVon(t, bilder, ref["n1"].NM)
	antwort := bildVon(t, bilder, ref["n2"].NM)
	if notiz.inhalt != "Rückfrage: Stimmt der Betrag? Ä Ö Ü ß €" || notiz.popup == 0 || notiz.flags != 4|8|16 || notiz.rect != "[220 700 240 720]" {
		t.Errorf("Notiz %+v", notiz)
	}
	if antwort.antwortAuf != notiz.nr || antwort.popup != 0 || antwort.seite != 0 {
		t.Errorf("Antwort %+v haengt nicht an Notiz %d", antwort, notiz.nr)
	}
	if h := bildVon(t, bilder, ref["h"].NM); h.quads != "[100 717.232 154.672 717.232 100 695.032 154.672 695.032]" || h.inhalt != "markiert" {
		t.Errorf("Hervorhebung %+v", h)
	}
	if q := bildVon(t, bilder, ref["q"].NM); q.rect != "[95 690 215 722]" || q.seite != 1 {
		t.Errorf("Rechteck %+v (rect wird geordnet)", q)
	}
	if f := bildVon(t, bilder, ref["f"].NM); f.rect != "[100 560 360 620]" || f.drehung != 0 {
		t.Errorf("Textfeld %+v", f)
	}
	inhalt, bbox, matrix := apStrom(t, aus, bildVon(t, bilder, ref["f"].NM).nr)
	if !strings.Contains(inhalt, "/Helv 14 Tf") || !strings.Contains(inhalt, "(Bitte bis Freitag kl\\344ren.) Tj") ||
		!strings.Contains(inhalt, "\\200") || bbox != "[0 0 260 60]" || matrix != "" {
		t.Errorf("Textfeld-AP: %q BBox %s Matrix %s", inhalt, bbox, matrix)
	}
	// Zeiten wie uebergeben.
	ctx := geoeffnet(t, aus)
	d := alsDict(ctx.XRefTable, *types.NewIndirectRef(notiz.nr, 0))
	if m, _ := alsText(ctx.XRefTable, d["M"]); !strings.HasPrefix(m, "D:20260929") {
		t.Errorf("M = %q", m)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Rundlauf mit Acrobat: Die Datei hat Acrobat inkrementell gespeichert,
// darin seine Antwort 33R auf das Rechteck. Wir antworten auf die
// Antwort und markieren etwas. Alle elf fremden Anmerkungen bleiben —
// mit Erscheinungsbild, unter ihrer Objektnummer —, und 33R haengt
// weiter am Rechteck.
func TestAnmerkungenRundlaufAcrobat(t *testing.T) {
	quelle, err := os.ReadFile(filepath.Join("testdata", "acrobat-inkrementell.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	vorher := anmerkungsbilder(t, quelle)
	aus, b, erg := commit(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "r", Page: 0, Kind: "note", Rect: []float64{95, 690}, Contents: "Antwort aus OpenIntraPDF auf Acrobat", ReplyTo: "33R"},
		{ClientID: "h", Page: 0, Kind: "highlight", Quads: [][]float64{{161.344, 717.232, 209.344, 717.232, 161.344, 695.032, 209.344, 695.032}}, Color: []float64{0.5, 1, 0.5}},
	}}, nil)
	if b.AnmerkungenFremdBehalten != 11 || b.AnmerkungenNeu != 2 || b.AnmerkungenBehalten != 13 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	nachher := anmerkungsbilder(t, aus)
	for _, v := range vorher {
		n := bildNr(t, nachher, v.nr)
		if n.typ != v.typ || n.nm != v.nm || n.autor != v.autor || n.inhalt != v.inhalt || n.antwortAuf != v.antwortAuf || n.hatAP != v.hatAP {
			t.Errorf("Objekt %d veraendert: vorher %+v, nachher %+v", v.nr, v, n)
		}
	}
	if mitAP, lesbar := erscheinungsbilder(t, aus); mitAP != 13 || lesbar != 13 {
		t.Errorf("%d mit AP, %d lesbar, erwartet 13/13", mitAP, lesbar)
	}
	antwort := bildVon(t, nachher, erg.Added[0].NM)
	if antwort.antwortAuf != 33 || antwort.autor != "Erika Musterfrau" {
		t.Errorf("Antwort %+v haengt nicht an 33R", antwort)
	}
	if a := bildNr(t, nachher, 33); a.antwortAuf != 24 || a.autor != "user" {
		t.Errorf("Acrobats Antwort veraendert: %+v", a)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Eine Antwort liegt an der Stelle ihrer Ursprungsanmerkung, egal welches
// Rechteck mitkommt -- auch fuer eine im selben Commit angelegte.
func TestAntwortLiegtAnDerUrsprungsanmerkung(t *testing.T) {
	quelle, err := os.ReadFile(filepath.Join("testdata", "acrobat-inkrementell.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	aus, _, erg := commit(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "n", Page: 0, Kind: "note", Rect: []float64{300, 500}, Contents: "Neue Notiz"},
		{ClientID: "a", Page: 0, Kind: "note", Rect: []float64{0, 0}, Contents: "Antwort auf die neue", ReplyTo: "n"},
		{ClientID: "b", Page: 0, Kind: "note", Rect: []float64{0, 0}, Contents: "Antwort auf Acrobat", ReplyTo: "33R"},
	}}, nil)
	ctx := geoeffnet(t, aus)
	lage := func(nm string) [4]float64 {
		t.Helper()
		for nr, e := range ctx.XRefTable.Table {
			d, ok := e.Object.(types.Dict)
			if !ok {
				continue
			}
			if v, _ := alsText(ctx.XRefTable, d["NM"]); v == nm {
				if r := rectVon(ctx.XRefTable, d); r != nil {
					return *r
				}
				t.Fatalf("Objekt %d ohne Rect", nr)
			}
		}
		t.Fatalf("NM %s nicht gefunden", nm)
		return [4]float64{}
	}
	neu, antwortNeu := lage(erg.Added[0].NM), lage(erg.Added[1].NM)
	if neu != antwortNeu {
		t.Errorf("Antwort auf die neue Notiz liegt bei %v, die Notiz bei %v", antwortNeu, neu)
	}
	eltern, err := ctx.XRefTable.DereferenceDict(*types.NewIndirectRef(33, 0))
	if err != nil {
		t.Fatal(err)
	}
	ursprung := rectVon(ctx.XRefTable, eltern)
	if b := lage(erg.Added[2].NM); b[0] != ursprung[0] || b[3] != ursprung[3] {
		t.Errorf("Antwort auf 33R liegt bei %v, 33R bei %v", b, *ursprung)
	}
}

// Loeschen: Notiz mit Popup und Antwort. Die Antwort eines anderen
// verhindert die Loeschung und wird genannt; die eigene geht mit; wer die
// fremde ausdruecklich nennt, loescht beide. Andere Anmerkungen bleiben.
func TestAnmerkungenLoeschen(t *testing.T) {
	quelle := korpus.MitAnmerkungen()
	vorher := anmerkungsbilder(t, quelle)
	notiz := bildVon(t, vorher, "probe-notiz-1")
	antwort := bildVon(t, vorher, "probe-antwort-1")
	ref := func(b anmerkungsbild) string { return verweisVon(b.nr) }

	// Fremde Antwort: 422 mit ihrem Verweis.
	err := commitFehler(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref(notiz)}},
		Eigene: map[string]bool{"probe-notiz-1": true}})
	var af *Anmerkungsfehler
	if !errors.Is(err, ErrAnmerkungHatAntworten) || !errors.As(err, &af) || len(af.Antworten) != 1 || af.Antworten[0] != ref(antwort) || af.Ref != ref(notiz) {
		t.Fatalf("Fehler %v (%+v)", err, af)
	}
	// Eigene Antwort geht mit.
	aus, b, _ := commit(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref(notiz)}},
		Eigene: map[string]bool{"probe-notiz-1": true, "probe-antwort-1": true}}, nil)
	nachher := anmerkungsbilder(t, aus)
	for _, n := range nachher {
		if n.nr == notiz.nr || n.nr == antwort.nr || n.nr == notiz.popup || n.typ == "Popup" {
			t.Errorf("noch da: %+v", n)
		}
	}
	if len(nachher) != 4 || b.AnmerkungenEntfernt != 2 || b.AnmerkungenFremdBehalten != 3 || b.AnmerkungenNeu != 0 {
		t.Errorf("%d Annotationen uebrig, Bericht %+v", len(nachher), b)
	}
	if i := inspektion(t, aus); i.Anmerkungen != 3 || i.Links != 1 {
		t.Errorf("Inspektion %+v", i)
	}
	// Ausdruecklich beide genannt, mit page: geht auch ohne Urheberschaft.
	seite0, seite2 := 0, 2
	aus, b, _ = commit(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref(notiz), Page: &seite0}, {Ref: ref(antwort), Page: &seite2}}}, nil)
	if n := anmerkungsbilder(t, aus); len(n) != 4 || b.AnmerkungenEntfernt != 2 {
		t.Errorf("%d Annotationen uebrig, Bericht %+v", len(n), b)
	}
	// Nur die Antwort loeschen: Notiz und Popup bleiben.
	aus, _, _ = commit(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref(antwort)}}}, nil)
	if n := anmerkungsbilder(t, aus); len(n) != 6 || bildNr(t, n, notiz.nr).popup != notiz.popup {
		t.Errorf("nach Loeschen der Antwort: %+v", n)
	}
	// Falsche Seite, kein Annotationsobjekt, Popup: ungueltig. (Ein Link
	// ist seit Etappe 9 loeschbar — link_test.go.)
	for _, r := range []Anmerkungsverweis{{Ref: ref(notiz), Page: &seite2}, {Ref: "1R"}, {Ref: verweisVon(notiz.popup)}, {Ref: "999R"}} {
		if err := commitFehler(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{r}}); !errors.Is(err, ErrAnmerkungUngueltig) {
			t.Errorf("%+v: %v", r, err)
		}
	}
	// Kommentarrecht: fremde Anmerkung -> ErrFremdeAnmerkung; eigene geht.
	err = commitFehler(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref(antwort)}}, NurEigene: true,
		Eigene: map[string]bool{"probe-notiz-1": true}})
	if !errors.Is(err, ErrFremdeAnmerkung) {
		t.Errorf("fremde Anmerkung mit Kommentarrecht: %v", err)
	}
	commit(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref(antwort)}}, NurEigene: true,
		Eigene: map[string]bool{"probe-antwort-1": true}}, nil)
}

// Status und Textaenderung. Der Status ist eine versteckte Text-Antwort
// mit StateModel Review; er geht beim Loeschen der Anmerkung mit, auch
// wenn ihn jemand anderes gesetzt hat. Eine Textaenderung am Textfeld
// zeichnet das Erscheinungsbild neu.
func TestAnmerkungenStatusUndText(t *testing.T) {
	quelle := korpus.MitAnmerkungen()
	vorher := anmerkungsbilder(t, quelle)
	notiz := bildVon(t, vorher, "probe-notiz-1")
	textfeld := bildVon(t, vorher, "probe-textfeld-1")
	aus, b, erg := commit(t, quelle, &Anmerkungsbefehle{
		State:  []Anmerkungsstatus{{Ref: verweisVon(notiz.nr), State: "completed"}},
		Update: []Anmerkungstext{{Ref: verweisVon(notiz.nr), Contents: "Betrag geprüft: 119,00 €"}, {Ref: verweisVon(textfeld.nr), Contents: "Neu: Rechnung 00124"}},
		Eigene: map[string]bool{"probe-notiz-1": true, "probe-textfeld-1": true}, NurEigene: true,
	}, nil)
	if b.AnmerkungenNeu != 1 || b.AnmerkungenFremdBehalten != 5 || len(erg.Added) != 0 {
		t.Errorf("Bericht %+v, Ergebnis %+v", b, erg)
	}
	nachher := anmerkungsbilder(t, aus)
	var status anmerkungsbild
	for _, n := range nachher {
		if n.status != "" {
			status = n
		}
	}
	if status.nr == 0 || status.typ != "Text" || status.antwortAuf != notiz.nr || status.status != "Completed" ||
		status.flags != 2|4|8|16 || status.autor != "Erika Musterfrau" || status.seite != 0 {
		t.Errorf("Status %+v", status)
	}
	ctx := geoeffnet(t, aus)
	sd := alsDict(ctx.XRefTable, *types.NewIndirectRef(status.nr, 0))
	if m, _ := alsText(ctx.XRefTable, sd["StateModel"]); m != "Review" {
		t.Errorf("StateModel %q", m)
	}
	if n := bildNr(t, nachher, notiz.nr); n.inhalt != "Betrag geprüft: 119,00 €" {
		t.Errorf("Notiz %+v", n)
	}
	if f := bildNr(t, nachher, textfeld.nr); f.inhalt != "Neu: Rechnung 00124" || !f.hatAP {
		t.Errorf("Textfeld %+v", f)
	}
	if inhalt, _, _ := apStrom(t, aus, textfeld.nr); !strings.Contains(inhalt, "(Neu: Rechnung 00124) Tj") || !strings.Contains(inhalt, "/Helv 12 Tf 0 0 0 rg") {
		t.Errorf("Textfeld-AP: %q", inhalt)
	}
	// Loeschen der Notiz nimmt den Status mit — ohne dass er in Eigene steht.
	aus2, b2, _ := commit(t, aus, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: verweisVon(notiz.nr)}},
		Eigene: map[string]bool{"probe-notiz-1": true, "probe-antwort-1": true}}, nil)
	for _, n := range anmerkungsbilder(t, aus2) {
		if n.nr == status.nr || n.nr == notiz.nr {
			t.Errorf("noch da: %+v", n)
		}
	}
	if b2.AnmerkungenEntfernt != 3 {
		t.Errorf("Bericht %+v", b2)
	}
	// Unbekannter Status, Kommentarrecht auf fremde: abgewiesen.
	if err := commitFehler(t, quelle, &Anmerkungsbefehle{State: []Anmerkungsstatus{{Ref: verweisVon(notiz.nr), State: "done"}}}); !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("state done: %v", err)
	}
	if err := commitFehler(t, quelle, &Anmerkungsbefehle{State: []Anmerkungsstatus{{Ref: verweisVon(notiz.nr), State: "none"}}, NurEigene: true}); !errors.Is(err, ErrFremdeAnmerkung) {
		t.Errorf("state auf fremde: %v", err)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Gedrehte Seite mit versetzter CropBox (Konzept Kap. 04): Rect und
// QuadPoints stehen im Ergebnis genau so, wie sie im Benutzerraum
// uebergeben wurden — Drehung und CropBox aendern daran nichts. Das
// Textfeld traegt Rotate 90 und ein Erscheinungsbild, dessen BBox die
// angezeigten Masse hat und dessen Matrix es in den Benutzerraum dreht.
func TestAnmerkungenGedrehteSeiteMitCropBox(t *testing.T) {
	quelle := korpus.GedrehtMitCropBox()
	if s := seitenbilder(t, quelle); s[0].drehung != 90 || s[0].cropBox != "[36 48 559 794]" {
		t.Fatalf("Vorbedingung: %+v", s[0])
	}
	aus, _, erg := commit(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "f", Page: 0, Kind: "freetext", Rect: []float64{100, 500, 300, 560}, Contents: "Aufrecht", Color: rot},
		{ClientID: "h", Page: 1, Kind: "highlight", Quads: hallo, Color: gelb},
		{ClientID: "n", Page: 1, Kind: "note", Rect: []float64{220, 700}, Contents: "Notiz"},
	}}, nil)
	bilder := anmerkungsbilder(t, aus)
	f := bildVon(t, bilder, erg.Added[0].NM)
	if f.rect != "[100 500 300 560]" || f.drehung != 90 || f.seite != 0 {
		t.Errorf("Textfeld %+v", f)
	}
	inhalt, bbox, matrix := apStrom(t, aus, f.nr)
	if bbox != "[0 0 60 200]" || matrix != "[0 1 -1 0 0 0]" || !strings.Contains(inhalt, "(Aufrecht) Tj") {
		t.Errorf("Textfeld-AP: BBox %s Matrix %s Inhalt %q", bbox, matrix, inhalt)
	}
	if h := bildVon(t, bilder, erg.Added[1].NM); h.quads != "[100 717.232 154.672 717.232 100 695.032 154.672 695.032]" || h.rect != "[99 694.032 155.672 718.232]" || h.seite != 1 {
		t.Errorf("Hervorhebung %+v", h)
	}
	if n := bildVon(t, bilder, erg.Added[2].NM); n.rect != "[220 700 240 720]" || n.flags&16 == 0 {
		t.Errorf("Notiz %+v (NoRotate haelt das Symbol aufrecht)", n)
	}
	if s := seitenbilder(t, aus); s[0].drehung != 90 || s[0].cropBox != "[36 48 559 794]" {
		t.Errorf("Seite veraendert: %+v", s[0])
	}
	popplerOhneSyntaxfehler(t, aus)

	// Im selben Commit dreht der Plan die Seite um 180 weiter (auf 270):
	// Das Textfeld wurde im Entwurf auf der 270er-Seite gesetzt und steht
	// nach dem Speichern aufrecht — Matrix fuer 270, Rotate 270.
	aus, _, erg = commit(t, aus, &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "g", Page: 1, Kind: "freetext", Rect: []float64{100, 500, 300, 560}, Contents: "Auch aufrecht"},
	}}, []Seite{{Quelle: 1, Drehung: 180}, {Quelle: 0}})
	g := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	if _, bbox, matrix := apStrom(t, aus, g.nr); g.drehung != 270 || bbox != "[0 0 60 200]" || matrix != "[0 -1 1 0 0 0]" || g.seite != 0 {
		t.Errorf("Textfeld nach Plan: %+v BBox %s Matrix %s", g, bbox, matrix)
	}
	if s := seitenbilder(t, aus); s[0].drehung != 270 {
		t.Errorf("Seite: %+v", s[0])
	}
}

// Anmerkung und Seitenplan in einem Commit: Die Anmerkung liegt auf
// Seite 3 des Basisdokuments; der Plan stellt sie nach vorn und entfernt
// Seite 2 — mit der Anmerkung, die dort lag (kein Verlust, kein Fehler).
func TestAnmerkungenMitSeitenplan(t *testing.T) {
	quelle := korpus.Voll()
	aus, b, erg := commit(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "s3", Page: 2, Kind: "note", Rect: []float64{72, 500}, Contents: "Auf Seite 3"},
		{ClientID: "s2", Page: 1, Kind: "square", Rect: []float64{72, 500, 200, 600}, Contents: "Auf Seite 2, geht mit"},
	}}, []Seite{{Quelle: 2, Drehung: 90}, {Quelle: 0}, {Quelle: 3}, {Quelle: 4}})
	if m := marken(t, aus); !gleich(m, []string{"SEITE-03", "SEITE-01", "SEITE-04", "SEITE-05"}) {
		t.Fatalf("Reihenfolge %v", m)
	}
	bilder := anmerkungsbilder(t, aus)
	if n := bildVon(t, bilder, erg.Added[0].NM); n.seite != 0 || n.inhalt != "Auf Seite 3" {
		t.Errorf("Notiz %+v", n)
	}
	for _, x := range bilder {
		if x.nm == erg.Added[1].NM {
			t.Errorf("Anmerkung der entfernten Seite noch da: %+v", x)
		}
	}
	// Voll hat 4 Anmerkungen: Notiz S1, Hervorhebung+Anlage S2, Freihand S3.
	// S2 ist weg: 2 fremde bleiben, 1 neue; mit der Seite gingen 2 + 1.
	if b.AnmerkungenNeu != 1 || b.AnmerkungenFremdBehalten != 2 || b.AnmerkungenEntfernt != 0 || b.AnmerkungenMitSeiten != 3 ||
		b.AnmerkungenBehalten != 3 || len(b.Verluste) != 0 || b.LesezeichenNachher != 4 {
		t.Errorf("Bericht %+v", b)
	}
	// Ohne Seitenplan: CommitBauen laesst die Seiten, wie sie sind.
	aus, b, _ = commit(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{{Page: 4, Kind: "note", Rect: []float64{72, 500}}}}, nil)
	if m := marken(t, aus); !gleich(m, []string{"SEITE-01", "SEITE-02", "SEITE-03", "SEITE-04", "SEITE-05"}) || b.AnmerkungenNeu != 1 ||
		b.AnmerkungenFremdBehalten != 4 || len(b.Warnungen) != 0 {
		t.Errorf("ohne Plan: %v, Bericht %+v", m, b)
	}
	if i := inspektion(t, aus); i.Anmerkungen != 5 || i.Formularfelder != 2 || i.Anhaenge != 2 || i.Lesezeichen != 5 {
		t.Errorf("Inspektion %+v", i)
	}
}

// Grenzen und Befehlsfehler — ohne Dokument (Pruefen) und mit.
func TestAnmerkungenGrenzen(t *testing.T) {
	viele := make([]Anmerkungsverweis, HoechstBefehle+1)
	for i := range viele {
		viele[i] = Anmerkungsverweis{Ref: "6R"}
	}
	langerText := strings.Repeat("ä", HoechstZeichen+1)
	vielePunkte := make([]float64, 2*(HoechstPunkte+1))
	faelle := []struct {
		name string
		b    Anmerkungsbefehle
		err  error
	}{
		{"501 Befehle", Anmerkungsbefehle{Delete: viele}, ErrZuVieleBefehle},
		{"Text zu lang", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note", Rect: []float64{1, 1}, Contents: langerText}}}, ErrZuVieleBefehle},
		{"Text zu lang (update)", Anmerkungsbefehle{Update: []Anmerkungstext{{Ref: "6R", Contents: langerText}}}, ErrZuVieleBefehle},
		{"zu viele Punkte", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "ink", Paths: [][]float64{vielePunkte}}}}, ErrZuVieleBefehle},
		{"unbekannte Art", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "signature", Rect: []float64{1, 1, 2, 2}}}}, ErrAnmerkungUngueltig},
		{"note ohne Anker", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note"}}}, ErrAnmerkungUngueltig},
		{"square ohne Flaeche", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "square", Rect: []float64{1, 1, 1, 5}}}}, ErrAnmerkungUngueltig},
		{"quad mit 7 Zahlen", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "highlight", Quads: [][]float64{{1, 2, 3, 4, 5, 6, 7}}}}}, ErrAnmerkungUngueltig},
		{"Pfad mit einem Punkt", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "ink", Paths: [][]float64{{1, 2}}}}}, ErrAnmerkungUngueltig},
		{"Farbe mit 4 Werten", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note", Rect: []float64{1, 1}, Color: []float64{1, 1, 1, 1}}}}, ErrAnmerkungUngueltig},
		{"Farbe > 1", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note", Rect: []float64{1, 1}, Color: []float64{2, 0, 0}}}}, ErrAnmerkungUngueltig},
		{"reply_to unbekannt", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note", Rect: []float64{1, 1}, ReplyTo: "tmp-9"}}}, ErrAnmerkungUngueltig},
		{"client_id doppelt", Anmerkungsbefehle{Add: []NeueAnmerkung{{ClientID: "a", Kind: "note", Rect: []float64{1, 1}}, {ClientID: "a", Kind: "note", Rect: []float64{1, 1}}}}, ErrAnmerkungUngueltig},
		{"ref ohne R", Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: "12"}}}, ErrAnmerkungUngueltig},
		{"Seite negativ", Anmerkungsbefehle{Add: []NeueAnmerkung{{Page: -1, Kind: "note", Rect: []float64{1, 1}}}}, ErrAnmerkungUngueltig},
		{"unendlich", Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note", Rect: []float64{1e9, 1}}}}, ErrAnmerkungUngueltig},
	}
	for _, f := range faelle {
		if err := f.b.Pruefen(); !errors.Is(err, f.err) {
			t.Errorf("%s: %v, erwartet %v", f.name, err, f.err)
		}
	}
	if err := (&Anmerkungsbefehle{}).Pruefen(); err != nil || !(&Anmerkungsbefehle{}).Leer() || (*Anmerkungsbefehle)(nil).Pruefen() != nil {
		t.Error("leere Befehle sind gueltig und leer")
	}
	// Mit Dokument: Seite, die es nicht gibt; Antwort auf anderer Seite.
	quelle := korpus.Textseiten(2)
	if err := commitFehler(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{{Page: 2, Kind: "note", Rect: []float64{1, 1}}}}); !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("Seite 3: %v", err)
	}
	aus, _, erg := commit(t, quelle, &Anmerkungsbefehle{Add: []NeueAnmerkung{{Page: 0, Kind: "note", Rect: []float64{1, 1}}}}, nil)
	if err := commitFehler(t, aus, &Anmerkungsbefehle{Add: []NeueAnmerkung{{Page: 1, Kind: "note", Rect: []float64{1, 1}, ReplyTo: erg.Added[0].Ref}}}); !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("Antwort auf anderer Seite: %v", err)
	}
	// delete kommt als Zeichenkette oder als Objekt.
	var b Anmerkungsbefehle
	if err := json.Unmarshal([]byte(`{"delete":["14R",{"ref":"15R","page":2}]}`), &b); err != nil || len(b.Delete) != 2 ||
		b.Delete[0].Ref != "14R" || b.Delete[0].Page != nil || b.Delete[1].Ref != "15R" || *b.Delete[1].Page != 2 {
		t.Errorf("delete gelesen als %+v (%v)", b.Delete, err)
	}
}

// Nur Besitzerpasswort: Anmerkungen kommen hinein, das Ergebnis bleibt
// verschluesselt und lesbar, die Erscheinungsbilder auch.
func TestAnmerkungenBesitzerpasswort(t *testing.T) {
	quelle, err := korpus.MitBesitzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	// Die Datei erlaubt nur Drucken: Ohne Rechte-Kennwort lehnt der Adapter
	// Anmerkungen ab (Etappe 9); mit dem Kennwort geht es wie bisher.
	var abgelehnt bytes.Buffer
	if _, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(quelle), Commit{Anmerkungen: alleArten()}, &abgelehnt); !errors.Is(err, ErrRechteEingeschraenkt) {
		t.Fatalf("ohne Rechte-Kennwort: %v", err)
	}
	befehle := alleArten()
	befehle.Autor = "Erika Musterfrau"
	var mit bytes.Buffer
	b, erg, err := CommitAusfuehren(context.Background(), bytes.NewReader(quelle), Commit{Anmerkungen: befehle, Besitzerpasswort: korpus.ProbeBesitzerpasswort}, &mit)
	if err != nil {
		t.Fatalf("mit Rechte-Kennwort: %v", err)
	}
	aus := mit.Bytes()
	if i := inspektion(t, aus); !i.Verschluesselt || i.Benutzerpasswort || i.Anmerkungen != 11 {
		t.Errorf("Inspektion %+v", i)
	}
	if mitAP, lesbar := erscheinungsbilder(t, aus); mitAP != 11 || lesbar != 11 {
		t.Errorf("%d mit AP, %d lesbar", mitAP, lesbar)
	}
	if n := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM); n.inhalt != "Rückfrage: Stimmt der Betrag? Ä Ö Ü ß €" || n.autor != "Erika Musterfrau" {
		t.Errorf("Notiz %+v", n)
	}
	if !enthaelt(b.Warnungen, WarnungVerschluesselung) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Stempel (Etappe 5).

var tfMuster = regexp.MustCompile(`/(\w+) ([\d.]+) Tf`)

// schriftgroessen liest Ressourcenname und Groesse jedes Tf.
func schriftgroessen(inhalt string) map[string]float64 {
	aus := map[string]float64{}
	for _, m := range tfMuster.FindAllStringSubmatch(inhalt, -1) {
		v, _ := strconv.ParseFloat(m[2], 64)
		aus[m[1]] = v
	}
	return aus
}

func TestStempelErscheinungUndFarbe(t *testing.T) {
	anm := &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{100, 600, 300, 650},
			Stamp: &Stempel{Label: "GEPRÜFT", Name: "Checked", Signed: true, Lang: "de"}},
	}, Zeit: time.Date(2026, 3, 5, 9, 0, 0, 0, time.Local)}
	aus, b, erg := commit(t, korpus.Textseiten(1), anm, nil)
	if len(b.Warnungen) != 0 || b.AnmerkungenNeu != 1 {
		t.Errorf("Bericht %+v", b)
	}
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	if bild.typ != "Stamp" || bild.flags != 4 || bild.rect != "[100 600 300 650]" || !bild.hatAP ||
		bild.inhalt != "GEPRÜFT\nErika Musterfrau · 05.03.2026" || bild.drehung != 0 {
		t.Errorf("Stempel %+v", bild)
	}
	d := dictVon(t, aus, bild.nr)
	if alsName(nil, d["Name"]) != "Checked" || zahlen(nil, d["C"]) != "[0.776 0.157 0.157]" {
		t.Errorf("Name %v C %v", d["Name"], d["C"])
	}
	inhalt, bbox, matrix := apStrom(t, aus, bild.nr)
	if bbox != "[0 0 200 50]" || matrix != "" {
		t.Errorf("BBox %s Matrix %s", bbox, matrix)
	}
	// Doppelter Rahmen (2 pt aussen, 0,75 pt innen), keine Fuellung, Label
	// fett, zweite Zeile normal.
	for _, s := range []string{"0.776 0.157 0.157 RG 2 w", "0.75 w", "/HelvB ", "/Helv ", "(GEPR\\334FT) Tj", "(Erika Musterfrau \\267 05.03.2026) Tj"} {
		if !strings.Contains(inhalt, s) {
			t.Errorf("Erscheinungsbild ohne %q: %s", s, inhalt)
		}
	}
	if strings.Contains(inhalt, " f ") || strings.Contains(inhalt, " B ") || strings.Contains(inhalt, " re ") {
		t.Errorf("Stempel gefuellt oder eckig: %s", inhalt)
	}
	gr := schriftgroessen(inhalt)
	if gr["HelvB"] <= 0 || gr["HelvB"] > 28 || gr["Helv"] < 6 || gr["Helv"] > gr["HelvB"]*0.4+0.01 {
		t.Errorf("Schriftgroessen %v", gr)
	}
	popplerOhneSyntaxfehler(t, aus)
	if pt := popplerText(t, aus); !strings.Contains(pt, "GEPRÜFT") || !strings.Contains(pt, "05.03.2026") {
		t.Errorf("pdftotext findet den Stempel nicht:\n%s", pt)
	}
	img := popplerBild(t, aus, 0)
	if p := pixel(img, 101.5, 625.5); !farbeNah(p, stempelRot, 0.05) {
		t.Errorf("aeusserer Rahmen ist %v, erwartet Rot %v", p, stempelRot)
	}
	if p := pixel(img, 103.5, 625.5); !farbeNah(p, []float64{1, 1, 1}, 0.03) {
		t.Errorf("Luecke zwischen den Rahmen ist %v, erwartet Weiss", p)
	}
	if p := pixel(img, 150, 611.5); !farbeNah(p, []float64{1, 1, 1}, 0.03) {
		t.Errorf("Inneres unter dem Text ist %v, erwartet Weiss (keine Fuellung)", p)
	}
}

// Ohne signed nur das Label; eigene Farbe; die Schrift passt sich dem
// Kasten an (hoechstens 28 pt).
func TestStempelGroesseUndFarbe(t *testing.T) {
	gruen := []float64{0.18, 0.49, 0.196}
	aus, _, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "breit", Page: 0, Kind: "stamp", Rect: []float64{50, 700, 450, 780}, Color: gruen,
			Stamp: &Stempel{Label: "OK", Name: "Approved"}},
		{ClientID: "schmal", Page: 0, Kind: "stamp", Rect: []float64{50, 600, 150, 630}, Color: gruen,
			Stamp: &Stempel{Label: "FREIGEGEBEN ZUR ZAHLUNG", Name: "Custom", Signed: true, Lang: "en"}},
		{ClientID: "lang", Page: 0, Kind: "stamp", Rect: []float64{50, 500, 300, 550},
			Stamp: &Stempel{Label: strings.Repeat("X", StempelLabelHoechst), Name: "Draft"}},
	}}, nil)
	bilder := anmerkungsbilder(t, aus)
	breit := bildVon(t, bilder, erg.Added[0].NM)
	if breit.inhalt != "OK" {
		t.Errorf("Contents %q", breit.inhalt)
	}
	inhalt, _, _ := apStrom(t, aus, breit.nr)
	if gr := schriftgroessen(inhalt); gr["HelvB"] != 28 || !strings.Contains(inhalt, "0.18 0.49 0.196 RG") || strings.Contains(inhalt, "/Helv ") {
		t.Errorf("breit: %v %s", gr, inhalt)
	}
	schmal := bildVon(t, bilder, erg.Added[1].NM)
	inhalt, _, _ = apStrom(t, aus, schmal.nr)
	if gr := schriftgroessen(inhalt); gr["HelvB"] >= 8 || gr["HelvB"] < 4 || gr["Helv"] != 6 {
		t.Errorf("schmal: %v", gr)
	}
	if !strings.HasPrefix(schmal.inhalt, "FREIGEGEBEN ZUR ZAHLUNG\nErika Musterfrau · 20") {
		t.Errorf("Contents %q", schmal.inhalt)
	}
	lang := bildVon(t, bilder, erg.Added[2].NM)
	if inhalt, _, _ = apStrom(t, aus, lang.nr); schriftgroessen(inhalt)["HelvB"] >= 28 || !strings.Contains(inhalt, strings.Repeat("X", 40)) {
		t.Errorf("lang: %s", inhalt)
	}
	popplerOhneSyntaxfehler(t, aus)
}

func TestStempelDatumsformate(t *testing.T) {
	zeit := time.Date(2026, 3, 5, 9, 0, 0, 0, time.Local)
	faelle := map[string]string{
		"de": "05.03.2026", "de-DE": "05.03.2026", "DE": "05.03.2026", "en": "2026-03-05", "cs": "5. 3. 2026",
		"hu": "2026. 03. 05.", "bg": "5.03.2026 г.", "nl": "05-03-2026", "hr": "05. 03. 2026.", "ja": "2026/03/05",
		"sv": "2026-03-05", "xx": "2026-03-05", "": "2026-03-05", "klingonisch": "2026-03-05",
	}
	for lang, erwartet := range faelle {
		if got := zeit.Format(datumsformat(lang)); got != erwartet {
			t.Errorf("%q: %q, erwartet %q", lang, got, erwartet)
		}
	}
	// Alle 26 OIH-Sprachen haben einen Eintrag.
	for _, l := range strings.Fields("bg cs da de el en es et fi fr ga hr hu it ja lt lv mt nl pl pt ro sk sl sv uk") {
		if _, ok := datumsformate[l]; !ok {
			t.Errorf("Sprache %s ohne Datumsformat", l)
		}
	}
	// Ueber den Commit: Autor und Datum im Format der Sprache; ohne Autor
	// nur das Datum.
	anm := &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{100, 600, 300, 650}, Stamp: &Stempel{Label: "ZAPLACENO", Name: "Paid", Signed: true, Lang: "cs"}},
	}, Zeit: zeit, Autor: "Jan Novák"}
	aus, _, erg := commit(t, korpus.Textseiten(1), anm, nil)
	if bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM); bild.inhalt != "ZAPLACENO\nJan Novák · 5. 3. 2026" {
		t.Errorf("Contents %q", bild.inhalt)
	}
	anm = &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{100, 600, 300, 650}, Stamp: &Stempel{Label: "PAID", Name: "Paid", Signed: true, Lang: "en"}},
	}, Zeit: zeit, Autor: " "}
	aus, _, erg = commit(t, korpus.Textseiten(1), anm, nil)
	if bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM); bild.inhalt != "PAID\n2026-03-05" {
		t.Errorf("Contents ohne Autor %q", bild.inhalt)
	}
}

func TestStempelPruefen(t *testing.T) {
	rect := []float64{100, 600, 300, 650}
	gut := &Stempel{Label: "GEPRÜFT", Name: "Checked", Signed: true, Lang: "de"}
	faelle := []struct {
		name   string
		a      NeueAnmerkung
		detail string
	}{
		{"stamp fehlt", NeueAnmerkung{Kind: "stamp", Rect: rect}, "stamp fehlt"},
		{"stamp bei note", NeueAnmerkung{Kind: "note", Rect: rect, Stamp: gut}, "nur bei kind stamp"},
		{"stamp bei freetext", NeueAnmerkung{Kind: "freetext", Rect: rect, Stamp: gut}, "nur bei kind stamp"},
		{"ohne Flaeche", NeueAnmerkung{Kind: "stamp", Rect: []float64{1, 1, 1, 5}, Stamp: gut}, "rect mit Flaeche"},
		{"Label leer", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: "", Name: "Checked"}}, "1 bis 40"},
		{"Label 41", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: strings.Repeat("ä", 41), Name: "Checked"}}, "1 bis 40"},
		{"Label zweizeilig", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: "A\nB", Name: "Checked"}}, "einzeilig"},
		{"Label Tab", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: "A\tB", Name: "Checked"}}, "einzeilig"},
		{"Name unbekannt", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: "X", Name: "Signed"}}, "stamp.name"},
		{"Name klein", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: "X", Name: "checked"}}, "stamp.name"},
		{"lang zu lang", NeueAnmerkung{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: "X", Name: "Checked", Lang: "de-DE-u-ca-x"}}, "stamp.lang"},
	}
	for _, f := range faelle {
		err := (&Anmerkungsbefehle{Add: []NeueAnmerkung{f.a}}).Pruefen()
		var af *Anmerkungsfehler
		if !errors.Is(err, ErrAnmerkungUngueltig) || !errors.As(err, &af) || !strings.Contains(af.Detail, f.detail) || af.Ref != "add[0]" {
			t.Errorf("%s: %v", f.name, err)
		}
	}
	for _, name := range []string{"Approved", "Draft", "Confidential", "Checked", "Paid", "Booked", "Received", "Done", "Custom"} {
		b := &Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "stamp", Rect: rect, Stamp: &Stempel{Label: strings.Repeat("Ω", 40), Name: name, Lang: "el"}}}}
		if err := b.Pruefen(); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Ein Post-it braucht ein Rect mit Flaeche.
	if err := (&Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "sticky", Rect: []float64{1, 1}}}}).Pruefen(); !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("sticky ohne Flaeche: %v", err)
	}
	if err := (&Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "sticky", Rect: []float64{1, 1, 50, 50}}}}).Pruefen(); err != nil {
		t.Errorf("sticky: %v", err)
	}
	if arten := AnmerkungsArten(); len(arten) != 13 || !enthaelt(arten, "sticky") || !enthaelt(arten, "stamp") || !enthaelt(arten, "link") || arten[0] != "note" {
		t.Errorf("AnmerkungsArten %v", arten)
	}
}

// update auf einen Stempel wird abgewiesen, und zwar bevor etwas geaendert
// ist; loeschen geht.
func TestStempelNichtBearbeitbar(t *testing.T) {
	quelle, _, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{100, 600, 300, 650}, Stamp: &Stempel{Label: "ENTWURF", Name: "Draft"}},
	}}, nil)
	ref, nm := erg.Added[0].Ref, erg.Added[0].NM
	err := commitFehler(t, quelle, &Anmerkungsbefehle{Update: []Anmerkungstext{{Ref: ref, Contents: "anders"}}, Eigene: map[string]bool{nm: true}})
	var af *Anmerkungsfehler
	if !errors.Is(err, ErrAnmerkungUngueltig) || !errors.As(err, &af) || af.Ref != ref {
		t.Errorf("update auf Stempel: %v", err)
	}
	aus, b, _ := commit(t, quelle, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: ref}}, Eigene: map[string]bool{nm: true}}, nil)
	if b.AnmerkungenEntfernt != 1 || len(anmerkungsbilder(t, aus)) != 0 {
		t.Errorf("loeschen: %+v", b)
	}
}

// Gedrehte Seite: aufrecht in der Anzeige, wie das Textfeld.
func TestStempelGedrehteSeite(t *testing.T) {
	aus, _, erg := commit(t, korpus.GedrehtMitCropBox(), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{100, 500, 300, 560}, Stamp: &Stempel{Label: "AUFRECHT", Name: "Custom"}},
	}}, nil)
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	inhalt, bbox, matrix := apStrom(t, aus, bild.nr)
	if bild.rect != "[100 500 300 560]" || bbox != "[0 0 60 200]" || matrix != "[0 1 -1 0 0 0]" || !strings.Contains(inhalt, "(AUFRECHT) Tj") {
		t.Errorf("Stempel %+v BBox %s Matrix %s", bild, bbox, matrix)
	}
	if _, ok := dictVon(t, aus, bild.nr)["Rotate"]; ok {
		t.Error("Stamp traegt Rotate (das Feld gehoert zu FreeText)")
	}
	// Im selben Commit dreht der Plan die Seite weiter: Matrix fuer 270.
	aus, _, erg = commit(t, aus, &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "g", Page: 1, Kind: "stamp", Rect: []float64{100, 500, 300, 560}, Stamp: &Stempel{Label: "AUCH", Name: "Custom"}},
	}}, []Seite{{Quelle: 1, Drehung: 180}, {Quelle: 0}})
	g := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	if _, bbox, matrix := apStrom(t, aus, g.nr); bbox != "[0 0 60 200]" || matrix != "[0 -1 1 0 0 0]" || g.seite != 0 {
		t.Errorf("nach Plan: BBox %s Matrix %s Seite %d", bbox, matrix, g.seite)
	}
	popplerOhneSyntaxfehler(t, aus)
}

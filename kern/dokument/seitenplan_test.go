// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Umsortieren und Drehen: Reihenfolge, zusaetzliche Drehung auf die
// vorhandene, Seitengroessen und CropBox bleiben.
func TestUmsortierenUndDrehen(t *testing.T) {
	aus, b := bauen(t, korpus.Seitenformen(), []Seite{
		{Quelle: 4, Drehung: 0},   // /Rotate 90 bleibt 90
		{Quelle: 0, Drehung: 90},  // A4 hoch -> 90
		{Quelle: 3, Drehung: 180}, // versetzte CropBox bleibt
		{Quelle: 1, Drehung: 270}, // A4 quer
		{Quelle: 2, Drehung: 0},   // Letter
	})
	erwartet := []seitenbild{
		{"SEITE-05", 90, "[0 0 595 842]", ""},
		{"SEITE-01", 90, "[0 0 595 842]", ""},
		{"SEITE-04", 180, "[0 0 595 842]", "[36 48 559 794]"},
		{"SEITE-02", 270, "[0 0 842 595]", ""},
		{"SEITE-03", 0, "[0 0 612 792]", ""},
	}
	ist := seitenbilder(t, aus)
	if len(ist) != len(erwartet) {
		t.Fatalf("%d Seiten, erwartet %d", len(ist), len(erwartet))
	}
	for i := range erwartet {
		if ist[i] != erwartet[i] {
			t.Errorf("Seite %d: %+v, erwartet %+v", i+1, ist[i], erwartet[i])
		}
	}
	if b.Seiten != 5 || len(b.Verluste) != 0 {
		t.Errorf("Bericht: %+v", b)
	}
}

// Drehen um 90 und nochmal um 270 ergibt wieder 0 — auch auf einer Seite,
// die schon gedreht war (Uhrzeigersinn, modulo 360).
func TestDrehungIstModulo360(t *testing.T) {
	aus, _ := bauen(t, korpus.Seitenformen(), []Seite{{Quelle: 4, Drehung: 270}})
	if d := seitenbilder(t, aus)[0].drehung; d != 0 {
		t.Errorf("90 + 270 = %d, erwartet 0", d)
	}
}

// Vererbte Attribute (MediaBox, Rotate, Resources am Zwischenknoten)
// gehen beim flachen Neuaufbau nicht verloren.
func TestVererbteAttributeBleiben(t *testing.T) {
	aus, _ := bauen(t, korpus.Verschachtelt(), []Seite{{Quelle: 3, Drehung: 90}, {Quelle: 0}, {Quelle: 1, Drehung: 180}})
	erwartet := []seitenbild{
		{"SEITE-04", 90, "[0 0 842 595]", ""},
		{"SEITE-01", 90, "[0 0 595 842]", ""},
		{"SEITE-02", 270, "[0 0 595 842]", ""},
	}
	ist := seitenbilder(t, aus)
	for i := range erwartet {
		if ist[i] != erwartet[i] {
			t.Errorf("Seite %d: %+v, erwartet %+v", i+1, ist[i], erwartet[i])
		}
	}
	// Die Schrift kommt aus den geerbten Ressourcen: Jede Seite muss /F1
	// noch finden.
	ctx := geoeffnet(t, aus)
	seiten, _ := blaetter(ctx)
	for i, s := range seiten {
		res := alsDict(ctx.XRefTable, s.dict["Resources"])
		if alsDict(ctx.XRefTable, res["Font"])["F1"] == nil {
			t.Errorf("Seite %d: Schrift F1 fehlt in den Ressourcen", i+1)
		}
	}
}

// Entfernen und Verdoppeln in einem Plan.
func TestEntfernenUndVerdoppeln(t *testing.T) {
	aus, b := bauen(t, korpus.Textseiten(3), plan(2, 0, 0))
	if m := marken(t, aus); !gleich(m, []string{"SEITE-03", "SEITE-01", "SEITE-01"}) {
		t.Errorf("Reihenfolge %v", m)
	}
	if b.Seiten != 3 {
		t.Errorf("Bericht %+v", b)
	}
}

// Eine entfernte Seite ist WIRKLICH weg — auch wenn Lesezeichen, Links,
// Antworten oder der Strukturbaum auf sie zeigten. Sonst schriebe pdfcpu
// sie ueber einen solchen Verweis wieder in die Datei.
func TestEntfernteSeiteIstWirklichWeg(t *testing.T) {
	faelle := []struct {
		name    string
		pdf     []byte
		plan    []Seite
		weg     []string // Texte, die nirgends mehr stehen duerfen
		bleiben []string
	}{
		{"Lesezeichen auf Seite 3", korpus.MitLesezeichen(), plan(0, 1, 3),
			[]string{"SEITE-03"}, []string{"SEITE-01", "SEITE-04"}},
		{"Link und Antwort auf Seite 1", korpus.MitAnmerkungen(), plan(1, 2),
			[]string{"SEITE-01", "Bitte Betrag pruefen", "Rechnungsnummer"}, []string{"Erledigt", "SEITE-02"}},
		{"Strukturbaum mit /Pg", korpus.Getaggt(), plan(1),
			[]string{"SEITE-01"}, []string{"SEITE-02"}},
		{"Formularfeld und Lesezeichen", korpus.Voll(), plan(0, 1, 2, 4),
			[]string{"SEITE-04", "Wert Betrag"}, []string{"Wert Name", "SEITE-05"}},
	}
	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			aus, _ := bauen(t, f.pdf, f.plan)
			alles := alleObjekteAlsText(t, aus)
			for _, w := range f.weg {
				if strings.Contains(alles, w) {
					t.Errorf("%q steht noch in der Datei", w)
				}
			}
			for _, w := range f.bleiben {
				if !strings.Contains(alles, w) {
					t.Errorf("%q fehlt, sollte bleiben", w)
				}
			}
		})
	}
}

// Der Pflichtfall aus Kap. 04: eine Seite drehen, und ALLES bleibt —
// Anmerkungen, Felder, Anhaenge (samt Inhalt der XML-Rechnung),
// Lesezeichen, Links.
func TestDrehenErhaeltAlles(t *testing.T) {
	quelle := korpus.Voll()
	vorher := inspektion(t, quelle)
	aus, b := bauen(t, quelle, []Seite{{Quelle: 0}, {Quelle: 1, Drehung: 90}, {Quelle: 2}, {Quelle: 3}, {Quelle: 4}})
	nach := inspektion(t, aus)
	if len(b.Verluste) != 0 {
		t.Errorf("Verluste %v", b.Verluste)
	}
	if nach.Anmerkungen != vorher.Anmerkungen || nach.Formularfelder != vorher.Formularfelder ||
		nach.Anhaenge != vorher.Anhaenge || nach.Lesezeichen != vorher.Lesezeichen || nach.Links != vorher.Links {
		t.Errorf("vorher %+v\nnachher %+v", vorher, nach)
	}
	if b.AnmerkungenBehalten != 4 || b.FelderNachher != 2 || b.AnhaengeNachher != 2 || b.LesezeichenNachher != 5 {
		t.Errorf("Bericht %+v", b)
	}
	if got := eingebetteterInhalt(t, aus, "rechnung.xml"); !bytes.Equal(got, eingebetteterInhalt(t, quelle, "rechnung.xml")) {
		t.Errorf("Rechnungs-XML veraendert: %q", got)
	}
	// Die Reihenfolge ist unveraendert — die Seitenbeschriftung bleibt.
	if enthaelt(b.Warnungen, WarnungSeitenbeschriftungWeg) {
		t.Error("reine Drehung hat die Seitenbeschriftung entfernt")
	}
}

// Entfernen: Was zu entfernten Seiten gehoert, geht mit ihnen — das ist
// kein Verlust. Alles andere bleibt.
func TestEntfernenZaehltMitSeitenGetrennt(t *testing.T) {
	// Voll ohne Seite 2 (Hervorhebung + Dateianlage) und Seite 4 (Feld
	// "Betrag").
	aus, b := bauen(t, korpus.Voll(), plan(0, 2, 4))
	if len(b.Verluste) != 0 {
		t.Errorf("Verluste %v, erwartet keine", b.Verluste)
	}
	if b.AnmerkungenMitSeiten != 2 || b.AnmerkungenBehalten != 2 || b.AnmerkungenVerloren != 0 {
		t.Errorf("Anmerkungen: %+v", b)
	}
	if b.FelderVorher != 2 || b.FelderMitSeiten != 1 || b.FelderNachher != 1 {
		t.Errorf("Felder: %+v", b)
	}
	if b.AnhaengeVorher != 2 || b.AnhaengeMitSeiten != 1 || b.AnhaengeNachher != 1 {
		t.Errorf("Anhaenge: %+v", b)
	}
	if b.LesezeichenVorher != 5 || b.LesezeichenMitSeiten != 2 || b.LesezeichenNachher != 3 {
		t.Errorf("Lesezeichen: %+v", b)
	}
	if !enthaelt(b.Warnungen, WarnungSeitenbeschriftungWeg) {
		t.Errorf("Warnungen %v: Seitenbeschriftung stimmt nach dem Entfernen nicht mehr", b.Warnungen)
	}
	// Die eingebettete Rechnung haengt an keiner Seite — sie bleibt.
	if len(eingebetteterInhalt(t, aus, "rechnung.xml")) == 0 {
		t.Error("eingebettete Rechnung fehlt")
	}
}

// Ein Feld mit Widgets auf zwei Seiten bleibt, wenn eine der beiden geht
// — mit dem verbleibenden Widget.
func TestFeldMitWidgetsAufZweiSeiten(t *testing.T) {
	aus, b := bauen(t, korpus.MitFormular(), plan(0, 1))
	ctx := geoeffnet(t, aus)
	var adresse *feld
	for _, f := range formularfelder(ctx.XRefTable, katalogVon(t, ctx)) {
		if f.name == "Adresse" {
			f := f
			adresse = &f
		}
	}
	if adresse == nil || len(adresse.widgets) != 1 {
		t.Fatalf("Feld Adresse: %+v", adresse)
	}
	if b.FelderNachher != 4 || b.FelderMitSeiten != 0 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	// Ohne Seite 1 gehen Name und Betrag, Adresse bleibt (Widget auf Seite 3).
	_, b = bauen(t, korpus.MitFormular(), plan(1, 2))
	if b.FelderNachher != 2 || b.FelderMitSeiten != 2 || len(b.Verluste) != 0 {
		t.Errorf("ohne Seite 1: %+v", b)
	}
}

// Ein Lesezeichen mit Unterpunkten, dessen Ziel entfernt wird, bleibt als
// Ueberschrift ohne Ziel — sonst verschwaenden seine Unterpunkte mit.
func TestLesezeichenMitUnterpunktBleibt(t *testing.T) {
	aus, b := bauen(t, korpus.MitLesezeichen(), plan(0, 2, 3))
	if b.LesezeichenNachher != 4 || b.LesezeichenMitSeiten != 0 {
		t.Errorf("Bericht %+v", b)
	}
	if !enthaelt(b.Warnungen, WarnungLesezeichenZielWeg) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	ctx := geoeffnet(t, aus)
	for _, p := range lesezeichen(ctx.XRefTable, katalogVon(t, ctx)) {
		titel, _ := alsText(ctx.XRefTable, p.dict["Title"])
		ziel := aktionsZiel(ctx.XRefTable, p.dict, nil)
		switch titel {
		case "Kapitel 1":
			if ziel != 0 {
				t.Errorf("Kapitel 1 zeigt noch auf Objekt %d", ziel)
			}
		default:
			if ziel == 0 {
				t.Errorf("%q hat sein Ziel verloren", titel)
			}
		}
	}
	// Ohne Seite 3 geht "Abschnitt 1.1" (ohne Unterpunkte) mit der Seite.
	_, b = bauen(t, korpus.MitLesezeichen(), plan(0, 1, 3))
	if b.LesezeichenNachher != 3 || b.LesezeichenMitSeiten != 1 || len(b.Verluste) != 0 {
		t.Errorf("ohne Seite 3: %+v", b)
	}
}

// Verdoppeln: eigene Anmerkungsobjekte mit /P auf die neue Seite, Popup
// und Notiz verweisen aufeinander, nicht auf das Original.
func TestVerdoppelnKopiertAnmerkungen(t *testing.T) {
	aus, b := bauen(t, korpus.MitAnmerkungen(), plan(0, 0, 1, 2))
	if b.AnmerkungenBehalten != 7 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v (erwartet 5 + 2 verdoppelte)", b)
	}
	ctx := geoeffnet(t, aus)
	x := ctx.XRefTable
	seiten, _ := blaetter(ctx)
	for i, s := range seiten[:2] {
		for _, a := range anmerkungen(x, s.dict) {
			if nr, _ := objNr(a.dict["P"]); nr != s.ref.ObjectNumber.Value() {
				t.Errorf("Seite %d: %s zeigt mit /P auf %d", i+1, a.typ, nr)
			}
			if a.typ != "Text" {
				continue
			}
			popupNr, _ := objNr(a.dict["Popup"])
			popup := alsDict(x, a.dict["Popup"])
			if eltern, _ := objNr(popup["Parent"]); eltern != a.nr() {
				t.Errorf("Seite %d: Popup %d gehoert zu %d, nicht zur Notiz %d", i+1, popupNr, eltern, a.nr())
			}
		}
	}
	if seiten[0].ref == seiten[1].ref {
		t.Error("Verdopplung teilt das Seitenobjekt")
	}
}

// Verdoppelte Seite mit Formularfeld: Das Widget wird nicht verdoppelt —
// der Bericht sagt es und stuft es als Verlust ein.
func TestVerdoppelteFormularseite(t *testing.T) {
	_, b := bauen(t, korpus.Voll(), plan(0, 0, 1, 2, 3, 4))
	if !enthaelt(b.Warnungen, WarnungVerdoppeltOhneFelder) || !enthaelt(b.Verluste, VerlustFelder) {
		t.Errorf("Bericht %+v", b)
	}
	if b.FelderNachher != 2 {
		t.Errorf("Felder %d, erwartet 2 (das Feld selbst bleibt)", b.FelderNachher)
	}
}

// Beleg, warum der Adapter nicht api.Collect benutzt: pdfcpu kopiert die
// Seiten in ein neues Dokument, Lesezeichen und eingebettete Dateien
// bleiben zurueck.
func TestPdfcpuCollectVerliertKatalog(t *testing.T) {
	var aus bytes.Buffer
	if err := api.Collect(context.Background(), bytes.NewReader(korpus.Voll()), &aus,
		[]string{"1-5"}, konfiguration(0)); err != nil {
		t.Fatal(err)
	}
	i := inspektion(t, aus.Bytes())
	if i.Lesezeichen != 0 || i.Anhaenge != 1 {
		t.Fatalf("pdfcpu Collect erhaelt jetzt Lesezeichen (%d) oder Anhaenge (%d) — dann kann der Adapter neu bewertet werden",
			i.Lesezeichen, i.Anhaenge)
	}
	// Unser Seitenplan mit derselben Auswahl erhaelt beides.
	eigen, _ := bauen(t, korpus.Voll(), plan(0, 1, 2, 3, 4))
	if j := inspektion(t, eigen); j.Lesezeichen != 5 || j.Anhaenge != 2 {
		t.Errorf("Seitenplan: %+v", j)
	}
}

func TestPlanFehler(t *testing.T) {
	zuViele := make([]Seite, HoechstSeiten+1)
	faelle := []struct {
		name string
		plan []Seite
		err  error
	}{
		{"leer", nil, ErrKeineSeiten},
		{"Seite fehlt", plan(0, 3), ErrPlanUngueltig},
		{"negativ", plan(-1), ErrPlanUngueltig},
		{"45 Grad", []Seite{{Quelle: 0, Drehung: 45}}, ErrPlanUngueltig},
		{"zu viele", zuViele, ErrZuVieleSeiten},
	}
	for _, f := range faelle {
		var aus bytes.Buffer
		_, err := SeitenplanBauen(context.Background(), bytes.NewReader(korpus.Textseiten(3)), f.plan, &aus)
		if !errors.Is(err, f.err) {
			t.Errorf("%s: %v, erwartet %v", f.name, err, f.err)
		}
		if aus.Len() != 0 {
			t.Errorf("%s: trotz Fehler geschrieben", f.name)
		}
	}
}

// Extrahieren ist ein Seitenplan ohne Drehung.
func TestExtrahieren(t *testing.T) {
	var aus bytes.Buffer
	b, err := Extrahieren(context.Background(), bytes.NewReader(korpus.Voll()), []int{4, 0}, &aus)
	if err != nil {
		t.Fatal(err)
	}
	if m := marken(t, aus.Bytes()); !gleich(m, []string{"SEITE-05", "SEITE-01"}) || b.Seiten != 2 {
		t.Errorf("%v %+v", m, b)
	}
}

// Nur Besitzerschutz: pdfcpu schreibt das Dokument mit demselben
// Schluessel und denselben Rechten zurueck.
func TestBesitzerpasswortBleibt(t *testing.T) {
	quelle, err := korpus.MitBesitzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	aus, b := bauen(t, quelle, plan(2, 1))
	if i := inspektion(t, aus); !i.Verschluesselt || i.Benutzerpasswort || i.Seiten != 2 {
		t.Errorf("Ergebnis %+v", i)
	}
	if !enthaelt(b.Warnungen, WarnungVerschluesselung) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	if m := marken(t, aus); !gleich(m, []string{"SEITE-03", "SEITE-02"}) {
		t.Errorf("Reihenfolge %v", m)
	}
}

func TestSigniertesOriginalWarnt(t *testing.T) {
	aus, b := bauen(t, korpus.MitSignaturfeld(), plan(1, 0))
	if !enthaelt(b.Warnungen, WarnungSignaturUngueltig) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	if !inspektion(t, aus).Signiert {
		t.Error("das Signaturfeld ist im Ergebnis nicht mehr zu erkennen")
	}
}

// Das Ergebnis traegt keine Zeiger auf Zwischenknoten mehr: Jede Seite
// haengt direkt an der Wurzel des Seitenbaums.
func TestSeitenbaumIstFlach(t *testing.T) {
	aus, _ := bauen(t, korpus.Verschachtelt(), plan(0, 1, 2, 3))
	ctx := geoeffnet(t, aus)
	wurzel, _ := ctx.Pages()
	seiten, _ := blaetter(ctx)
	for i, s := range seiten {
		if p, _ := s.dict["Parent"].(types.IndirectRef); p.ObjectNumber != wurzel.ObjectNumber {
			t.Errorf("Seite %d haengt an %v, nicht an der Wurzel %v", i+1, p, wurzel)
		}
	}
}

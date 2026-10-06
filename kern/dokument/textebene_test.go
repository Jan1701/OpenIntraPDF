// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"html"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Unsichtbare Textebene (Etappe 3): Lage, Erhaltung, Grenzen.
//
// Die Lage prueft Poppler — ein fremder Leser, nicht die Bibliothek, die
// geschrieben hat: pdftotext -bbox -cropbox nennt jedes Wort im angezeigten
// Raum (Ursprung oben links in der CropBox, Drehung angewandt), genau dem
// Raum, in dem der Texterkennungsdienst seine Woerter liefert. Fehlt
// Poppler, wird die Lagepruefung uebersprungen und zaehlt NICHT als
// bestanden.

// gedrehterScan ist die schwere Seitenform: /Rotate 90 UND versetzte
// CropBox — Benutzerraum, Anzeige und Versatz fallen auseinander.
var gedrehterScan = korpus.Seitenform{Breite: 595, Hoehe: 842, CropBox: "[36 48 559 794]", Drehung: 90}

// textebene baut das Ergebnis und scheitert am Fehler.
func textebene(t *testing.T, quelle []byte, seiten map[int][]Wort) ([]byte, Bericht, int) {
	t.Helper()
	var aus bytes.Buffer
	b, n, err := TextebeneBauen(context.Background(), bytes.NewReader(quelle), seiten, &aus)
	if err != nil {
		t.Fatalf("TextebeneBauen: %v", err)
	}
	return aus.Bytes(), b, n
}

// popplerWort ist ein Wort, wie pdftotext -bbox es nennt.
type popplerWort struct {
	seite          int
	x0, y0, x1, y1 float64
	text           string
}

var popplerWortMuster = regexp.MustCompile(`<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>`)

// popplerWoerter laesst pdftotext -bbox -cropbox ueber das PDF laufen.
// Ohne Poppler: SKIP mit Meldung.
func popplerWoerter(t *testing.T, pdf []byte) []popplerWort {
	t.Helper()
	pfad, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("Poppler (pdftotext) nicht installiert — Lagepruefung der Textebene UEBERSPRUNGEN, zaehlt nicht als bestanden")
	}
	ordner := t.TempDir()
	datei := filepath.Join(ordner, "ergebnis.pdf")
	if err := os.WriteFile(datei, pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	aus := filepath.Join(ordner, "woerter.html")
	cmd := exec.CommandContext(context.Background(), pfad, "-bbox", "-cropbox", datei, aus)
	if ausgabe, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("pdftotext: %v\n%s", err, ausgabe)
	}
	roh, err := os.ReadFile(aus)
	if err != nil {
		t.Fatal(err)
	}
	var woerter []popplerWort
	for i, seite := range strings.Split(string(roh), "<page ")[1:] {
		for _, m := range popplerWortMuster.FindAllStringSubmatch(seite, -1) {
			z := func(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }
			woerter = append(woerter, popplerWort{seite: i, x0: z(m[1]), y0: z(m[2]), x1: z(m[3]), y1: z(m[4]),
				text: html.UnescapeString(m[5])})
		}
	}
	return woerter
}

// lageStimmt sucht jedes gesetzte Wort in Popplers Liste: gleicher Text,
// jede Kante hoechstens toleranz Punkte daneben.
func lageStimmt(t *testing.T, gefunden []popplerWort, seite int, erwartet []Wort, toleranz float64) {
	t.Helper()
	for _, e := range erwartet {
		passt := false
		var naechst string
		for _, g := range gefunden {
			if g.seite != seite || g.text != e.Text {
				continue
			}
			abstand := math.Max(math.Max(math.Abs(g.x0-e.X0), math.Abs(g.y0-e.Y0)),
				math.Max(math.Abs(g.x1-e.X1), math.Abs(g.y1-e.Y1)))
			naechst += " " + strconv.FormatFloat(abstand, 'f', 1, 64)
			if abstand <= toleranz {
				passt = true
				break
			}
		}
		if !passt {
			t.Errorf("Seite %d: %q bei [%g %g %g %g] nicht innerhalb %g pt gefunden (Abstaende gleichnamiger:%s); Poppler sah: %v",
				seite, e.Text, e.X0, e.Y0, e.X1, e.Y1, toleranz, naechst, gefunden)
		}
	}
}

// Die Pflichtpruefung des Auftrags: ein Scan aus dem Korpus (Bild ohne
// Text) und eine Seite mit /Rotate 90 und CropBox; pdftotext -bbox muss
// die Woerter an der richtigen Lage finden, ±4 pt.
func TestTextebeneLageMitPoppler(t *testing.T) {
	faelle := []struct {
		name    string
		quelle  []byte
		seite   int
		woerter []Wort
	}{
		{"Scan A4", korpus.Scan(korpus.A4), 0, []Wort{
			{72, 70, 190, 90, "Musterfirma"}, {200, 70, 260, 90, "GmbH"},
			{72, 400, 150, 416, "Rechnung"}, {160, 400, 210, 416, "00123"},
			{72, 780, 130, 796, "Grüße"},
		}},
		{"Scan /Rotate 90 mit CropBox, zweite Seite", korpus.Scan(korpus.A4, gedrehterScan), 1, []Wort{
			// angezeigt: 746 breit, 523 hoch
			{100, 50, 220, 70, "Musterfirma"}, {230, 50, 290, 70, "GmbH"},
			{500, 400, 600, 420, "Betrag"}, {610, 400, 680, 420, "119,00"},
		}},
	}
	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			aus, b, n := textebene(t, f.quelle, map[int][]Wort{f.seite: f.woerter})
			if n != len(f.woerter) || len(b.Verluste) != 0 {
				t.Fatalf("%d Woerter gesetzt (erwartet %d), Bericht %+v", n, len(f.woerter), b)
			}
			popplerOhneSyntaxfehler(t, aus)
			lageStimmt(t, popplerWoerter(t, aus), f.seite, f.woerter, 4)
			// Optisch derselbe Scan: Das Bild ist noch da, der Text unsichtbar.
			alles := alleObjekteAlsText(t, aus)
			if !strings.Contains(alles, "/Im1 Do") || !strings.Contains(alles, "3 Tr") {
				t.Error("Bild oder Textdarstellung 3 fehlt im Ergebnis")
			}
		})
	}
}

// Anmerkungen, Formulare, Anhaenge und Lesezeichen bleiben erhalten —
// auch auf Seiten, die eine Textebene bekommen.
func TestTextebeneErhaeltAlles(t *testing.T) {
	woerter := []Wort{{72, 100, 180, 118, "Lieferschein"}, {72, 130, 120, 148, "00456"}}
	aus, b, n := textebene(t, korpus.Voll(), map[int][]Wort{1: woerter, 3: woerter})
	if n != 4 {
		t.Errorf("%d Woerter gesetzt, erwartet 4", n)
	}
	if b.Seiten != 5 || b.AnmerkungenBehalten != 4 || b.AnmerkungenFremdBehalten != 4 || b.FelderNachher != 2 ||
		b.AnhaengeNachher != 2 || b.LesezeichenNachher != 5 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	vorher, nachher := inspektion(t, korpus.Voll()), inspektion(t, aus)
	if vorher != nachher {
		t.Errorf("Inspektion veraendert:\nvorher  %+v\nnachher %+v", vorher, nachher)
	}
	if m := marken(t, aus); !gleich(m, []string{"SEITE-01", "SEITE-02", "SEITE-03", "SEITE-04", "SEITE-05"}) {
		t.Errorf("Seiten %v", m)
	}
	if got := eingebetteterInhalt(t, aus, "rechnung.xml"); !bytes.Contains(got, []byte("Musterfirma GmbH")) {
		t.Error("eingebettete Rechnung veraendert")
	}
	popplerOhneSyntaxfehler(t, aus)

	// Ein inkrementell gespeichertes Acrobat-Dokument: alle Erscheinungs-
	// bilder bleiben (die Regression aus Etappe 2).
	quelle, err := os.ReadFile(filepath.Join("testdata", "acrobat-inkrementell.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	aus, _, _ = textebene(t, quelle, map[int][]Wort{0: woerter})
	if mitAP, lesbar := erscheinungsbilder(t, aus); mitAP != 11 || lesbar != 11 {
		t.Errorf("nach der Textebene: %d mit AP, %d lesbar — erwartet 11/11", mitAP, lesbar)
	}
}

// Geerbte Ressourcen (Seitenbaum mit Zwischenknoten): Die Schrift kommt
// auf die Seite, nicht auf den Zwischenknoten — die Geschwister bleiben
// unberuehrt, und die Textebene liegt trotz geerbter Drehung richtig.
func TestTextebeneMitGeerbtenRessourcen(t *testing.T) {
	woerter := []Wort{{50, 40, 150, 60, "Musterfirma"}}
	aus, b, n := textebene(t, korpus.Verschachtelt(), map[int][]Wort{0: woerter})
	if n != 1 || b.Seiten != 4 || len(b.Verluste) != 0 {
		t.Fatalf("n=%d Bericht %+v", n, b)
	}
	ctx := geoeffnet(t, aus)
	seiten, err := blaetter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, s := range seiten {
		res := alsDict(ctx.XRefTable, wirksam(s, "Resources"))
		fonts := alsDict(ctx.XRefTable, res["Font"])
		_, hat := fonts[ocrSchrift]
		if hat != (i == 0) {
			t.Errorf("Seite %d: Schrift %s vorhanden %v", i+1, ocrSchrift, hat)
		}
	}
	// Seite 1 erbt /Rotate 90 vom Zwischenknoten; angezeigt 842 breit.
	lageStimmt(t, popplerWoerter(t, aus), 0, woerter, 4)
}

// Grenzen: Seite ausserhalb, leere Woerter, Woerter ohne Flaeche.
func TestTextebeneGrenzen(t *testing.T) {
	ctx := geoeffnet(t, korpus.Textseiten(2))
	if _, err := TextebeneSetzen(context.Background(), ctx, 2, []Wort{{0, 0, 10, 10, "x"}}); !errors.Is(err, ErrPlanUngueltig) {
		t.Errorf("Seite 3 von 2: %v", err)
	}
	n, err := TextebeneSetzen(context.Background(), ctx, 0, []Wort{{10, 10, 10, 20, "leer"}, {10, 10, 50, 20, "  "}, {30, 20, 20, 10, "rueckwaerts"}})
	if err != nil || n != 0 {
		t.Errorf("Woerter ohne Flaeche: n=%d %v", n, err)
	}
	// Ohne Woerter bleibt das Dokument, wie es war — und ist trotzdem
	// gueltig geschrieben.
	aus, b, n := textebene(t, korpus.Textseiten(2), map[int][]Wort{0: nil})
	if n != 0 || b.Seiten != 2 {
		t.Errorf("n=%d Bericht %+v", n, b)
	}
	if strings.Contains(alleObjekteAlsText(t, aus), ocrSchrift) {
		t.Error("Schrift eingetragen, obwohl kein Wort gesetzt wurde")
	}
}

// Die Matrix ist die von pdf.js (PageViewport, Massstab 1): Ursprung oben
// links in der CropBox, Drehung angewandt.
func TestAnzeigematrix(t *testing.T) {
	box := [4]float64{36, 48, 559, 794} // 523 x 746
	faelle := []struct {
		drehung int
		x, y    float64 // Benutzerraum
		ax, ay  float64 // angezeigt
	}{
		{0, 36, 794, 0, 0}, {0, 559, 48, 523, 746},
		{90, 36, 48, 0, 0}, {90, 559, 794, 746, 523},
		{180, 559, 48, 0, 0},
		{270, 559, 794, 0, 0},
	}
	for _, f := range faelle {
		m := anzeigematrix(box, f.drehung)
		ax, ay := anwenden(m, f.x, f.y)
		if math.Abs(ax-f.ax) > 1e-9 || math.Abs(ay-f.ay) > 1e-9 {
			t.Errorf("Drehung %d: (%g,%g) -> (%g,%g), erwartet (%g,%g)", f.drehung, f.x, f.y, ax, ay, f.ax, f.ay)
		}
		rx, ry := anwenden(umkehren(m), ax, ay)
		if math.Abs(rx-f.x) > 1e-9 || math.Abs(ry-f.y) > 1e-9 {
			t.Errorf("Drehung %d: Umkehr (%g,%g) -> (%g,%g)", f.drehung, ax, ay, rx, ry)
		}
	}
}

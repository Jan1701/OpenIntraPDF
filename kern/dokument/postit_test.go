// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"image"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/font"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Post-it (Etappe 5). Wie in Etappe 2 wird alles im wieder geoeffneten
// Ergebnis nachgelesen; Farbe und Text zusaetzlich mit Poppler (SKIP ohne
// Poppler, wie bei der Textebene).

// popplerText laesst pdftotext ueber das Ergebnis laufen.
func popplerText(t *testing.T, pdf []byte) string {
	t.Helper()
	pfad, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("Poppler (pdftotext) nicht installiert — Textpruefung UEBERSPRUNGEN, zaehlt nicht als bestanden")
	}
	datei := filepath.Join(t.TempDir(), "ergebnis.pdf")
	if err := os.WriteFile(datei, pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	aus, err := exec.CommandContext(context.Background(), pfad, datei, "-").CombinedOutput()
	if err != nil {
		t.Fatalf("pdftotext: %v\n%s", err, aus)
	}
	return string(aus)
}

// popplerBild rendert Seite seite (ab 0) mit 72 dpi: ein Punkt ist ein Pixel.
func popplerBild(t *testing.T, pdf []byte, seite int) image.Image {
	t.Helper()
	pfad, err := exec.LookPath("pdftoppm")
	if err != nil {
		t.Skip("Poppler (pdftoppm) nicht installiert — Farbpruefung UEBERSPRUNGEN, zaehlt nicht als bestanden")
	}
	ordner := t.TempDir()
	datei := filepath.Join(ordner, "ergebnis.pdf")
	if err := os.WriteFile(datei, pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	praefix := filepath.Join(ordner, "seite")
	nr := strconv.Itoa(seite + 1)
	aus, err := exec.CommandContext(context.Background(), pfad, "-r", "72", "-f", nr, "-l", nr, "-png", "-singlefile", datei, praefix).CombinedOutput()
	if err != nil {
		t.Fatalf("pdftoppm: %v\n%s", err, aus)
	}
	f, err := os.Open(praefix + ".png")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

// pixel liest die Farbe an einem Punkt des Benutzerraums (Ursprung unten
// links) aus einem 72-dpi-Bild, als Werte 0..1.
func pixel(img image.Image, x, y float64) [3]float64 {
	h := img.Bounds().Dy()
	r, g, b, _ := img.At(int(x), h-int(math.Ceil(y))).RGBA()
	return [3]float64{float64(r) / 65535, float64(g) / 65535, float64(b) / 65535}
}

func farbeNah(got [3]float64, want []float64, toleranz float64) bool {
	for i := range got {
		if math.Abs(got[i]-want[i]) > toleranz {
			return false
		}
	}
	return true
}

// dictVon liest das Woerterbuch eines Objekts.
func dictVon(t *testing.T, pdf []byte, nr int) types.Dict {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	d := alsDict(ctx.XRefTable, *types.NewIndirectRef(nr, 0))
	if d == nil {
		t.Fatalf("Objekt %d ist kein Woerterbuch", nr)
	}
	return d
}

var tjMuster = regexp.MustCompile(`\(((?:\\.|[^\\)])*)\) Tj`)

// gezeichneteZeilen liest die WinAnsi-Literale der Tj-Operatoren eines
// Inhaltsstroms (nur ASCII-Texte, ohne Maskierung).
func gezeichneteZeilen(inhalt string) []string {
	var aus []string
	for _, m := range tjMuster.FindAllStringSubmatch(inhalt, -1) {
		aus = append(aus, m[1])
	}
	return aus
}

func TestPostitErscheinungUndFarbe(t *testing.T) {
	text := "Bitte die Rechnung noch einmal prüfen: Der Betrag stimmt nicht mit dem Angebot überein."
	aus, b, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 500, 270, 630}, Contents: text},
	}}, nil)
	if len(b.Warnungen) != 0 || b.AnmerkungenNeu != 1 {
		t.Errorf("Bericht %+v", b)
	}
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	if bild.typ != "FreeText" || bild.flags != 4 || bild.rect != "[100 500 270 630]" || bild.inhalt != text || !bild.hatAP || bild.autor != "Erika Musterfrau" {
		t.Errorf("Post-it %+v", bild)
	}
	d := dictVon(t, aus, bild.nr)
	if alsName(nil, d["OIHKind"]) != "sticky" || zahlen(nil, d["OIHFill"]) != "[1 0.961 0.616]" {
		t.Errorf("Kennzeichen: OIHKind %v, OIHFill %v", d["OIHKind"], d["OIHFill"])
	}
	if _, hatC := d["C"]; hatC {
		t.Error("Post-it traegt C (siehe Begruendung in postit.go)")
	}
	if da, _ := alsText(nil, d["DA"]); da != "/Helv 11 Tf 0.122 0.161 0.216 rg" {
		t.Errorf("DA %q", da)
	}
	inhalt, bbox, matrix := apStrom(t, aus, bild.nr)
	if bbox != "[0 0 170 130]" || matrix != "" {
		t.Errorf("BBox %s Matrix %s", bbox, matrix)
	}
	// Fuellung, dunklerer Rand (75 %), Eselsohr, Text in Dunkelgrau, Umbruch.
	for _, s := range []string{"1 0.961 0.616 rg", "0.75 0.721 0.462 RG", "h B", "0.75 0.721 0.462 rg", "h f", "/Helv 11 Tf 0.122 0.161 0.216 rg 13.2 TL 6 113 Td"} {
		if !strings.Contains(inhalt, s) {
			t.Errorf("Erscheinungsbild ohne %q: %s", s, inhalt)
		}
	}
	if z := gezeichneteZeilen(inhalt); len(z) < 3 || z[0] != "Bitte die Rechnung noch einmal" {
		t.Errorf("Zeilen %q", z)
	}
	popplerOhneSyntaxfehler(t, aus)
	if pt := popplerText(t, aus); !strings.Contains(pt, "Bitte die Rechnung") || !strings.Contains(pt, "überein") {
		t.Errorf("pdftotext findet den Zettel nicht:\n%s", pt)
	}
	img := popplerBild(t, aus, 0)
	if p := pixel(img, 185, 520); !farbeNah(p, postitGelb, 0.03) {
		t.Errorf("Mitte unten des Zettels ist %v, erwartet Gelb %v", p, postitGelb)
	}
	if p := pixel(img, 50, 565); !farbeNah(p, []float64{1, 1, 1}, 0.01) {
		t.Errorf("neben dem Zettel ist %v, erwartet Weiss", p)
	}
}

// Eigene Farbe, Schriftgroesse und Umbruch in einem schmalen Zettel: Jede
// gezeichnete Zeile ist hoechstens so breit wie der Innenraum.
func TestPostitUmbruch(t *testing.T) {
	gruen := []float64{0.773, 0.882, 0.647}
	text := "Ein langer Satz ohne Zeilenumbruch, der in einem schmalen Zettel auf mehrere Zeilen verteilt werden muss, und ein Riesenwortohnejedeslsuecke."
	aus, b, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 400, 200, 700}, Contents: text, Color: gruen, FontSize: 10},
	}}, nil)
	if len(b.Warnungen) != 0 {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	inhalt, _, _ := apStrom(t, aus, bild.nr)
	if !strings.Contains(inhalt, "0.773 0.882 0.647 rg") || !strings.Contains(inhalt, "/Helv 10 Tf") {
		t.Errorf("Farbe oder Groesse fehlt: %s", inhalt)
	}
	zeilen := gezeichneteZeilen(inhalt)
	if len(zeilen) < 5 {
		t.Fatalf("nur %d Zeilen: %q", len(zeilen), zeilen)
	}
	innen := 100 - 2*postitInnen
	for _, z := range zeilen {
		w, err := font.TextWidthFloat(context.Background(), z, "Helvetica", 10)
		if err != nil || w > innen {
			t.Errorf("Zeile %q ist %.1f pt breit, Innenraum %.0f", z, w, innen)
		}
	}
	if !strings.Contains(strings.Join(zeilen, "|"), "Riesenwort") || strings.Contains(strings.Join(zeilen, " "), "Riesenwortohnejedeslsuecke.") {
		t.Errorf("langes Wort nicht hart getrennt: %q", zeilen)
	}
	if strings.Join(strings.Fields(strings.ReplaceAll(strings.Join(zeilen, ""), "Riesenwort", "Riesenwort")), " ") == "" {
		t.Error("leer")
	}
	if d := dictVon(t, aus, bild.nr); zahlen(nil, d["OIHFill"]) != "[0.773 0.882 0.647]" {
		t.Errorf("OIHFill %v", d["OIHFill"])
	}
}

func TestUmbrechen(t *testing.T) {
	messen := func(s string) float64 { return float64(len([]rune(s))) * 10 }
	faelle := []struct {
		text   string
		breite float64
		zeilen []string
	}{
		{"aaaa bbbb cccc", 90, []string{"aaaa bbbb", "cccc"}},
		{"aaaa bbbb cccc", 140, []string{"aaaa bbbb cccc"}},
		{"ab\n\ncd", 100, []string{"ab", "", "cd"}},
		{"abcdefghijklmnop", 50, []string{"abcde", "fghij", "klmno", "p"}},
		{"xx abcdefghijkl yy", 50, []string{"xx", "abcde", "fghij", "kl yy"}},
		{"a", 5, []string{"a"}},
		{"", 50, []string{""}},
		{"  viele   Leerzeichen  ", 200, []string{"viele Leerzeichen"}},
	}
	for _, f := range faelle {
		if got := umbrechen(f.text, f.breite, messen); !gleich(got, f.zeilen) {
			t.Errorf("umbrechen(%q, %g) = %q, erwartet %q", f.text, f.breite, got, f.zeilen)
		}
	}
}

// Passt der Text nicht: Schrift bis 7 pt verkleinern, dann kuerzen mit
// „…“ und Warnung; Contents bleibt vollstaendig.
func TestPostitKuerzung(t *testing.T) {
	text := strings.Repeat("Dieser Zettel ist viel zu klein für den Text. ", 6)
	// 80 x 30: Innenraum 68 x 18 -> mit 7 pt zwei Zeilen.
	aus, b, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 600, 180, 630}, Contents: text},
	}}, nil)
	if !enthaelt(b.Warnungen, WarnungPostitGekuerzt) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	if bild.inhalt != text {
		t.Errorf("Contents gekuerzt: %q", bild.inhalt)
	}
	inhalt, _, _ := apStrom(t, aus, bild.nr)
	zeilen := gezeichneteZeilen(inhalt)
	if !strings.Contains(inhalt, "/Helv 7 Tf") || len(zeilen) != 2 || !strings.HasSuffix(zeilen[1], `\205`) {
		t.Errorf("gekuerzt: %q in %s", zeilen, inhalt)
	}
	// Passt es nach dem Verkleinern: keine Warnung, kleinere Schrift.
	aus, b, erg = commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 600, 220, 660}, Contents: "Passt mit etwas kleinerer Schrift gerade noch auf den Zettel."},
	}}, nil)
	if len(b.Warnungen) != 0 {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	if inhalt, _, _ := apStrom(t, aus, bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM).nr); strings.Contains(inhalt, "/Helv 11 Tf") || !strings.Contains(inhalt, "/Helv ") {
		t.Errorf("Schrift nicht verkleinert: %s", inhalt)
	}
}

// update auf ein Post-it zeichnet es als Post-it neu: gleiche Farbe,
// gleiches Rect, Umbruch — auch mit Zeichen ausserhalb WinAnsi.
func TestPostitAktualisieren(t *testing.T) {
	blau := []float64{0.702, 0.898, 0.988}
	quelle, _, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 500, 270, 630}, Contents: "Erster Text", Color: blau, FontSize: 12},
	}}, nil)
	ref := erg.Added[0].Ref
	nm := erg.Added[0].NM
	aus, b, _ := commit(t, quelle, &Anmerkungsbefehle{
		Update: []Anmerkungstext{{Ref: ref, Contents: "Neuer Text, der jetzt so lang ist, dass er auf dem Zettel umgebrochen wird."}},
		Eigene: map[string]bool{nm: true}, NurEigene: true,
	}, nil)
	if len(b.Warnungen) != 0 {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	bild := bildVon(t, anmerkungsbilder(t, aus), nm)
	inhalt, bbox, _ := apStrom(t, aus, bild.nr)
	if bild.rect != "[100 500 270 630]" || bbox != "[0 0 170 130]" || !strings.Contains(inhalt, "0.702 0.898 0.988 rg") ||
		!strings.Contains(inhalt, "/Helv 12 Tf") || len(gezeichneteZeilen(inhalt)) < 2 || strings.Contains(inhalt, "Erster") {
		t.Errorf("neu gezeichnet: %+v BBox %s\n%s", bild, bbox, inhalt)
	}
	if d := dictVon(t, aus, bild.nr); alsName(nil, d["OIHKind"]) != "sticky" || zahlen(nil, d["OIHFill"]) != "[0.702 0.898 0.988]" {
		t.Errorf("Kennzeichen verloren: %v %v", d["OIHKind"], d["OIHFill"])
	}
	// Griechisch: Noto Sans statt Helvetica, Text per ToUnicode lesbar.
	aus, _, _ = commit(t, aus, &Anmerkungsbefehle{Update: []Anmerkungstext{{Ref: ref, Contents: "Ελληνικά σημείωση"}}}, nil)
	inhalt, _, _ = apStrom(t, aus, bild.nr)
	if !strings.Contains(inhalt, "/"+schriftNoto+" 12 Tf") || !strings.Contains(inhalt, "> Tj") {
		t.Errorf("Griechisch ohne Noto: %s", inhalt)
	}
	if pt := popplerText(t, aus); !strings.Contains(pt, "Ελληνικά") {
		t.Errorf("pdftotext:\n%s", pt)
	}
}

// Auf einer um 90 Grad gedrehten Seite steht der Zettel in der Anzeige
// aufrecht — BBox und Matrix wie beim Textfeld.
func TestPostitGedrehteSeite(t *testing.T) {
	aus, _, erg := commit(t, korpus.GedrehtMitCropBox(), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 500, 300, 560}, Contents: "Aufrecht"},
	}}, nil)
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	inhalt, bbox, matrix := apStrom(t, aus, bild.nr)
	if bild.rect != "[100 500 300 560]" || bild.drehung != 90 || bbox != "[0 0 60 200]" || matrix != "[0 1 -1 0 0 0]" ||
		!strings.Contains(inhalt, "(Aufrecht) Tj") {
		t.Errorf("Post-it %+v BBox %s Matrix %s", bild, bbox, matrix)
	}
	popplerOhneSyntaxfehler(t, aus)
}

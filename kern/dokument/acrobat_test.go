// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Regression aus dem Acrobat-Rundlauf (Koordinator, 29.09.2026):
// testdata/acrobat-inkrementell.pdf ist ein synthetisches Dokument, das
// Acrobat inkrementell gespeichert hat (Anhang mit Querverweisstrom und
// neuem Objektstrom). Wird es nur mit api.ReadContext gelesen und dann
// geschrieben, fehlen danach die Erscheinungsbilder (AP-Form-XObjects)
// der Anmerkungen — still: pdfcpu validiert das Ergebnis trotzdem, erst
// Poppler meldet „Invalid XRef entry“. Mit api.ReadAndValidate (so liest
// lesen() in konfig.go) bleiben alle erhalten.
func TestAcrobatInkrementellBehaeltErscheinungsbilder(t *testing.T) {
	quelle, err := os.ReadFile(filepath.Join("testdata", "acrobat-inkrementell.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	mitAP, lesbar := erscheinungsbilder(t, quelle)
	if mitAP != 11 || lesbar != 11 {
		t.Fatalf("Quelle: %d Anmerkungen mit AP, %d lesbar — erwartet 11/11", mitAP, lesbar)
	}

	aus, b := bauen(t, quelle, []Seite{{Quelle: 0, Drehung: 90}})
	mitAP, lesbar = erscheinungsbilder(t, aus)
	if mitAP != 11 || lesbar != 11 {
		t.Errorf("nach dem Drehen: %d mit AP, %d lesbar — erwartet 11/11", mitAP, lesbar)
	}
	if b.AnmerkungenBehalten != 11 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Waechter zur Regression oben: Im Adapter liest niemand mit
// api.ReadContext allein.
func TestKeinReadContextOhneValidierung(t *testing.T) {
	dateien, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range dateien {
		if strings.HasSuffix(d, "_test.go") {
			continue
		}
		roh, err := os.ReadFile(d)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(roh), "api.ReadContext(") || strings.Contains(string(roh), "pdfcpu.Read(") {
			t.Errorf("%s liest ohne Validierung — nur lesen() (api.ReadAndValidate) benutzen", d)
		}
	}
}

// popplerOhneSyntaxfehler laesst pdfinfo und pdftotext ueber das Ergebnis
// laufen, wenn sie da sind. Poppler ist strenger als pdfcpu; ein
// „Syntax Error“ dort ist ein Befund, auch wenn pdfcpu die Datei liest.
func popplerOhneSyntaxfehler(t *testing.T, pdf []byte) {
	t.Helper()
	datei := filepath.Join(t.TempDir(), "ergebnis.pdf")
	if err := os.WriteFile(datei, pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, werkzeug := range [][]string{{"pdfinfo", datei}, {"pdftotext", datei, "-"}} {
		pfad, err := exec.LookPath(werkzeug[0])
		if err != nil {
			t.Logf("%s nicht installiert — Poppler-Pruefung uebersprungen", werkzeug[0])
			continue
		}
		cmd := exec.CommandContext(context.Background(), pfad, werkzeug[1:]...)
		ausgabe, err := cmd.CombinedOutput()
		if err != nil {
			t.Errorf("%s scheitert: %v\n%s", werkzeug[0], err, ausgabe)
		}
		if strings.Contains(string(ausgabe), "Syntax Error") || strings.Contains(string(ausgabe), "Syntax Warning") {
			t.Errorf("%s meldet:\n%s", werkzeug[0], ausgabe)
		}
	}
}

// Dieselbe Pruefung fuer die Ergebnisse aus dem Korpus: Umsortieren,
// Entfernen, Verdoppeln, Binden duerfen fuer Poppler keine Syntaxfehler
// erzeugen.
func TestKorpusErgebnissePoppler(t *testing.T) {
	if _, err := exec.LookPath("pdfinfo"); err != nil {
		t.Skip("Poppler (pdfinfo) nicht installiert")
	}
	for _, f := range popplerFaelle(t) {
		t.Run(f.name, func(t *testing.T) { popplerOhneSyntaxfehler(t, f.pdf) })
	}
}

type popplerFall struct {
	name string
	pdf  []byte
}

func popplerFaelle(t *testing.T) []popplerFall {
	t.Helper()
	var aus []popplerFall
	neu := func(name string, pdf []byte) { aus = append(aus, popplerFall{name, pdf}) }
	p, _ := bauen(t, korpus.Voll(), []Seite{{Quelle: 4, Drehung: 90}, {Quelle: 0}, {Quelle: 0, Drehung: 180}, {Quelle: 2}})
	neu("Voll umsortiert", p)
	p, _ = bauen(t, korpus.MitAnmerkungen(), plan(1, 2, 2))
	neu("Anmerkungen ohne Seite 1", p)
	p, _ = bauen(t, korpus.Getaggt(), plan(1))
	neu("Getaggt ohne Seite 1", p)
	p, _ = bauen(t, korpus.Verschachtelt(), plan(3, 1))
	neu("Verschachtelt", p)
	p, _ = binden(t, true, quelle(korpus.MitFormular(), "A"), quelle(korpus.MitAnhang(), "B"),
		quelle(korpus.MitLesezeichen(), "C", 3, 1))
	neu("Gebunden", p)
	return aus
}

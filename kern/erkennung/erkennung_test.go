// SPDX-License-Identifier: Apache-2.0

package erkennung

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestTsvLesen kam mit dem Paket aus cmd/texterkennung (verhaltensgleich).
func TestTsvLesen(t *testing.T) {
	tsv := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
		"1\t1\t0\t0\t0\t0\t0\t0\t2480\t3508\t-1\t\n" +
		"5\t1\t1\t1\t1\t1\t300\t300\t150\t50\t96.5\tRechnung\n" +
		"5\t1\t1\t1\t1\t2\t480\t300\t120\t50\t91.2\t00123\n" +
		"5\t1\t1\t1\t2\t1\t300\t400\t100\t50\t88\tSumme\n" +
		"5\t1\t2\t1\t1\t1\t300\t900\t90\t50\t-1\t \n" + // Leerwort faellt weg
		"5\t1\t3\t1\t1\t1\t300\t1000\t90\t50\t77\tEnde\n"
	bloecke, err := TsvLesen([]byte(tsv), 72.0/300)
	if err != nil {
		t.Fatal(err)
	}
	if len(bloecke) != 2 || len(bloecke[0].Zeilen) != 2 || len(bloecke[0].Zeilen[0].Woerter) != 2 {
		t.Fatalf("Aufbau falsch: %+v", bloecke)
	}
	w := bloecke[0].Zeilen[0].Woerter[1]
	// 480 px bei 300 dpi = 115,2 pt
	if w.Text != "00123" || w.X0 != 115.2 || w.Y0 != 72 || w.X1 != 144 || w.Konf != 91.2 {
		t.Errorf("Wort = %+v", w)
	}
	if bloecke[1].Zeilen[0].Woerter[0].Text != "Ende" {
		t.Errorf("zweiter Block = %+v", bloecke[1])
	}
}

func TestZeichenUndTextebene(t *testing.T) {
	kurz := []Block{{Zeilen: []Zeile{{Woerter: []Wort{{Text: "Seite 3"}}}}}}
	if n := ZeichenIn(kurz); n != 6 || HatTextebene(kurz) {
		t.Errorf("kurz: %d Zeichen, Textebene %v", n, HatTextebene(kurz))
	}
	lang := []Block{{Zeilen: []Zeile{{Woerter: []Wort{{Text: "Betriebsordnung"}, {Text: "Musterfirma"}}}}}}
	if !HatTextebene(lang) {
		t.Errorf("26 Zeichen zaehlen nicht als Textebene")
	}
}

func TestMeistSenkrecht(t *testing.T) {
	liegend := []Block{{Zeilen: []Zeile{{Woerter: []Wort{
		{X0: 0, Y0: 0, X1: 60, Y1: 12, Text: "Rechnung"}, {X0: 70, Y0: 0, X1: 90, Y1: 12, Text: "12"},
	}}}}}
	if MeistSenkrecht(liegend) {
		t.Error("liegender Text gilt als senkrecht")
	}
	stehend := []Block{{Zeilen: []Zeile{{Woerter: []Wort{
		// Zwei von drei zaehlbaren Woertern stehen hochkant; „Nr“ ist zu kurz und zaehlt nicht.
		{X0: 0, Y0: 0, X1: 12, Y1: 60, Text: "Rechnung"}, {X0: 0, Y0: 70, X1: 12, Y1: 120, Text: "Nummer"},
		{X0: 0, Y0: 130, X1: 12, Y1: 140, Text: "Nr"}, {X0: 20, Y0: 0, X1: 60, Y1: 12, Text: "quer"},
	}}}}}
	if !MeistSenkrecht(stehend) {
		t.Error("stehender Text gilt nicht als senkrecht")
	}
	if MeistSenkrecht(nil) {
		t.Error("nichts ist senkrecht")
	}
}

func TestUnsicher(t *testing.T) {
	if Unsicher(1, 4) || !Unsicher(2, 4) {
		t.Error("Unsicher: mehr als ein Viertel zaehlt")
	}
}

// attrappe legt ein Shell-Skript als „tesseract“ an, das seine Argumente
// protokolliert und je Aufruf eine feste Ausgabe liefert.
func attrappe(t *testing.T, rumpf string) (programm, protokoll string) {
	t.Helper()
	ordner := t.TempDir()
	protokoll = filepath.Join(ordner, "protokoll")
	programm = filepath.Join(ordner, "tesseract")
	inhalt := "#!/bin/sh\necho \"$*\" >> '" + protokoll + "'\n" + rumpf + "\n"
	if err := os.WriteFile(programm, []byte(inhalt), 0o755); err != nil {
		t.Fatal(err)
	}
	return programm, protokoll
}

func TestZustand(t *testing.T) {
	programm, _ := attrappe(t, `case "$1" in
--version) echo 'tesseract 5.5.3'; echo ' leptonica-1.87.0'; exit 0 ;;
--list-langs) echo 'List of available languages in "/x/tessdata/" (3):'; echo osd; echo eng; echo deu; exit 0 ;;
esac
exit 2`)
	z, err := Tesseract{Programm: programm, Sprachen: "deu+eng"}.Zustand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if z.Fassung != "5.5.3" || strings.Join(z.Sprachen, ",") != "deu,eng,osd" {
		t.Errorf("Zustand = %+v", z)
	}
	if _, err := (Tesseract{Programm: programm, Sprachen: "deu+fra"}).Zustand(context.Background()); err == nil ||
		!strings.Contains(err.Error(), "fra fehlt") {
		t.Errorf("fehlende Sprache nicht gemeldet: %v", err)
	}
}

func TestSeiteErkennenArgumente(t *testing.T) {
	programm, protokoll := attrappe(t, `printf 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
printf '5\t1\t1\t1\t1\t1\t300\t300\t150\t50\t96.5\tRechnung\n'`)
	tess := Tesseract{Programm: programm, Tessdata: "/app/tessdata", Sprachen: "deu+eng"}
	bloecke, err := tess.SeiteErkennen(context.Background(), "/bilder/seite.png", 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(bloecke) != 1 || bloecke[0].Zeilen[0].Woerter[0].Text != "Rechnung" || bloecke[0].Zeilen[0].Woerter[0].X0 != 72 {
		t.Errorf("Bloecke = %+v", bloecke)
	}
	aufruf, _ := os.ReadFile(protokoll)
	erwartet := "/bilder/seite.png stdout -l deu+eng --psm 3 --tessdata-dir /app/tessdata tsv\n"
	if string(aufruf) != erwartet {
		t.Errorf("Aufruf = %q, erwartet %q", aufruf, erwartet)
	}
	if _, err := tess.SeiteErkennen(context.Background(), "/bilder/seite.png", 0); err == nil {
		t.Error("0 dpi angenommen")
	}
}

func TestLaufWerkzeugfehler(t *testing.T) {
	programm, _ := attrappe(t, `echo 'Error in pixReadStream: kaputt' >&2; exit 1`)
	_, err := Lauf(context.Background(), programm, "x")
	var wf *Werkzeugfehler
	if err == nil || !errors.As(err, &wf) || wf.Code != 1 || !strings.Contains(wf.Meldung, "pixReadStream") {
		t.Errorf("Lauf = %v", err)
	}
	if _, err := Lauf(context.Background(), filepath.Join(t.TempDir(), "gibtsnicht")); err == nil || errors.As(err, &wf) {
		t.Errorf("nicht startbar ist kein Werkzeugfehler: %v", err)
	}
}

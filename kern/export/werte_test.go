// SPDX-License-Identifier: Apache-2.0

package export

import (
	"bytes"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Die Ausgaberegeln aus Konzept Kap. 05: nie still umwandeln.

func TestAuslegen(t *testing.T) {
	faelle := []struct {
		text, typ, format string
		art               string
		wert              any
		warnung           string
	}{
		{"00123", TypText, FormatDE, TypText, "00123", ""},
		{"00123", TypZahl, FormatDE, TypText, "00123", WarnungZahlBleibtText},
		{"1.234,56", TypZahl, FormatDE, TypZahl, 1234.56, ""},
		{"1.234,56", TypText, FormatDE, TypText, "1.234,56", ""},
		{"1.234,56", TypZahl, FormatEN, TypText, "1.234,56", WarnungZahlBleibtText},
		{"1,234.56", TypZahl, FormatEN, TypZahl, 1234.56, ""},
		{"-12,50", TypZahl, FormatDE, TypZahl, -12.5, ""},
		{"+7", TypZahl, FormatDE, TypZahl, 7.0, ""},
		{"0,5", TypZahl, FormatDE, TypZahl, 0.5, ""},
		{"119,00 EUR", TypZahl, FormatDE, TypText, "119,00 EUR", WarnungZahlBleibtText},
		{"", TypZahl, FormatDE, TypText, "", ""},
		{"03/04/2026", TypDatum, FormatDE, TypText, "03/04/2026", WarnungDatumBleibtText},
		{"03.04.2026", TypDatum, FormatDE, TypDatum, time.Date(2026, 4, 3, 0, 0, 0, 0, time.UTC), ""},
		{"3.4.2026", TypDatum, FormatDE, TypDatum, time.Date(2026, 4, 3, 0, 0, 0, 0, time.UTC), ""},
		{"2026-04-03", TypDatum, FormatDE, TypDatum, time.Date(2026, 4, 3, 0, 0, 0, 0, time.UTC), ""},
		{"31.02.2026", TypDatum, FormatDE, TypText, "31.02.2026", WarnungDatumBleibtText},
		{"03.04.2026", TypText, FormatDE, TypText, "03.04.2026", ""},
	}
	for _, f := range faelle {
		z, warnung := auslegen(f.text, f.typ, f.format)
		if z.art != f.art || warnung != f.warnung {
			t.Errorf("%q als %s/%s: Art %s, Warnung %q — erwartet %s, %q", f.text, f.typ, f.format, z.art, warnung, f.art, f.warnung)
			continue
		}
		switch z.art {
		case TypZahl:
			if z.zahl != f.wert.(float64) {
				t.Errorf("%q: Zahl %v, erwartet %v", f.text, z.zahl, f.wert)
			}
		case TypDatum:
			if !z.datum.Equal(f.wert.(time.Time)) {
				t.Errorf("%q: Datum %v, erwartet %v", f.text, z.datum, f.wert)
			}
		default:
			if z.text != f.wert.(string) {
				t.Errorf("%q: Text %q, erwartet %q", f.text, z.text, f.wert)
			}
		}
	}
	if zahlText(1234.56, FormatDE, 2) != "1234,56" || zahlText(-12.5, FormatEN, 1) != "-12.5" || zahlText(7, FormatDE, 0) != "7" ||
		zahlText(119, FormatDE, 2) != "119,00" || zahlText(1249.5, FormatEN, 2) != "1249.50" {
		t.Error("zahlText")
	}
}

func TestTypvorschlag(t *testing.T) {
	dok := eineTabelle(1,
		[]string{"Nr", "Betrag", "Datum", "Gemischt", "Leer", "Menge"},
		[]string{"00123", "119,00", "03.04.2026", "1", "", "2"},
		[]string{"00124", "1.249,50", "2026-04-04", "Text", "", ""},
		[]string{"00125", "-39,90", "5.4.2026", "3", "", "4"},
	)
	tab := dok.Tabellen()[0]
	if got := typvorschlag(tab); !reflect.DeepEqual(got, []string{TypText, TypZahl, TypDatum, TypText, TypText, TypZahl}) {
		t.Errorf("Typvorschlag %v", got)
	}
	if kopfzeilenVorschlag(tab) != 1 {
		t.Error("Kopfzeile nicht vorgeschlagen")
	}
	ohneKopf := eineTabelle(0, []string{"1", "Stuhl"}, []string{"2", "Tisch"})
	if kopfzeilenVorschlag(ohneKopf.Tabellen()[0]) != 0 {
		t.Error("Kopfzeile bei Zahlen in der ersten Zeile vorgeschlagen")
	}
}

// CSV: RFC 4180, BOM, Formelschutz nur fuer Text, der keine reine Zahl
// ist; Zeilenumbruch in der Zelle bleibt und wird in Anfuehrungszeichen
// gesetzt.
func TestCSV(t *testing.T) {
	dok := eineTabelle(1,
		[]string{"Artikel", "Betrag", "Hinweis", "Nr"},
		[]string{"=SUMME(A1)", "-12,50", "Zeile 1\nZeile 2", "00123"},
		[]string{"@Kunde", "1.234,56", `Sag "Hallo"; bitte`, "+49"},
		[]string{"-Abzug", "3", "", "007"},
	)
	var aus bytes.Buffer
	warn, err := CSV(&aus, dok, Optionen{Tabellen: []Tabellenwahl{{Index: 0, Include: true, HeaderRows: 1,
		ColumnTypes: []string{TypText, TypZahl, TypText, TypText}}}})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(aus.Bytes(), []byte("\xEF\xBB\xBF")) {
		t.Error("keine BOM")
	}
	erwartet := "Artikel;Betrag;Hinweis;Nr\r\n" +
		"'=SUMME(A1);-12,50;\"Zeile 1\nZeile 2\";00123\r\n" +
		"'@Kunde;1234,56;\"Sag \"\"Hallo\"\"; bitte\";+49\r\n" +
		"'-Abzug;3;;007\r\n"
	if got := strings.TrimPrefix(aus.String(), "\xEF\xBB\xBF"); got != erwartet {
		t.Errorf("CSV:\n%q\nerwartet:\n%q", got, erwartet)
	}
	if w, ok := warnungMit(warn, WarnungFormelschutz); !ok || w.Count != 3 {
		t.Errorf("Formelschutz %+v %v", w, ok)
	}
	// Alles Text: „-12,50“ und „+49“ sind reine Zahlen, kein Schutz;
	// Komma als Trenner setzt die Betraege in Anfuehrungszeichen.
	aus.Reset()
	warn, err = CSV(&aus, dok, Optionen{CSVTrenner: ","})
	if err != nil {
		t.Fatal(err)
	}
	zeilen := strings.Split(strings.TrimPrefix(aus.String(), "\xEF\xBB\xBF"), "\r\n")
	if zeilen[1] != "'=SUMME(A1),\"-12,50\",\"Zeile 1\nZeile 2\",00123" {
		t.Errorf("Zeile 2: %q", zeilen[1])
	}
	if w, ok := warnungMit(warn, WarnungFormelschutz); !ok || w.Count != 3 {
		t.Errorf("Formelschutz %+v", w)
	}
	// Unbekannte Tabelle, unbekannter Trenner.
	if _, err := CSV(&aus, dok, Optionen{CSVTabelle: 4}); !errors.Is(err, ErrTabelleFehlt) {
		t.Errorf("Tabelle 4: %v", err)
	}
	if _, err := CSV(&aus, dok, Optionen{CSVTrenner: "#"}); !errors.Is(err, ErrOptionUngueltig) {
		t.Errorf("Trenner #: %v", err)
	}
	// Datum als ISO, en-Zahlen mit Punkt.
	dok = eineTabelle(0, []string{"03.04.2026", "1,234.50"})
	aus.Reset()
	if _, err := CSV(&aus, dok, Optionen{Zahlenformat: FormatEN,
		Tabellen: []Tabellenwahl{{Index: 0, Include: true, ColumnTypes: []string{TypDatum, TypZahl}}}}); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimPrefix(aus.String(), "\xEF\xBB\xBF"); got != "2026-04-03;1234.50\r\n" {
		t.Errorf("en: %q", got)
	}
}

// Die Grenze der Zellen: darueber ErrZuGross, bevor etwas gebaut wird.
func TestZellenGrenze(t *testing.T) {
	zeilen := make([][]string, 1001)
	for i := range zeilen {
		zeilen[i] = make([]string, 100)
	}
	dok := eineTabelle(1, zeilen...)
	if n, err := Zellen(dok, Optionen{}); err != nil || n != 100100 {
		t.Errorf("Zellen %d %v", n, err)
	}
	var aus bytes.Buffer
	for name, f := range map[string]func(w *bytes.Buffer) error{
		"csv":  func(w *bytes.Buffer) error { _, err := CSV(w, dok, Optionen{}); return err },
		"xlsx": func(w *bytes.Buffer) error { _, err := XLSX(w, dok, Optionen{}); return err },
		"docx": func(w *bytes.Buffer) error { _, err := DOCX(w, dok, Optionen{}); return err },
		"odt":  func(w *bytes.Buffer) error { _, err := ODT(w, dok, Optionen{}); return err },
	} {
		if err := f(&aus); !errors.Is(err, ErrZuGross) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Abgewaehlt zaehlt nicht.
	if n, err := Zellen(dok, Optionen{Tabellen: []Tabellenwahl{{Index: 0}}}); err != nil || n != 0 {
		t.Errorf("abgewaehlt: %d %v", n, err)
	}
}

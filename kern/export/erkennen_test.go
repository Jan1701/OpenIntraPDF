// SPDX-License-Identifier: Apache-2.0

package export

import (
	"reflect"
	"strings"
	"testing"
)

// Die Heuristiken laut Vertrag Etappe 4 an synthetischen Wortlisten.

// Ueberschrift: Zeilenhoehe ≥ 1,3 × Median der Seite und kurz.
func TestErkennenUeberschrift(t *testing.T) {
	b := neueSeite(0)
	b.block().zeile(60, 18, "72:Rechnung 00123")
	b.block().zeile(100, 13, "72:Positionen im Ueberblick")
	b.block().zeile(140, 10, "72:Erste Zeile des Absatzes").zeile(152, 10, "72:Zweite Zeile").zeile(164, 10, "72:Dritte Zeile").
		zeile(176, 10, "72:Vierte Zeile").zeile(188, 10, "72:Fuenfte Zeile")
	// Lang und gross ist keine Ueberschrift, sondern ein grosser Absatz.
	// Median der Reihenhoehen: 10 (fuenf Zeilen zu 10, je eine zu 13 und
	// zweimal 18).
	b.block().zeile(220, 18, "72:"+strings.Repeat("Wort ", 20))
	dok := Erkennen([]Seitenwoerter{b.fertig()})
	s := dok.Seiten[0]
	if got := arten(s.Bloecke); got != "heading,heading,paragraph,paragraph" {
		t.Fatalf("Arten %s", got)
	}
	if s.Bloecke[0].Ebene != 1 || s.Bloecke[0].Text != "Rechnung 00123" || s.Bloecke[0].Groesse != 18 {
		t.Errorf("Ueberschrift 1: %+v", s.Bloecke[0])
	}
	if s.Bloecke[1].Ebene != 2 {
		t.Errorf("Ueberschrift 2: %+v", s.Bloecke[1])
	}
	if s.Bloecke[2].Text != "Erste Zeile des Absatzes Zweite Zeile Dritte Zeile Vierte Zeile Fuenfte Zeile" || len(s.Bloecke[2].Zeilen) != 5 {
		t.Errorf("Absatz: %+v", s.Bloecke[2])
	}
	// „Rechnung“ 8 × 9 pt, Wortabstand 5,4 pt, „00123“ 5 × 9 pt.
	if s.Bloecke[0].Lage != [4]float64{72, 60, 72 + 72 + 5.4 + 45, 78} {
		t.Errorf("Lage %v", s.Bloecke[0].Lage)
	}
	if dok.Heuristik != Heuristikfassung || !reflect.DeepEqual(dok.Quelle.Seiten, []int{0}) {
		t.Errorf("Kopf %+v", dok)
	}
}

// Silbentrennung: nur vor einem Kleinbuchstaben zusammenziehen.
func TestErkennenSilbentrennung(t *testing.T) {
	b := neueSeite(0)
	b.block().zeile(100, 10, "72:Die Rech-").zeile(112, 10, "72:nung ist").zeile(124, 10, "72:vom Ein-").zeile(136, 10, "72:Ausgang.")
	dok := Erkennen([]Seitenwoerter{b.fertig()})
	if got := dok.Seiten[0].Bloecke[0].Text; got != "Die Rechnung ist vom Ein- Ausgang." {
		t.Errorf("Text %q", got)
	}
	if got := dok.Seiten[0].Bloecke[0].Zeilen; !reflect.DeepEqual(got, []string{"Die Rech-", "nung ist", "vom Ein-", "Ausgang."}) {
		t.Errorf("Zeilen %q", got)
	}
}

// Liste: •, –, -, *, „1.“, „a)“ am Zeilenanfang; Folgezeilen ohne Marke
// gehoeren zum Punkt davor.
func TestErkennenListe(t *testing.T) {
	b := neueSeite(0)
	b.block().zeile(100, 10, "72:Enthalten sind:").
		zeile(112, 10, "72:• Lieferung").
		zeile(124, 10, "72:– Aufbau").
		zeile(136, 10, "72:- Entsorgung").
		zeile(148, 10, "72:* Einweisung").
		zeile(160, 10, "72:1. Garantie").
		zeile(172, 10, "72:a) Wartung im").
		zeile(184, 10, "72:ersten Jahr")
	// Ein negativer Betrag ist keine Liste.
	b.block().zeile(220, 10, "72:-12,50 Gutschrift")
	dok := Erkennen([]Seitenwoerter{b.fertig()})
	s := dok.Seiten[0]
	if got := arten(s.Bloecke); got != "paragraph,list,list,list,list,list,list,paragraph" {
		t.Fatalf("Arten %s", got)
	}
	texte := []string{}
	for _, bl := range s.Bloecke[1:7] {
		texte = append(texte, bl.Text)
		if bl.Ebene != 1 {
			t.Errorf("Ebene %d", bl.Ebene)
		}
	}
	if !reflect.DeepEqual(texte, []string{"Lieferung", "Aufbau", "Entsorgung", "Einweisung", "Garantie", "Wartung im ersten Jahr"}) {
		t.Errorf("Listenpunkte %q", texte)
	}
	if s.Bloecke[6].Zeilen[0] != "a) Wartung im" {
		t.Errorf("Rohzeile %q", s.Bloecke[6].Zeilen[0])
	}
}

// Tabelle 4 × 4 (Kopf + 3 Positionen) mit rechtsbuendigen Betraegen:
// Spalten, Kopfzeile, Typvorschlag, Lesereihenfolge; die Tabellenwoerter
// landen in keinem Absatz.
func TestErkennenTabelle(t *testing.T) {
	dok := Erkennen([]Seitenwoerter{rechnungsseite(0, 200).fertig()})
	s := dok.Seiten[0]
	if got := arten(s.Bloecke); got != "heading,paragraph,table" {
		t.Fatalf("Arten %s", got)
	}
	tab := mussTabelle(t, s.Bloecke[2])
	if tab.Index != 0 || tab.Spalten != 4 || len(tab.Zeilen) != 4 || tab.Kopfzeilen != 1 || !reflect.DeepEqual(tab.Seiten, []int{0}) {
		t.Errorf("Tabelle %+v", tab)
	}
	erwartet := [][]string{
		{"Pos", "Artikel", "Menge", "Betrag"},
		{"1", "Buerostuhl", "2", "119,00"},
		{"2", "Schreibtisch", "1", "1.249,50"},
		{"3", "Lampe", "4", "39,90"},
	}
	if got := zellentexte(tab); !reflect.DeepEqual(got, erwartet) {
		t.Errorf("Zellen %q", got)
	}
	if !reflect.DeepEqual(tab.Typvorschlag, []string{TypZahl, TypText, TypZahl, TypZahl}) {
		t.Errorf("Typvorschlag %v", tab.Typvorschlag)
	}
	if z := tab.Zeilen[1][3]; z.Konf != -1 || z.Quelle != QuelleTextebene || z.Lage[2] != 500 || z.Lage[1] != 214 {
		t.Errorf("Zelle %+v", z)
	}
	if s.Bloecke[2].Lage[1] != 200 || s.Bloecke[2].Lage[3] != 252 {
		t.Errorf("Lage der Tabelle %v", s.Bloecke[2].Lage)
	}
	// Zwei Zeilen mit zwei Segmenten sind keine Tabelle; eine Adresse mit
	// zwei Segmenten ueber drei Zeilen aber schon zu nah an einer — die
	// Regel der kurzen Zellen greift bei Prosa in zwei Spalten.
	b := neueSeite(1)
	b.block().zeile(100, 10, "72:Name", "300:Erika Musterfrau").zeile(112, 10, "72:Ort", "300:Musterstadt")
	b.block().zeile(200, 10, "72:Dies ist ein langer Satz in der linken Spalte", "320:und dies ist ein langer Satz in der rechten").
		zeile(212, 10, "72:der ueber mehrere Zeilen laeuft und daher", "320:Spalte, der ebenfalls ueber mehrere Zeilen").
		zeile(224, 10, "72:keine Tabelle sein kann, sondern Prosa.", "320:laeuft und ebenfalls Prosa ist, kein Raster.")
	dok = Erkennen([]Seitenwoerter{b.fertig()})
	if got := arten(dok.Seiten[0].Bloecke); strings.Contains(got, "table") {
		t.Errorf("Prosa als Tabelle erkannt: %s", got)
	}
}

// Mehrseitige Tabelle: gleiche Spaltenzahl und Kopfzeile -> eine Tabelle
// (Warnung tables_merged); andere Spaltenzahl oder Kopfzeile -> zwei
// (tables_not_merged mit Grund).
func TestErkennenTabelleUeberSeiten(t *testing.T) {
	seite2 := neueSeite(1)
	seite2.block().zeile(60, 10, "72:Pos", "110:Artikel", "R 400:Menge", "R 500:Betrag").
		zeile(74, 10, "72:4", "110:Regal", "R 400:1", "R 500:89,00").
		zeile(88, 10, "72:5", "110:Sessel", "R 400:2", "R 500:299,00")
	seite2.block().zeile(140, 10, "72:Vielen Dank fuer Ihren Auftrag.")
	dok := Erkennen([]Seitenwoerter{rechnungsseite(0, 700).fertig(), seite2.fertig()})
	if len(dok.Tabellen()) != 1 {
		t.Fatalf("%d Tabellen, erwartet 1: Seite 2 = %s", len(dok.Tabellen()), arten(dok.Seiten[1].Bloecke))
	}
	tab := dok.Tabellen()[0]
	if len(tab.Zeilen) != 6 || tab.Zeilen[5][1].Text != "Sessel" || !reflect.DeepEqual(tab.Seiten, []int{0, 1}) || tab.Kopfzeilen != 1 {
		t.Errorf("zusammengefuehrt: %d Zeilen, Seiten %v", len(tab.Zeilen), tab.Seiten)
	}
	if !dok.Seiten[1].Fortsetzung || arten(dok.Seiten[1].Bloecke) != "paragraph" {
		t.Errorf("Seite 2: Fortsetzung %v, Bloecke %s", dok.Seiten[1].Fortsetzung, arten(dok.Seiten[1].Bloecke))
	}
	if w, ok := warnungMit(dok.Warnungen, WarnungZusammengefuehrt); !ok || !reflect.DeepEqual(w.Pages, []int{0, 1}) {
		t.Errorf("Warnung %+v %v", w, ok)
	}

	// Andere Spaltenzahl: getrennt.
	seite3 := neueSeite(1)
	seite3.block().zeile(60, 10, "72:Pos", "110:Artikel", "R 500:Betrag").
		zeile(74, 10, "72:4", "110:Regal", "R 500:89,00").
		zeile(88, 10, "72:5", "110:Sessel", "R 500:299,00")
	dok = Erkennen([]Seitenwoerter{rechnungsseite(0, 700).fertig(), seite3.fertig()})
	if len(dok.Tabellen()) != 2 || dok.Tabellen()[1].Index != 1 || dok.Seiten[1].Fortsetzung {
		t.Errorf("andere Spaltenzahl: %d Tabellen", len(dok.Tabellen()))
	}
	if w, ok := warnungMit(dok.Warnungen, WarnungNichtZusammengefuehrt); !ok || w.Detail != "columns" {
		t.Errorf("Warnung %+v %v", w, ok)
	}
	// Andere Kopfzeile: getrennt.
	seite4 := neueSeite(1)
	seite4.block().zeile(60, 10, "72:Nr", "110:Bezeichnung", "R 400:Anzahl", "R 500:Summe").
		zeile(74, 10, "72:4", "110:Regal", "R 400:1", "R 500:89,00").
		zeile(88, 10, "72:5", "110:Sessel", "R 400:2", "R 500:299,00")
	dok = Erkennen([]Seitenwoerter{rechnungsseite(0, 700).fertig(), seite4.fertig()})
	if w, ok := warnungMit(dok.Warnungen, WarnungNichtZusammengefuehrt); len(dok.Tabellen()) != 2 || !ok || w.Detail != "header" {
		t.Errorf("andere Kopfzeile: %d Tabellen, %+v", len(dok.Tabellen()), w)
	}
	// Die Tabelle der ersten Seite ist nicht der letzte Block: nichts
	// zusammenfuehren, keine Warnung.
	mitten := rechnungsseite(0, 200)
	mitten.block().zeile(300, 10, "72:Zwischensumme siehe naechste Seite.")
	dok = Erkennen([]Seitenwoerter{mitten.fertig(), seite2.fertig()})
	if _, ok := warnungMit(dok.Warnungen, WarnungZusammengefuehrt); ok || len(dok.Tabellen()) != 2 {
		t.Errorf("Tabelle mitten auf der Seite wurde zusammengefuehrt")
	}
}

// Kopf- und Fusszeilen: gleicher Text (Ziffern gleichgesetzt) an gleicher
// Stelle auf drei Seiten -> Warnung, ab der zweiten Seite als wiederholt
// markiert. Zwei Seiten reichen nicht.
func TestErkennenKopfFuss(t *testing.T) {
	seite := func(nr int) Seitenwoerter {
		b := neueSeite(nr)
		b.block().zeile(30, 8, "72:Musterfirma GmbH – Rechnung 00123")
		b.block().zeile(200, 10, "72:Inhalt der Seite "+strings.Repeat("x", nr+1))
		b.block().zeile(800, 8, "R 520:Seite "+string(rune('1'+nr))+" von 3")
		return b.fertig()
	}
	dok := Erkennen([]Seitenwoerter{seite(0), seite(1), seite(2)})
	n := 0
	for _, w := range dok.Warnungen {
		if w.Code == WarnungKopfFuss {
			n++
			if !reflect.DeepEqual(w.Pages, []int{0, 1, 2}) || w.Count != 3 {
				t.Errorf("Warnung %+v", w)
			}
		}
	}
	if n != 2 {
		t.Errorf("%d Kopf-/Fusszeilen-Warnungen, erwartet 2: %+v", n, dok.Warnungen)
	}
	for i, s := range dok.Seiten {
		kopf, inhalt, fuss := s.Bloecke[0], s.Bloecke[1], s.Bloecke[2]
		if kopf.Wiederholt != (i > 0) || fuss.Wiederholt != (i > 0) || inhalt.Wiederholt {
			t.Errorf("Seite %d: Kopf %v, Inhalt %v, Fuss %v", i, kopf.Wiederholt, inhalt.Wiederholt, fuss.Wiederholt)
		}
		if !kopf.KopfFuss || !fuss.KopfFuss || inhalt.KopfFuss {
			t.Errorf("Seite %d: KopfFuss %v/%v/%v", i, kopf.KopfFuss, inhalt.KopfFuss, fuss.KopfFuss)
		}
	}
	dok = Erkennen([]Seitenwoerter{seite(0), seite(1)})
	if _, ok := warnungMit(dok.Warnungen, WarnungKopfFuss); ok {
		t.Error("zwei Seiten als Kopfzeile gemeldet")
	}

	// Eine Fusszeile unter der Tabelle der ersten Seite verhindert das
	// Zusammenfuehren nicht — auch nicht ihr erstes Vorkommen.
	fuss := func(b *seitenbauer, nr int) *seitenbauer {
		b.block().zeile(800, 8, "R 520:Seite "+string(rune('1'+nr))+" von 3")
		return b
	}
	s1 := fuss(rechnungsseite(0, 700), 0)
	s2 := neueSeite(1)
	s2.block().zeile(60, 10, "72:Pos", "110:Artikel", "R 400:Menge", "R 500:Betrag").
		zeile(74, 10, "72:4", "110:Regal", "R 400:1", "R 500:89,00").
		zeile(88, 10, "72:5", "110:Sessel", "R 400:2", "R 500:299,00")
	fuss(s2, 1)
	s3 := neueSeite(2)
	s3.block().zeile(100, 10, "72:Vielen Dank.")
	fuss(s3, 2)
	dok = Erkennen([]Seitenwoerter{s1.fertig(), s2.fertig(), s3.fertig()})
	if len(dok.Tabellen()) != 1 || len(dok.Tabellen()[0].Zeilen) != 6 || !dok.Seiten[1].Fortsetzung {
		t.Errorf("mit Fusszeile: %d Tabellen, Fortsetzung %v", len(dok.Tabellen()), dok.Seiten[1].Fortsetzung)
	}
}

// Unsichere Woerter aus der Erkennung: Block und Seite werden gemeldet,
// die Zelle traegt ihre kleinste Sicherheit.
func TestErkennenUnsicher(t *testing.T) {
	b := neueSeite(3)
	b.s.Quelle, b.s.Bildanteil, b.konf = QuelleOCR, 1, 40
	b.block().zeile(100, 10, "72:Schlecht lesbarer Absatz")
	b.konf = 95
	b.block().zeile(140, 10, "72:Gut lesbarer Absatz")
	b.block().zeile(200, 10, "72:Pos", "200:Artikel", "300:Betrag").zeile(214, 10, "72:1", "200:Stuhl", "300:119,00").
		zeile(228, 10, "72:2", "200:Tisch", "300:249,00")
	dok := Erkennen([]Seitenwoerter{b.fertig()})
	s := dok.Seiten[0]
	if s.Quelle != QuelleOCR || s.Bildanteil != 1 || !s.Bloecke[0].Unsicher || s.Bloecke[1].Unsicher || s.Bloecke[0].Quelle != QuelleOCR {
		t.Errorf("Seite %+v", s)
	}
	if z := mussTabelle(t, s.Bloecke[2]).Zeilen[1][2]; z.Konf != 95 || z.Quelle != QuelleOCR {
		t.Errorf("Zelle %+v", z)
	}
	if w, ok := warnungMit(dok.Warnungen, WarnungUnsicher); !ok || !reflect.DeepEqual(w.Pages, []int{3}) {
		t.Errorf("Warnung %+v %v", w, ok)
	}
	z := dok.Zaehlen()
	if z.Seiten != 1 || z.Absaetze != 2 || len(z.Tabellen) != 1 || !reflect.DeepEqual(z.OCRSeiten, []int{3}) || !reflect.DeepEqual(z.Unsichere, []int{3}) {
		t.Errorf("Zaehlung %+v", z)
	}
	// Leere Seite: keine Bloecke, Quelle none.
	leer := Erkennen([]Seitenwoerter{{Nr: 0, Breite: 595, Hoehe: 842}})
	if len(leer.Seiten) != 1 || len(leer.Seiten[0].Bloecke) != 0 || leer.Seiten[0].Quelle != QuelleLeer || len(leer.Warnungen) != 0 {
		t.Errorf("leere Seite %+v", leer)
	}
}

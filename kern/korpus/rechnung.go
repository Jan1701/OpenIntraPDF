// SPDX-License-Identifier: Apache-2.0

package korpus

import (
	"context"
	"fmt"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/font"
)

// Rechnung erzeugt eine erfundene Rechnung mit Textebene ueber drei
// Seiten — die Probe fuer den Export (OpenIntraPDF Etappe 4):
//
//	Seite 1: Kopfzeile, Ueberschrift 18 pt, Anschrift, Absatz, Positions-
//	         tabelle (Kopf + 3 Zeilen; Menge und Betrag rechtsbuendig)
//	Seite 2: Kopfzeile, Fortsetzung der Tabelle (Kopf + 2 Zeilen) als
//	         erster Block, Schlussabsatz
//	Seite 3: Kopfzeile, Ueberschrift 13 pt, Absatz mit Silbentrennung
//	         („Rech-“ / „nungsdatum“), Liste mit drei Punkten
//	Alle:    Fusszeile „Seite n von 3 – SEITE-0n“
//
// Alle Werte sind erfunden. Der Inhalt ist ASCII (pdfText).
func Rechnung() []byte {
	d := neuesDokument(A4, A4, A4)
	d.inhalt = func(i int) string {
		var s strings.Builder
		t := func(groesse float64, x, y float64, text string) {
			fmt.Fprintf(&s, "BT /F1 %g Tf %g %g Td %s Tj ET\n", groesse, x, y, pdfText(text))
		}
		// rechts setzt den Text mit seiner rechten Kante an x.
		rechts := func(groesse float64, x, y float64, text string) {
			t(groesse, x-textbreite(text, groesse), y, text)
		}
		t(8, 72, 812, "Musterfirma GmbH")
		t(8, 72, 40, fmt.Sprintf("Seite %d von 3 - %s", i+1, Marke(i)))
		zeile := func(y float64, pos, artikel, menge, betrag string) {
			t(10, 72, y, pos)
			t(10, 110, y, artikel)
			rechts(10, 400, y, menge)
			rechts(10, 520, y, betrag)
		}
		switch i {
		case 0:
			t(18, 72, 760, "Rechnung 00123")
			t(10, 72, 720, "Erika Musterfrau")
			t(10, 72, 708, "Musterstrasse 1")
			t(10, 72, 696, "12345 Musterstadt")
			t(10, 72, 660, "Vielen Dank fuer Ihren Auftrag. Die Positionen sind nach")
			t(10, 72, 648, "Lieferschein 00456 aufgefuehrt.")
			zeile(600, "Pos", "Artikel", "Menge", "Betrag")
			zeile(586, "1", "Buerostuhl", "2", "119,00")
			zeile(572, "2", "Schreibtisch", "1", "1.249,50")
			zeile(558, "3", "Lampe", "4", "39,90")
		case 1:
			zeile(790, "Pos", "Artikel", "Menge", "Betrag")
			zeile(776, "4", "Regal", "1", "89,00")
			zeile(762, "5", "Sessel", "2", "299,00")
			t(10, 72, 720, "Gesamtbetrag 1.796,40 EUR, zahlbar bis 17.04.2026.")
		case 2:
			t(13, 72, 760, "Zahlungsbedingungen")
			t(10, 72, 730, "Die Zahlung erfolgt innerhalb von 14 Tagen nach Rech-")
			t(10, 72, 718, "nungsdatum ohne Abzug.")
			t(10, 72, 690, "- Lieferung frei Haus")
			t(10, 72, 678, "- Aufbau durch Musterfirma")
			t(10, 72, 666, "- Entsorgung der Verpackung")
		}
		return s.String()
	}
	return d.fertig()
}

// textbreite ist die Breite eines Textes in Helvetica; ohne Metrik eine
// Schaetzung.
func textbreite(text string, groesse float64) float64 {
	b, err := font.TextWidthFloat(context.Background(), text, "Helvetica", groesse)
	if err != nil {
		return 0.5 * groesse * float64(len(text))
	}
	return b
}

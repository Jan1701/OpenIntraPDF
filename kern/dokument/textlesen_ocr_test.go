// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Die eigene Textebene (Etappe 3) muss der Leser wiederfinden — sonst
// gilt eine erkannte Seite beim naechsten Oeffnen wieder als Scan (Etappe
// 6: Seitenarten und Analyse der Desktop-App lesen hiermit). Bis zum
// 30.09.2026 scheiterte das: Die Bibliothek haengt die Inhaltsstroeme ohne
// Trennzeichen aneinander und stuerzte am letzten Q ab (Unlesbar).
func TestTextebeneLesenEigeneOcrEbene(t *testing.T) {
	woerter := map[int][]Wort{0: {
		{X0: 72, Y0: 72, X1: 216, Y1: 91.2, Text: "Rechnung"},
		{X0: 228, Y0: 72, X1: 324, Y1: 91.2, Text: "00123"},
	}}
	pdf, _, n := textebene(t, korpus.Scan(korpus.A4), woerter)
	if n != 2 {
		t.Fatalf("%d Woerter gesetzt", n)
	}
	seiten, err := TextebeneLesen(context.Background(), pdf, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(seiten) != 1 || seiten[0].Unlesbar || seiten[0].Woerter() != 2 {
		t.Fatalf("eigene Textebene nicht gelesen: %+v", seiten)
	}
	var texte []string
	for _, b := range seiten[0].Bloecke {
		for _, z := range b {
			for _, w := range z.Woerter {
				texte = append(texte, w.Text)
				// Die Lage muss in der Naehe der gesetzten liegen (Anzeigeraum).
				// Der Leser schaetzt den Kasten aus der Schriftgroesse, nicht
				// aus dem Wortkasten — deshalb grosszuegig.
				if w.Y0 < 50 || w.Y1 > 110 || w.X0 < 60 || w.X1 > 340 {
					t.Errorf("%q liegt bei x %g–%g, y %g–%g statt 72–324, 72–91", w.Text, w.X0, w.X1, w.Y0, w.Y1)
				}
			}
		}
	}
	if len(texte) != 2 || texte[0] != "Rechnung" || texte[1] != "00123" {
		t.Errorf("Texte = %v", texte)
	}
	hat, err := HatTextebene(context.Background(), pdf, nil)
	if err != nil || !hat {
		t.Errorf("HatTextebene = %v, %v", hat, err)
	}
}

// SPDX-License-Identifier: Apache-2.0

package export

import (
	"strconv"
	"strings"
	"testing"
)

// Synthetische Wortseiten fuer die Tests. Alles erfunden: Musterfirma,
// Rechnung 00123, Buerostuhl und Schreibtisch.

// seitenbauer baut Seitenwoerter aus Zeilenangaben.
type seitenbauer struct {
	s    Seitenwoerter
	konf float64
}

func neueSeite(nr int) *seitenbauer {
	return &seitenbauer{s: Seitenwoerter{Nr: nr, Breite: 595, Hoehe: 842, Quelle: QuelleTextebene}, konf: -1}
}

// block beginnt einen neuen Block des Lieferanten.
func (b *seitenbauer) block() *seitenbauer {
	b.s.Bloecke = append(b.s.Bloecke, Wortblock{})
	return b
}

// zeile legt eine Zeile in den letzten Block: Oberkante y, Hoehe h, und
// Woerter als "x:Text" (linke Kante) oder "R x:Text" (rechte Kante).
// Mehrere Woerter eines Stuecks trennt ein Leerzeichen im Text: "72:Ein
// Wort" ergibt zwei Woerter mit Wortabstand.
func (b *seitenbauer) zeile(y, h float64, stuecke ...string) *seitenbauer {
	if len(b.s.Bloecke) == 0 {
		b.block()
	}
	var z Wortzeile
	for _, st := range stuecke {
		rechts := strings.HasPrefix(st, "R ")
		st = strings.TrimPrefix(st, "R ")
		i := strings.Index(st, ":")
		x, _ := strconv.ParseFloat(st[:i], 64)
		text := st[i+1:]
		woerter := strings.Fields(text)
		breite := func(w string) float64 { return 0.5 * h * float64(len([]rune(w))) }
		gesamt := 0.0
		for i, w := range woerter {
			if i > 0 {
				gesamt += 0.3 * h
			}
			gesamt += breite(w)
		}
		if rechts {
			x -= gesamt
		}
		for i, w := range woerter {
			if i > 0 {
				x += 0.3 * h
			}
			z.Woerter = append(z.Woerter, Wort{X0: x, Y0: y, X1: x + breite(w), Y1: y + h, Text: w, Konf: b.konf})
			x += breite(w)
		}
	}
	letzter := &b.s.Bloecke[len(b.s.Bloecke)-1]
	letzter.Zeilen = append(letzter.Zeilen, z)
	return b
}

func (b *seitenbauer) fertig() Seitenwoerter { return b.s }

// rechnungsseite ist eine Seite mit Ueberschrift, Absatz und einer
// Positionstabelle 4 Spalten × 4 Zeilen (Kopf + 3 Positionen), die
// Betraege rechtsbuendig.
func rechnungsseite(nr int, tabelleY float64) *seitenbauer {
	b := neueSeite(nr)
	b.block().zeile(60, 18, "72:Rechnung 00123")
	b.block().zeile(100, 10, "72:Musterfirma GmbH, Musterstrasse 1, 12345 Musterstadt").
		zeile(112, 10, "72:Lieferung vom 03.04.2026, zahlbar innerhalb von 14 Tagen.")
	b.block().zeile(tabelleY, 10, "72:Pos", "110:Artikel", "R 400:Menge", "R 500:Betrag").
		zeile(tabelleY+14, 10, "72:1", "110:Buerostuhl", "R 400:2", "R 500:119,00").
		zeile(tabelleY+28, 10, "72:2", "110:Schreibtisch", "R 400:1", "R 500:1.249,50").
		zeile(tabelleY+42, 10, "72:3", "110:Lampe", "R 400:4", "R 500:39,90")
	return b
}

// eineTabelle ist ein Modell mit genau einer Tabelle aus Zeilen von
// Texten.
func eineTabelle(kopfzeilen int, zeilen ...[]string) Dokument {
	t := &Tabelle{Index: 0, Seiten: []int{0}, Kopfzeilen: kopfzeilen}
	for _, z := range zeilen {
		if len(z) > t.Spalten {
			t.Spalten = len(z)
		}
	}
	t.Typvorschlag = nurText(t.Spalten)
	for _, z := range zeilen {
		zeile := make([]Zelle, t.Spalten)
		for k := range zeile {
			zeile[k] = Zelle{Konf: -1}
			if k < len(z) {
				zeile[k].Text = z[k]
			}
		}
		t.Zeilen = append(t.Zeilen, zeile)
	}
	return Dokument{Heuristik: Heuristikfassung, Warnungen: []Warnung{}, Quelle: Quelle{Seiten: []int{0}},
		Seiten: []Seite{{Nr: 0, Breite: 595, Hoehe: 842, Quelle: QuelleTextebene,
			Bloecke: []Block{{Art: ArtTabelle, Tabelle: t}}}}}
}

func warnungMit(warnungen []Warnung, code string) (Warnung, bool) {
	for _, w := range warnungen {
		if w.Code == code {
			return w, true
		}
	}
	return Warnung{}, false
}

func arten(bloecke []Block) string {
	teile := make([]string, len(bloecke))
	for i, b := range bloecke {
		teile[i] = b.Art
	}
	return strings.Join(teile, ",")
}

func mussTabelle(t *testing.T, b Block) *Tabelle {
	t.Helper()
	if b.Art != ArtTabelle || b.Tabelle == nil {
		t.Fatalf("Block ist keine Tabelle: %+v", b)
	}
	return b.Tabelle
}

func zellentexte(t *Tabelle) [][]string {
	aus := make([][]string, len(t.Zeilen))
	for i, z := range t.Zeilen {
		aus[i] = make([]string, len(z))
		for k, zelle := range z {
			aus[i][k] = zelle.Text
		}
	}
	return aus
}

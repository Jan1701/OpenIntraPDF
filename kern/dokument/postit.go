// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"fmt"
	"math"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Post-it (kind sticky, Etappe 5): ein farbiger Zettel mit einer Notiz
// darauf. Im PDF ist er ein FreeText mit eigenem Erscheinungsbild; die
// privaten Schluessel OIHKind und OIHFill sagen beim Wiederoeffnen, dass er
// ein Post-it ist und welche Farbe er hat. Die bestehende Notiz (kind note,
// „Kommentieren“) bleibt davon unberuehrt.
//
// # Warum kein /C
//
// Der Vertrag erlaubt /C nur, wenn pdf.js UND Poppler ohne Erscheinungsbild
// daraus eine Fuellung machen und keinen Rahmen. Nachgelesen (30.09.2026):
//
//   - pdf.js (src/core/annotation.js, FreeTextAnnotation) baut ohne AP ein
//     Erscheinungsbild allein aus DA und Contents (FakeUnicodeFont) — /C
//     wird weder als Fuellung noch als Rahmen gezeichnet; der Editor
//     nimmt die Textfarbe aus DA.
//   - Poppler (poppler/Annot.cc, AnnotFreeText::generateFreeTextAppearance)
//     fuellt mit /C, zeichnet aber dazu einen Rahmen in der DA-Textfarbe,
//     solange /BS keine Breite 0 nennt (AnnotBorderBS() hat Breite 1).
//
// Die Bedingung „beide fuellen“ ist damit nicht erfuellt. /C bleibt weg;
// die Farbe steht in OIHFill, und das Erscheinungsbild zeigt sie in jedem
// Programm.

const (
	// postitInnen ist der Innenabstand des Textes zum Rand.
	postitInnen = 6.0
	// postitSchrift ist die Schriftgroesse, wenn der Befehl keine nennt.
	postitSchrift = 11.0
	// postitMindest: so weit wird die Schrift verkleinert, bevor gekuerzt wird.
	postitMindest = 7.0
	// postitZeile ist der Zeilenabstand als Vielfaches der Schriftgroesse.
	postitZeile = 1.2
)

var (
	// postitGelb ist die Vorgabefarbe #fff59d.
	postitGelb = []float64{1, 0.961, 0.616}
	// postitText ist die Textfarbe #1f2937.
	postitText = []float64{0.122, 0.161, 0.216}
)

// dunkler nimmt einer Farbe ein Viertel ihrer Helligkeit (Rand, Eselsohr).
func dunkler(f []float64) []float64 {
	return []float64{f[0] * 0.75, f[1] * 0.75, f[2] * 0.75}
}

// postit baut Erscheinungsbild und Darstellungsschluessel eines Post-its
// in d. gekuerzt sagt, dass die Notiz auch mit 7 pt nicht ganz auf den
// Zettel passte und die letzte sichtbare Zeile mit „…“ endet; Contents
// behaelt der Aufrufer voll.
func (a *anwender) postit(d types.Dict, rect [4]float64, text string, fuellung []float64, gr float64, drehung int) (bbox [4]float64, inhalt string, res types.Dict, matrix []float64, gekuerzt bool, err error) {
	if gr <= 0 {
		gr = postitSchrift
	}
	s, err := a.satz(text, false)
	if err != nil {
		return bbox, "", nil, nil, false, err
	}
	d["OIHKind"] = types.Name("sticky")
	d["OIHFill"] = types.NewNumberArray(fuellung[0], fuellung[1], fuellung[2])
	d["DA"] = types.StringLiteral(fmt.Sprintf("/Helv %s Tf %s", zahl(gr), farbeOp(postitText, "rg")))
	d["DS"] = types.StringLiteral(fmt.Sprintf("font: Helvetica %spt; color: #1f2937", zahl(gr)))
	w, h, matrix := drehmatrix(drehung, rect)
	if drehung != 0 {
		d["Rotate"] = types.Integer(drehung)
	} else {
		d.Delete("Rotate")
	}
	bbox = [4]float64{0, 0, w, h}

	// Umbruch; passt es nicht in die Hoehe, schrittweise kleiner bis 7 pt.
	innen, hoehe := w-2*postitInnen, h-2*postitInnen
	fs := gr
	var zeilen []string
	for {
		zeilen = umbrechen(text, innen, func(t string) float64 { return s.breite(t, fs) })
		if float64(len(zeilen))*fs*postitZeile <= hoehe || fs-1 < postitMindest {
			break
		}
		fs--
	}
	if float64(len(zeilen))*fs*postitZeile > hoehe {
		gekuerzt = true
		n := max(1, int(math.Floor(hoehe/(fs*postitZeile))))
		if n < len(zeilen) {
			zeilen = zeilen[:n]
		}
		letzte := strings.TrimRight(zeilen[len(zeilen)-1], " ")
		for s.breite(letzte+"…", fs) > innen && letzte != "" {
			r := []rune(letzte)
			letzte = strings.TrimRight(string(r[:len(r)-1]), " ")
		}
		zeilen[len(zeilen)-1] = letzte + "…"
	}

	name, obj := s.ressource()
	res = types.Dict{"Font": types.Dict{name: obj}}
	dunkel := dunkler(fuellung)
	// Eselsohr: die Ecke unten rechts fehlt dem Zettel, die Klappe liegt
	// in der dunkleren Farbe daneben.
	e := math.Min(12, math.Min(w, h)/5)
	var b strings.Builder
	fmt.Fprintf(&b, "q %s %s 1 w 0.5 0.5 m %s 0.5 l %s %s l %s %s l 0.5 %s l h B ",
		farbeOp(fuellung, "rg"), farbeOp(dunkel, "RG"),
		zahl(w-0.5-e), zahl(w-0.5), zahl(0.5+e), zahl(w-0.5), zahl(h-0.5), zahl(h-0.5))
	fmt.Fprintf(&b, "%s %s 0.5 m %s %s l %s %s l h f Q ",
		farbeOp(dunkel, "rg"), zahl(w-0.5-e), zahl(w-0.5-e), zahl(0.5+e), zahl(w-0.5), zahl(0.5+e))
	fmt.Fprintf(&b, "/Tx BMC q BT /%s %s Tf %s %s TL %s %s Td ", name, zahl(fs), farbeOp(postitText, "rg"),
		zahl(fs*postitZeile), zahl(postitInnen), zahl(h-postitInnen-fs))
	for i, z := range zeilen {
		if i > 0 {
			b.WriteString("T* ")
		}
		if z == "" {
			continue
		}
		fmt.Fprintf(&b, "%s Tj ", s.tj(z))
	}
	b.WriteString("ET Q EMC")
	return bbox, b.String(), res, matrix, gekuerzt, nil
}

// umbrechen bricht text an Wortgrenzen auf breite um (Absaetze an \n
// bleiben); ein Wort, das allein breiter ist, wird hart getrennt. messen
// liefert die Breite eines Stuecks.
func umbrechen(text string, breite float64, messen func(string) float64) []string {
	var zeilen []string
	for _, absatz := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		woerter := strings.Fields(absatz)
		if len(woerter) == 0 {
			zeilen = append(zeilen, "")
			continue
		}
		zeile := ""
		for _, w := range woerter {
			if messen(w) > breite {
				if zeile != "" {
					zeilen = append(zeilen, zeile)
				}
				// Hart trennen: jedes Stueck so lang, wie es passt; der Rest
				// wird die laufende Zeile. Ein einzelnes Zeichen, das nicht
				// passt, bleibt stehen.
				for messen(w) > breite {
					n := praefix(w, breite, messen)
					r := []rune(w)
					if n >= len(r) {
						break
					}
					zeilen = append(zeilen, string(r[:n]))
					w = string(r[n:])
				}
				zeile = w
				continue
			}
			if zeile == "" {
				zeile = w
			} else if messen(zeile+" "+w) <= breite {
				zeile += " " + w
			} else {
				zeilen = append(zeilen, zeile)
				zeile = w
			}
		}
		zeilen = append(zeilen, zeile)
	}
	return zeilen
}

// praefix ist die groesste Zahl Runen von w (mindestens 1), die in breite
// passen.
func praefix(w string, breite float64, messen func(string) float64) int {
	r := []rune(w)
	n := 1
	for n < len(r) && messen(string(r[:n+1])) <= breite {
		n++
	}
	return n
}

// drehmatrix liefert Breite und Hoehe der BBox eines aufrecht angezeigten
// Erscheinungsbilds auf einer gedrehten Seite und die Matrix, die es in den
// Benutzerraum zurueckdreht (ISO 32000-1 12.5.5). nil heisst Einheit.
func drehmatrix(drehung int, rect [4]float64) (w, h float64, matrix []float64) {
	w, h = rect[2]-rect[0], rect[3]-rect[1]
	switch drehung {
	case 90:
		w, h = h, w
		matrix = []float64{0, 1, -1, 0, 0, 0}
	case 180:
		matrix = []float64{-1, 0, 0, -1, 0, 0}
	case 270:
		w, h = h, w
		matrix = []float64{0, -1, 1, 0, 0, 0}
	}
	return w, h, matrix
}

// zahlenVon liest ein Zahlenfeld als Gleitkommaliste; nil, wenn es keins ist.
func zahlenVon(x *model.XRefTable, o types.Object) []float64 {
	a := alsArray(x, o)
	if a == nil {
		return nil
	}
	aus := make([]float64, len(a))
	for i, e := range a {
		switch v := aufloesen(x, e).(type) {
		case types.Float:
			aus[i] = float64(v)
		case types.Integer:
			aus[i] = float64(v)
		default:
			return nil
		}
	}
	return aus
}

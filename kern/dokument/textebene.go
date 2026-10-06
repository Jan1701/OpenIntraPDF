// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"fmt"
	"io"
	"math"
	"slices"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/font"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Unsichtbare Textebene (OpenIntraPDF Etappe 3, Texterkennung).
//
// Ein Scan bleibt optisch derselbe Scan und bekommt die erkannten Woerter
// als unsichtbaren Text darueber (Textdarstellung 3: weder fuellen noch
// umranden), jedes Wort an der Stelle seines Bildes. Suche, Auswahl und
// Kopieren finden ihn. Die Probe des Koordinators (29.09.2026) hat das mit
// pdftotext, pdf.js und Acrobat bestaetigt; TestTextebeneLageMitPoppler
// misst es nach.
//
// # Koordinaten
//
// Die Woerter kommen aus dem Texterkennungsdienst im ANGEZEIGTEN Raum:
// Punkte, Ursprung oben links in der CropBox, /Rotate schon angewandt —
// so, wie die Seite auf dem Bildschirm steht. In den Inhaltsstrom gehoert
// der Benutzerraum der Seite. Die Umrechnung ist die Matrix, die pdf.js in
// PageViewport baut (Massstab 1), umgekehrt — damit rechnen Oberflaeche
// und Server gleich (Vertrag Etappe 2: keine zweite Handformel).
//
// # Was mit dem Dokument geschieht
//
// Der bisherige Inhalt wird in q/Q geklammert (ein Inhaltsstrom darf den
// Grafikzustand offen lassen, und der Text soll davon nichts erben),
// dahinter kommt der Textstrom. Geaendert werden nur /Contents und die
// Schriftressource der Seite; Anmerkungen, Formular, Anhaenge, Lesezeichen
// und alles Uebrige bleiben, wie sie sind — TextebeneBauen prueft das am
// wieder geoeffneten Ergebnis.

// Wort ist ein erkanntes Wort mit seiner Lage im angezeigten Seitenraum
// (Punkte, Ursprung oben links, Y nach unten).
type Wort struct {
	X0, Y0, X1, Y1 float64
	Text           string
}

// ocrSchrift ist der Ressourcenname der Schrift der Textebene: Helvetica
// mit WinAnsi, wie bei den Anmerkungen. Die Breite jedes Worts wird ueber
// Tz auf den Wortkasten gezogen; welche Schrift dahintersteht, sieht
// niemand.
const ocrSchrift = "OIHOcr"

// TextebeneSetzen legt die Woerter als unsichtbaren Text ueber Seite seite
// (ab 0) des geoeffneten Dokuments. Woerter ohne Flaeche oder ohne Text
// werden uebergangen; die Rueckgabe zaehlt die gesetzten. Geschrieben wird
// hier nichts — das tut TextebeneBauen, das danach auch prueft.
func TextebeneSetzen(c context.Context, ctx *model.Context, seite int, woerter []Wort) (int, error) {
	seiten, err := blaetter(ctx)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	if seite < 0 || seite >= len(seiten) {
		return 0, fmt.Errorf("%w: Seite %d, das Dokument hat %d", ErrPlanUngueltig, seite, len(seiten))
	}
	s := seiten[seite]
	x := ctx.XRefTable
	strom, n := textstrom(c, x, s, woerter)
	if n == 0 {
		return 0, nil
	}
	if err := schriftEintragen(x, s); err != nil {
		return 0, err
	}
	if err := inhaltAnhaengen(x, s, strom); err != nil {
		return 0, err
	}
	return n, nil
}

// TextebeneBauen schreibt das Dokument mit den Textebenen der genannten
// Seiten (ab 0) neu — ohne Rasterung, Seiten und Katalog wie sie sind —,
// oeffnet das Ergebnis wieder und prueft es wie CommitBauen: Seitenzahl,
// jede Anmerkung, Erhaltungsbericht; dazu, dass jede Seite mit Woertern
// ihre Textebene traegt. Verluste im Bericht sind kein Fehler: Der
// Aufrufer entscheidet, ob er das Ergebnis behaelt.
//
// Die Rueckgabe zaehlt die gesetzten Woerter.
func TextebeneBauen(c context.Context, quelle io.ReadSeeker, seiten map[int][]Wort, ziel io.Writer) (Bericht, int, error) {
	ctx, err := lesen(c, quelle, model.COLLECT)
	if err != nil {
		return Bericht{}, 0, err
	}
	blatt, err := blaetter(ctx)
	if err != nil {
		return Bericht{}, 0, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	erg := Anmerkungsergebnis{Added: []AnmerkungHinzugefuegt{}, vorher: anmerkungsbestand(ctx.XRefTable, blatt)}

	nummern := make([]int, 0, len(seiten))
	for n := range seiten {
		nummern = append(nummern, n)
	}
	slices.Sort(nummern)
	gesetzt := 0
	var mitText []int
	for _, n := range nummern {
		if err := c.Err(); err != nil {
			return Bericht{}, 0, err
		}
		k, err := TextebeneSetzen(c, ctx, n, seiten[n])
		if err != nil {
			return Bericht{}, 0, err
		}
		if k > 0 {
			gesetzt += k
			mitText = append(mitText, n)
		}
	}

	plan := make([]Seite, ctx.PageCount)
	for i := range plan {
		plan[i] = Seite{Quelle: i}
	}
	ergebnis, nachCtx, bericht, err := seitenplan(c, ctx, plan)
	if err != nil {
		return Bericht{}, 0, err
	}
	if err := anmerkungenPruefen(nachCtx, plan, erg, &bericht); err != nil {
		return Bericht{}, 0, err
	}
	// Die Textebene muss im Ergebnis stehen — nicht nur im Speicher.
	nachher, err := blaetter(nachCtx)
	if err != nil {
		return Bericht{}, 0, fmt.Errorf("%w: Ergebnis: %v", ErrPruefung, err)
	}
	for _, n := range mitText {
		inhalt, err := nachCtx.PageContent(nachher[n].dict, n+1)
		if err != nil || !strings.Contains(string(inhalt), "/"+ocrSchrift+" ") {
			return Bericht{}, 0, fmt.Errorf("%w: Textebene der Seite %d fehlt im Ergebnis", ErrPruefung, n)
		}
	}
	if _, err := ziel.Write(ergebnis); err != nil {
		return Bericht{}, 0, err
	}
	return bericht, gesetzt, nil
}

// textstrom baut den Inhaltsstrom der Textebene einer Seite.
func textstrom(c context.Context, x *model.XRefTable, s blatt, woerter []Wort) (string, int) {
	box := angezeigteBox(x, s)
	zu := umkehren(anzeigematrix(box, wirksameDrehung(x, s)))
	// Richtung der Schrift im Benutzerraum: Anzeige-x (1,0) und
	// Anzeige-oben (0,-1), durch den linearen Teil der Matrix.
	rx, ry := zu[0], zu[1]
	ux, uy := -zu[2], -zu[3]

	var b strings.Builder
	b.WriteString("q BT 3 Tr ")
	n := 0
	for _, w := range woerter {
		hoehe := w.Y1 - w.Y0
		text := strings.TrimSpace(w.Text)
		if !(hoehe > 0) || !(w.X1 > w.X0) || text == "" || !endlich([]float64{w.X0, w.Y0, w.X1, w.Y1}) {
			continue
		}
		// Gemessen wird der WinAnsi-kodierte Text: pdfcpu schlaegt bei
		// Kernschriften je BYTE in der CP1252-Tabelle nach; UTF-8 zaehlte
		// ein „ü“ doppelt, und das Wort wuerde zu schmal gezogen.
		breite, err := font.TextWidthFloat(c, string(winAnsiKodiert(text)), "Helvetica", hoehe)
		if err != nil || !(breite > 0) {
			continue
		}
		skala := 100 * (w.X1 - w.X0) / breite
		// Grundlinie: unten im Wortkasten, um ein Fuenftel angehoben
		// (Unterlaengen). Die Schriftgroesse ist die Kastenhoehe.
		px, py := anwenden(zu, w.X0, w.Y1-hoehe*0.2)
		fmt.Fprintf(&b, "/%s %s Tf %s Tz %s %s %s %s %s %s Tm (%s) Tj ", ocrSchrift,
			zahl(hoehe), zahl(skala), zahl(rx), zahl(ry), zahl(ux), zahl(uy), zahl(px), zahl(py), winAnsi(text))
		n++
	}
	b.WriteString("ET Q")
	return b.String(), n
}

// schriftEintragen sorgt fuer die Schrift in den Ressourcen der Seite.
// Geerbte Ressourcen werden erst auf die Seite kopiert — sonst bekaemen
// alle Geschwister die Schrift.
func schriftEintragen(x *model.XRefTable, s blatt) error {
	var res types.Dict
	if o, ok := s.dict.Find("Resources"); ok {
		res = alsDict(x, o)
	} else if geerbt := alsDict(x, s.geerbt["Resources"]); geerbt != nil {
		res = geerbt.Clone().(types.Dict)
		s.dict["Resources"] = res
	}
	if res == nil {
		res = types.NewDict()
		s.dict["Resources"] = res
	}
	fonts := alsDict(x, res["Font"])
	if fonts == nil {
		fonts = types.NewDict()
		res["Font"] = fonts
	}
	fonts[ocrSchrift] = helvetica.Clone().(types.Dict)
	return nil
}

// inhaltAnhaengen klammert den bisherigen Inhalt in q/Q und haengt den
// Textstrom an.
//
// Jeder der drei Stroeme beginnt und endet mit einem Zeilenumbruch. Die
// Norm behandelt die Grenze zwischen zwei Inhaltsstroemen als Leerraum,
// aber nicht jeder Leser tut das: github.com/ledongthuc/pdf (TextebeneLesen)
// haengt die Stroeme ohne Trennzeichen aneinander, las bis 30.09.2026
// „qq … QQq BT …“ und stuerzte am letzten Q ab — die eigene Textebene
// galt als unlesbar (Etappe 6, Desktop-App ohne Poppler).
func inhaltAnhaengen(x *model.XRefTable, s blatt, strom string) error {
	neu := func(inhalt string) (types.IndirectRef, error) {
		sd, err := x.NewStreamDictForBuf([]byte(inhalt))
		if err != nil {
			return types.IndirectRef{}, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		if err := sd.Encode(); err != nil {
			return types.IndirectRef{}, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		ref, err := x.IndRefForNewObject(*sd)
		if err != nil {
			return types.IndirectRef{}, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		return *ref, nil
	}
	auf, err := neu("q\n")
	if err != nil {
		return err
	}
	zu, err := neu("\nQ\n")
	if err != nil {
		return err
	}
	ebene, err := neu("\n" + strom + "\n")
	if err != nil {
		return err
	}
	inhalte := types.Array{auf}
	if o, ok := s.dict.Find("Contents"); ok {
		switch v := aufloesen(x, o).(type) {
		case types.Array:
			inhalte = append(inhalte, v...)
		case types.StreamDict:
			if ir, ist := o.(types.IndirectRef); ist {
				inhalte = append(inhalte, ir)
			}
		}
	}
	s.dict["Contents"] = append(inhalte, zu, ebene)
	return nil
}

// ============================================================
// Anzeige <-> Benutzerraum
// ============================================================

// viereck liest ein Rechteck [llx lly urx ury] aus einem Array-Objekt,
// geordnet. nil, wenn es keins ist.
func viereck(x *model.XRefTable, o types.Object) *[4]float64 {
	a := alsArray(x, o)
	if len(a) != 4 {
		return nil
	}
	var r [4]float64
	for i, e := range a {
		switch v := aufloesen(x, e).(type) {
		case types.Float:
			r[i] = float64(v)
		case types.Integer:
			r[i] = float64(v)
		default:
			return nil
		}
	}
	r = geordnet(r[:])
	return &r
}

// wirksam liefert ein Seitenattribut — von der Seite oder geerbt.
func wirksam(s blatt, k string) types.Object {
	if v, ok := s.dict.Find(k); ok {
		return v
	}
	return s.geerbt[k]
}

// angezeigteBox ist die Flaeche, die ein Programm anzeigt: die CropBox,
// beschnitten auf die MediaBox; ohne CropBox die MediaBox; ohne beides
// A4.
func angezeigteBox(x *model.XRefTable, s blatt) [4]float64 {
	media := viereck(x, wirksam(s, "MediaBox"))
	if media == nil {
		media = &[4]float64{0, 0, 595, 842}
	}
	crop := viereck(x, wirksam(s, "CropBox"))
	if crop == nil {
		return *media
	}
	schnitt := [4]float64{math.Max(crop[0], media[0]), math.Max(crop[1], media[1]),
		math.Min(crop[2], media[2]), math.Min(crop[3], media[3])}
	if !(schnitt[2] > schnitt[0]) || !(schnitt[3] > schnitt[1]) {
		return *media
	}
	return schnitt
}

// wirksameDrehung ist /Rotate der Seite, geerbt eingeschlossen, auf
// 0/90/180/270 gebracht.
func wirksameDrehung(x *model.XRefTable, s blatt) int {
	d := 0
	switch v := aufloesen(x, wirksam(s, "Rotate")).(type) {
	case types.Integer:
		d = int(v)
	case types.Float:
		d = int(v)
	}
	d = ((d % 360) + 360) % 360
	return d - d%90
}

// anzeigematrix bildet den Benutzerraum auf den angezeigten Raum ab
// (Ursprung oben links, Y nach unten) — dieselbe Rechnung wie pdf.js'
// PageViewport bei Massstab 1 ohne Versatz.
func anzeigematrix(box [4]float64, drehung int) [6]float64 {
	cx, cy := (box[2]+box[0])/2, (box[3]+box[1])/2
	var a, b, c, d float64
	switch drehung {
	case 90:
		a, b, c, d = 0, 1, 1, 0
	case 180:
		a, b, c, d = -1, 0, 0, 1
	case 270:
		a, b, c, d = 0, -1, -1, 0
	default:
		a, b, c, d = 1, 0, 0, -1
	}
	var ox, oy float64
	if a == 0 {
		ox = math.Abs(cy - box[1])
		oy = math.Abs(cx - box[0])
	} else {
		ox = math.Abs(cx - box[0])
		oy = math.Abs(cy - box[1])
	}
	return [6]float64{a, b, c, d, ox - a*cx - c*cy, oy - b*cx - d*cy}
}

// umkehren invertiert eine affine Matrix [a b c d e f].
func umkehren(m [6]float64) [6]float64 {
	det := m[0]*m[3] - m[1]*m[2]
	return [6]float64{
		m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
		(m[2]*m[5] - m[3]*m[4]) / det, (m[1]*m[4] - m[0]*m[5]) / det,
	}
}

// anwenden wendet eine affine Matrix auf einen Punkt an.
func anwenden(m [6]float64, x, y float64) (float64, float64) {
	return m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]
}

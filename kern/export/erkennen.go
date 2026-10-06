// SPDX-License-Identifier: Apache-2.0

package export

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode"
)

// Die Erkennung (Vertrag Etappe 4, Heuristikfassung 1). Alles hier ist
// Geometrie und Zeichenmuster — keine KI, keine Sprachmodelle. Jede Regel
// steht mit ihrer Zahl da, damit man sie am Dokument nachrechnen kann.
//
// Ablauf je Seite:
//
//  1. Woerter einsammeln und zu REIHEN buendeln: Woerter, deren Kaesten
//     sich senkrecht zur Haelfte ueberlappen, stehen in einer Reihe.
//  2. Jede Reihe in SEGMENTE teilen: Ein Zwischenraum breiter als
//     spaltenluecke × Zeilenhoehe trennt zwei Zellen.
//  3. TABELLEN: mindestens tabelleMindestZeilen aufeinanderfolgende Reihen
//     mit je mindestens zwei Segmenten, von denen je Reihenpaar mindestens
//     tabelleMindestGrenzen an gleicher Kante beginnen, enden oder sich
//     deutlich ueberlappen. Spalten entstehen, indem Segmente mit
//     gemeinsamer Kante oder Ueberlappung zusammenfallen.
//  4. Was uebrig bleibt, wird nach den Bloecken des Lieferanten zu
//     ABSAETZEN; Silbentrennung am Zeilenende wird nur vor einem
//     Kleinbuchstaben zusammengezogen.
//  5. UEBERSCHRIFT: Zeilenhoehe ≥ ueberschriftFaktor × Median der Seite
//     und kurz. LISTE: Zeile beginnt mit •, –, -, *, „1.“ oder „a)“.
//
// Ueber die Seiten hinweg: Kopf- und Fusszeilen (gleicher Text an gleicher
// Stelle auf ≥ 3 Seiten) und das Zusammenfuehren von Tabellen ueber einen
// Seitenwechsel — nur bei gleicher Spaltenzahl und gleicher Kopfzeile.
//
// Bekannte Grenze: Zweispaltige Prosa sieht wie eine zweispaltige Tabelle
// aus. Dagegen steht nur die Regel der kurzen Zellen (tabelleKurzeZelle…);
// „Layout aehnlich“ ist nicht Gegenstand dieser Etappe.
const (
	// unsichereKonfidenz: Woerter darunter zaehlen als unsicher; ein Block
	// ist unsicher, wenn mehr als ein Viertel seiner Woerter unsicher sind
	// (wie die Seitenregel der Etappe 3).
	unsichereKonfidenz = 50
	// spaltenluecke: Zwischenraum in Zeilenhoehen, ab dem zwei Woerter
	// nicht mehr zur selben Zelle gehoeren. Ein Wortabstand liegt bei
	// 0,25–0,35, Blocksatz selten ueber 0,6.
	spaltenluecke = 0.75
	// kantenToleranz: Kanten, die naeher beieinander liegen (in
	// Zeilenhoehen, mindestens kantenMindestens Punkte), gelten als gleich.
	kantenToleranz   = 0.5
	kantenMindestens = 3.0
	// reihenAbstand: Reihen einer Tabelle liegen hoechstens so viele
	// Zeilenhoehen auseinander.
	reihenAbstand = 2.5
	// tabelleMindestZeilen und tabelleMindestGrenzen laut Vertrag.
	tabelleMindestZeilen  = 3
	tabelleMindestGrenzen = 2
	// tabelleKurzeZelleWoerter/-Anteil: Mindestens dieser Anteil der
	// Zellen hat hoechstens so viele Woerter — sonst ist es Prosa in
	// Spalten, kein Raster.
	tabelleKurzeZelleWoerter = 5
	tabelleKurzeZellenAnteil = 0.6
	// ueberschriftFaktor: Zeilenhoehe zum Median der Seite; ab
	// ueberschriftEbene1 ist es eine Ueberschrift erster Ebene.
	ueberschriftFaktor         = 1.3
	ueberschriftEbene1         = 1.6
	ueberschriftHoechstZeilen  = 2
	ueberschriftHoechstZeichen = 80
	// kopfFussMindestSeiten: so oft muss ein Text an gleicher Stelle
	// stehen; kopfFussHoechstZeilen: laengere Bloecke sind Inhalt.
	kopfFussMindestSeiten = 3
	kopfFussHoechstZeilen = 2
	// kopfFussRaster: Die Lage wird auf dieses Raster der Seitenhoehe
	// gerundet (20 = Fuenftel-Prozent-Streifen von 5 %).
	kopfFussRaster = 20
)

// listenmarke: •, ·, ▪, –, —, -, *, „1.“, „1)“, „a)“, „a.“ — gefolgt von
// Leerraum, damit „-12,50“ und „2026-…“ keine Liste sind.
var listenmarke = regexp.MustCompile(`^(?:[•·▪–—\-*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+`)

// ============================================================
// Arbeitsstrukturen
// ============================================================

// wort ist ein Wort waehrend der Erkennung: mit seiner Herkunft (Block und
// Zeile des Lieferanten) und der Marke, ob eine Tabelle es verbraucht hat.
type wort struct {
	Wort
	block, zeile int
	benutzt      bool
}

func (w *wort) hoehe() float64 { return math.Max(w.Y1-w.Y0, 0.1) }

// reihe ist eine Zeile der Seite ueber alle Bloecke des Lieferanten
// hinweg.
type reihe struct {
	woerter  []*wort
	y0, y1   float64
	hoehe    float64 // Median der Worthoehen
	segmente []*segment
}

// segment ist ein Stueck einer Reihe ohne grosse Luecke — in einer Tabelle
// eine Zelle.
type segment struct {
	woerter []*wort
	x0, x1  float64
}

func (s *segment) text() string {
	teile := make([]string, 0, len(s.woerter))
	for _, w := range s.woerter {
		teile = append(teile, w.Text)
	}
	return strings.Join(teile, " ")
}

// ============================================================
// Einstieg
// ============================================================

// Erkennen baut aus den Woertern der Seiten das Dokumentmodell. Die
// Seiten werden nach Nummer geordnet; Sha256 der Quelle traegt der
// Aufrufer ein.
func Erkennen(seiten []Seitenwoerter) Dokument {
	sortiert := slices.Clone(seiten)
	slices.SortStableFunc(sortiert, func(a, b Seitenwoerter) int { return a.Nr - b.Nr })
	dok := Dokument{Heuristik: Heuristikfassung, Warnungen: []Warnung{}, Seiten: []Seite{},
		Quelle: Quelle{Seiten: []int{}}}
	for _, s := range sortiert {
		dok.Quelle.Seiten = append(dok.Quelle.Seiten, s.Nr)
		dok.Seiten = append(dok.Seiten, erkennenSeite(s))
	}
	kopfFussMarkieren(&dok)
	tabellenZusammenfuehren(&dok)
	tabellenNummerieren(&dok)
	unsichereMelden(&dok)
	return dok
}

func erkennenSeite(s Seitenwoerter) Seite {
	seite := Seite{Nr: s.Nr, Breite: s.Breite, Hoehe: s.Hoehe, Quelle: s.Quelle, Bildanteil: s.Bildanteil, Bloecke: []Block{}}
	if seite.Quelle == "" {
		seite.Quelle = QuelleLeer
	}
	woerter := einsammeln(s)
	if len(woerter) == 0 {
		return seite
	}
	reihen := reihenBilden(woerter)
	median := medianReihenhoehe(reihen)
	bloecke := tabellenFinden(reihen, s.Nr, seite.Quelle)
	bloecke = append(bloecke, absaetzeBilden(woerter, median, seite.Quelle)...)
	// Lesereihenfolge: von oben nach unten, dann von links nach rechts.
	slices.SortStableFunc(bloecke, func(a, b Block) int {
		if a.Lage[1] != b.Lage[1] {
			return vergleich(a.Lage[1], b.Lage[1])
		}
		return vergleich(a.Lage[0], b.Lage[0])
	})
	seite.Bloecke = bloecke
	return seite
}

func vergleich(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// einsammeln macht aus der Struktur des Lieferanten eine flache Liste;
// leere Woerter fallen weg.
func einsammeln(s Seitenwoerter) []*wort {
	var aus []*wort
	for bi, b := range s.Bloecke {
		for zi, z := range b.Zeilen {
			for _, w := range z.Woerter {
				w.Text = strings.Join(strings.Fields(w.Text), " ")
				if w.Text == "" {
					continue
				}
				if w.X1 < w.X0 {
					w.X0, w.X1 = w.X1, w.X0
				}
				if w.Y1 < w.Y0 {
					w.Y0, w.Y1 = w.Y1, w.Y0
				}
				aus = append(aus, &wort{Wort: w, block: bi, zeile: zi})
			}
		}
	}
	return aus
}

// ============================================================
// Reihen und Segmente
// ============================================================

// reihenBilden buendelt Woerter zu Reihen: nach der senkrechten Mitte
// geordnet; ein Wort gehoert zur laufenden Reihe, wenn sein Kasten sie zur
// Haelfte der kleineren Hoehe ueberlappt.
func reihenBilden(woerter []*wort) []*reihe {
	geordnet := slices.Clone(woerter)
	slices.SortStableFunc(geordnet, func(a, b *wort) int {
		if ma, mb := (a.Y0+a.Y1)/2, (b.Y0+b.Y1)/2; ma != mb {
			return vergleich(ma, mb)
		}
		return vergleich(a.X0, b.X0)
	})
	var reihen []*reihe
	for _, w := range geordnet {
		if n := len(reihen); n > 0 {
			r := reihen[n-1]
			ueberlappung := math.Min(w.Y1, r.y1) - math.Max(w.Y0, r.y0)
			if ueberlappung > 0.5*math.Min(w.hoehe(), r.hoehe) {
				r.woerter = append(r.woerter, w)
				r.y0, r.y1 = math.Min(r.y0, w.Y0), math.Max(r.y1, w.Y1)
				continue
			}
		}
		reihen = append(reihen, &reihe{woerter: []*wort{w}, y0: w.Y0, y1: w.Y1, hoehe: w.hoehe()})
	}
	for _, r := range reihen {
		slices.SortStableFunc(r.woerter, func(a, b *wort) int { return vergleich(a.X0, b.X0) })
		hoehen := make([]float64, len(r.woerter))
		for i, w := range r.woerter {
			hoehen[i] = w.hoehe()
		}
		r.hoehe = median(hoehen)
		r.segmente = segmentieren(r)
	}
	return reihen
}

// segmentieren teilt eine Reihe an Luecken breiter als spaltenluecke ×
// Zeilenhoehe.
func segmentieren(r *reihe) []*segment {
	schwelle := math.Max(spaltenluecke*r.hoehe, kantenMindestens)
	var aus []*segment
	var lauf *segment
	for _, w := range r.woerter {
		if lauf != nil && w.X0-lauf.x1 <= schwelle {
			lauf.woerter = append(lauf.woerter, w)
			lauf.x1 = math.Max(lauf.x1, w.X1)
			continue
		}
		lauf = &segment{woerter: []*wort{w}, x0: w.X0, x1: w.X1}
		aus = append(aus, lauf)
	}
	return aus
}

func median(werte []float64) float64 {
	if len(werte) == 0 {
		return 0
	}
	s := slices.Clone(werte)
	sort.Float64s(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func medianReihenhoehe(reihen []*reihe) float64 {
	hoehen := make([]float64, len(reihen))
	for i, r := range reihen {
		hoehen[i] = r.hoehe
	}
	return median(hoehen)
}

// ============================================================
// Tabellen
// ============================================================

// kantenGleich: zwei Segmente beginnen oder enden an derselben Kante oder
// ueberlappen sich zur Haelfte des schmaleren.
func kantenGleich(a, b *segment, toleranz float64) bool {
	if math.Abs(a.x0-b.x0) <= toleranz || math.Abs(a.x1-b.x1) <= toleranz {
		return true
	}
	ueberlappung := math.Min(a.x1, b.x1) - math.Max(a.x0, b.x0)
	return ueberlappung > 0 && ueberlappung >= 0.5*math.Min(a.x1-a.x0, b.x1-b.x0)
}

func toleranz(hoehe float64) float64 { return math.Max(kantenToleranz*hoehe, kantenMindestens) }

// reihenPassen: beide Reihen haben mindestens zwei Segmente, liegen nah
// beieinander, und mindestens tabelleMindestGrenzen Segmente der einen
// finden eine gleiche Kante in der anderen.
func reihenPassen(a, b *reihe) bool {
	if len(a.segmente) < 2 || len(b.segmente) < 2 {
		return false
	}
	hoehe := math.Max(a.hoehe, b.hoehe)
	if b.y0-a.y1 > reihenAbstand*hoehe {
		return false
	}
	t := toleranz(hoehe)
	belegt := make([]bool, len(b.segmente))
	n := 0
	for _, sa := range a.segmente {
		for j, sb := range b.segmente {
			if !belegt[j] && kantenGleich(sa, sb, t) {
				belegt[j] = true
				n++
				break
			}
		}
	}
	return n >= tabelleMindestGrenzen
}

// tabellenFinden sucht Laeufe passender Reihen und baut daraus Tabellen.
// Die Woerter einer Tabelle sind danach benutzt.
func tabellenFinden(reihen []*reihe, seiteNr int, quelle string) []Block {
	var aus []Block
	i := 0
	for i < len(reihen) {
		if len(reihen[i].segmente) < 2 {
			i++
			continue
		}
		j := i
		for j+1 < len(reihen) && reihenPassen(reihen[j], reihen[j+1]) {
			j++
		}
		if j-i+1 >= tabelleMindestZeilen {
			if b, ok := tabelleBauen(reihen[i:j+1], seiteNr, quelle); ok {
				aus = append(aus, b)
				i = j + 1
				continue
			}
		}
		i++
	}
	return aus
}

// tabelleBauen macht aus einem Lauf von Reihen ein Raster. Spalten sind
// die Zusammenhangsklassen der Segmente unter kantenGleich.
func tabelleBauen(reihen []*reihe, seiteNr int, quelle string) (Block, bool) {
	var alle []*segment
	kurz := 0
	for _, r := range reihen {
		for _, s := range r.segmente {
			alle = append(alle, s)
			if len(s.woerter) <= tabelleKurzeZelleWoerter {
				kurz++
			}
		}
	}
	if float64(kurz) < tabelleKurzeZellenAnteil*float64(len(alle)) {
		return Block{}, false
	}
	// Zusammenhangsklassen (Union-Find).
	eltern := make([]int, len(alle))
	for i := range eltern {
		eltern[i] = i
	}
	var wurzel func(int) int
	wurzel = func(i int) int {
		for eltern[i] != i {
			eltern[i] = eltern[eltern[i]]
			i = eltern[i]
		}
		return i
	}
	t := toleranz(medianReihenhoehe(reihen))
	for i := range alle {
		for j := i + 1; j < len(alle); j++ {
			if kantenGleich(alle[i], alle[j], t) {
				eltern[wurzel(i)] = wurzel(j)
			}
		}
	}
	// Spalten nach ihrer linken Kante ordnen.
	type spalte struct {
		wurzel int
		x0     float64
	}
	var spalten []spalte
	spalteVon := map[int]int{}
	for i, s := range alle {
		w := wurzel(i)
		if k, ok := spalteVon[w]; ok {
			spalten[k].x0 = math.Min(spalten[k].x0, s.x0)
			continue
		}
		spalteVon[w] = len(spalten)
		spalten = append(spalten, spalte{wurzel: w, x0: s.x0})
	}
	if len(spalten) < 2 {
		return Block{}, false
	}
	reihenfolge := make([]int, len(spalten))
	for i := range reihenfolge {
		reihenfolge[i] = i
	}
	slices.SortStableFunc(reihenfolge, func(a, b int) int { return vergleich(spalten[a].x0, spalten[b].x0) })
	nummer := make(map[int]int, len(spalten)) // Wurzel -> Spaltennummer
	for n, k := range reihenfolge {
		nummer[spalten[k].wurzel] = n
	}

	tab := &Tabelle{Seiten: []int{seiteNr}, Spalten: len(spalten), Typvorschlag: []string{}}
	b := Block{Art: ArtTabelle, Quelle: quelle, Tabelle: tab}
	var lage kasten
	idx := 0
	for _, r := range reihen {
		zeile := make([]Zelle, len(spalten))
		kaesten := make([]kasten, len(spalten))
		for k := range zeile {
			zeile[k] = Zelle{Konf: -1}
		}
		for _, s := range r.segmente {
			k := nummer[wurzel(idx)]
			idx++
			z := &zeile[k]
			if z.Text != "" {
				z.Text += " "
			}
			z.Text += s.text()
			z.Quelle = quelle
			for _, w := range s.woerter {
				w.benutzt = true
				kaesten[k].aufnehmen(w.Wort)
				lage.aufnehmen(w.Wort)
				if w.Konf >= 0 && (z.Konf < 0 || w.Konf < z.Konf) {
					z.Konf = w.Konf
				}
			}
		}
		for k := range zeile {
			zeile[k].Lage = kaesten[k].lage
		}
		tab.Zeilen = append(tab.Zeilen, zeile)
	}
	b.Lage = lage.lage
	return b, true
}

// kasten ist ein wachsender Umriss aus Woertern.
type kasten struct {
	lage [4]float64
	hat  bool
}

func (k *kasten) aufnehmen(w Wort) {
	if !k.hat {
		k.lage, k.hat = [4]float64{w.X0, w.Y0, w.X1, w.Y1}, true
		return
	}
	k.lage[0], k.lage[1] = math.Min(k.lage[0], w.X0), math.Min(k.lage[1], w.Y0)
	k.lage[2], k.lage[3] = math.Max(k.lage[2], w.X1), math.Max(k.lage[3], w.Y1)
}

// ============================================================
// Absaetze, Ueberschriften, Listen
// ============================================================

// zeile ist eine Zeile eines Absatzes waehrend des Baus.
type zeile struct {
	woerter []*wort
	text    string
}

// absaetzeBilden macht aus den unbenutzten Woertern Bloecke — nach der
// Einteilung des Lieferanten, Zeile fuer Zeile.
func absaetzeBilden(woerter []*wort, seitenMedian float64, quelle string) []Block {
	// Nach Block und Zeile des Lieferanten sammeln, Reihenfolge wie
	// geliefert.
	type schluessel struct{ block, zeile int }
	zeilenVon := map[int]map[int]*zeile{}
	var bloecke []int
	for _, w := range woerter {
		if w.benutzt {
			continue
		}
		zs, ok := zeilenVon[w.block]
		if !ok {
			zs = map[int]*zeile{}
			zeilenVon[w.block] = zs
			bloecke = append(bloecke, w.block)
		}
		z, ok := zs[w.zeile]
		if !ok {
			z = &zeile{}
			zs[w.zeile] = z
		}
		z.woerter = append(z.woerter, w)
	}
	slices.Sort(bloecke)
	var aus []Block
	for _, bi := range bloecke {
		zs := zeilenVon[bi]
		nummern := make([]int, 0, len(zs))
		for n := range zs {
			nummern = append(nummern, n)
		}
		slices.Sort(nummern)
		zeilen := make([]*zeile, 0, len(nummern))
		for _, n := range nummern {
			z := zs[n]
			slices.SortStableFunc(z.woerter, func(a, b *wort) int { return vergleich(a.X0, b.X0) })
			teile := make([]string, len(z.woerter))
			for i, w := range z.woerter {
				teile[i] = w.Text
			}
			z.text = strings.Join(teile, " ")
			zeilen = append(zeilen, z)
		}
		aus = append(aus, blockTeilen(zeilen, seitenMedian, quelle)...)
	}
	return aus
}

// blockTeilen zerlegt die Zeilen eines Lieferantenblocks an Listenmarken:
// Zeilen vor der ersten Marke sind ein Absatz, jede Marke beginnt einen
// Listenpunkt, der bis zur naechsten Marke reicht.
func blockTeilen(zeilen []*zeile, seitenMedian float64, quelle string) []Block {
	var aus []Block
	var lauf []*zeile
	liste := false
	abschliessen := func() {
		if len(lauf) > 0 {
			aus = append(aus, blockBauen(lauf, liste, seitenMedian, quelle))
		}
		lauf = nil
	}
	for _, z := range zeilen {
		if listenmarke.MatchString(z.text) {
			abschliessen()
			liste = true
		}
		lauf = append(lauf, z)
	}
	abschliessen()
	return aus
}

// blockBauen macht aus Zeilen einen Absatz, eine Ueberschrift oder einen
// Listenpunkt.
func blockBauen(zeilen []*zeile, liste bool, seitenMedian float64, quelle string) Block {
	b := Block{Art: ArtAbsatz, Quelle: quelle, Zeilen: make([]string, 0, len(zeilen))}
	var hoehen []float64
	var lage kasten
	woerter, unsicher := 0, 0
	for _, z := range zeilen {
		b.Zeilen = append(b.Zeilen, z.text)
		for _, w := range z.woerter {
			hoehen = append(hoehen, w.hoehe())
			lage.aufnehmen(w.Wort)
			woerter++
			if w.Konf >= 0 && w.Konf < unsichereKonfidenz {
				unsicher++
			}
		}
	}
	b.Lage = lage.lage
	b.Groesse = math.Round(median(hoehen)*10) / 10
	b.Unsicher = unsicher*4 > woerter
	b.Text = zusammenziehen(b.Zeilen)
	switch {
	case liste:
		b.Art, b.Ebene = ArtListe, 1
		b.Text = strings.TrimSpace(listenmarke.ReplaceAllString(b.Text, ""))
	case seitenMedian > 0 && b.Groesse >= ueberschriftFaktor*seitenMedian && len(zeilen) <= ueberschriftHoechstZeilen &&
		len([]rune(b.Text)) <= ueberschriftHoechstZeichen:
		b.Art, b.Ebene = ArtUeberschrift, 2
		if b.Groesse >= ueberschriftEbene1*seitenMedian {
			b.Ebene = 1
		}
	}
	return b
}

// zusammenziehen macht aus Zeilen einen Absatz. Ein Trennstrich am
// Zeilenende faellt weg, wenn die naechste Zeile mit einem Kleinbuchstaben
// beginnt („Rech-“ + „nung“); sonst bleibt er („Ein- und Ausgang“ am
// Zeilenende vor „Ausgang“ … bleibt „Ein- Ausgang“ mit Leerzeichen, wie im
// Original).
func zusammenziehen(zeilen []string) string {
	aus := ""
	for i, z := range zeilen {
		z = strings.TrimSpace(z)
		switch {
		case i == 0:
			aus = z
		case strings.HasSuffix(aus, "-") && beginntKlein(z):
			aus = strings.TrimSuffix(aus, "-") + z
		default:
			aus += " " + z
		}
	}
	return aus
}

func beginntKlein(s string) bool {
	for _, r := range s {
		return unicode.IsLower(r)
	}
	return false
}

// ============================================================
// Ueber die Seiten hinweg
// ============================================================

// kopfFussMarkieren findet Kopf- und Fusszeilen: der oberste und der
// unterste kurze Textblock jeder Seite, verglichen ueber Text (Ziffern
// gleichgesetzt) und Lage. Ab kopfFussMindestSeiten Treffern bleibt der
// erste, die weiteren werden als wiederholt markiert.
func kopfFussMarkieren(dok *Dokument) {
	type stelle struct {
		seite int
		block *Block
	}
	gruppen := map[string][]stelle{}
	var reihenfolge []string
	merken := func(s *Seite, b *Block, zone string) {
		if b == nil || b.Art == ArtTabelle || len(b.Zeilen) > kopfFussHoechstZeilen {
			return
		}
		k := kopfFussSchluessel(s, b, zone)
		if _, ok := gruppen[k]; !ok {
			reihenfolge = append(reihenfolge, k)
		}
		gruppen[k] = append(gruppen[k], stelle{s.Nr, b})
	}
	for i := range dok.Seiten {
		s := &dok.Seiten[i]
		if len(s.Bloecke) == 0 {
			continue
		}
		merken(s, &s.Bloecke[0], "top")
		if len(s.Bloecke) > 1 {
			merken(s, &s.Bloecke[len(s.Bloecke)-1], "bottom")
		}
	}
	for _, k := range reihenfolge {
		st := gruppen[k]
		if len(st) < kopfFussMindestSeiten {
			continue
		}
		seiten := make([]int, 0, len(st))
		for i, x := range st {
			x.block.KopfFuss = true
			x.block.Wiederholt = i > 0
			seiten = append(seiten, x.seite)
		}
		dok.Warnungen = append(dok.Warnungen, Warnung{Code: WarnungKopfFuss, Count: len(seiten), Pages: seiten})
	}
}

var ziffern = regexp.MustCompile(`\d+`)

// kopfFussSchluessel: Zone, Streifen der Seitenhoehe und der Text mit
// gleichgesetzten Ziffern („Seite 3 von 9“ = „Seite # von #“).
func kopfFussSchluessel(s *Seite, b *Block, zone string) string {
	text := strings.ToLower(strings.Join(strings.Fields(ziffern.ReplaceAllString(b.Text, "#")), " "))
	streifen := 0
	if s.Hoehe > 0 {
		streifen = int(b.Lage[1] / s.Hoehe * kopfFussRaster)
	}
	return fmt.Sprintf("%s|%d|%s", zone, streifen, text)
}

// tabellenZusammenfuehren haengt eine Tabelle am Anfang einer Seite an die
// Tabelle am Ende der Vorseite — nur bei gleicher Spaltenzahl und gleicher
// Kopfzeile. Beide Entscheidungen stehen in den Warnungen.
func tabellenZusammenfuehren(dok *Dokument) {
	var vorige *Tabelle
	vorigeSeite := -1
	for i := range dok.Seiten {
		s := &dok.Seiten[i]
		zusammengefuehrt := false
		if erste := ersterInhalt(s); vorige != nil && erste >= 0 && s.Bloecke[erste].Tabelle != nil && s.Nr == vorigeSeite+1 {
			t := s.Bloecke[erste].Tabelle
			w := Warnung{Code: WarnungNichtZusammengefuehrt, Pages: []int{vorigeSeite, s.Nr}}
			switch {
			case t.Spalten != vorige.Spalten:
				w.Detail = "columns"
			case len(t.Zeilen) == 0 || !kopfGleich(vorige.Zeilen[0], t.Zeilen[0]):
				w.Detail = "header"
			default:
				vorige.Zeilen = append(vorige.Zeilen, t.Zeilen[1:]...)
				vorige.Seiten = append(vorige.Seiten, s.Nr)
				s.Bloecke = slices.Delete(s.Bloecke, erste, erste+1)
				s.Fortsetzung = true
				zusammengefuehrt = true
				w = Warnung{Code: WarnungZusammengefuehrt, Pages: []int{vorigeSeite, s.Nr}}
			}
			dok.Warnungen = append(dok.Warnungen, w)
		}
		if letzte := letzterInhalt(s); letzte >= 0 {
			vorige = s.Bloecke[letzte].Tabelle
		} else if !zusammengefuehrt {
			vorige = nil
		}
		vorigeSeite = s.Nr
	}
}

// ersterInhalt/letzterInhalt: Index des ersten/letzten Blocks, der keine
// Kopf- oder Fusszeile ist (auch nicht deren erstes Vorkommen); -1 ohne.
func ersterInhalt(s *Seite) int {
	for i := range s.Bloecke {
		if !s.Bloecke[i].KopfFuss {
			return i
		}
	}
	return -1
}

func letzterInhalt(s *Seite) int {
	for i := len(s.Bloecke) - 1; i >= 0; i-- {
		if !s.Bloecke[i].KopfFuss {
			return i
		}
	}
	return -1
}

func kopfGleich(a, b []Zelle) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if strings.TrimSpace(a[i].Text) != strings.TrimSpace(b[i].Text) {
			return false
		}
	}
	return true
}

// tabellenNummerieren vergibt Index, Kopfzeilen und Typvorschlag — nach
// dem Zusammenfuehren, damit beides fuer die ganze Tabelle gilt.
func tabellenNummerieren(dok *Dokument) {
	for i, t := range dok.Tabellen() {
		t.Index = i
		t.Kopfzeilen = kopfzeilenVorschlag(t)
		t.Typvorschlag = typvorschlag(t)
	}
}

// kopfzeilenVorschlag: eine Kopfzeile, wenn die erste Zeile keine Zahl
// und kein Datum enthaelt und es weitere Zeilen gibt.
func kopfzeilenVorschlag(t *Tabelle) int {
	if len(t.Zeilen) < 2 {
		return 0
	}
	for _, z := range t.Zeilen[0] {
		if _, ok := zahlLesen(z.Text, FormatDE); ok {
			return 0
		}
		if _, ok := zahlLesen(z.Text, FormatEN); ok {
			return 0
		}
		if _, ok := datumLesen(z.Text); ok {
			return 0
		}
	}
	return 1
}

// typvorschlag je Spalte: number oder date nur, wenn ALLE nicht-leeren
// Zellen unter den Kopfzeilen passen; sonst text. „00123“ passt nie als
// Zahl.
func typvorschlag(t *Tabelle) []string {
	aus := make([]string, t.Spalten)
	for k := range aus {
		zahlDE, zahlEN, datum, belegt := true, true, true, false
		for _, z := range t.Zeilen[min(t.Kopfzeilen, len(t.Zeilen)):] {
			if k >= len(z) {
				continue
			}
			text := strings.TrimSpace(z[k].Text)
			if text == "" {
				continue
			}
			belegt = true
			if _, ok := zahlLesen(text, FormatDE); !ok {
				zahlDE = false
			}
			if _, ok := zahlLesen(text, FormatEN); !ok {
				zahlEN = false
			}
			if _, ok := datumLesen(text); !ok {
				datum = false
			}
		}
		switch {
		case !belegt:
			aus[k] = TypText
		case zahlDE || zahlEN:
			aus[k] = TypZahl
		case datum:
			aus[k] = TypDatum
		default:
			aus[k] = TypText
		}
	}
	return aus
}

// unsichereMelden nennt die Seiten mit unsicheren Bloecken.
func unsichereMelden(dok *Dokument) {
	z := dok.Zaehlen()
	if len(z.Unsichere) > 0 {
		dok.Warnungen = append(dok.Warnungen, Warnung{Code: WarnungUnsicher, Count: len(z.Unsichere), Pages: z.Unsichere})
	}
}

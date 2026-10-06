// SPDX-License-Identifier: Apache-2.0

package export

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Werte (Konzept Kap. 05, Tabelle der Faelle): Nie still umwandeln.
//
//   - Text ist die Vorgabe jeder Spalte. „00123“ bleibt Text — auch wenn
//     die Person number waehlt, denn fuehrende Nullen ueberlebten die Zahl
//     nicht (WarnungZahlBleibtText).
//   - number liest mit dem gewaehlten Zahlenformat: de „1.234,56“, en
//     „1,234.56“. Was nicht passt, bleibt Text und wird gezaehlt.
//   - date nimmt nur eindeutige Formen: TT.MM.JJJJ und JJJJ-MM-TT.
//     „03/04/2026“ bleibt Text (WarnungDatumBleibtText) — ob April oder
//     Maerz, entscheidet niemand still.
//   - Summenzeilen sind Werte; Formeln entstehen nie.

// Spaltentypen.
const (
	TypText  = "text"
	TypZahl  = "number"
	TypDatum = "date"
)

// Zahlenformate.
const (
	FormatDE = "de"
	FormatEN = "en"
)

// Tabellenwahl ist, was die Person je Tabelle festlegt (Rumpf von POST
// …/export, tables[]).
type Tabellenwahl struct {
	Index      int  `json:"index"`
	Include    bool `json:"include"`
	HeaderRows int  `json:"header_rows"`
	// ColumnTypes je Spalte: text, number oder date; fehlende sind text.
	ColumnTypes []string `json:"column_types"`
}

// Optionen steuern das Schreiben.
type Optionen struct {
	// Tabellen: leer heisst alle Tabellen mit den Vorschlaegen des Modells
	// fuer die Kopfzeilen und Text fuer jede Spalte.
	Tabellen []Tabellenwahl
	// Zahlenformat: FormatDE (Vorgabe) oder FormatEN.
	Zahlenformat string
	// CSVTrenner: ; (Vorgabe), , | oder Tab. CSVTabelle: der Index der
	// einen Tabelle einer CSV.
	CSVTrenner string
	CSVTabelle int
}

// erlaubteTrenner der CSV.
var erlaubteTrenner = []string{";", ",", "|", "\t"}

// pruefen setzt Vorgaben ein und weist Unbekanntes ab.
func (o *Optionen) pruefen() error {
	switch o.Zahlenformat {
	case "":
		o.Zahlenformat = FormatDE
	case FormatDE, FormatEN:
	default:
		return fmt.Errorf("%w: Zahlenformat %q", ErrOptionUngueltig, o.Zahlenformat)
	}
	if o.CSVTrenner == "" {
		o.CSVTrenner = ";"
	}
	trennerOK := false
	for _, t := range erlaubteTrenner {
		if o.CSVTrenner == t {
			trennerOK = true
		}
	}
	if !trennerOK {
		return fmt.Errorf("%w: Trennzeichen %q", ErrOptionUngueltig, o.CSVTrenner)
	}
	for i := range o.Tabellen {
		w := &o.Tabellen[i]
		if w.HeaderRows < 0 || w.HeaderRows > 2 {
			return fmt.Errorf("%w: header_rows %d", ErrOptionUngueltig, w.HeaderRows)
		}
		for _, t := range w.ColumnTypes {
			switch t {
			case TypText, TypZahl, TypDatum:
			default:
				return fmt.Errorf("%w: Spaltentyp %q", ErrOptionUngueltig, t)
			}
		}
	}
	return nil
}

// gewaehlt ist eine Tabelle mit den wirksamen Einstellungen.
type gewaehlt struct {
	tabelle    *Tabelle
	kopfzeilen int
	typen      []string
}

// auswahl bestimmt die zu schreibenden Tabellen. Ohne Angaben alle, mit
// den Kopfzeilen des Modells und Text je Spalte. Ein unbekannter Index
// ist ErrTabelleFehlt.
func auswahl(dok Dokument, opt Optionen) ([]gewaehlt, error) {
	var aus []gewaehlt
	if len(opt.Tabellen) == 0 {
		for _, t := range dok.Tabellen() {
			aus = append(aus, gewaehlt{tabelle: t, kopfzeilen: t.Kopfzeilen, typen: nurText(t.Spalten)})
		}
		return aus, nil
	}
	for _, w := range opt.Tabellen {
		t := dok.Tabelle(w.Index)
		if t == nil {
			return nil, fmt.Errorf("%w: Index %d", ErrTabelleFehlt, w.Index)
		}
		if !w.Include {
			continue
		}
		typen := nurText(t.Spalten)
		for k := range typen {
			if k < len(w.ColumnTypes) && w.ColumnTypes[k] != "" {
				typen[k] = w.ColumnTypes[k]
			}
		}
		aus = append(aus, gewaehlt{tabelle: t, kopfzeilen: min(w.HeaderRows, len(t.Zeilen)), typen: typen})
	}
	// In Lesereihenfolge, nicht in der Reihenfolge der Angaben.
	for i := 1; i < len(aus); i++ {
		for j := i; j > 0 && aus[j].tabelle.Index < aus[j-1].tabelle.Index; j-- {
			aus[j], aus[j-1] = aus[j-1], aus[j]
		}
	}
	return aus, nil
}

func nurText(n int) []string {
	aus := make([]string, n)
	for i := range aus {
		aus[i] = TypText
	}
	return aus
}

// Zellen zaehlt die Zellen, die ein Export mit diesen Optionen schriebe —
// fuer die Grenze HoechstZellen, bevor etwas gebaut wird.
func Zellen(dok Dokument, opt Optionen) (int, error) {
	if err := opt.pruefen(); err != nil {
		return 0, err
	}
	gew, err := auswahl(dok, opt)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, g := range gew {
		n += len(g.tabelle.Zeilen) * g.tabelle.Spalten
	}
	return n, nil
}

func zellenPruefen(dok Dokument, opt Optionen) ([]gewaehlt, error) {
	gew, err := auswahl(dok, opt)
	if err != nil {
		return nil, err
	}
	n := 0
	for _, g := range gew {
		n += len(g.tabelle.Zeilen) * g.tabelle.Spalten
	}
	if n > HoechstZellen {
		return nil, ErrZuGross
	}
	return gew, nil
}

// ============================================================
// Zellwerte
// ============================================================

// zellwert ist eine ausgelegte Zelle.
type zellwert struct {
	art   string // TypText, TypZahl, TypDatum
	text  string
	zahl  float64
	datum time.Time
	// stellen: Nachkommastellen, wie sie im PDF standen („119,00“ → 2).
	// Die Ausgabe haelt sie ein; ein Betrag verliert sonst seine Form
	// (Dev-Probe 29.09.2026: 119,00 → 119, 1.249,50 → 1249,5).
	stellen int
}

// auslegen liest eine Zelle nach dem gewaehlten Typ. Passt der Text nicht,
// bleibt er Text; die Rueckgabe nennt dann den Warnungscode.
func auslegen(text, typ, format string) (zellwert, string) {
	text = strings.TrimSpace(text)
	switch typ {
	case TypZahl:
		if z, ok := zahlLesen(text, format); ok {
			return zellwert{art: TypZahl, text: text, zahl: z, stellen: nachkommastellen(text, format)}, ""
		}
		if text != "" {
			return zellwert{art: TypText, text: text}, WarnungZahlBleibtText
		}
	case TypDatum:
		if d, ok := datumLesen(text); ok {
			return zellwert{art: TypDatum, text: text, datum: d}, ""
		}
		if text != "" {
			return zellwert{art: TypText, text: text}, WarnungDatumBleibtText
		}
	}
	return zellwert{art: TypText, text: text}, ""
}

var (
	// zahlDE: 1.234,56 · 1234,56 · -12,50 · +7. Gruppen zu dreien mit
	// Punkt, Komma als Dezimalzeichen.
	zahlDE = regexp.MustCompile(`^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$`)
	// zahlEN: 1,234.56 · 1234.56 · -12.50.
	zahlEN = regexp.MustCompile(`^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$`)
	// fuehrendeNull: 00123, 007 — eine Kennung, keine Zahl. „0“ und
	// „0,5“ sind erlaubt.
	fuehrendeNull = regexp.MustCompile(`^[+-]?0\d`)
	// reineZahl fuer den Formelschutz: Ziffern mit Vorzeichen und
	// Trennzeichen, in beiden Formaten.
	reineZahl = regexp.MustCompile(`^[+-]?\d+(?:[.,]\d+)*$`)
	datumDE   = regexp.MustCompile(`^(\d{1,2})\.(\d{1,2})\.(\d{4})$`)
	datumISO  = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
)

// zahlLesen liest eine Zahl im Format; fuehrende Nullen sind keine Zahl.
func zahlLesen(text, format string) (float64, bool) {
	text = strings.TrimSpace(text)
	if text == "" || fuehrendeNull.MatchString(text) {
		return 0, false
	}
	var roh string
	switch format {
	case FormatEN:
		if !zahlEN.MatchString(text) {
			return 0, false
		}
		roh = strings.ReplaceAll(text, ",", "")
	default:
		if !zahlDE.MatchString(text) {
			return 0, false
		}
		roh = strings.ReplaceAll(strings.ReplaceAll(text, ".", ""), ",", ".")
	}
	z, err := strconv.ParseFloat(roh, 64)
	return z, err == nil
}

// datumLesen nimmt TT.MM.JJJJ oder JJJJ-MM-TT — nichts, was zwei Lesarten
// hat.
func datumLesen(text string) (time.Time, bool) {
	text = strings.TrimSpace(text)
	var jahr, monat, tag int
	switch {
	case datumDE.MatchString(text):
		m := datumDE.FindStringSubmatch(text)
		tag, _ = strconv.Atoi(m[1])
		monat, _ = strconv.Atoi(m[2])
		jahr, _ = strconv.Atoi(m[3])
	case datumISO.MatchString(text):
		m := datumISO.FindStringSubmatch(text)
		jahr, _ = strconv.Atoi(m[1])
		monat, _ = strconv.Atoi(m[2])
		tag, _ = strconv.Atoi(m[3])
	default:
		return time.Time{}, false
	}
	if monat < 1 || monat > 12 || tag < 1 || tag > 31 || jahr < 1000 {
		return time.Time{}, false
	}
	d := time.Date(jahr, time.Month(monat), tag, 0, 0, 0, 0, time.UTC)
	if d.Day() != tag || int(d.Month()) != monat {
		// 31.02. rutscht in den Maerz — kein Datum.
		return time.Time{}, false
	}
	return d, true
}

// nachkommastellen zaehlt die Stellen hinter dem Dezimalzeichen des
// Formats; nur fuer Texte, die zahlLesen angenommen hat.
func nachkommastellen(text, format string) int {
	trenner := ","
	if format == FormatEN {
		trenner = "."
	}
	if i := strings.LastIndex(strings.TrimSpace(text), trenner); i >= 0 {
		return len(strings.TrimSpace(text)) - i - 1
	}
	return 0
}

// zahlText schreibt eine Zahl im Format ohne Tausenderzeichen: de
// „1234,56“, en „1234.56“ -- mit so vielen Nachkommastellen, wie im PDF
// standen (stellen), ganze Zahlen ohne.
func zahlText(z float64, format string, stellen int) string {
	s := strconv.FormatFloat(z, 'f', stellen, 64)
	if format == FormatDE {
		s = strings.ReplaceAll(s, ".", ",")
	}
	return s
}

// warnungen sammelt Warnungen mit Zaehler je Code, in der Reihenfolge des
// ersten Auftretens.
type warnungen struct {
	liste []Warnung
}

func (w *warnungen) zaehlen(code string) {
	for i := range w.liste {
		if w.liste[i].Code == code {
			w.liste[i].Count++
			return
		}
	}
	w.liste = append(w.liste, Warnung{Code: code, Count: 1})
}

func (w *warnungen) hinzu(warnung Warnung) { w.liste = append(w.liste, warnung) }

func (w *warnungen) ergebnis() []Warnung {
	if w.liste == nil {
		return []Warnung{}
	}
	return w.liste
}

// bilderWarnung zaehlt die Seiten mit Bildern.
func bilderWarnung(dok Dokument, w *warnungen) {
	var seiten []int
	for _, s := range dok.Seiten {
		if s.Bildanteil > 0 {
			seiten = append(seiten, s.Nr)
		}
	}
	if len(seiten) > 0 {
		w.hinzu(Warnung{Code: WarnungBilder, Count: len(seiten), Pages: seiten})
	}
}

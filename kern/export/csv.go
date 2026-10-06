// SPDX-License-Identifier: Apache-2.0

package export

import (
	"bufio"
	"io"
	"strings"
)

// CSV schreibt EINE Tabelle (opt.CSVTabelle) nach RFC 4180: Felder in
// Anfuehrungszeichen, wenn sie Trennzeichen, Anfuehrungszeichen oder
// Zeilenumbrueche enthalten; Anfuehrungszeichen verdoppelt; Zeilen mit
// CRLF; davor die UTF-8-Byteordnungsmarke, damit Excel die Kodierung
// erkennt.
//
// Formelschutz: Ein Textfeld, das mit =, +, -, @, Tab oder CR beginnt und
// keine reine Zahl ist, bekommt ein vorangestelltes ' — sonst rechnete
// eine Tabellenkalkulation „=SUMME(A1)“ aus einer Rechnung aus. Die
// Anpassung wird gezaehlt (WarnungFormelschutz). „-12,50“ ist eine reine
// Zahl und bleibt.
func CSV(w io.Writer, dok Dokument, opt Optionen) ([]Warnung, error) {
	if err := opt.pruefen(); err != nil {
		return nil, err
	}
	gew, err := zellenPruefen(dok, opt)
	if err != nil {
		return nil, err
	}
	var g *gewaehlt
	for i := range gew {
		if gew[i].tabelle.Index == opt.CSVTabelle {
			g = &gew[i]
		}
	}
	if g == nil {
		return nil, ErrTabelleFehlt
	}
	var warn warnungen
	if len(gew) > 1 {
		warn.hinzu(Warnung{Code: WarnungCSVEineTabelle, Count: len(gew) - 1})
	}
	aus := bufio.NewWriter(w)
	if _, err := aus.WriteString("\xEF\xBB\xBF"); err != nil {
		return nil, err
	}
	for zi, zeile := range g.tabelle.Zeilen {
		felder := make([]string, len(zeile))
		for k, z := range zeile {
			// Kopfzeilen sind Text, was immer die Spalte ist.
			typ := TypText
			if zi >= g.kopfzeilen && k < len(g.typen) {
				typ = g.typen[k]
			}
			wert, code := auslegen(z.Text, typ, opt.Zahlenformat)
			if code != "" {
				warn.zaehlen(code)
			}
			felder[k] = csvFeld(wert, opt, &warn)
		}
		if _, err := aus.WriteString(strings.Join(felder, opt.CSVTrenner) + "\r\n"); err != nil {
			return nil, err
		}
	}
	if err := aus.Flush(); err != nil {
		return nil, err
	}
	return warn.ergebnis(), nil
}

// csvFeld schreibt einen Wert als Feld — mit Formelschutz und
// Anfuehrungszeichen, wo noetig.
func csvFeld(z zellwert, opt Optionen, warn *warnungen) string {
	var s string
	switch z.art {
	case TypZahl:
		s = zahlText(z.zahl, opt.Zahlenformat, z.stellen)
	case TypDatum:
		s = z.datum.Format("2006-01-02")
	default:
		s = z.text
		if formelverdaechtig(s) {
			s = "'" + s
			warn.zaehlen(WarnungFormelschutz)
		}
	}
	if strings.ContainsAny(s, opt.CSVTrenner+"\"\r\n") {
		s = `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

// formelverdaechtig: beginnt mit =, +, -, @, Tab oder CR und ist keine
// reine Zahl.
func formelverdaechtig(s string) bool {
	if s == "" {
		return false
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return !reineZahl.MatchString(s)
	}
	return false
}

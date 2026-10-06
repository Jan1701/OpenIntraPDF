// SPDX-License-Identifier: Apache-2.0

package export

import (
	"fmt"
	"io"
	"strings"

	"github.com/xuri/excelize/v2"
)

// XLSX schreibt je gewaehlter Tabelle ein Arbeitsblatt „Tabelle N“ (N =
// Index + 1). Kopfzeilen fett. Zelltypen nach den gewaehlten Spaltentypen:
// Text als Zeichenkette gesetzt (SetCellStr — Excelize raet dann nicht),
// Zahlen als Zahl, Daten als Datum mit Tagesformat. Keine Formeln.
func XLSX(w io.Writer, dok Dokument, opt Optionen) ([]Warnung, error) {
	if err := opt.pruefen(); err != nil {
		return nil, err
	}
	gew, err := zellenPruefen(dok, opt)
	if err != nil {
		return nil, err
	}
	if len(gew) == 0 {
		return nil, ErrTabelleFehlt
	}
	f := excelize.NewFile()
	defer f.Close()
	fett, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}
	tagesformat := "DD.MM.YYYY"
	datum, err := f.NewStyle(&excelize.Style{CustomNumFmt: &tagesformat})
	if err != nil {
		return nil, err
	}
	// Zahlformat je Stellenzahl: Der Wert bleibt eine Zahl, die Anzeige
	// behaelt die Nachkommastellen aus dem PDF (119,00 statt 119).
	zahlformate := map[int]int{}
	zahlformat := func(stellen int) (int, error) {
		if stellen <= 0 {
			return 0, nil
		}
		if id, ok := zahlformate[stellen]; ok {
			return id, nil
		}
		muster := "#,##0." + strings.Repeat("0", stellen)
		id, err := f.NewStyle(&excelize.Style{CustomNumFmt: &muster})
		zahlformate[stellen] = id
		return id, err
	}
	var warn warnungen
	erstes := f.GetSheetName(0)
	for i, g := range gew {
		name := fmt.Sprintf("Tabelle %d", g.tabelle.Index+1)
		if i == 0 {
			if err := f.SetSheetName(erstes, name); err != nil {
				return nil, err
			}
		} else if _, err := f.NewSheet(name); err != nil {
			return nil, err
		}
		for zi, zeile := range g.tabelle.Zeilen {
			for k, z := range zeile {
				zelle, err := excelize.CoordinatesToCellName(k+1, zi+1)
				if err != nil {
					return nil, err
				}
				// Kopfzeilen sind Text, was immer die Spalte ist.
				typ := TypText
				if zi >= g.kopfzeilen && k < len(g.typen) {
					typ = g.typen[k]
				}
				wert, code := auslegen(z.Text, typ, opt.Zahlenformat)
				if code != "" {
					warn.zaehlen(code)
				}
				stil := 0
				switch wert.art {
				case TypZahl:
					if err = f.SetCellFloat(name, zelle, wert.zahl, -1, 64); err == nil {
						stil, err = zahlformat(wert.stellen)
					}
				case TypDatum:
					err = f.SetCellValue(name, zelle, wert.datum)
					stil = datum
				default:
					if wert.text == "" {
						continue
					}
					err = f.SetCellStr(name, zelle, wert.text)
				}
				if err != nil {
					return nil, err
				}
				if zi < g.kopfzeilen {
					stil = fett
				}
				if stil != 0 {
					if err := f.SetCellStyle(name, zelle, zelle, stil); err != nil {
						return nil, err
					}
				}
			}
		}
	}
	if err := f.Write(w); err != nil {
		return nil, err
	}
	return warn.ergebnis(), nil
}

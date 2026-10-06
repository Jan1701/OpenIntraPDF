// SPDX-License-Identifier: Apache-2.0

package main

import (
	"strings"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
)

// auswerten macht aus den Bloecken einer erkannten Seite die flache Liste
// fuer dokument.TextebeneBauen — ohne Leere — und zaehlt, wie viele
// Woerter unsicher sind (Konf unter erkennung.UnsichereKonfidenz; -1 zaehlt nicht).
func auswerten(bloecke []erkennung.Block) (ws []dokument.Wort, unsicher int) {
	for _, b := range bloecke {
		for _, z := range b.Zeilen {
			for _, w := range z.Woerter {
				text := strings.TrimSpace(w.Text)
				if text == "" {
					continue
				}
				ws = append(ws, dokument.Wort{X0: w.X0, Y0: w.Y0, X1: w.X1, Y1: w.Y1, Text: text})
				if w.Konf >= 0 && w.Konf < erkennung.UnsichereKonfidenz {
					unsicher++
				}
			}
		}
	}
	return ws, unsicher
}

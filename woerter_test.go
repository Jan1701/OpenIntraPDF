// SPDX-License-Identifier: Apache-2.0

package main

import (
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
)

func TestAuswerten(t *testing.T) {
	bloecke := []erkennung.Block{{Zeilen: []erkennung.Zeile{
		{Woerter: []erkennung.Wort{{X0: 1, Y0: 2, X1: 3, Y1: 4, Text: "Klar", Konf: 96}, {Text: "  ", Konf: 10}}},
		{Woerter: []erkennung.Wort{{X0: 5, Y0: 6, X1: 7, Y1: 8, Text: "Unsicher", Konf: 49.9}, {Text: "Ebene", Konf: -1}}},
	}}}
	ws, unsicher := auswerten(bloecke)
	if len(ws) != 3 || unsicher != 1 {
		t.Fatalf("Auswerten = %d Woerter, %d unsicher", len(ws), unsicher)
	}
	if ws[1].Text != "Unsicher" || ws[1].X0 != 5 || ws[1].Y1 != 8 {
		t.Errorf("Wort = %+v", ws[1])
	}
}

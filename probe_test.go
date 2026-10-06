// SPDX-License-Identifier: Apache-2.0

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// TestProbedateienSchreiben legt synthetische Probe-PDFs in den Ordner aus
// OPENINTRAPDF_PROBE_AUSGABE — fuer den Rundlauf von Hand in der App
// (Jan: ~/Desktop/OpenIntraPDF-Probe). Ohne die Variable tut er nichts.
//
//	OPENINTRAPDF_PROBE_AUSGABE=~/Desktop/OpenIntraPDF-Probe go test -run TestProbedateienSchreiben .
func TestProbedateienSchreiben(t *testing.T) {
	ordner := os.Getenv("OPENINTRAPDF_PROBE_AUSGABE")
	if ordner == "" {
		t.Skip("OPENINTRAPDF_PROBE_AUSGABE nicht gesetzt")
	}
	if err := os.MkdirAll(ordner, 0o755); err != nil {
		t.Fatal(err)
	}
	dateien := map[string][]byte{
		// Ein Scan mit Text (das Bild aus testdata, erfundene Zeilen), ohne Textebene.
		"probe-scan.pdf": scanPDF(t, scanBild(t)),
		// Korpus: Textseiten, Anmerkungen, Formular, Lesezeichen, alles zusammen.
		"probe-text.pdf":        korpus.Textseiten(5),
		"probe-anmerkungen.pdf": korpus.MitAnmerkungen(),
		"probe-formular.pdf":    korpus.MitFormular(),
		"probe-lesezeichen.pdf": korpus.MitLesezeichen(),
		"probe-voll.pdf":        korpus.Voll(),
		"probe-rechnung.pdf":    korpus.Rechnung(),
	}
	for name, inhalt := range dateien {
		if err := os.WriteFile(filepath.Join(ordner, name), inhalt, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("%d Probedateien nach %s geschrieben", len(dateien), ordner)
}

// SPDX-License-Identifier: Apache-2.0

package korpus

import (
	"bytes"
	"testing"
)

// Der Korpus entsteht vollstaendig, mit eindeutigen Namen, und jede Datei
// ist ein PDF.
func TestKorpusVollstaendig(t *testing.T) {
	alle, err := Alle()
	if err != nil {
		t.Fatal(err)
	}
	if len(alle) != 16 {
		t.Errorf("%d Dateien, erwartet 16", len(alle))
	}
	namen := map[string]bool{}
	for _, d := range alle {
		if namen[d.Name] {
			t.Errorf("Name %q doppelt", d.Name)
		}
		namen[d.Name] = true
		if !bytes.HasPrefix(d.Inhalt, []byte("%PDF-")) {
			t.Errorf("%s beginnt nicht mit %%PDF-", d.Name)
		}
	}
}

// Gleicher Aufruf, gleiche Bytes — die Tests duerfen sich darauf
// verlassen (ausser bei den verschluesselten Proben: AES waehlt Zufall).
func TestKorpusIstStabil(t *testing.T) {
	if !bytes.Equal(Voll(), Voll()) {
		t.Error("Voll() liefert bei jedem Aufruf andere Bytes")
	}
}

func TestMarken(t *testing.T) {
	m, err := Marken(Textseiten(3))
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 3 || m[0] != "SEITE-01" || m[2] != "SEITE-03" {
		t.Errorf("Marken %v", m)
	}
}

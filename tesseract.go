// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
)

// Das mitgelieferte Tesseract (Vertrag Etappe 6): Die App muss auf einem
// Mac ohne Homebrew erkennen koennen. Im Paket liegt das Programm neben
// dem eigenen unter Contents/MacOS/tesseract, seine Bibliotheken unter
// Contents/Frameworks (Ladepfade @executable_path/../Frameworks), die
// Sprachdaten unter Contents/Resources/tessdata. Windows folgt demselben
// Weg mit tesseract.exe neben der App und tessdata daneben.
//
// Nur zum Entwickeln, wenn kein Paket gebaut ist: OPENINTRAPDF_TESSERACT
// (Pfad zum Programm) und OPENINTRAPDF_TESSDATA, sonst das Programm aus
// dem PATH. Die Abnahme laeuft mit dem mitgelieferten und ohne Homebrew im
// PATH.

// tesseractFinden bestimmt Programm und Sprachdaten.
func tesseractFinden() erkennung.Tesseract {
	t := erkennung.Tesseract{Programm: "tesseract", Sprachen: erkennung.VorgabeSprachen}
	if exe, err := os.Executable(); err == nil {
		exe, _ = filepath.EvalSymlinks(exe)
		ordner := filepath.Dir(exe)
		programm := filepath.Join(ordner, tesseractName)
		tessdata := filepath.Join(ordner, "..", "Resources", "tessdata")
		if istDatei(programm) {
			t.Programm = programm
			if istOrdner(tessdata) {
				t.Tessdata = filepath.Clean(tessdata)
			}
			return t
		}
	}
	if p := os.Getenv("OPENINTRAPDF_TESSERACT"); p != "" {
		t.Programm = p
	}
	if p := os.Getenv("OPENINTRAPDF_TESSDATA"); p != "" {
		t.Tessdata = p
	}
	return t
}

func istDatei(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func istOrdner(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// tesseractPruefen fragt das Programm einmal, ob es laeuft und die
// Sprachen hat. Das Ergebnis bestimmt capabilities.ocr.
func tesseractPruefen(t erkennung.Tesseract) (erkennung.Zustand, error) {
	ctx, abbruch := context.WithTimeout(context.Background(), 20*time.Second)
	defer abbruch()
	return t.Zustand(ctx)
}

// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package main

import "path/filepath"

// tesseractOrte: im Mac-Paket liegt das Programm neben dem eigenen
// (Contents/MacOS/tesseract), die Sprachdaten unter Contents/Resources/tessdata.
func tesseractOrte(ordner string) (programm, tessdata string) {
	return filepath.Join(ordner, "tesseract"), filepath.Join(ordner, "..", "Resources", "tessdata")
}

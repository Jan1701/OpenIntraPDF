// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !windows

package main

import "path/filepath"

// tesseractOrte: unter Linux kommt Tesseract aus der Distribution
// (/usr/bin/tesseract neben /usr/bin/openintrapdf) und kennt seine
// Sprachdaten selbst.
func tesseractOrte(ordner string) (programm, tessdata string) {
	return filepath.Join(ordner, "tesseract"), ""
}

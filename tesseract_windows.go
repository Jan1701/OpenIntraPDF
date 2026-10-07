// SPDX-License-Identifier: Apache-2.0

//go:build windows

package main

import "path/filepath"

// tesseractOrte: Unter Windows liegt alles in einem Unterordner neben der
// App -- tesseract\tesseract.exe, seine DLLs daneben (Windows sucht sie im
// Ordner des Programms) und tesseract\tessdata. So stehen die rund
// dreissig DLLs nicht lose neben OpenIntraPDF.exe (bauen-windows.sh).
func tesseractOrte(ordner string) (programm, tessdata string) {
	t := filepath.Join(ordner, "tesseract")
	return filepath.Join(t, "tesseract.exe"), filepath.Join(t, "tessdata")
}

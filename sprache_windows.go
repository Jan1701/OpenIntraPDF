// SPDX-License-Identifier: Apache-2.0

//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// systemSprachen: die bevorzugten Anzeigesprachen des Benutzers
// (GetUserPreferredUILanguages, MUI_LANGUAGE_NAME → „de-DE“ …).
func systemSprachen() []string {
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserPreferredUILanguages")
	if proc.Find() != nil {
		return nil
	}
	const muiLanguageName = 0x8
	var anzahl, groesse uint32
	if r, _, _ := proc.Call(muiLanguageName, uintptr(unsafe.Pointer(&anzahl)), 0, uintptr(unsafe.Pointer(&groesse))); r == 0 || groesse == 0 {
		return nil
	}
	puffer := make([]uint16, groesse)
	if r, _, _ := proc.Call(muiLanguageName, uintptr(unsafe.Pointer(&anzahl)), uintptr(unsafe.Pointer(&puffer[0])), uintptr(unsafe.Pointer(&groesse))); r == 0 {
		return nil
	}
	// Doppelt nullterminierte Liste
	var liste []string
	start := 0
	for i, z := range puffer {
		if z == 0 {
			if i > start {
				liste = append(liste, syscall.UTF16ToString(puffer[start:i]))
			}
			start = i + 1
		}
	}
	return liste
}

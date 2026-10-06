// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !linux

package main

// schnelldruckBefehl: kein Weg ohne Dialog — die Oberflaeche zeigt den
// Knopf nicht.
func schnelldruckBefehl() (string, bool) { return "", false }

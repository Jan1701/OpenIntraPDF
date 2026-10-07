// SPDX-License-Identifier: Apache-2.0

package main

import "testing"

func TestFensterGroesse(t *testing.T) {
	for _, f := range []struct {
		name         string
		b, h, bb, bh int
		wantB, wantH int
		anders       bool
	}{
		{"grosser Bildschirm: bleibt", 1280, 860, 2560, 1440, 1280, 860, false},
		{"Test-VM 1280x800: kleiner und zentriert", 1280, 860, 1280, 800, 1152, 680, true},
		{"Laptop 1366x768", 1280, 860, 1366, 768, 1280, 652, true},
		{"Full-HD passt", 1280, 860, 1920, 1080, 1280, 860, false},
		{"ohne Bildschirmangabe nichts tun", 1280, 860, 0, 0, 1280, 860, false},
	} {
		b, h, anders := fensterGroesse(f.b, f.h, f.bb, f.bh)
		if b != f.wantB || h != f.wantH || anders != f.anders {
			t.Errorf("%s: %dx%d %v, erwartet %dx%d %v", f.name, b, h, anders, f.wantB, f.wantH, f.anders)
		}
	}
}

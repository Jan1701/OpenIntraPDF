// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Fenster an den Bildschirm anpassen (07.10.2026).
//
// Das Fenster startet mit 1280 × 860. Auf einem Bildschirm mit 800 Pixeln
// Hoehe (Jans Windows-Test-VM, viele Laptops) zentrierte Windows es so, dass
// die Titelleiste oberhalb des Bildschirms lag: Jan: „ich komme oben nicht an
// die leiste und kann es nicht verschieben oder maximieren.“ Ist das Fenster
// groesser als der Bildschirm, wird es beim Start verkleinert und zentriert.

// fensterGroesse liefert die neue Groesse, wenn das Fenster nicht auf den
// Bildschirm passt (Platz fuer Taskleiste bzw. Menueleiste bleibt).
func fensterGroesse(breite, hoehe, bildBreite, bildHoehe int) (int, int, bool) {
	if bildBreite <= 0 || bildHoehe <= 0 {
		return breite, hoehe, false
	}
	nb, nh := breite, hoehe
	if breite > bildBreite*95/100 {
		nb = bildBreite * 90 / 100
	}
	if hoehe > bildHoehe*88/100 {
		nh = bildHoehe * 85 / 100
	}
	return nb, nh, nb != breite || nh != hoehe
}

// domBereit passt das Fenster an, sobald es steht (OnDomReady).
func (a *App) domBereit(ctx context.Context) {
	bildschirme, err := runtime.ScreenGetAll(ctx)
	if err != nil || len(bildschirme) == 0 {
		return
	}
	b := bildschirme[0]
	for _, s := range bildschirme {
		if s.IsCurrent {
			b = s
			break
		}
		if s.IsPrimary {
			b = s
		}
	}
	breite, hoehe := runtime.WindowGetSize(ctx)
	if nb, nh, anders := fensterGroesse(breite, hoehe, b.Size.Width, b.Size.Height); anders {
		runtime.WindowSetSize(ctx, nb, nh)
		runtime.WindowCenter(ctx)
	}
}

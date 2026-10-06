// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"net/http"
	"os/exec"
)

// Schnelldruck (Etappe 8): die Datei ohne Dialog an den Standarddrucker.
// Welches Programm das tut, sagt schnelldruckBefehl je System (Linux lp,
// macOS lpr); auf anderen Systemen gibt es den Weg nicht. Die Oberflaeche
// bietet den Knopf nur an, wenn schnelldruckMoeglich das Programm findet.

// schnelldruckMoeglich: Es gibt einen Befehl, und er ist installiert.
func schnelldruckMoeglich() bool {
	name, ok := schnelldruckBefehl()
	if !ok {
		return false
	}
	_, err := exec.LookPath(name)
	return err == nil
}

// schnelldruckAusfuehren ruft den Befehl mit dem Pfad auf und wartet auf
// ihn — lp und lpr uebergeben nur an die Warteschlange und kehren sofort
// zurueck.
func schnelldruckAusfuehren(pfad string) error {
	name, ok := schnelldruckBefehl()
	if !ok {
		return fehler(http.StatusUnprocessableEntity, "pdf.unsupported", map[string]any{"reason": "no_quick_print"})
	}
	programm, err := exec.LookPath(name)
	if err != nil {
		return fehler(http.StatusUnprocessableEntity, "pdf.unsupported", map[string]any{"reason": "no_quick_print"})
	}
	aus, err := exec.Command(programm, pfad).CombinedOutput()
	if err != nil {
		return intern(fmt.Errorf("%s: %v: %s", name, err, aus))
	}
	return nil
}

// SPDX-License-Identifier: Apache-2.0

//go:build linux

package main

import (
	"context"
	"os/exec"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// druckenUebergeben gibt die Kopie an Okular, das den Druckdialog von KDE
// zeigt und sich danach wieder schliesst (OpenIntraOS, 01.10.2026).
//
// Nicht ueber xdg-open wie auf den anderen Systemen: Ist OpenIntraPDF
// selbst das Programm fuer PDF, oeffnete sich nur wieder OpenIntraPDF.
// Ohne Okular bleibt dieser Weg trotzdem der Rueckfall.
func druckenUebergeben(ctx context.Context, pfad string) error {
	okular, err := exec.LookPath("okular")
	if err != nil {
		runtime.BrowserOpenURL(ctx, "file://"+pfad)
		return nil
	}
	cmd := exec.Command(okular, "--print-and-exit", pfad)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

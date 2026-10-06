// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !linux

package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// druckenUebergeben oeffnet die Kopie im Programm, das das System fuer PDF
// eingetragen hat; dort geht der Druck von Hand.
func druckenUebergeben(ctx context.Context, pfad string) error {
	runtime.BrowserOpenURL(ctx, "file://"+pfad)
	return nil
}

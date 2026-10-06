// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework PDFKit
#include <stdlib.h>
#import <Cocoa/Cocoa.h>
#import <PDFKit/PDFKit.h>

// pdfDrucken zeigt den Druckdialog des Systems fuer eine PDF-Datei, als
// Blatt am Fenster der App. 0 = Dialog gezeigt, 1 = Datei nicht lesbar,
// 2 = keine Druckoperation.
static int pdfDrucken(const char *pfad, const char *titel) {
	NSString *p = [NSString stringWithUTF8String:pfad];
	NSString *t = [NSString stringWithUTF8String:titel];
	__block int ergebnis = 0;
	void (^zeigen)(void) = ^{
		PDFDocument *doc = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:p]];
		if (doc == nil) { ergebnis = 1; return; }
		NSPrintInfo *info = [[NSPrintInfo sharedPrintInfo] copy];
		NSPrintOperation *op = [doc printOperationForPrintInfo:info
		                                           scalingMode:kPDFPrintPageScaleDownToFit
		                                            autoRotate:YES];
		if (op == nil) { ergebnis = 2; return; }
		op.jobTitle = t;
		op.showsPrintPanel = YES;
		op.showsProgressPanel = YES;
		NSWindow *fenster = [NSApp mainWindow] ?: [NSApp keyWindow];
		if (fenster != nil) {
			[op runOperationModalForWindow:fenster delegate:nil didRunSelector:NULL contextInfo:NULL];
		} else {
			[op runOperation];
		}
	};
	// AppKit nur im Hauptfaden. Die Bindungen von Wails laufen in einer
	// Goroutine; das Blatt kehrt sofort zurueck, also blockiert nichts.
	if ([NSThread isMainThread]) {
		zeigen();
	} else {
		dispatch_sync(dispatch_get_main_queue(), zeigen);
	}
	return ergebnis;
}
*/
import "C"

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// druckenUebergeben zeigt den Druckdialog des Systems direkt in der App
// (PDFKit): dieselbe Vorschau, dieselben Drucker und „Als PDF sichern“
// wie in der Vorschau-App, aber ohne den Umweg dorthin (Jan, 01.10.2026:
// „wenn ich auf drucken gehe dann oeffnet sich im moment die vorschau das
// ist auch eher nicht optimal“). Gedruckt wird die PDF selbst, nicht ein
// Bildschirmabzug.
//
// Nur wenn PDFKit die Datei nicht annimmt, geht sie wie bisher an die
// Vorschau.
func druckenUebergeben(ctx context.Context, pfad string) error {
	if err := druckenNativ(pfad); err == nil {
		return nil
	}
	if err := exec.Command("/usr/bin/open", "-a", "Preview", pfad).Run(); err == nil {
		return nil
	}
	runtime.BrowserOpenURL(ctx, "file://"+pfad)
	return nil
}

func druckenNativ(pfad string) error {
	cPfad := C.CString(pfad)
	defer C.free(unsafe.Pointer(cPfad))
	titel := strings.TrimSuffix(filepath.Base(pfad), filepath.Ext(pfad))
	cTitel := C.CString(titel)
	defer C.free(unsafe.Pointer(cTitel))
	switch C.pdfDrucken(cPfad, cTitel) {
	case 0:
		return nil
	case 1:
		return fmt.Errorf("PDFKit kann %s nicht lesen", filepath.Base(pfad))
	default:
		return fmt.Errorf("PDFKit liefert keine Druckoperation")
	}
}

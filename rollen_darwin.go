// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package main

// Die Standardmenues von Wails v2 (App, Bearbeiten, Fenster) traegt Wails
// mit festen englischen Titeln ein (internal/frontend/desktop/darwin/
// WailsMenu.m: „Hide“, „Edit“, „Undo“, „Window“, „Minimize“ …). Neben
// unseren deutschen Menues stand so ein Gemisch in der Leiste (Jan,
// 06.10.2026). Hier werden die Eintraege nach ihrer Aktion umbenannt -- die
// Aktion bleibt, damit Kopieren und Einsetzen weiter in der Webansicht
// wirken. Auch den Text des Info-Fensters setzt diese Stelle: Wails haelt ihn
// am WailsContext (aboutDescription), dem Ziel des Eintrags „Über …“.

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#include <stdlib.h>

static NSString *oipdfText(NSDictionary *t, NSString *k) {
	id v = t[k];
	return [v isKindOfClass:[NSString class]] && [v length] > 0 ? v : nil;
}

static BOOL oipdfEnthaelt(NSMenu *m, SEL aktion) {
	for (NSMenuItem *i in m.itemArray) {
		if (i.action == aktion) return YES;
	}
	return NO;
}

static void oipdfMenueUmbenennen(NSMenu *m, NSDictionary *t, NSDictionary *aktionen) {
	for (NSMenuItem *i in m.itemArray) {
		if (i.action != NULL) {
			NSString *k = aktionen[NSStringFromSelector(i.action)];
			NSString *neu = k ? oipdfText(t, k) : nil;
			if (neu) i.title = neu;
			if (i.action == NSSelectorFromString(@"About") && i.target) {
				NSString *ueber = oipdfText(t, @"ueberText");
				if (ueber && [i.target respondsToSelector:NSSelectorFromString(@"setAboutDescription:")]) {
					[i.target setValue:ueber forKey:@"aboutDescription"];
				}
			}
		}
		NSMenu *unter = i.submenu;
		if (unter) {
			NSString *titel = nil;
			if (oipdfEnthaelt(unter, @selector(undo:))) titel = oipdfText(t, @"bearbeiten");
			else if (oipdfEnthaelt(unter, NSSelectorFromString(@"startSpeaking:"))) titel = oipdfText(t, @"sprachausgabe");
			else if (oipdfEnthaelt(unter, @selector(performMiniaturize:))) titel = oipdfText(t, @"fenster");
			if (titel) { unter.title = titel; i.title = titel; }
			oipdfMenueUmbenennen(unter, t, aktionen);
		}
	}
}

// Bevorzugte Sprachen des Benutzers, durch Zeilenumbruch getrennt (der
// Aufrufer gibt den Speicher frei).
static char *oipdfSprachen(void) {
	NSString *liste = [[NSLocale preferredLanguages] componentsJoinedByString:@"\n"];
	return strdup(liste ? [liste UTF8String] : "");
}

static void oipdfRollenUebersetzen(const char *json) {
	NSData *daten = [NSData dataWithBytes:json length:strlen(json)];
	NSDictionary *t = [NSJSONSerialization JSONObjectWithData:daten options:0 error:nil];
	if (![t isKindOfClass:[NSDictionary class]]) return;
	// Hinter das Neusetzen des Menues durch Wails (UpdateApplicationMenu
	// laeuft ebenfalls per dispatch_async auf dem Haupt-Thread).
	dispatch_async(dispatch_get_main_queue(), ^{
		NSDictionary *aktionen = @{
			@"About": @"ueber", @"hide:": @"ausblenden", @"hideOtherApplications:": @"andereAusblenden",
			@"unhideAllApplications:": @"alleEinblenden", @"Quit": @"beenden",
			@"undo:": @"widerrufen", @"redo:": @"wiederholen", @"cut:": @"ausschneiden", @"copy:": @"kopieren",
			@"paste:": @"einsetzen", @"pasteAsRichText:": @"einsetzenStil", @"delete:": @"loeschen",
			@"selectAll:": @"allesAuswaehlen", @"startSpeaking:": @"sprechenStarten", @"stopSpeaking:": @"sprechenStoppen",
			@"performMiniaturize:": @"dock", @"performZoom:": @"zoomen", @"enterFullScreenMode:": @"vollbild",
		};
		NSMenu *haupt = [NSApp mainMenu];
		if (haupt) oipdfMenueUmbenennen(haupt, t, aktionen);
	});
}
*/
import "C"

import (
	"encoding/json"
	"strings"
	"unsafe"
)

// systemSprachen: [NSLocale preferredLanguages], dieselbe Liste, die die
// Webansicht als navigator.languages meldet.
func systemSprachen() []string {
	s := C.oipdfSprachen()
	defer C.free(unsafe.Pointer(s))
	return strings.Split(C.GoString(s), "\n")
}

// rollenUebersetzen benennt die Wails-Standardmenues und das Info-Fenster
// mit den Texten der Oberflaeche um (Schluessel wie menueStandard).
func rollenUebersetzen(texte map[string]string) {
	b, err := json.Marshal(texte)
	if err != nil {
		return
	}
	s := C.CString(string(b))
	defer C.free(unsafe.Pointer(s))
	C.oipdfRollenUebersetzen(s)
}

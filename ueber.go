// SPDX-License-Identifier: Apache-2.0

package main

import "strings"

// Info-Fenster („Über OpenIntraPDF“) und Urheber (06.10.2026).
//
// Jan: „dann bin ich nirgends erwähnt“. Der Urheber steht jetzt im
// Info-Fenster, im Lizenzdialog und in den Paketdaten (wails.json:
// Copyright und Hersteller, Info.plist NSHumanReadableCopyright).

// Fassung und Bau setzt bauen.sh per -ldflags "-X main.bau=…" aus der
// BAUNUMMER des Repositorys; ohne das (go test, go run) bleibt der Bau leer.
var (
	fassung = "0.9.4"
	bau     = ""
)

const urheber = "© 2026 Jan Günther"

// ueberStandard ist der deutsche Text des Info-Fensters, bis die Oberflaeche
// ihn in der Sprache des Systems schickt (menue.go, Schluessel ueberText).
var ueberStandard = ueberText(
	"PDF lesen, Seiten ordnen, kommentieren, Text erkennen, exportieren, binden.",
	fassungsZeile("Version {{version}} (Bau {{bau}})"),
	"Freie Software unter der Apache-Lizenz 2.0. Die Lizenzen der mitgelieferten Teile stehen unter Hilfe → Lizenzen.",
)

// ueberText setzt das Info-Fenster zusammen: Beschreibung, Fassung, Urheber,
// Lizenz.
func ueberText(beschreibung, fassungZeile, lizenz string) string {
	return beschreibung + "\n\n" + fassungZeile + "\n" + urheber + "\n\n" + lizenz
}

// fassungsZeile fuellt die Vorlage; ohne Baunummer (go run, Tests) steht
// „–“ wie in der Oberflaeche (src/desktop/menue.ts).
func fassungsZeile(vorlage string) string {
	b := bau
	if b == "" {
		b = "–"
	}
	return strings.ReplaceAll(strings.ReplaceAll(vorlage, "{{version}}", fassung), "{{bau}}", b)
}

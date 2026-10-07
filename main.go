// SPDX-License-Identifier: Apache-2.0

// OpenIntraPDF fuer den Schreibtisch (Vertrag Etappe 6): derselbe
// Arbeitsplatz wie in OpenIntraHub (core/frontend/src/openintrapdf) und
// derselbe Go-Kern (openintrapdf), als Wails-App mit lokalen Dateien
// statt Drive. Ein weiterer Gastgeber — keine zweite Oberflaeche, kein
// zweiter Kern.
//
// Aufbau:
//
//	main.go       Wails, Fenster, Menue, Oeffnen aus dem Finder, Drag & Drop
//	app.go        die Bindungen (Fachfunktionen, wie die Drive-Routen)
//	ablage.go     Kennungen statt Pfade, atomares Speichern, Konfliktschutz
//	vorgaenge.go  Idempotenzschluessel je Sitzung
//	auftraege.go  Texterkennung und Analyse als Goroutinen mit Abbruch
//	info.go       Inspektion, Faehigkeiten, Seitenarten
//	tesseract.go  das mitgelieferte Tesseract finden
//	zuletzt.go    zuletzt geoeffnete Dateien
//
// Die Oberflaeche liegt im Frontend von OpenIntraHub (desktop.html,
// src/desktop) und wird nach frontend/dist gebaut; sie ist hier
// eingebettet. Kein Netzwerkzugriff, kein Entwicklungsserver im Release.
package main

import (
	"embed"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := neueApp()
	// Menue gleich in der Sprache des Systems (sprache.go): Unter Linux
	// laesst es sich spaeter nicht mehr tauschen.
	app.menueTexte = startTexte(assets, systemSprachen())
	// Dateien aus der Kommandozeile (open … --args datei.pdf, unter Linux
	// Exec=openintrapdf %F) wie aus dem Finder — nur .pdf, alles andere ist
	// keine Datei fuer uns.
	for _, arg := range os.Args[1:] {
		if strings.EqualFold(filepath.Ext(arg), ".pdf") {
			app.dateiVomSystem(arg)
		}
	}
	err := wails.Run(&options.App{
		Title:     "OpenIntraPDF",
		Width:     1280,
		Height:    860,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: app.dateiHandler(),
		},
		Menu:       app.menue(),
		OnStartup:  app.startup,
		OnDomReady: app.domBereit,
		OnShutdown: app.shutdown,
		Bind:       []any{app},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		// Linux (OpenIntraOS, Plasma auf Wayland): Der Programmname ist die
		// app_id unter Wayland -- sie muss zu openintrapdf.desktop passen,
		// sonst zeigt die Leiste ein fremdes Symbol.
		Linux: &linux.Options{
			ProgramName: "openintrapdf",
		},
		Mac: &mac.Options{
			OnFileOpen: app.dateiVomSystem,
			About: &mac.AboutInfo{
				Title: "OpenIntraPDF",
				// In der Sprache des Systems (startTexte); die Oberflaeche
				// setzt ihn nach dem Start noch einmal (rollenUebersetzen).
				Message: app.menueText("ueberText"),
			},
		},
	})
	if err != nil {
		println("OpenIntraPDF:", err.Error())
		os.Exit(1)
	}
}

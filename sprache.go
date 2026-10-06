// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"io/fs"
	"strings"
)

// Menue in der Sprache des Systems schon beim Start (06.10.2026).
//
// Unter Linux kann Wails v2 das Menue nach dem Start nicht mehr tauschen:
// SetApplicationMenu baut eine neue GTK-Leiste, haengt sie aber nie ins
// Fenster (gepackt wird nur in Window.Run). Deshalb waehlt die Go-Seite die
// Sprache selbst, bevor wails.Run das Menue baut -- nach derselben Regel wie
// die Oberflaeche (src/desktop/sprache.ts): die erste Sprache des Systems,
// fuer die es einen Katalog gibt, sonst Deutsch. Die Texte stehen in
// menue-texte.json im eingebetteten Buendel (vite.desktop.config.ts).
// Auf dem Mac schickt die Oberflaeche danach ihre Texte noch einmal
// (MenueSprache) -- dort geht das Tauschen.

type sprachTexte struct {
	Menue map[string]string `json:"menue"`
	Ueber map[string]string `json:"ueber"`
}

// katalogSprache: der Zwei-Buchstaben-Code der ersten Sprache mit Katalog.
func katalogSprache(sprachen []string, vorhanden map[string]sprachTexte) string {
	for _, s := range sprachen {
		code := strings.ToLower(s)
		if i := strings.IndexAny(code, "-_.@"); i >= 0 {
			code = code[:i]
		}
		if _, da := vorhanden[code]; da {
			return code
		}
	}
	return "de"
}

// startTexte liefert die Menuetexte fuer menueStandard in der Sprache des
// Systems; ohne Datei oder Katalog bleibt es beim deutschen Standard (nil).
func startTexte(dateien fs.FS, sprachen []string) map[string]string {
	roh, err := fs.ReadFile(dateien, "frontend/dist/menue-texte.json")
	if err != nil {
		return nil
	}
	var alle map[string]sprachTexte
	if json.Unmarshal(roh, &alle) != nil || len(alle) == 0 {
		return nil
	}
	k := alle[katalogSprache(sprachen, alle)]
	texte := map[string]string{}
	for schluessel := range menueStandard {
		if t := k.Menue[schluessel]; t != "" {
			texte[schluessel] = strings.ReplaceAll(t, "{{app}}", "OpenIntraPDF")
		}
	}
	if k.Ueber["text"] != "" && k.Ueber["fassung"] != "" && k.Ueber["lizenz"] != "" {
		weg := menueOder(texte, "hilfe") + " → " + menueOder(texte, "lizenzen")
		texte["ueberText"] = ueberText(k.Ueber["text"], fassungsZeile(k.Ueber["fassung"]), strings.ReplaceAll(k.Ueber["lizenz"], "{{weg}}", weg))
	}
	return texte
}

func menueOder(texte map[string]string, k string) string {
	if t := texte[k]; t != "" {
		return t
	}
	return menueStandard[k]
}

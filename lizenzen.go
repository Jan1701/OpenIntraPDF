// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Lizenzen fuer den Dialog der Oberflaeche (06.10.2026).
//
// Vorher oeffnete „Hilfe → Lizenzen“ die Datei LIZENZEN.md als file://-
// Adresse; auf dem Mac geschah dabei nichts. Jetzt liest die App die Texte
// selbst: LICENSE (Apache-2.0 der App) und lizenzen/verzeichnis.json, das
// beim Bau lizenzverzeichnis/ schreibt -- Texterkennung, Schrift, Go-Module
// und JavaScript-Pakete, jeweils mit vollem Text.

// LizenzTeil ist ein mitgeliefertes Teil mit seinem Lizenztext.
type LizenzTeil struct {
	Gruppe  string `json:"gruppe"`
	Name    string `json:"name"`
	Fassung string `json:"fassung"`
	Lizenz  string `json:"lizenz"`
	Text    string `json:"text"`
}

// Lizenzauskunft ist alles, was der Lizenzdialog zeigt.
type Lizenzauskunft struct {
	App     string       `json:"app"`
	Urheber string       `json:"urheber"`
	Lizenz  string       `json:"lizenz"`
	Text    string       `json:"text"`
	Teile   []LizenzTeil `json:"teile"`
}

// Lizenzen liefert die Lizenz der App und die der mitgelieferten Teile.
func (a *App) Lizenzen() (Lizenzauskunft, error) {
	ordner := ressourcenOrdner()
	if ordner == "" {
		return Lizenzauskunft{}, fehler(500, "pdf.licenses_missing", nil)
	}
	return lizenzenAus(ordner)
}

func lizenzenAus(ordner string) (Lizenzauskunft, error) {
	text, err := os.ReadFile(filepath.Join(ordner, "LICENSE"))
	if err != nil {
		return Lizenzauskunft{}, fehler(500, "pdf.licenses_missing", nil)
	}
	auskunft := Lizenzauskunft{App: "OpenIntraPDF", Urheber: urheber, Lizenz: "Apache-2.0", Text: string(text), Teile: []LizenzTeil{}}
	roh, err := os.ReadFile(filepath.Join(ordner, "lizenzen", "verzeichnis.json"))
	if err != nil {
		return auskunft, nil
	}
	var verzeichnis []struct {
		Gruppe, Name, Fassung, Lizenz, Datei string
	}
	if json.Unmarshal(roh, &verzeichnis) != nil {
		return auskunft, nil
	}
	for _, e := range verzeichnis {
		// Nur Dateinamen aus dem eigenen Ordner, nie Pfade.
		if e.Datei != filepath.Base(e.Datei) {
			continue
		}
		t, err := os.ReadFile(filepath.Join(ordner, "lizenzen", e.Datei))
		if err != nil {
			continue
		}
		auskunft.Teile = append(auskunft.Teile, LizenzTeil{Gruppe: e.Gruppe, Name: e.Name, Fassung: e.Fassung, Lizenz: e.Lizenz, Text: string(t)})
	}
	return auskunft, nil
}

// ressourcenOrdner findet den Ordner mit LICENSE: im Mac-Paket
// Contents/Resources, unter Linux /usr/share/openintrapdf, sonst neben dem
// Programm.
func ressourcenOrdner() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	exe, _ = filepath.EvalSymlinks(exe)
	for _, k := range []string{
		filepath.Join(filepath.Dir(exe), "..", "Resources"),
		filepath.Join(filepath.Dir(exe), "..", "share", "openintrapdf"),
		filepath.Dir(exe),
	} {
		if istDatei(filepath.Join(k, "LICENSE")) {
			return filepath.Clean(k)
		}
	}
	return ""
}

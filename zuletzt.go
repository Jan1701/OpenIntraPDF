// SPDX-License-Identifier: Apache-2.0

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

// Zuletzt geoeffnete Dateien fuer den Startbildschirm. Die Liste liegt
// als JSON im Einstellungsordner der Person (auf dem Mac
// ~/Library/Application Support/OpenIntraPDF/zuletzt.json). Die Webseite
// bekommt Name, Ordner (nur zum Anzeigen) und einen Schluessel, nie den
// Pfad; geoeffnet wird ueber den Schluessel.

const zuletztHoechst = 10

type ZuletztEintrag struct {
	Schluessel string `json:"schluessel"`
	Name       string `json:"name"`
	Ordner     string `json:"ordner"`
	// Fehlt: Die Datei liegt nicht mehr dort.
	Fehlt bool `json:"fehlt"`
}

type Zuletzt struct {
	mu    sync.Mutex
	datei string
	pfade []string
}

// zuletztLaden liest die Liste; ohne Datei ist sie leer.
func zuletztLaden(datei string) *Zuletzt {
	z := &Zuletzt{datei: datei}
	roh, err := os.ReadFile(datei)
	if err == nil {
		_ = json.Unmarshal(roh, &z.pfade)
	}
	return z
}

func zuletztSchluessel(pfad string) string {
	s := sha256.Sum256([]byte(pfad))
	return hex.EncodeToString(s[:8])
}

// Merken setzt pfad an den Anfang und schreibt die Liste.
func (z *Zuletzt) Merken(pfad string) {
	z.mu.Lock()
	defer z.mu.Unlock()
	z.pfade = slices.DeleteFunc(z.pfade, func(p string) bool { return p == pfad })
	z.pfade = append([]string{pfad}, z.pfade...)
	if len(z.pfade) > zuletztHoechst {
		z.pfade = z.pfade[:zuletztHoechst]
	}
	z.schreiben()
}

// Entfernen nimmt einen Pfad aus der Liste (Datei weg).
func (z *Zuletzt) Entfernen(pfad string) {
	z.mu.Lock()
	defer z.mu.Unlock()
	z.pfade = slices.DeleteFunc(z.pfade, func(p string) bool { return p == pfad })
	z.schreiben()
}

func (z *Zuletzt) schreiben() {
	if z.datei == "" {
		return
	}
	roh, err := json.Marshal(z.pfade)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(z.datei), 0o755)
	_ = os.WriteFile(z.datei, roh, 0o600)
}

// Eintraege liefert die Liste fuer die Oberflaeche.
func (z *Zuletzt) Eintraege() []ZuletztEintrag {
	z.mu.Lock()
	defer z.mu.Unlock()
	aus := make([]ZuletztEintrag, 0, len(z.pfade))
	for _, p := range z.pfade {
		e := ZuletztEintrag{Schluessel: zuletztSchluessel(p), Name: filepath.Base(p), Ordner: filepath.Dir(p)}
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
			e.Fehlt = true
		}
		aus = append(aus, e)
	}
	return aus
}

// Pfad liefert den Pfad zu einem Schluessel — nur, was in der Liste steht.
func (z *Zuletzt) Pfad(schluessel string) (string, bool) {
	z.mu.Lock()
	defer z.mu.Unlock()
	for _, p := range z.pfade {
		if zuletztSchluessel(p) == schluessel {
			return p, true
		}
	}
	return "", false
}

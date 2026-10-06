// SPDX-License-Identifier: Apache-2.0

package main

import (
	"strings"
	"testing"
	"testing/fstest"
)

const probeTexte = `{
 "de": {"menue": {"datei": "Datei", "hilfe": "Hilfe", "lizenzen": "Lizenzen", "beenden": "{{app}} beenden"},
        "ueber": {"text": "PDF lesen.", "fassung": "Version {{version}} (Bau {{bau}})", "lizenz": "Lizenzen unter {{weg}}."}},
 "en": {"menue": {"datei": "File", "hilfe": "Help", "lizenzen": "Licenses", "beenden": "Quit {{app}}"},
        "ueber": {"text": "Read PDFs.", "fassung": "Version {{version}} (build {{bau}})", "lizenz": "Licenses under {{weg}}."}}
}`

func TestKatalogSprache(t *testing.T) {
	vorhanden := map[string]sprachTexte{"de": {}, "en": {}, "fr": {}}
	for _, f := range []struct {
		sprachen []string
		soll     string
	}{
		{[]string{"en_US.UTF-8"}, "en"},
		{[]string{"tlh", "fr-CA"}, "fr"},
		{[]string{"C.UTF-8", "POSIX"}, "de"},
		{nil, "de"},
		{[]string{"EN-gb"}, "en"},
	} {
		if s := katalogSprache(f.sprachen, vorhanden); s != f.soll {
			t.Errorf("%v: %q, erwartet %q", f.sprachen, s, f.soll)
		}
	}
}

func TestStartTexte(t *testing.T) {
	dateien := fstest.MapFS{"frontend/dist/menue-texte.json": {Data: []byte(probeTexte)}}
	texte := startTexte(dateien, []string{"en_GB.UTF-8"})
	if texte["datei"] != "File" || texte["beenden"] != "Quit OpenIntraPDF" {
		t.Errorf("Menue: %v", texte)
	}
	if !strings.Contains(texte["ueberText"], "Licenses under Help → Licenses.") || !strings.Contains(texte["ueberText"], urheber) {
		t.Errorf("Info-Fenster: %q", texte["ueberText"])
	}
	// Ohne Datei: nil, das Menue bleibt beim deutschen Standard.
	if startTexte(fstest.MapFS{}, []string{"en"}) != nil {
		t.Error("ohne menue-texte.json muss nil kommen")
	}
}

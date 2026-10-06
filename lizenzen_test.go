// SPDX-License-Identifier: Apache-2.0

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLizenzenAusDemPaket(t *testing.T) {
	ordner := t.TempDir()
	if err := os.WriteFile(filepath.Join(ordner, "LICENSE"), []byte("Apache License\nVersion 2.0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(ordner, "lizenzen"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(ordner, "lizenzen", "go-wails.txt"), []byte("MIT License"), 0o644)
	_ = os.WriteFile(filepath.Join(ordner, "lizenzen", "verzeichnis.json"), []byte(`[
	 {"gruppe":"go","name":"github.com/wailsapp/wails/v2","fassung":"v2.16.0","lizenz":"MIT","datei":"go-wails.txt"},
	 {"gruppe":"js","name":"weg","fassung":"1","lizenz":"MIT","datei":"fehlt.txt"},
	 {"gruppe":"js","name":"boese","fassung":"1","lizenz":"MIT","datei":"../LICENSE"}
	]`), 0o644)

	a, err := lizenzenAus(ordner)
	if err != nil {
		t.Fatal(err)
	}
	if a.Urheber != urheber || a.Lizenz != "Apache-2.0" || a.Text == "" {
		t.Errorf("App-Teil: %+v", a)
	}
	// Nur der Eintrag mit vorhandener Datei im eigenen Ordner zaehlt.
	if len(a.Teile) != 1 || a.Teile[0].Name != "github.com/wailsapp/wails/v2" || a.Teile[0].Text != "MIT License" {
		t.Errorf("Teile: %+v", a.Teile)
	}
}

func TestLizenzenOhneLicense(t *testing.T) {
	if _, err := lizenzenAus(t.TempDir()); err == nil {
		t.Error("ohne LICENSE muss ein Fehler kommen")
	}
}

func TestUeberText(t *testing.T) {
	alt := bau
	defer func() { bau = alt }()
	bau = ""
	if z := fassungsZeile("Version {{version}} (Bau {{bau}})"); z != "Version "+fassung+" (Bau –)" {
		t.Errorf("ohne Bau: %q", z)
	}
	bau = "2343"
	if z := fassungsZeile("Version {{version}} (Bau {{bau}})"); z != "Version "+fassung+" (Bau 2343)" {
		t.Errorf("mit Bau: %q", z)
	}
	if u := ueberText("A", "B", "C"); u != "A\n\nB\n"+urheber+"\n\nC" {
		t.Errorf("ueberText: %q", u)
	}
}

func TestMenueSpracheNimmtNurBekannteSchluessel(t *testing.T) {
	a := &App{}
	if err := a.MenueSprache(map[string]string{"oeffnen": "Open …", "unbekannt": "x", "sichern": ""}); err != nil {
		t.Fatal(err)
	}
	if a.menueText("oeffnen") != "Open …" {
		t.Errorf("oeffnen: %q", a.menueText("oeffnen"))
	}
	if a.menueText("sichern") != "Sichern" {
		t.Errorf("leerer Text darf den Standard nicht ersetzen: %q", a.menueText("sichern"))
	}
	if _, da := a.menueTexte["unbekannt"]; da {
		t.Error("unbekannter Schluessel uebernommen")
	}
}

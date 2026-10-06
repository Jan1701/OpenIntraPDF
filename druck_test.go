// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Drucken mit Seitenbereich und Schnelldruck (Etappe 8) auf dem Desktop:
// Druckfassung baut die Teil-PDF lokal mit dem Go-Kern, Schnelldruck ruft
// lp bzw. lpr mit der Datei — hier eine Attrappe im PATH, die ihre
// Argumente aufschreibt.

func TestDruckfassungAufDemDesktop(t *testing.T) {
	a := attrappenApp(t)
	d, _ := datei(t, a, "angebot.pdf", korpus.MitAnmerkungen())
	ohne := false
	roh, err := a.Druckfassung(d.ID, DruckBefehl{Pages: []int{2, 0}, Annotations: &ohne, ExpectedVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := base64.StdEncoding.DecodeString(roh)
	if err != nil {
		t.Fatal(err)
	}
	if m, err := korpus.Marken(pdf); err != nil || strings.Join(m, ",") != "SEITE-03,SEITE-01" {
		t.Errorf("Marken %v %v", m, err)
	}
	if bytes.Contains(pdf, []byte("/Subtype /Text")) || bytes.Contains(pdf, []byte("/Subtype/Text")) {
		t.Error("ohne Anmerkungen steht noch eine Notiz im Ergebnis")
	}
	// Die Datei selbst blieb, wie sie war: Version 1, Basis unveraendert.
	if d.Version != 1 || !bytes.Equal(d.Basis, korpus.MitAnmerkungen()) {
		t.Error("Druckfassung hat die Datei veraendert")
	}
	if _, err := a.Druckfassung(d.ID, DruckBefehl{Pages: []int{0}, ExpectedVersion: 5}); fehlerVon(t, err).Status != 412 {
		t.Errorf("falsche Fassung: %v", err)
	}
	if _, err := a.Druckfassung(d.ID, DruckBefehl{Pages: []int{9}}); fehlerVon(t, err).Code != "pdf.invalid_plan" {
		t.Errorf("Seite ausserhalb: %v", err)
	}
	if err := a.BytesDrucken("x.pdf", "kein base64!"); fehlerVon(t, err).Status != 400 {
		t.Errorf("kein Base64: %v", err)
	}
	if err := a.BytesDrucken("x.pdf", base64.StdEncoding.EncodeToString([]byte("hallo"))); fehlerVon(t, err).Status != 400 {
		t.Errorf("kein PDF: %v", err)
	}
}

func TestSchnelldruckMitAttrappe(t *testing.T) {
	name, ok := schnelldruckBefehl()
	if !ok {
		t.Skip("auf diesem System gibt es keinen Schnelldruck")
	}
	// Eine Attrappe namens lp bzw. lpr, die den Aufruf aufschreibt.
	ordner := t.TempDir()
	protokoll := filepath.Join(ordner, "aufruf.txt")
	skript := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + protokoll + "\n"
	if err := os.WriteFile(filepath.Join(ordner, name), []byte(skript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", ordner)
	if !schnelldruckMoeglich() {
		t.Fatal("Attrappe nicht gefunden")
	}
	a := attrappenApp(t)
	d, _ := datei(t, a, "angebot.pdf", korpus.Textseiten(2))
	if err := a.Schnelldruck(d.ID); err != nil {
		t.Fatal(err)
	}
	aufruf, err := os.ReadFile(protokoll)
	if err != nil {
		t.Fatalf("Attrappe wurde nicht gerufen: %v", err)
	}
	pfad := strings.TrimSpace(string(aufruf))
	if filepath.Base(pfad) != "angebot.pdf" || !strings.HasPrefix(pfad, a.tempWurzel) {
		t.Errorf("Aufruf mit %q", pfad)
	}
	if inhalt, _ := os.ReadFile(pfad); !bytes.Equal(inhalt, korpus.Textseiten(2)) {
		t.Error("die gedruckte Datei ist nicht der gespeicherte Stand")
	}
	// Ohne Programm im PATH: kein Schnelldruck.
	t.Setenv("PATH", t.TempDir())
	if schnelldruckMoeglich() {
		t.Error("ohne Programm angeboten")
	}
	if err := a.Schnelldruck(d.ID); fehlerVon(t, err).Code != "pdf.unsupported" {
		t.Errorf("ohne Programm: %v", err)
	}
	if a.Start().Schnelldruck {
		t.Error("Start meldet Schnelldruck ohne Programm")
	}
}

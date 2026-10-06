// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Druckfassung (Etappe 8): Teilbereich in gegebener Reihenfolge, ohne
// Anmerkungen nur Widgets, Grenzen. Gelesen wird das Ergebnis mit pdfcpu.

func druck(t *testing.T, quelle []byte, seiten []int, anmerkungen bool) []byte {
	t.Helper()
	var aus bytes.Buffer
	if err := Druckfassung(context.Background(), bytes.NewReader(quelle), seiten, anmerkungen, "", "", &aus); err != nil {
		t.Fatalf("Druckfassung: %v", err)
	}
	return aus.Bytes()
}

func TestDruckfassungSeitenUndAnmerkungen(t *testing.T) {
	quelle := korpus.MitAnmerkungen() // 3 Seiten, 5 Anmerkungen + Popup + Link
	// Teilbereich in Dokumentreihenfolge, mit Anmerkungen.
	aus := druck(t, quelle, []int{2, 0}, true)
	if m, err := korpus.Marken(aus); err != nil || strings.Join(m, ",") != "SEITE-03,SEITE-01" {
		t.Errorf("Marken %v %v", m, err)
	}
	bilder := anmerkungsbilder(t, aus)
	typen := map[string]int{}
	for _, b := range bilder {
		typen[b.typ]++
	}
	// Seite 1: Text + Popup + Highlight; Seite 3: Link + Text-Antwort.
	if typen["Text"] != 2 || typen["Highlight"] != 1 || typen["Popup"] != 1 || typen["Link"] != 1 {
		t.Errorf("Anmerkungen mit: %+v", typen)
	}
	// Ohne Anmerkungen: nichts mehr auf den Seiten.
	ohne := druck(t, quelle, nil, false)
	if m, _ := korpus.Marken(ohne); strings.Join(m, ",") != "SEITE-01,SEITE-02,SEITE-03" {
		t.Errorf("alle Seiten: %v", m)
	}
	if n := len(anmerkungsbilder(t, ohne)); n != 0 {
		t.Errorf("ohne Anmerkungen noch %d da", n)
	}
	popplerOhneSyntaxfehler(t, ohne)
}

func TestDruckfassungWidgetsBleiben(t *testing.T) {
	quelle := korpus.Voll() // Notiz, Markierung, Dateianlage, Freihand, Link, zwei Textfelder
	ohne := druck(t, quelle, []int{0, 3}, false)
	bilder := anmerkungsbilder(t, ohne)
	for _, b := range bilder {
		if b.typ != "Widget" {
			t.Errorf("ohne Anmerkungen noch %s auf Seite %d", b.typ, b.seite+1)
		}
	}
	if len(bilder) != 2 {
		t.Errorf("Widgets: %d, erwartet 2 (Name, Betrag)", len(bilder))
	}
	if insp := inspizieren(geoeffnet(t, ohne)); insp.Formularfelder != 2 || insp.Seiten != 2 {
		t.Errorf("Inspektion %+v", insp)
	}
}

func TestDruckfassungGrenzen(t *testing.T) {
	quelle := korpus.Textseiten(2)
	var aus bytes.Buffer
	if err := Druckfassung(context.Background(), bytes.NewReader(quelle), []int{0, 2}, true, "", "", &aus); !errors.Is(err, ErrPlanUngueltig) {
		t.Errorf("Seite ausserhalb: %v", err)
	}
	if err := Druckfassung(context.Background(), bytes.NewReader(quelle), []int{-1}, true, "", "", &aus); !errors.Is(err, ErrPlanUngueltig) {
		t.Errorf("negative Seite: %v", err)
	}
	viele := make([]int, HoechstSeiten+1)
	if err := Druckfassung(context.Background(), bytes.NewReader(quelle), viele, true, "", "", &aus); !errors.Is(err, ErrZuVieleSeiten) {
		t.Errorf("zu viele: %v", err)
	}
	// Doppelte Seiten sind erlaubt (Collect): zweimal Seite 1.
	doppelt := druck(t, quelle, []int{0, 0}, true)
	if m, _ := korpus.Marken(doppelt); strings.Join(m, ",") != "SEITE-01,SEITE-01" {
		t.Errorf("doppelt: %v", m)
	}
}

// Rechte einer fremd geschuetzten Quelle (#247): Ohne Druck-Bit und ohne
// Rechte-Kennwort gibt es keine Druckfassung; sonst behaelt die Kopie den
// Schutz der Quelle (AES-256 R6, kein Oeffnen-Kennwort, zufaelliges
// Rechte-Kennwort, dieselben Rechte-Bits) — vorher kam sie unverschluesselt
// und frei kopierbar heraus.
func TestDruckfassungRechteEingeschraenkt(t *testing.T) {
	versuch := func(quelle []byte, passwort, besitzer string) ([]byte, error) {
		var aus bytes.Buffer
		err := Druckfassung(context.Background(), bytes.NewReader(quelle), nil, true, passwort, besitzer, &aus)
		return aus.Bytes(), err
	}
	// Nichts erlaubt (P wie im Befund: kein Drucken, Kopieren, Aendern).
	gesperrt := schuetzen(t, korpus.Textseiten(3), Schutz{Besitzerpasswort: "rechte-456", Rechte: Rechte{}})
	aus, err := versuch(gesperrt, "", "")
	var rf *Rechtefehler
	if !errors.As(err, &rf) || !gleich(rf.Fehlend, []string{"print"}) || len(aus) != 0 {
		t.Fatalf("ohne Druckrecht: %v, %d Byte", err, len(aus))
	}
	if _, err := versuch(gesperrt, "", "falsch-789"); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("falsches Rechte-Kennwort: %v", err)
	}
	if _, err := versuch(gesperrt, "falsch-789", ""); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("falsches Kennwort als beides: %v", err)
	}
	// Mit Rechte-Kennwort: Die Kopie ist wieder geschuetzt, mit denselben Rechten.
	aus, err = versuch(gesperrt, "", "rechte-456")
	if err != nil {
		t.Fatalf("mit Rechte-Kennwort: %v", err)
	}
	geschuetztPruefen := func(name string, aus []byte, rechte Rechte, seiten int) {
		t.Helper()
		ctx, err := oeffnenMit(aus, "", "")
		if err != nil {
			t.Fatalf("%s: Kopie ohne Kennwort nicht lesbar: %v", name, err)
		}
		if ctx.Encrypt == nil || ctx.E == nil || ctx.E.R != 6 || ctx.E.L != 256 || ctx.PageCount != seiten {
			t.Fatalf("%s: Kopie nicht als AES-256 R6 geschuetzt: Encrypt %v, E %+v, %d Seiten", name, ctx.Encrypt, ctx.E, ctx.PageCount)
		}
		if got := RechteVon(ctx.E.P); got != rechte {
			t.Errorf("%s: Rechte %+v, erwartet %+v", name, got, rechte)
		}
		// Das Rechte-Kennwort der Quelle gilt an der Kopie nicht mehr: Es ist ein neues aus Zufall.
		for _, pw := range []string{"rechte-456", korpus.ProbeBesitzerpasswort} {
			if err := besitzerPruefen(context.Background(), bytes.NewReader(aus), pw); !errors.Is(err, ErrPasswortFalsch) {
				t.Errorf("%s: altes Rechte-Kennwort gilt an der Kopie: %v", name, err)
			}
		}
		if !bytes.HasPrefix(aus, []byte("%PDF-2.0")) {
			t.Errorf("%s: Kopf %q", name, aus[:8])
		}
	}
	geschuetztPruefen("gesperrt", aus, Rechte{}, 3)
	// Nur Drucken erlaubt (Korpus): ohne Kennwort druckbar, die Kopie bleibt auf „nur Drucken“.
	besitzer, _ := korpus.MitBesitzerpasswort()
	aus, err = versuch(besitzer, "", "")
	if err != nil {
		t.Fatalf("Druck-Bit: %v", err)
	}
	geschuetztPruefen("nur Drucken", aus, Rechte{Drucken: true}, 3)
	if m, err := korpus.Marken(aus); err != nil || !gleich(m, []string{"SEITE-01", "SEITE-02", "SEITE-03"}) {
		t.Errorf("Marken der Kopie: %v %v", m, err)
	}
	// Mit Oeffnen-Kennwort (nur Drucken): Ohne Kennwort nichts, mit ihm eine Kopie ohne Oeffnen-Kennwort.
	benutzer, _ := korpus.MitBenutzerpasswort()
	if _, err := versuch(benutzer, "", ""); !errors.Is(err, ErrPasswort) {
		t.Errorf("Oeffnen-Kennwort fehlt: %v", err)
	}
	aus, err = versuch(benutzer, korpus.ProbeBenutzerpasswort, "")
	if err != nil {
		t.Fatalf("mit Oeffnen-Kennwort: %v", err)
	}
	geschuetztPruefen("Oeffnen-Kennwort", aus, Rechte{Drucken: true}, 2)
	// Eine ungeschuetzte Quelle bleibt ungeschuetzt.
	frei, err := versuch(korpus.Textseiten(1), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if i := inspektion(t, frei); i.Verschluesselt {
		t.Errorf("ungeschuetzte Quelle, geschuetzte Kopie: %+v", i)
	}
}

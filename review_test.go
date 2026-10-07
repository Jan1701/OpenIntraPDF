// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Die Befunde des Reviews vom 07.10.2026 (oeffentliches Repo, Stand
// 82d9a10), je ein Test, der vor der Korrektur scheiterte.

// Seiten aus einer anderen Datei einfuegen: Der Commit nennt sie in
// sources, der Plan zaehlt sie ab der Seitenzahl der Basis. Bis Bau 2342
// kannte CommitBefehl kein sources — pdf.invalid_plan.
func TestSpeichernMitQuellen(t *testing.T) {
	a := attrappenApp(t)
	basis, pfad := datei(t, a, "basis.pdf", korpus.Textseiten(2))
	quelle, _ := datei(t, a, "quelle.pdf", korpus.Textseiten(3))

	befehl := CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: basis.SHA256,
		Sources:     []BindeQuelle{{FileID: quelle.ID, ExpectedVersion: 1, Pages: []int{2}}},
		Pages:       seitenplan(dokument.Seite{Quelle: 0}, dokument.Seite{Quelle: 2}, dokument.Seite{Quelle: 1}),
		Destination: Ziel{Kind: "new_version"}}
	if _, err := a.Speichern(basis.ID, befehl, "q1"); err != nil {
		t.Fatal(err)
	}
	marken, _ := korpus.Marken(mussLesen(t, pfad))
	if strings.Join(marken, ",") != "SEITE-01,SEITE-03,SEITE-02" {
		t.Errorf("Marken %v", marken)
	}

	// Nur Quellen, kein Plan: hinten angehaengt — nicht „nichts zu tun“.
	nurQuellen := CommitBefehl{ExpectedVersion: 2, ExpectedSHA256: basis.SHA256,
		Sources: []BindeQuelle{{FileID: quelle.ID, ExpectedVersion: 1, Pages: []int{0}}}, Destination: Ziel{Kind: "new_version"}}
	if _, err := a.Speichern(basis.ID, nurQuellen, "q2"); err != nil {
		t.Fatal(err)
	}
	if marken, _ := korpus.Marken(mussLesen(t, pfad)); len(marken) != 4 {
		t.Errorf("nur Quellen: Marken %v", marken)
	}

	// Eine Quelle, die es nicht (mehr) gibt: 404; eine leere Seitenliste: 422.
	for name, q := range map[string]BindeQuelle{
		"unbekannt":   {FileID: "gibtsnicht"},
		"leere Liste": {FileID: quelle.ID, Pages: []int{}},
	} {
		_, err := a.Speichern(basis.ID, CommitBefehl{ExpectedVersion: 3, Sources: []BindeQuelle{q}, Destination: Ziel{Kind: "new_version"}}, "q-"+name)
		f := fehlerVon(t, err)
		if name == "unbekannt" && f.Status != http.StatusNotFound || name == "leere Liste" && f.Code != "pdf.no_pages" {
			t.Errorf("%s: %+v", name, f)
		}
	}
}

// Kennwort entfernen: decrypt mit dem Rechte-Kennwort schreibt die Fassung
// ohne Schutz. Bis Bau 2342 kannte CommitBefehl kein decrypt — pdf.nothing_to_do.
func TestSpeichernKennwortEntfernen(t *testing.T) {
	a := attrappenApp(t)
	geschuetzt, err := korpus.MitBenutzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	d, pfad := datei(t, a, "geschuetzt.pdf", geschuetzt)
	entfernen := func(kennwort, schluessel string) error {
		_, err := a.Speichern(d.ID, CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: d.SHA256,
			Decrypt: &Entschluess{Password: kennwort}, Destination: Ziel{Kind: "new_version"}}, schluessel)
		return err
	}
	if f := fehlerVon(t, entfernen("", "e0")); f.Status != http.StatusBadRequest {
		t.Errorf("ohne Kennwort: %+v", f)
	}
	if f := fehlerVon(t, entfernen("falsch-789", "e1")); f.Code != "pdf.wrong_password" {
		t.Errorf("falsches Kennwort: %+v", f)
	}
	if !bytes.Equal(mussLesen(t, pfad), geschuetzt) {
		t.Fatal("nach dem Fehlschlag wurde geschrieben")
	}
	// Derselbe Schluessel mit dem richtigen Kennwort ist dieselbe Anfrage
	// (der Hash des Vorgangs traegt keine Kennwoerter, wie im Server).
	if err := entfernen(korpus.ProbeBesitzerpasswort, "e1"); err != nil {
		t.Fatal(err)
	}
	insp, err := dokument.Inspizieren(context.Background(), bytes.NewReader(mussLesen(t, pfad)))
	if err != nil || insp.Verschluesselt || insp.Seiten != 2 {
		t.Errorf("nach dem Entfernen: %+v, %v", insp, err)
	}
	if d.Version != 2 {
		t.Errorf("Fassung %d", d.Version)
	}
}

// Neu laden nach einem Konflikt holt den Stand der Platte. Bis Bau 2342
// lieferten Info und /datei/{id} die alten Bytes und die alte Fassung —
// jeder weitere Speicherversuch lief wieder in den Konflikt.
func TestNeuLadenNachKonflikt(t *testing.T) {
	a := attrappenApp(t)
	d, pfad := datei(t, a, "probe.pdf", korpus.Textseiten(3))

	// Ohne Aenderung auf der Platte (auch nach touch) bleibt alles.
	jetzt := time.Now().Add(time.Minute)
	if err := os.Chtimes(pfad, jetzt, jetzt); err != nil {
		t.Fatal(err)
	}
	if err := a.Neuladen(d.ID); err != nil || d.Version != 1 {
		t.Fatalf("ohne Aenderung: Fassung %d, %v", d.Version, err)
	}

	fremd := korpus.Textseiten(2)
	if err := os.WriteFile(pfad, fremd, 0o644); err != nil {
		t.Fatal(err)
	}
	drehen := func(fassung int, schluessel string) error {
		_, err := a.Speichern(d.ID, CommitBefehl{ExpectedVersion: fassung,
			Pages: seitenplan(dokument.Seite{Quelle: 1}, dokument.Seite{Quelle: 0}), Destination: Ziel{Kind: "new_version"}}, schluessel)
		return err
	}
	if f := fehlerVon(t, drehen(1, "k1")); f.Code != "pdf.version_conflict" {
		t.Fatalf("Konflikt erwartet: %+v", f)
	}
	if err := a.Neuladen(d.ID); err != nil {
		t.Fatal(err)
	}
	info, err := a.Info(d.ID)
	if err != nil || info.Version != 2 || info.Inspection.Seiten != 2 {
		t.Fatalf("Info nach Neu laden: %+v, %v", info, err)
	}
	w := httptest.NewRecorder()
	a.dateiHandler().ServeHTTP(w, httptest.NewRequest("GET", "/datei/"+d.ID, nil))
	if !bytes.Equal(w.Body.Bytes(), fremd) || w.Header().Get("X-File-Version") != "2" {
		t.Errorf("GET /datei/{id}: %d Bytes, Fassung %s", w.Body.Len(), w.Header().Get("X-File-Version"))
	}
	if err := drehen(2, "k2"); err != nil {
		t.Fatalf("Speichern nach Neu laden: %v", err)
	}
	if marken, _ := korpus.Marken(mussLesen(t, pfad)); strings.Join(marken, ",") != "SEITE-02,SEITE-01" {
		t.Errorf("Marken %v", marken)
	}

	// Ist die Datei inzwischen kein PDF mehr, sagt Neu laden das.
	if err := os.WriteFile(pfad, []byte("kein pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	if f := fehlerVon(t, a.Neuladen(d.ID)); f.Code != "pdf.not_pdf" {
		t.Errorf("kein PDF: %+v", f)
	}
}

// Dieselbe Datei noch einmal oeffnen (Finder, Zuletzt, als Quelle) laesst
// den Eintrag in Ruhe: gleiche Kennung, gleiche Fassung — ein Entwurf
// darauf bleibt speicherbar. Bis Bau 2342 zaehlte Oeffnen die Fassung hoch.
func TestNochmalOeffnenLaesstEntwurfGueltig(t *testing.T) {
	a := attrappenApp(t)
	d, pfad := datei(t, a, "probe.pdf", korpus.Textseiten(2))
	g, err := a.oeffnen(pfad)
	if err != nil || g.ID != d.ID || d.Version != 1 {
		t.Fatalf("nochmal geoeffnet: %+v, Fassung %d, %v", g, d.Version, err)
	}
	if _, err := a.Speichern(d.ID, CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: d.SHA256,
		Pages: seitenplan(dokument.Seite{Quelle: 1}, dokument.Seite{Quelle: 0}), Destination: Ziel{Kind: "new_version"}}, "n1"); err != nil {
		t.Fatalf("Entwurf nach erneutem Oeffnen: %v", err)
	}
}

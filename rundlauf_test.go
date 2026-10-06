// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Der Rundlauf der Abnahme (Vertrag Etappe 6), gesteuert ueber die
// Bindungen, mit den Korpus-PDFs: oeffnen, Seite drehen, Notiz, Post-it
// und Stempel setzen, speichern, erneut oeffnen — danach pdfcpu-Validierung
// (api.Validate ist `pdfcpu validate`) und pdftotext, wenn Poppler da ist.

func TestRundlaufKorpus(t *testing.T) {
	alle, err := korpus.Alle()
	if err != nil {
		t.Fatal(err)
	}
	pdftotext, _ := exec.LookPath("pdftotext")
	if pdftotext == "" {
		t.Log("pdftotext fehlt — die Poppler-Probe wird uebersprungen (zaehlt nicht als bestanden)")
	}
	for _, dok := range alle {
		t.Run(dok.Name, func(t *testing.T) {
			a := attrappenApp(t)
			d, pfad := datei(t, a, dok.Name, dok.Inhalt)
			info, err := a.Info(d.ID)
			if err != nil {
				t.Fatal(err)
			}
			if info.Capabilities.Pages.State != "available" || info.Capabilities.Annotations.State != "available" {
				t.Skipf("Seiten %s, Anmerkungen %s (%s) — Rundlauf nicht vorgesehen", info.Capabilities.Pages.State,
					info.Capabilities.Annotations.State, info.Capabilities.Pages.Reason)
			}
			vorher := info.Inspection
			vorherDrehung := drehungSeite1(t, d.Basis)
			vorherMarken, _ := korpus.Marken(d.Basis)

			// 1. oeffnen ist geschehen. 2. Seite 1 drehen, 3. Notiz, Post-it
			// und Stempel auf Seite 1, 4. speichern als neue Fassung.
			plan := make([]dokument.Seite, vorher.Seiten)
			for i := range plan {
				plan[i] = dokument.Seite{Quelle: i}
			}
			plan[0].Drehung = 90
			befehl := CommitBefehl{
				ExpectedVersion: 1, ExpectedSHA256: d.SHA256, Pages: &plan, Destination: Ziel{Kind: "new_version"},
				Annotations: &dokument.Anmerkungsbefehle{Add: []dokument.NeueAnmerkung{
					{ClientID: "n1", Page: 0, Kind: "note", Rect: []float64{80, 700, 100, 720}, Contents: "Bitte prüfen", Color: []float64{1, 0.85, 0}},
					{ClientID: "p1", Page: 0, Kind: "sticky", Rect: []float64{120, 560, 290, 690}, Contents: "Zettel: Rückruf am Montag", Color: []float64{1, 0.96, 0.62}, FontSize: 11},
					{ClientID: "s1", Page: 0, Kind: "stamp", Rect: []float64{320, 640, 540, 700}, Color: []float64{0.18, 0.49, 0.2},
						Stamp: &dokument.Stempel{Label: "GEPRÜFT", Name: "Checked", Signed: true, Lang: "de"}},
				}},
			}
			erg, err := a.Speichern(d.ID, befehl, "r1")
			if err != nil && fehlerVon(t, err).Code == "pdf.permission_restricted" {
				// Die Rechte der Datei (nur Drucken) sperren den Vorgang (Etappe 9);
				// mit dem Rechte-Kennwort geht es.
				befehl.OwnerPassword = korpus.ProbeBesitzerpasswort
				erg, err = a.Speichern(d.ID, befehl, "r1b")
			}
			if err != nil {
				// Verluste (Anhaenge, Lesezeichen) meldet der Server als 422 und
				// speichert erst nach Bestaetigung — hier wird bestaetigt.
				f := fehlerVon(t, err)
				if f.Code != "pdf.preservation_failed" {
					t.Fatalf("Speichern: %+v", f)
				}
				verluste, _ := f.Params["losses"].([]any)
				for _, v := range verluste {
					befehl.AcceptLosses = append(befehl.AcceptLosses, v.(string))
				}
				if erg, err = a.Speichern(d.ID, befehl, "r2"); err != nil {
					t.Fatalf("Speichern mit Verlusten: %v", err)
				}
			}
			if erg.Version != 2 || erg.Annotations == nil || len(erg.Annotations.Added) != 3 {
				t.Fatalf("Ergebnis = %+v", erg)
			}

			// 5. erneut oeffnen: neue Kennung, neue Basis von der Platte.
			a.Schliessen(d.ID)
			g, err := a.oeffnen(pfad)
			if err != nil {
				t.Fatal(err)
			}
			neu, err := a.ablage.Datei(g.ID)
			if err != nil {
				t.Fatal(err)
			}
			platte, _ := os.ReadFile(pfad)
			if !bytes.Equal(platte, neu.Basis) || neu.Version != 1 {
				t.Errorf("neu geoeffnet: Basis = Platte %v, Version %d", bytes.Equal(platte, neu.Basis), neu.Version)
			}

			// pdfcpu validate
			if err := api.Validate(context.Background(), bytes.NewReader(platte), model.NewDefaultConfiguration(), nil); err != nil {
				t.Errorf("pdfcpu validate: %v", err)
			}
			nachher, err := dokument.Inspizieren(context.Background(), bytes.NewReader(platte))
			if err != nil {
				t.Fatal(err)
			}
			if nachher.Seiten != vorher.Seiten || nachher.Anmerkungen != vorher.Anmerkungen+3 {
				t.Errorf("nachher: %d Seiten, %d Anmerkungen; vorher %d/%d", nachher.Seiten, nachher.Anmerkungen, vorher.Seiten, vorher.Anmerkungen)
			}
			// Die Drehung kommt ZU einer geerbten dazu (03-verschachtelt: 90 vom
			// Zwischenknoten, danach 180).
			if nachherDrehung := drehungSeite1(t, platte); nachherDrehung != (vorherDrehung+90)%360 {
				t.Errorf("Seite 1: Drehung %d, erwartet %d", nachherDrehung, (vorherDrehung+90)%360)
			}
			if marken, _ := korpus.Marken(platte); len(vorherMarken) > 0 && (len(marken) == 0 || marken[0] != vorherMarken[0]) {
				t.Errorf("Marken nach dem Rundlauf: %v, vorher %v", marken, vorherMarken)
			}

			// pdftotext: Stempel und Post-it sind sichtbarer Text im
			// Erscheinungsbild, die Notiz nicht (sie ist ein Symbol).
			if pdftotext != "" {
				aus, err := exec.Command(pdftotext, "-f", "1", "-l", "1", pfad, "-").Output()
				if err != nil {
					t.Fatalf("pdftotext: %v", err)
				}
				text := string(aus)
				for _, w := range []string{"GEPRÜFT", "Erika Musterfrau", "30.09.2026", "Rückruf"} {
					if !strings.Contains(text, w) {
						t.Errorf("pdftotext findet %q nicht:\n%s", w, text)
					}
				}
			}
		})
	}
}

// drehungSeite1 liest die wirksame Drehung der ersten Seite (geerbt oder
// eigen), 0..270.
func drehungSeite1(t *testing.T, pdf []byte) int {
	t.Helper()
	ctx, err := api.ReadAndValidate(context.Background(), bytes.NewReader(pdf), model.NewDefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	_, _, geerbt, err := ctx.XRefTable.PageDict(context.Background(), 1, false)
	if err != nil {
		t.Fatal(err)
	}
	if geerbt == nil {
		return 0
	}
	return ((geerbt.Rotate % 360) + 360) % 360
}

func TestRundlaufDateiname(t *testing.T) {
	if dateinameMitEndung("../../etc/passwd", "x", ".pdf") != "passwd.pdf" || dateinameMitEndung("", "Ersatz", ".pdf") != "Ersatz.pdf" {
		t.Error("dateinameMitEndung laesst Pfade durch")
	}
	if filepath.Base(dateinameMitEndung("a/b/Rechnung.PDF", "x", ".pdf")) != "Rechnung.PDF" {
		t.Error("Endung wird nicht erkannt")
	}
}

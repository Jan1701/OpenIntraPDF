// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
)

// Die Abnahme mit dem MITGELIEFERTEN Tesseract (Vertrag Etappe 6): Die
// App erkennt einen Scan, auch wenn /opt/homebrew/bin nicht im PATH
// steht, und kein mitgelieferter Teil verweist auf Homebrew.
//
// Genommen wird das umgepackte Tesseract aus build/tesseract (Ergebnis
// von tesseract/einpacken.sh) oder aus der gebauten App. Fehlt beides,
// wird uebersprungen — das zaehlt NICHT als bestanden.

// mitgeliefert findet Programm und Sprachdaten des umgepackten Tesseract.
func mitgeliefert(t *testing.T) erkennung.Tesseract {
	t.Helper()
	for _, wurzel := range []string{
		filepath.Join("build", "bin", "OpenIntraPDF.app", "Contents"),
		filepath.Join("build", "tesseract"),
	} {
		programm := filepath.Join(wurzel, "MacOS", "tesseract")
		tessdata := filepath.Join(wurzel, "Resources", "tessdata")
		if !istOrdner(tessdata) {
			tessdata = filepath.Join(wurzel, "tessdata")
		}
		if istDatei(programm) && istOrdner(tessdata) {
			abs, _ := filepath.Abs(programm)
			absData, _ := filepath.Abs(tessdata)
			return erkennung.Tesseract{Programm: abs, Tessdata: absData, Sprachen: "deu+eng"}
		}
	}
	t.Skip("kein umgepacktes Tesseract (tesseract/einpacken.sh oder bauen.sh zuerst) — Probe uebersprungen, nicht bestanden")
	return erkennung.Tesseract{}
}

func TestMitgeliefertesTesseractOhneHomebrew(t *testing.T) {
	tess := mitgeliefert(t)
	// Kein Homebrew im PATH — was jetzt noch laeuft, kommt aus dem Paket.
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	t.Setenv("TESSDATA_PREFIX", "")
	t.Setenv("DYLD_LIBRARY_PATH", "")
	t.Setenv("DYLD_FALLBACK_LIBRARY_PATH", "")
	if _, err := exec.LookPath("tesseract"); err == nil {
		t.Fatal("tesseract liegt im System-PATH — die Probe waere nicht aussagekraeftig")
	}

	z, err := tess.Zustand(context.Background())
	if err != nil {
		t.Fatalf("mitgeliefertes Tesseract: %v", err)
	}
	if !strings.HasPrefix(z.Fassung, "5.") || !strings.Contains(strings.Join(z.Sprachen, ","), "deu") {
		t.Errorf("Zustand = %+v", z)
	}

	// Der Rundlauf ueber die Bindungen: Scan oeffnen, Erkennung starten,
	// das Seitenbild liefern (wie pdf.js es taete), Ergebnis pruefen.
	a := testApp(t, tess)
	d, pfad := datei(t, a, "scan.pdf", scanPDF(t, scanBild(t)))
	k, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 1, Options: AuftragOptionenRumpf{Languages: "deu+eng"}}, "o1")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SeiteLiefern(k.ID, 0, base64.StdEncoding.EncodeToString(scanBild(t)), ""); err != nil {
		t.Fatal(err)
	}
	ende := warten(t, a, k.ID)
	if ende.State != auftragFertig {
		t.Fatalf("Auftrag = %+v, Fehler %+v", ende, ende.Error)
	}
	roh, _, err := a.auftraege.Ergebnis(k.ID, auftragArtOCR)
	if err != nil {
		t.Fatal(err)
	}
	// Das Ergebnis ist ein gueltiges PDF mit einer Seite …
	insp, err := dokument.Inspizieren(context.Background(), strings.NewReader(string(roh)))
	if err != nil || insp.Seiten != 1 {
		t.Fatalf("Ergebnis: %v, %+v", err, insp)
	}
	// … und traegt die erkannten Woerter als Textebene an der Stelle des
	// Bildes (Anzeigeraum: die erste Zeile steht oben, y unter 150 pt).
	texte, err := dokument.TextebeneLesen(context.Background(), roh, nil)
	if err != nil {
		t.Fatal(err)
	}
	woerter := texteAls(texte)
	for _, w := range []string{"Probelauf", "Texterkennung", "Musterstadt", "Beispielsee", "Wolken", "Wasser", "00123"} {
		if !strings.Contains(woerter, w) {
			t.Errorf("%q nicht in der Textebene: %q", w, woerter)
		}
	}
	for _, b := range texte[0].Bloecke {
		for _, z := range b {
			for _, w := range z.Woerter {
				if w.Text == "Probelauf" && (w.Y0 < 40 || w.Y1 > 150 || w.X0 < 60 || w.X0 > 200) {
					t.Errorf("Probelauf liegt bei x %g, y %g–%g — nicht ueber dem Bild", w.X0, w.Y0, w.Y1)
				}
			}
		}
	}
	// Veroeffentlichen als neue Fassung: Die Datei auf der Platte ist jetzt
	// das durchsuchbare PDF.
	if _, err := a.AuftragVeroeffentlichen(k.ID, AuftragCommit{Destination: Ziel{Kind: "new_version"}}, "c1"); err != nil {
		t.Fatal(err)
	}
	platte, _ := os.ReadFile(pfad)
	if hat, err := dokument.HatTextebene(context.Background(), platte, nil); err != nil || !hat {
		t.Errorf("gespeicherte Datei ohne Textebene: %v, %v", hat, err)
	}
	// Die erkannte Seite gilt nun als Text und wird nicht noch einmal belegt.
	arten, err := a.Seitenarten(d.ID)
	if err != nil || arten.Pages[0].Kind != "gemischt" {
		t.Errorf("Seitenart nach der Erkennung = %+v, %v", arten, err)
	}
}

// TestMitgeliefertesTesseractOhneHomebrewPfade prueft mit otool -L
// rekursiv, dass kein mitgelieferter Mach-O-Teil auf /opt/homebrew oder
// /usr/local verweist.
func TestMitgeliefertesTesseractOhneHomebrewPfade(t *testing.T) {
	tess := mitgeliefert(t)
	otool, err := exec.LookPath("otool")
	if err != nil {
		t.Skip("otool fehlt")
	}
	wurzel := filepath.Dir(filepath.Dir(tess.Programm))
	dateien := []string{tess.Programm}
	eintraege, _ := os.ReadDir(filepath.Join(wurzel, "Frameworks"))
	for _, e := range eintraege {
		if strings.HasSuffix(e.Name(), ".dylib") {
			dateien = append(dateien, filepath.Join(wurzel, "Frameworks", e.Name()))
		}
	}
	if len(dateien) < 5 {
		t.Fatalf("nur %d Mach-O-Dateien gefunden unter %s", len(dateien), wurzel)
	}
	for _, f := range dateien {
		aus, err := exec.Command(otool, "-L", f).Output()
		if err != nil {
			t.Fatalf("otool -L %s: %v", f, err)
		}
		for _, zeile := range strings.Split(string(aus), "\n")[1:] {
			if strings.Contains(zeile, "/opt/homebrew") || strings.Contains(zeile, "/usr/local") || strings.Contains(zeile, "@rpath") {
				t.Errorf("%s verweist nach draussen: %s", filepath.Base(f), strings.TrimSpace(zeile))
			}
		}
	}
	t.Logf("%d Mach-O-Dateien geprueft, alle Ladepfade im Paket", len(dateien))
}

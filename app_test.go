// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Die Bindungen gegen eine Tesseract-Attrappe (Shell-Skript) und
// synthetische PDFs aus dem Korpus. Nichts hier ist ein echtes Dokument.
// Die Probe mit dem MITGELIEFERTEN Tesseract steht in erkennung_test.go.

// probeZeit ist das feste „Jetzt“ der Tests — Name und Datum am Stempel
// setzt die Go-Seite daraus.
var probeZeit = time.Date(2026, 9, 30, 14, 8, 0, 0, time.Local)

// tesseractAttrappe ist ein Skript, das --version und --list-langs
// beantwortet und fuer jedes Bild zwei Woerter als TSV liefert. Mit
// ATTRAPPE_SCHLAF wartet es vorher (Abbruchtest).
func tesseractAttrappe(t *testing.T) string {
	t.Helper()
	pfad := filepath.Join(t.TempDir(), "tesseract")
	skript := `#!/bin/sh
case "$1" in
--version) echo 'tesseract 5.5.3'; echo ' leptonica-1.87.0'; exit 0 ;;
--list-langs) echo 'List of available languages in "/x/" (3):'; echo deu; echo eng; echo osd; exit 0 ;;
esac
[ -n "$ATTRAPPE_SCHLAF" ] && sleep "$ATTRAPPE_SCHLAF"
[ -f "$1" ] || { echo "Bild fehlt: $1" >&2; exit 1; }
printf 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
printf '5\t1\t1\t1\t1\t1\t300\t300\t600\t80\t96.5\tRechnung\n'
printf '5\t1\t1\t1\t1\t2\t950\t300\t400\t80\t91.2\t00123\n'
printf '5\t1\t1\t1\t2\t1\t300\t420\t900\t80\t30\tMusterfirma\n'
printf '5\t1\t1\t1\t2\t2\t1250\t420\t400\t80\t45\tGmbH\n'
`
	if err := os.WriteFile(pfad, []byte(skript), 0o755); err != nil {
		t.Fatal(err)
	}
	return pfad
}

// testApp baut eine App ohne Fenster: Attrappe, fester Name, feste Zeit.
func testApp(t *testing.T, tess erkennung.Tesseract) *App {
	t.Helper()
	wurzel := t.TempDir()
	a := &App{
		ablage: neueAblage(), vorgaenge: neueVorgaenge(), tess: tess, ocr: erkennung.Zustand{Fassung: "5.5.3"},
		tempWurzel: wurzel, jetzt: func() time.Time { return probeZeit }, person: "Erika Musterfrau",
		zuletzt: zuletztLaden(filepath.Join(wurzel, "zuletzt.json")),
	}
	a.auftraege = neueAuftraege(wurzel, tess, true)
	a.auftraege.jetzt = a.jetzt
	t.Cleanup(a.auftraege.Aufraeumen)
	return a
}

func attrappenApp(t *testing.T) *App {
	return testApp(t, erkennung.Tesseract{Programm: tesseractAttrappe(t), Sprachen: "deu+eng"})
}

// datei legt Bytes als Datei in einen Temp-Ordner und oeffnet sie.
func datei(t *testing.T, a *App, name string, inhalt []byte) (*Datei, string) {
	t.Helper()
	pfad := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(pfad, inhalt, 0o644); err != nil {
		t.Fatal(err)
	}
	g, err := a.oeffnen(pfad)
	if err != nil {
		t.Fatal(err)
	}
	d, err := a.ablage.Datei(g.ID)
	if err != nil {
		t.Fatal(err)
	}
	return d, pfad
}

// fehlerVon liest Status und Code aus einem Bindungsfehler.
func fehlerVon(t *testing.T, err error) *Fehler {
	t.Helper()
	if err == nil {
		t.Fatal("kein Fehler")
	}
	var f Fehler
	if jerr := json.Unmarshal([]byte(err.Error()), &f); jerr != nil {
		t.Fatalf("Fehler ist kein JSON: %v", err)
	}
	return &f
}

func zielFuer(a *App, ordner, name string) Ziel {
	id := a.ablage.ZielAnlegen(ordner)
	return Ziel{Kind: "new_file", DriveID: "", FolderID: &id, Name: name}
}

func seitenplan(seiten ...dokument.Seite) *[]dokument.Seite { return &seiten }

// scanPDF macht aus einem PNG einen „Scan“: eine A4-Seite (bei 300 dpi
// gerastert) mit dem Bild als einzigem Inhalt, ohne Textebene.
func scanPDF(t *testing.T, pngRoh []byte) []byte {
	t.Helper()
	bild, err := png.Decode(bytes.NewReader(pngRoh))
	if err != nil {
		t.Fatal(err)
	}
	grau := image.NewGray(bild.Bounds())
	draw.Draw(grau, grau.Bounds(), bild, bild.Bounds().Min, draw.Src)
	var gepackt bytes.Buffer
	z := zlib.NewWriter(&gepackt)
	z.Write(grau.Pix)
	z.Close()
	b := grau.Bounds()
	breite, hoehe := float64(b.Dx())*72/300, float64(b.Dy())*72/300
	inhalt := fmt.Sprintf("q %.2f 0 0 %.2f 0 0 cm /Im1 Do Q", breite, hoehe)
	objekte := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>", breite, hoehe),
		fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream", b.Dx(), b.Dy(), gepackt.Len(), gepackt.String()),
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(inhalt), inhalt),
	}
	var aus bytes.Buffer
	aus.WriteString("%PDF-1.4\n")
	lagen := make([]int, len(objekte))
	for i, o := range objekte {
		lagen[i] = aus.Len()
		fmt.Fprintf(&aus, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := aus.Len()
	fmt.Fprintf(&aus, "xref\n0 %d\n0000000000 65535 f \n", len(objekte)+1)
	for _, l := range lagen {
		fmt.Fprintf(&aus, "%010d 00000 n \n", l)
	}
	fmt.Fprintf(&aus, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objekte)+1, xref)
	return aus.Bytes()
}

func scanBild(t *testing.T) []byte {
	t.Helper()
	roh, err := os.ReadFile("testdata/scan-seite.png")
	if err != nil {
		t.Fatal(err)
	}
	return roh
}

// warten fragt den Auftrag ab, bis er nicht mehr laeuft.
func warten(t *testing.T, a *App, id string) *Auftrag {
	t.Helper()
	frist := time.Now().Add(2 * time.Minute)
	for time.Now().Before(frist) {
		k, err := a.Auftrag(id)
		if err != nil {
			t.Fatal(err)
		}
		if k.State != auftragLaeuft && k.State != auftragWartet {
			return k
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("Auftrag wird nicht fertig")
	return nil
}

// ------------------------------------------------------------------
// Speichern: Konflikt, atomar, als neue Datei
// ------------------------------------------------------------------

func TestSpeichernKonfliktUndAtomar(t *testing.T) {
	a := attrappenApp(t)
	d, pfad := datei(t, a, "probe.pdf", korpus.Textseiten(3))
	info, err := a.Info(d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if info.Version != 1 || info.Access != "edit" || info.Inspection.Seiten != 3 || info.Capabilities.OCR.State != "available" {
		t.Fatalf("Info = %+v", info)
	}

	// Seite 1 drehen, als neue Fassung: Datei atomar ersetzt, Version 2.
	befehl := CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: d.SHA256,
		Pages:       seitenplan(dokument.Seite{Quelle: 0, Drehung: 90}, dokument.Seite{Quelle: 1}, dokument.Seite{Quelle: 2}),
		Destination: Ziel{Kind: "new_version"}}
	erg, err := a.Speichern(d.ID, befehl, "s1")
	if err != nil {
		t.Fatal(err)
	}
	platte, _ := os.ReadFile(pfad)
	if erg.Version != 2 || d.Version != 2 || !bytes.Equal(platte, d.Basis) || pruefsumme(platte) != erg.SHA256 {
		t.Errorf("nach dem Speichern: Version %d/%d, Platte = Basis %v", erg.Version, d.Version, bytes.Equal(platte, d.Basis))
	}
	if reste, _ := filepath.Glob(filepath.Join(filepath.Dir(pfad), ".*.tmp")); len(reste) > 0 {
		t.Errorf("Nebendateien liegen noch: %v", reste)
	}
	if insp, err := dokument.Inspizieren(context.Background(), bytes.NewReader(platte)); err != nil || insp.Seiten != 3 {
		t.Errorf("Ergebnis nicht lesbar: %v, %+v", err, insp)
	}

	// Jemand anderes schreibt die Datei: Die naechste Fassung wird
	// abgewiesen (412), die Platte bleibt, wie der andere sie liess.
	fremd := korpus.Textseiten(2)
	time.Sleep(20 * time.Millisecond)
	if err := os.WriteFile(pfad, fremd, 0o644); err != nil {
		t.Fatal(err)
	}
	befehl2 := CommitBefehl{ExpectedVersion: 2, ExpectedSHA256: d.SHA256,
		Pages: seitenplan(dokument.Seite{Quelle: 2}, dokument.Seite{Quelle: 1}, dokument.Seite{Quelle: 0}), Destination: Ziel{Kind: "new_version"}}
	_, err = a.Speichern(d.ID, befehl2, "s2")
	f := fehlerVon(t, err)
	if f.Status != http.StatusPreconditionFailed || f.Code != "pdf.version_conflict" || f.Params["current_version"] != float64(2) {
		t.Errorf("Konflikt = %+v", f)
	}
	if platte, _ := os.ReadFile(pfad); !bytes.Equal(platte, fremd) {
		t.Error("die fremde Datei wurde trotzdem ueberschrieben")
	}
	// Auch eine falsche Fassung aus der Oberflaeche ist ein Konflikt.
	_, err = a.Speichern(d.ID, CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: d.SHA256, Pages: befehl2.Pages, Destination: Ziel{Kind: "new_version"}}, "s3")
	if f := fehlerVon(t, err); f.Code != "pdf.version_conflict" {
		t.Errorf("falsche Fassung: %+v", f)
	}

	// Nach dem Konflikt: als neue Datei, aus der Basis, die die Person sah
	// (3 Seiten) — nicht aus der fremden (2 Seiten).
	ordner := t.TempDir()
	befehl2.Destination = zielFuer(a, ordner, "probe (bearbeitet).pdf")
	neu, err := a.Speichern(d.ID, befehl2, "s4")
	if err != nil {
		t.Fatal(err)
	}
	roh, err := os.ReadFile(filepath.Join(ordner, neu.Name))
	if err != nil {
		t.Fatal(err)
	}
	marken, _ := korpus.Marken(roh)
	if neu.Version != 1 || strings.Join(marken, ",") != "SEITE-03,SEITE-02,SEITE-01" {
		t.Errorf("neue Datei: %+v, Marken %v", neu, marken)
	}
	// Derselbe Schluessel mit demselben Rumpf: dasselbe Ergebnis, keine
	// zweite Datei.
	wieder, err := a.Speichern(d.ID, befehl2, "s4")
	if err != nil || wieder.Name != neu.Name {
		t.Errorf("Wiederholung: %+v, %v", wieder, err)
	}
	if eintraege, _ := os.ReadDir(ordner); len(eintraege) != 1 {
		t.Errorf("Wiederholung legte eine zweite Datei an: %d Eintraege", len(eintraege))
	}
	// Derselbe Schluessel mit anderem Rumpf: 409.
	befehl2.Comment = "anders"
	if f := fehlerVon(t, func() error { _, err := a.Speichern(d.ID, befehl2, "s4"); return err }()); f.Code != "pdf.idempotency_mismatch" {
		t.Errorf("anderer Rumpf: %+v", f)
	}
}

func TestAtomarSchreibenLaesstAlteDateiStehen(t *testing.T) {
	ordner := t.TempDir()
	pfad := filepath.Join(ordner, "alt.pdf")
	alt := []byte("%PDF-1.4 alt")
	if err := os.WriteFile(pfad, alt, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := atomarSchreiben(pfad, []byte("%PDF-1.4 neu")); err != nil {
		t.Fatal(err)
	}
	if roh, _ := os.ReadFile(pfad); string(roh) != "%PDF-1.4 neu" {
		t.Errorf("Inhalt = %q", roh)
	}
	// Ordner nicht beschreibbar: Die Nebendatei entsteht nicht, das Alte
	// bleibt unversehrt, nichts liegt herum.
	if os.Getuid() == 0 {
		t.Skip("als root ist jeder Ordner beschreibbar")
	}
	if err := os.Chmod(ordner, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(ordner, 0o700) })
	if err := atomarSchreiben(pfad, []byte("%PDF-1.4 kaputt")); err == nil {
		t.Fatal("Schreiben in schreibgeschuetzten Ordner gelang")
	}
	if roh, _ := os.ReadFile(pfad); string(roh) != "%PDF-1.4 neu" {
		t.Errorf("Inhalt nach Fehlschlag = %q", roh)
	}
	eintraege, _ := os.ReadDir(ordner)
	if len(eintraege) != 1 {
		t.Errorf("Reste im Ordner: %d Eintraege", len(eintraege))
	}
}

// ------------------------------------------------------------------
// Pfad-Kennungen
// ------------------------------------------------------------------

func TestPfadKennungen(t *testing.T) {
	a := attrappenApp(t)
	d, pfad := datei(t, a, "probe.pdf", korpus.Textseiten(1))

	// Nur die vergebene Kennung fuehrt zur Datei — kein Pfad, kein Name.
	for _, falsch := range []string{pfad, "../" + filepath.Base(pfad), "probe.pdf", "/etc/hosts", ""} {
		if _, err := a.Info(falsch); err == nil {
			t.Errorf("Info(%q) lieferte etwas", falsch)
		} else if f := fehlerVon(t, err); f.Status != http.StatusNotFound {
			t.Errorf("Info(%q) = %+v", falsch, f)
		}
	}
	h := a.dateiHandler()
	for _, adresse := range []string{"/datei/" + pfad, "/datei/..%2Fprobe.pdf", "/datei/gibtsnicht", "/auftrag/x/ergebnis", "/etc/hosts"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", adresse, nil))
		// 404 — oder die Umleitung des Multiplexers auf den bereinigten Pfad,
		// die dann ins 404 laeuft; Bytes gibt es nie.
		if w.Code == http.StatusOK || w.Body.Len() > 0 && w.Code < 300 {
			t.Errorf("GET %s = %d, %d Bytes", adresse, w.Code, w.Body.Len())
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/datei/"+d.ID, nil))
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), d.Basis) || w.Header().Get("X-File-Version") != "1" || w.Header().Get("ETag") != `"`+d.SHA256+`"` {
		t.Errorf("GET /datei/{id} = %d, %d Bytes, Koepfe %v", w.Code, w.Body.Len(), w.Header())
	}

	// Ein Ziel muss aus dem Dialog stammen: Ein Ordnerpfad als folder_id
	// ist keine Zielkennung.
	ordner := t.TempDir()
	ziel := Ziel{Kind: "new_file", FolderID: &ordner, Name: "kopie.pdf"}
	_, err := a.Speichern(d.ID, CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: d.SHA256, Pages: seitenplan(dokument.Seite{}), Destination: ziel}, "z1")
	if f := fehlerVon(t, err); f.Status != http.StatusNotFound {
		t.Errorf("Ordnerpfad als Ziel: %+v", f)
	}
	if eintraege, _ := os.ReadDir(ordner); len(eintraege) != 0 {
		t.Error("in den ungepruefteten Ordner wurde geschrieben")
	}
	// Die Ablage kennt nur, was sie selbst vergab; ein Ziel zeigt auf
	// genau seinen Ordner.
	zielID := a.ablage.ZielAnlegen(ordner)
	if o, err := a.ablage.Ziel(zielID); err != nil || o != ordner {
		t.Errorf("Ziel = %q, %v", o, err)
	}
	if _, err := a.ablage.Ziel(ordner); err == nil {
		t.Error("Ordnerpfad als Zielkennung angenommen")
	}
}

// ------------------------------------------------------------------
// Auftraege: Rundlauf und Abbruch
// ------------------------------------------------------------------

func TestSeitenarten(t *testing.T) {
	a := attrappenApp(t)
	text, _ := datei(t, a, "text.pdf", korpus.Textseiten(2))
	arten, err := a.Seitenarten(text.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(arten.Pages) != 2 || arten.Version != 1 {
		t.Fatalf("Seitenarten = %+v", arten)
	}
	// Die Korpus-Textseite traegt Text und kein Bild.
	if arten.Pages[0].Kind != "text" || arten.Pages[0].ImageRatio != 0 || arten.Pages[0].Chars < 20 {
		t.Errorf("Korpusseite = %+v", arten.Pages[0])
	}
	scan, _ := datei(t, a, "scan.pdf", scanPDF(t, scanBild(t)))
	arten, err = a.Seitenarten(scan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if arten.Pages[0].Kind != "scan" || arten.Pages[0].ImageRatio != 1 || arten.Pages[0].Chars != 0 {
		t.Errorf("Scan = %+v", arten.Pages[0])
	}
}

func TestAuftragRundlaufMitAttrappe(t *testing.T) {
	a := attrappenApp(t)
	d, pfad := datei(t, a, "scan.pdf", scanPDF(t, scanBild(t)))

	k, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 1, Options: AuftragOptionenRumpf{Languages: "deu+eng"}}, "o1")
	if err != nil {
		t.Fatal(err)
	}
	if k.State != auftragLaeuft || len(k.RenderPages) != 1 || k.RenderPages[0] != 0 || k.DPI != 300 || k.Progress.Total != 1 {
		t.Fatalf("Auftrag = %+v", k)
	}
	// Dieselbe Anfrage mit demselben Schluessel legt keinen zweiten an.
	if wieder, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 1, Options: AuftragOptionenRumpf{Languages: "deu+eng"}}, "o1"); err != nil || wieder.ID != k.ID {
		t.Errorf("Wiederholung: %+v, %v", wieder, err)
	}
	liste, _ := a.Auftraege(d.ID)
	if len(liste) != 1 {
		t.Errorf("Liste = %d Auftraege", len(liste))
	}
	if err := a.SeiteLiefern(k.ID, 0, base64.StdEncoding.EncodeToString(scanBild(t)), ""); err != nil {
		t.Fatal(err)
	}
	if err := a.SeiteLiefern(k.ID, 0, "", ""); err == nil {
		t.Error("Seite zweimal geliefert")
	}
	fertig := warten(t, a, k.ID)
	if fertig.State != auftragFertig || fertig.Result == nil || fertig.Progress.Done != 1 {
		t.Fatalf("Ende = %+v, Fehler %+v", fertig, fertig.Error)
	}
	var meta ocrMeta
	if err := json.Unmarshal(fertig.Result.Meta, &meta); err != nil || meta.Words != 4 || len(meta.PagesRecognized) != 1 || len(meta.LowConfidencePages) != 1 {
		t.Errorf("Meta = %s (%v)", fertig.Result.Meta, err)
	}
	// Das Ergebnis traegt die Textebene mit den Woertern der Attrappe.
	roh, _, err := a.auftraege.Ergebnis(k.ID, auftragArtOCR)
	if err != nil {
		t.Fatal(err)
	}
	texte, err := dokument.TextebeneLesen(context.Background(), roh, nil)
	if err != nil {
		t.Fatal(err)
	}
	if woerter := texteAls(texte); !strings.Contains(woerter, "Rechnung") || !strings.Contains(woerter, "00123") {
		t.Errorf("Textebene = %q", woerter)
	}

	// Veroeffentlichen als neue Fassung: Datei ersetzt, Auftrag verbraucht.
	erg, err := a.AuftragVeroeffentlichen(k.ID, AuftragCommit{Destination: Ziel{Kind: "new_version"}}, "c1")
	if err != nil {
		t.Fatal(err)
	}
	platte, _ := os.ReadFile(pfad)
	if erg.Version != 2 || !bytes.Equal(platte, roh) {
		t.Errorf("Veroeffentlicht: %+v, Platte = Ergebnis %v", erg, bytes.Equal(platte, roh))
	}
	if _, err := a.Auftrag(k.ID); err == nil {
		t.Error("verbrauchter Auftrag noch da")
	}
	// Seiten mit Text werden nicht noch einmal belegt.
	_, err = a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 2, Options: AuftragOptionenRumpf{Pages: &[]int{0}}}, "o2")
	if f := fehlerVon(t, err); f.Code != "pdf.ocr_page_has_text" {
		t.Errorf("Seite mit Text: %+v", f)
	}
}

func texteAls(texte []dokument.Seitentext) string {
	var b strings.Builder
	for _, st := range texte {
		for _, bl := range st.Bloecke {
			for _, z := range bl {
				for _, w := range z.Woerter {
					b.WriteString(w.Text + " ")
				}
			}
		}
	}
	return b.String()
}

func TestAuftragAbbruch(t *testing.T) {
	t.Setenv("ATTRAPPE_SCHLAF", "5")
	a := attrappenApp(t)
	d, _ := datei(t, a, "scan.pdf", scanPDF(t, scanBild(t)))
	k, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 1}, "o1")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SeiteLiefern(k.ID, 0, base64.StdEncoding.EncodeToString(scanBild(t)), ""); err != nil {
		t.Fatal(err)
	}
	intern, _ := a.auftraege.holen(k.ID)
	ordner := intern.ordner
	beginn := time.Now()
	nach, err := a.AuftragAbbrechen(k.ID)
	if err != nil {
		t.Fatal(err)
	}
	if nach.State != auftragAbgebrochen || time.Since(beginn) > 3*time.Second {
		t.Errorf("nach Abbruch: %s nach %s", nach.State, time.Since(beginn))
	}
	select {
	case <-intern.fertig:
	default:
		t.Error("Goroutine laeuft nach dem Abbruch weiter")
	}
	if _, err := os.Stat(ordner); !errors.Is(err, os.ErrNotExist) {
		t.Error("Arbeitsordner nicht weggeraeumt")
	}
	if err := a.SeiteLiefern(k.ID, 0, "eA==", ""); err == nil {
		t.Error("Seite nach Abbruch angenommen")
	} else if f := fehlerVon(t, err); f.Status != http.StatusConflict {
		t.Errorf("Seite nach Abbruch: %+v", f)
	}
	if liste, _ := a.Auftraege(d.ID); len(liste) != 0 {
		t.Errorf("abgebrochener Auftrag in der Liste: %d", len(liste))
	}
	if _, _, err := a.auftraege.Ergebnis(k.ID, auftragArtOCR); err == nil {
		t.Error("Ergebnis eines abgebrochenen Auftrags")
	}
}

func TestAuftragRasternGescheitert(t *testing.T) {
	a := attrappenApp(t)
	d, _ := datei(t, a, "scan.pdf", scanPDF(t, scanBild(t)))
	k, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 1}, "o1")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SeiteLiefern(k.ID, 0, "", "render_failed"); err != nil {
		t.Fatal(err)
	}
	ende := warten(t, a, k.ID)
	if ende.State != auftragGescheitert || ende.Error == nil || ende.Error.Code != "render_failed" {
		t.Errorf("Ende = %+v", ende)
	}
}

func TestAnalyseUndExport(t *testing.T) {
	a := attrappenApp(t)
	d, _ := datei(t, a, "text.pdf", mussLesen(t, "testdata/textseite.pdf"))
	k, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "analyse", ExpectedVersion: 1}, "a1")
	if err != nil {
		t.Fatal(err)
	}
	// Die Textseite hat eine Textebene: nichts zu rastern.
	if len(k.RenderPages) != 0 {
		t.Errorf("RenderPages = %v", k.RenderPages)
	}
	ende := warten(t, a, k.ID)
	if ende.State != auftragFertig {
		t.Fatalf("Ende = %+v, %+v", ende, ende.Error)
	}
	dok, err := a.Modell(k.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(dok.Seiten) != 1 || len(dok.Seiten[0].Bloecke) == 0 {
		t.Fatalf("Modell = %+v", dok)
	}
	ordner := t.TempDir()
	erg, err := a.Exportieren(k.ID, ExportBefehl{Format: "docx", NumberLocale: "de", Destination: zielFuer(a, ordner, "text.docx")}, "e1")
	if err != nil {
		t.Fatal(err)
	}
	if st, err := os.Stat(filepath.Join(ordner, erg.Name)); err != nil || st.Size() != erg.Size || erg.Name != "text.docx" {
		t.Errorf("Export = %+v, %v", erg, err)
	}
	if _, err := a.Exportieren(k.ID, ExportBefehl{Format: "pdf", Destination: zielFuer(a, ordner, "x.pdf")}, "e2"); err == nil {
		t.Error("Format pdf angenommen")
	}
}

func mussLesen(t *testing.T, pfad string) []byte {
	t.Helper()
	roh, err := os.ReadFile(pfad)
	if err != nil {
		t.Fatal(err)
	}
	return roh
}

// ------------------------------------------------------------------
// Stempel: Name und Datum setzt die Go-Seite
// ------------------------------------------------------------------

// anmerkungstexte liest /Contents aller Anmerkungen der ersten Seite —
// mit pdfcpu, nicht mit dem Adapter, der sie schrieb.
func anmerkungstexte(t *testing.T, pdf []byte) []string {
	t.Helper()
	ctx, err := api.ReadAndValidate(context.Background(), bytes.NewReader(pdf), model.NewDefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	x := ctx.XRefTable
	seite, _, _, err := x.PageDict(context.Background(), 1, false)
	if err != nil {
		t.Fatal(err)
	}
	annots, err := x.DereferenceArray(seite["Annots"])
	if err != nil {
		t.Fatal(err)
	}
	var aus []string
	for _, o := range annots {
		d, err := x.DereferenceDict(o)
		if err != nil || d == nil {
			continue
		}
		if s, err := x.DereferenceStringOrHexLiteral(d["Contents"], model.V10, nil); err == nil {
			aus = append(aus, s)
		}
	}
	return aus
}

func TestStempelNameUndDatumVonGo(t *testing.T) {
	a := attrappenApp(t)
	d, pfad := datei(t, a, "probe.pdf", korpus.Textseiten(1))
	// Die Oberflaeche schickt weder Namen noch Datum — nur stamp.
	befehl := CommitBefehl{ExpectedVersion: 1, ExpectedSHA256: d.SHA256, Destination: Ziel{Kind: "new_version"},
		Annotations: &dokument.Anmerkungsbefehle{Add: []dokument.NeueAnmerkung{{
			ClientID: "c1", Page: 0, Kind: "stamp", Rect: []float64{72, 600, 300, 660}, Color: []float64{0.776, 0.157, 0.157},
			Stamp: &dokument.Stempel{Label: "GEPRÜFT", Name: "Checked", Signed: true, Lang: "de"},
		}}}}
	erg, err := a.Speichern(d.ID, befehl, "st1")
	if err != nil {
		t.Fatal(err)
	}
	if erg.Annotations == nil || len(erg.Annotations.Added) != 1 || erg.Report.AnmerkungenNeu != 1 {
		t.Fatalf("Ergebnis = %+v", erg)
	}
	texte := anmerkungstexte(t, mussLesen(t, pfad))
	erwartet := "GEPRÜFT\nErika Musterfrau · 30.09.2026"
	if len(texte) != 1 || texte[0] != erwartet {
		t.Errorf("Contents = %q, erwartet %q", texte, erwartet)
	}
	// Der Name kommt aus os/user, nicht aus der Oberflaeche: ein Befehl
	// mit gesetztem Autor wird ueberschrieben.
	befehl.ExpectedVersion, befehl.ExpectedSHA256 = 2, d.SHA256
	befehl.Annotations.Autor = "Fremder"
	if _, err := a.Speichern(d.ID, befehl, "st2"); err != nil {
		t.Fatal(err)
	}
	texte = anmerkungstexte(t, mussLesen(t, pfad))
	for _, s := range texte {
		if strings.Contains(s, "Fremder") {
			t.Errorf("Autor aus der Oberflaeche uebernommen: %q", s)
		}
	}
}

// ------------------------------------------------------------------
// Fehlerform
// ------------------------------------------------------------------

func TestFehlerForm(t *testing.T) {
	err := kernFehler(dokument.ErrKeineSeiten)
	f := fehlerVon(t, err)
	if f.Status != 422 || f.Code != "pdf.no_pages" {
		t.Errorf("kernFehler = %+v", f)
	}
	var roh map[string]any
	if err := json.Unmarshal([]byte(konflikt(3).Error()), &roh); err != nil || roh["status"] != float64(412) || roh["params"].(map[string]any)["current_version"] != float64(3) {
		t.Errorf("konflikt = %s", konflikt(3).Error())
	}
	if _, ok := errors.Unwrap(intern(errors.New("x"))).(*Fehler); ok {
		t.Error("intern wickelt doppelt")
	}
	_ = types.Name("x")
}

// Rechte-Bits beim Anlegen eines Auftrags, wie im Server: Analyse braucht
// das Kopier-Bit, Texterkennung das Aendern-Bit — oder das Rechte-Kennwort
// im Befehl, das nirgends bleibt. Die Textebene einer geschuetzten Datei
// kann der lokale Leser nicht lesen (Bestand); darum zeigt hier nach
// bestandener Rechtepruefung ein ANDERER Fehler, dass sie passiert wurde.
func TestAuftragStartenRechteBits(t *testing.T) {
	a := attrappenApp(t)
	gesperrt, err := korpus.MitBesitzerpasswort() // nur Drucken
	if err != nil {
		t.Fatal(err)
	}
	d, _ := datei(t, a, "gesperrt.pdf", gesperrt)
	analyse := func(besitzer, schluessel string) *Fehler {
		_, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "analyse", ExpectedVersion: 1, OwnerPassword: besitzer}, schluessel)
		return fehlerVon(t, err)
	}
	if f := analyse("", "r1"); f.Code != "pdf.permission_restricted" || fmt.Sprint(f.Params["restricted"]) != "[copy]" {
		t.Errorf("ohne Kopier-Bit: %+v", f)
	}
	if f := analyse("falsch-789", "r2"); f.Code != "pdf.wrong_password" {
		t.Errorf("falsches Rechte-Kennwort: %+v", f)
	}
	// Mit Rechte-Kennwort laeuft die Analyse an: Seit #253 entschluesselt
	// der lokale Leser die Datei im Speicher (AES-256); bis 2314 endete sie
	// hier bei pdf.unreadable.
	if _, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "analyse", ExpectedVersion: 1, OwnerPassword: korpus.ProbeBesitzerpasswort}, "r3"); err != nil {
		t.Errorf("mit Rechte-Kennwort: %v", err)
	}
	ocr := func(besitzer, schluessel string) *Fehler {
		_, err := a.AuftragStarten(d.ID, AuftragBefehl{Kind: "ocr", ExpectedVersion: 1, OwnerPassword: besitzer}, schluessel)
		return fehlerVon(t, err)
	}
	if f := ocr("", "o1"); f.Code != "pdf.permission_restricted" || fmt.Sprint(f.Params["restricted"]) != "[modify]" {
		t.Errorf("Texterkennung ohne Aendern-Bit: %+v", f)
	}
	if f := ocr(korpus.ProbeBesitzerpasswort, "o2"); f.Code == "pdf.permission_restricted" || f.Code == "pdf.wrong_password" {
		t.Errorf("Texterkennung mit Rechte-Kennwort an der Rechtepruefung gescheitert: %+v", f)
	}
	// Ungeschuetzt: wie bisher ohne Kennwort.
	frei, _ := datei(t, a, "frei.pdf", korpus.Rechnung())
	if _, err := a.AuftragStarten(frei.ID, AuftragBefehl{Kind: "analyse", ExpectedVersion: 1}, "f1"); err != nil {
		t.Errorf("ungeschuetzt: %v", err)
	}
}

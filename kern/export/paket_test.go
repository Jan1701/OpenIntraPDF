// SPDX-License-Identifier: Apache-2.0

package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

// Paketgueltigkeit: DOCX und ODT enthalten die Pflichtteile, jedes XML
// ist wohlgeformt; LibreOffice oeffnet beide (wenn installiert); XLSX
// laesst sich mit Excelize zuruecklesen, mit den richtigen Zelltypen.

// beispiel ist ein Modell mit allem: Ueberschrift, Absatz, Liste, Tabelle
// ueber zwei Seiten (Seite 2 beginnt mit ihrer Fortsetzung), Kopfzeile
// auf drei Seiten, Bild auf einer Seite.
func beispiel() Dokument {
	kopfzeile := func(b *seitenbauer) *seitenbauer {
		b.s.Bloecke = append([]Wortblock{{Zeilen: []Wortzeile{{Woerter: []Wort{{X0: 72, Y0: 20, X1: 200, Y1: 28, Text: "Musterfirma", Konf: -1},
			{X0: 205, Y0: 20, X1: 240, Y1: 28, Text: "GmbH", Konf: -1}}}}}}, b.s.Bloecke...)
		return b
	}
	s1 := kopfzeile(rechnungsseite(0, 700))
	s2 := neueSeite(1)
	s2.block().zeile(40, 10, "72:Pos", "110:Artikel", "R 400:Menge", "R 500:Betrag").
		zeile(54, 10, "72:4", "110:Regal", "R 400:1", "R 500:89,00").
		zeile(68, 10, "72:5", "110:Sessel", "R 400:2", "R 500:299,00")
	s2.block().zeile(140, 10, "72:Enthalten:").zeile(152, 10, "72:• Lieferung").zeile(164, 10, "72:• Aufbau & Einweisung <frei>")
	kopfzeile(s2)
	s3 := kopfzeile(rechnungsseite(2, 300))
	s3.s.Bildanteil = 0.4
	return Erkennen([]Seitenwoerter{s1.fertig(), s2.fertig(), s3.fertig()})
}

// teile liest ein ZIP und prueft jedes XML auf Wohlgeformtheit.
func teile(t *testing.T, roh []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(roh), int64(len(roh)))
	if err != nil {
		t.Fatalf("kein ZIP: %v", err)
	}
	aus := map[string]string{}
	for _, f := range zr.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		inhalt, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		aus[f.Name] = string(inhalt)
		if strings.HasSuffix(f.Name, ".xml") || strings.HasSuffix(f.Name, ".rels") {
			d := xml.NewDecoder(bytes.NewReader(inhalt))
			for {
				_, err := d.Token()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Errorf("%s nicht wohlgeformt: %v", f.Name, err)
					break
				}
			}
		}
	}
	return aus
}

func TestDOCX(t *testing.T) {
	dok := beispiel()
	var aus bytes.Buffer
	warn, err := DOCX(&aus, dok, Optionen{})
	if err != nil {
		t.Fatal(err)
	}
	p := teile(t, aus.Bytes())
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml"} {
		if _, ok := p[name]; !ok {
			t.Errorf("Teil %s fehlt", name)
		}
	}
	d := p["word/document.xml"]
	if !strings.Contains(d, `<w:pStyle w:val="Heading1"/>`) || !strings.Contains(d, `<w:numId w:val="1"/>`) || !strings.Contains(d, `<w:tbl>`) {
		t.Error("Ueberschrift, Liste oder Tabelle fehlt")
	}
	if n := strings.Count(d, ">Musterfirma GmbH<"); n != 1 {
		t.Errorf("Kopfzeile %d-mal, erwartet einmal", n)
	}
	if n := strings.Count(d, "<w:tbl>"); n != 2 {
		t.Errorf("%d Tabellen, erwartet 2 (Seite 1+2 zusammengefuehrt, Seite 3)", n)
	}
	// Ein Seitenumbruch: vor Seite 3. Seite 2 setzt die Tabelle fort.
	if n := strings.Count(d, `<w:br w:type="page"/>`); n != 1 {
		t.Errorf("%d Seitenumbrueche, erwartet 1", n)
	}
	if !strings.Contains(d, "Aufbau &amp; Einweisung &lt;frei&gt;") {
		t.Error("XML nicht maskiert")
	}
	if strings.Contains(d, "&#8226;") || strings.Contains(d, ">• ") {
		t.Error("Listenmarke steht im Text")
	}
	if !strings.Contains(d, `<w:tblHeader/>`) || !strings.Contains(d, `<w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">Betrag</w:t>`) {
		t.Error("Kopfzeile der Tabelle nicht fett")
	}
	if strings.Contains(d, "http://") && strings.Count(d, "http://") != strings.Count(d, "schemas.openxmlformats.org") {
		t.Error("externer Verweis")
	}
	if w, ok := warnungMit(warn, WarnungBilder); !ok || w.Count != 1 || w.Pages[0] != 2 {
		t.Errorf("Bilderwarnung %+v %v", w, ok)
	}
	voll := bytes.Clone(aus.Bytes())
	// Abgewaehlte Tabelle fehlt.
	aus.Reset()
	if _, err := DOCX(&aus, dok, Optionen{Tabellen: []Tabellenwahl{{Index: 0, Include: false}}}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(teile(t, aus.Bytes())["word/document.xml"], `<w:tbl>`) {
		t.Error("abgewaehlte Tabelle geschrieben")
	}
	if _, err := DOCX(&aus, dok, Optionen{Tabellen: []Tabellenwahl{{Index: 9, Include: true}}}); !errors.Is(err, ErrTabelleFehlt) {
		t.Errorf("Index 9: %v", err)
	}
	libreofficeProbe(t, "docx", voll, dok)
}

func TestODT(t *testing.T) {
	dok := beispiel()
	var aus bytes.Buffer
	if _, err := ODT(&aus, dok, Optionen{}); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(aus.Bytes()), int64(aus.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(zr.File) == 0 || zr.File[0].Name != "mimetype" || zr.File[0].Method != zip.Store {
		t.Error("mimetype muss der erste, unkomprimierte Eintrag sein")
	}
	p := teile(t, aus.Bytes())
	if p["mimetype"] != odtMime {
		t.Errorf("mimetype %q", p["mimetype"])
	}
	for _, name := range []string{"META-INF/manifest.xml", "content.xml", "styles.xml"} {
		if _, ok := p[name]; !ok {
			t.Errorf("Teil %s fehlt", name)
		}
	}
	c := p["content.xml"]
	if !strings.Contains(c, `<text:h text:style-name="Heading_20_1" text:outline-level="1">Rechnung 00123</text:h>`) ||
		!strings.Contains(c, `<text:list text:style-name="L1">`) || !strings.Contains(c, `<table:table table:name="Tabelle1">`) ||
		!strings.Contains(c, `<table:table-header-rows>`) {
		t.Error("Ueberschrift, Liste, Tabelle oder Kopfzeile fehlt")
	}
	if n := strings.Count(c, `text:style-name="Pumbruch"`); n != 1 {
		t.Errorf("%d Seitenumbrueche, erwartet 1", n)
	}
	if strings.Count(c, ">Musterfirma GmbH<") != 1 || strings.Count(c, "<table:table ") != 2 {
		t.Errorf("Kopfzeile %d-mal, Tabellen %d-mal", strings.Count(c, ">Musterfirma GmbH<"), strings.Count(c, "<table:table "))
	}
	libreofficeProbe(t, "odt", aus.Bytes(), dok)
}

// sofficeFinden sucht LibreOffice: OIH_SOFFICE, PATH, dann der Mac-Pfad.
func sofficeFinden() string {
	if p := os.Getenv("OIH_SOFFICE"); p != "" {
		return p
	}
	if p, err := exec.LookPath("soffice"); err == nil {
		return p
	}
	if p := "/Applications/LibreOffice.app/Contents/MacOS/soffice"; fileExists(p) {
		return p
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// libreofficeProbe oeffnet die Datei mit soffice --headless und wandelt
// sie in ein PDF; ohne LibreOffice SKIP. Mit pdftotext wird dazu geprueft,
// dass der Text angekommen ist.
func libreofficeProbe(t *testing.T, endung string, roh []byte, dok Dokument) {
	t.Helper()
	soffice := sofficeFinden()
	if soffice == "" {
		t.Skip("LibreOffice nicht gefunden (OIH_SOFFICE, PATH, /Applications)")
	}
	ordner := t.TempDir()
	quelle := filepath.Join(ordner, "probe."+endung)
	if err := os.WriteFile(quelle, roh, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, abbrechen := context.WithTimeout(context.Background(), 3*time.Minute)
	defer abbrechen()
	// Eigenes Profil: Ein laufendes LibreOffice der Person darf den Lauf
	// nicht verschlucken.
	profil := "file://" + filepath.ToSlash(filepath.Join(ordner, "profil"))
	cmd := exec.CommandContext(ctx, soffice, "-env:UserInstallation="+profil, "--headless", "--convert-to", "pdf", "--outdir", ordner, quelle)
	ausgabe, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("soffice: %v\n%s", err, ausgabe)
	}
	pdf, err := os.ReadFile(filepath.Join(ordner, "probe.pdf"))
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatalf("kein PDF aus LibreOffice: %v\n%s", err, ausgabe)
	}
	// OIH_EXPORT_PROBEN=<Ordner>: Quelle und PDF dort ablegen, um sie von
	// Hand in Writer, Word oder der Vorschau zu sichten.
	if ziel := os.Getenv("OIH_EXPORT_PROBEN"); ziel != "" {
		_ = os.MkdirAll(ziel, 0o750)
		_ = os.WriteFile(filepath.Join(ziel, "probe."+endung), roh, 0o600)
		_ = os.WriteFile(filepath.Join(ziel, "probe-"+endung+".pdf"), pdf, 0o600)
	}
	if pdftotext, err := exec.LookPath("pdftotext"); err == nil {
		text, err := exec.CommandContext(ctx, pdftotext, filepath.Join(ordner, "probe.pdf"), "-").Output()
		if err != nil {
			t.Fatalf("pdftotext: %v", err)
		}
		for _, erwartet := range []string{"Rechnung 00123", "Schreibtisch", "1.249,50", "Lieferung"} {
			if !strings.Contains(string(text), erwartet) {
				t.Errorf("%q fehlt im PDF aus LibreOffice", erwartet)
			}
		}
	}
	t.Logf("%s in LibreOffice geoeffnet und als PDF geschrieben (%d Bytes)", endung, len(pdf))
}

func TestXLSX(t *testing.T) {
	dok := eineTabelle(1,
		[]string{"Nr", "Betrag", "Datum", "Lieferung", "Hinweis"},
		[]string{"00123", "1.234,56", "03.04.2026", "03/04/2026", "=SUMME(A1)"},
		[]string{"00124", "-12,50", "2026-04-04", "04/04/2026", ""},
	)
	var aus bytes.Buffer
	warn, err := XLSX(&aus, dok, Optionen{Tabellen: []Tabellenwahl{{Index: 0, Include: true, HeaderRows: 1,
		ColumnTypes: []string{TypText, TypZahl, TypDatum, TypDatum, TypText}}}})
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(aus.Bytes()))
	if err != nil {
		t.Fatalf("XLSX nicht lesbar: %v", err)
	}
	defer f.Close()
	if f.GetSheetName(0) != "Tabelle 1" || f.SheetCount != 1 {
		t.Errorf("Blaetter %v", f.GetSheetList())
	}
	art := func(zelle string) excelize.CellType {
		a, err := f.GetCellType("Tabelle 1", zelle)
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	wert := func(zelle string) string {
		v, err := f.GetCellValue("Tabelle 1", zelle)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	// Zeichenketten tragen t="s"; Zahlen und Daten haben kein t-Attribut
	// (Excelize: CellTypeUnset) und einen Zahlenwert.
	istText := func(zelle string) bool {
		return art(zelle) == excelize.CellTypeSharedString || art(zelle) == excelize.CellTypeInlineString
	}
	if !istText("A2") || wert("A2") != "00123" {
		t.Errorf("A2: %v %q — fuehrende Nullen verloren", art("A2"), wert("A2"))
	}
	roh := func(zelle string) string {
		v, err := f.GetCellValue("Tabelle 1", zelle, excelize.Options{RawCellValue: true})
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	if istText("B2") || roh("B2") != "1234.56" || istText("B3") || roh("B3") != "-12.5" {
		t.Errorf("B2/B3: %v %q %q", art("B2"), roh("B2"), roh("B3"))
	}
	// Die Anzeige behaelt die Nachkommastellen aus dem PDF: -12,50 bleibt
	// zweistellig, nicht -12,5.
	if wert("B3") != "-12.50" || wert("B2") != "1,234.56" {
		t.Errorf("Zahlformat B2/B3: %q %q", wert("B2"), wert("B3"))
	}
	if istText("C2") || wert("C2") != "03.04.2026" || wert("C3") != "04.04.2026" {
		t.Errorf("C2/C3 (Datum): %v %q %q", art("C2"), wert("C2"), wert("C3"))
	}
	if !istText("A1") || !istText("B1") || wert("B1") != "Betrag" {
		t.Errorf("Kopfzeile: %v %q", art("B1"), wert("B1"))
	}
	if !istText("D2") || wert("D2") != "03/04/2026" {
		t.Errorf("D2: %v %q — mehrdeutiges Datum still gedeutet", art("D2"), wert("D2"))
	}
	if !istText("E2") || wert("E2") != "=SUMME(A1)" {
		t.Errorf("E2: %v %q — Formel entstanden", art("E2"), wert("E2"))
	}
	if formel, _ := f.GetCellFormula("Tabelle 1", "E2"); formel != "" {
		t.Errorf("E2 hat eine Formel: %q", formel)
	}
	stilID, _ := f.GetCellStyle("Tabelle 1", "A1")
	if stil, err := f.GetStyle(stilID); err != nil || stil.Font == nil || !stil.Font.Bold {
		t.Errorf("Kopfzeile nicht fett: %v %+v", err, stil)
	}
	if w, ok := warnungMit(warn, WarnungDatumBleibtText); !ok || w.Count != 2 {
		t.Errorf("Datumswarnung %+v %v", w, ok)
	}
	// Zwei Tabellen, zwei Blaetter; ohne gewaehlte Tabelle ein Fehler.
	zwei := dok
	zweite := *dok.Tabellen()[0]
	zweite.Index = 1
	zwei.Seiten = append(zwei.Seiten, Seite{Nr: 1, Bloecke: []Block{{Art: ArtTabelle, Tabelle: &zweite}}})
	aus.Reset()
	if _, err := XLSX(&aus, zwei, Optionen{}); err != nil {
		t.Fatal(err)
	}
	if g, _ := excelize.OpenReader(bytes.NewReader(aus.Bytes())); g.SheetCount != 2 || g.GetSheetName(1) != "Tabelle 2" {
		t.Errorf("Blaetter %v", g.GetSheetList())
	}
	if _, err := XLSX(&aus, dok, Optionen{Tabellen: []Tabellenwahl{{Index: 0, Include: false}}}); !errors.Is(err, ErrTabelleFehlt) {
		t.Errorf("ohne Tabelle: %v", err)
	}
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Eigenschaften (Etappe 8): Info-Woerterbuch und XMP. Gelesen wird das
// Ergebnis mit pdfcpu (ReadAndValidate ueber lesen) und das XMP mit
// pdfcpus eigenem Modell (model.XMPMeta) — nicht mit dem Code, der es
// geschrieben hat. Die pdf.js-Seite prueft eigenschaften.pdfjs.test.ts im
// Frontend an der Probe, die TestEigenschaftenProbeSchreiben erzeugt.

func str(s string) *string { return &s }

func eigenschaftenCommit(t *testing.T, quelle []byte, e *Eigenschaften) []byte {
	t.Helper()
	var aus bytes.Buffer
	if _, _, err := CommitBauenMit(context.Background(), bytes.NewReader(quelle), nil, nil, e, &aus); err != nil {
		t.Fatalf("CommitBauenMit: %v", err)
	}
	return aus.Bytes()
}

// infoWerte liest Title, Subject, Author, Keywords, Producer aus dem Ergebnis.
func infoWerte(t *testing.T, pdf []byte) map[string]string {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	aus := map[string]string{}
	if ctx.Info == nil {
		return aus
	}
	d, err := ctx.DereferenceDict(*ctx.Info)
	if err != nil || d == nil {
		t.Fatalf("Info: %v", err)
	}
	for _, k := range []string{"Title", "Subject", "Author", "Keywords", "Producer"} {
		if s, ok := alsText(ctx.XRefTable, d[k]); ok {
			aus[k] = s
		}
	}
	return aus
}

// xmpVon liefert den XMP-Text des Katalogs, "" ohne Metadata.
func xmpVon(t *testing.T, pdf []byte) string {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	katalog := katalogVon(t, ctx)
	sd, ok := aufloesen(ctx.XRefTable, katalog["Metadata"]).(types.StreamDict)
	if !ok {
		return ""
	}
	if err := sd.Decode(); err != nil {
		t.Fatal(err)
	}
	return string(sd.Content)
}

func TestEigenschaftenInfoUndXMP(t *testing.T) {
	quelle := korpus.PDFA() // Info-Woerterbuch und XMP mit dc:title und pdfaid
	aus := eigenschaftenCommit(t, quelle, &Eigenschaften{
		Title: str("Angebot Küche – Müller & Söhne"), Subject: str("Rechnung 00123 <geprüft>"),
		Author: str("Erika Musterfrau"), Keywords: str("Rechnung; Küche; 2026"),
	})
	info := infoWerte(t, aus)
	if info["Title"] != "Angebot Küche – Müller & Söhne" || info["Subject"] != "Rechnung 00123 <geprüft>" ||
		info["Author"] != "Erika Musterfrau" || info["Keywords"] != "Rechnung; Küche; 2026" {
		t.Errorf("Info %+v", info)
	}
	if !strings.HasPrefix(info["Producer"], "pdfcpu") {
		t.Errorf("Producer %q — setzt pdfcpu bei jedem Commit", info["Producer"])
	}
	xmp := xmpVon(t, aus)
	var meta model.XMPMeta
	if err := xml.Unmarshal([]byte(xmp), &meta); err != nil {
		t.Fatalf("XMP nach pdfcpu-Modell nicht lesbar: %v\n%s", err, xmp)
	}
	d := meta.RDF.Description
	if len(d.Title.Alt.Entries) != 1 || d.Title.Alt.Entries[0] != "Angebot Küche – Müller & Söhne" {
		t.Errorf("dc:title %+v", d.Title)
	}
	if len(d.Subject.Alt.Entries) != 1 || d.Subject.Alt.Entries[0] != "Rechnung 00123 <geprüft>" {
		t.Errorf("dc:description %+v", d.Subject)
	}
	if len(d.Author.Seq.Entries) != 1 || d.Author.Seq.Entries[0] != "Erika Musterfrau" {
		t.Errorf("dc:creator %+v", d.Author)
	}
	if d.Keywords != "Rechnung; Küche; 2026" {
		t.Errorf("pdf:Keywords %q", d.Keywords)
	}
	// Der alte Titel ist ersetzt, nicht verdoppelt; die PDF/A-Kennung bleibt.
	if strings.Count(xmp, "<dc:title") != 1 || strings.Contains(xmp, "Musterfirma GmbH - Probe") {
		t.Errorf("dc:title doppelt oder alt:\n%s", xmp)
	}
	if !strings.Contains(xmp, "<pdfaid:part>2</pdfaid:part>") || !enthaeltPdfaKennung([]byte(xmp)) {
		t.Errorf("PDF/A-Kennung verloren:\n%s", xmp)
	}
	if !strings.HasPrefix(xmp, "<?xpacket begin") || !strings.Contains(xmp, `<?xpacket end="w"?>`) {
		t.Errorf("Paketrahmen verloren:\n%s", xmp)
	}

	// Leerer String entfernt: Autor und Stichwoerter weg, Titel bleibt.
	aus2 := eigenschaftenCommit(t, aus, &Eigenschaften{Author: str(""), Keywords: str("  ")})
	info2 := infoWerte(t, aus2)
	if _, da := info2["Author"]; da {
		t.Errorf("Author nicht entfernt: %+v", info2)
	}
	if _, da := info2["Keywords"]; da {
		t.Errorf("Keywords nicht entfernt: %+v", info2)
	}
	if info2["Title"] != "Angebot Küche – Müller & Söhne" {
		t.Errorf("Titel verloren: %+v", info2)
	}
	xmp2 := xmpVon(t, aus2)
	if strings.Contains(xmp2, "dc:creator") || strings.Contains(xmp2, "pdf:Keywords") || !strings.Contains(xmp2, "<dc:title") {
		t.Errorf("XMP nach Entfernen:\n%s", xmp2)
	}
	popplerOhneSyntaxfehler(t, aus2)
}

func TestEigenschaftenOhneXMPUndOhneInfo(t *testing.T) {
	// Ohne XMP-Strom wird keiner angelegt.
	aus := eigenschaftenCommit(t, korpus.Textseiten(2), &Eigenschaften{Title: str("Nur Info")})
	if xmpVon(t, aus) != "" {
		t.Error("XMP angelegt, obwohl keiner da war")
	}
	if infoWerte(t, aus)["Title"] != "Nur Info" {
		t.Errorf("Info %+v", infoWerte(t, aus))
	}
	// Die Seiten bleiben, wie sie sind.
	if m, err := korpus.Marken(aus); err != nil || strings.Join(m, ",") != "SEITE-01,SEITE-02" {
		t.Errorf("Marken %v %v", m, err)
	}

	// Ohne Info-Woerterbuch entsteht eines.
	ohneInfo := regexp.MustCompile(`/Info \d+ 0 R`).ReplaceAll(korpus.Textseiten(1), []byte("/Info 999 0 R"))
	ohneInfo = bytes.ReplaceAll(ohneInfo, []byte("/Info 999 0 R"), []byte("            "))
	if ctx := geoeffnet(t, ohneInfo); ctx.Info != nil {
		t.Fatal("Probe hat noch ein Info-Woerterbuch")
	}
	aus2 := eigenschaftenCommit(t, ohneInfo, &Eigenschaften{Author: str("Max Mustermann")})
	if infoWerte(t, aus2)["Author"] != "Max Mustermann" {
		t.Errorf("Info %+v", infoWerte(t, aus2))
	}
}

// XMP ohne dc-Deklaration in der ersten rdf:Description, mit fremdem Prefix
// fuer den pdf-Namensraum und Attributform fuer Keywords.
func TestEigenschaftenXmpTextFormen(t *testing.T) {
	xmp := `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:p="http://ns.adobe.com/pdf/1.3/" p:Keywords="alt" p:Producer="X"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
	neu, geaendert := xmpText(xmp, []eigenschaftsfeld{{"keywords", "neu"}, {"title", "T"}, {"author", ""}})
	if !geaendert {
		t.Fatal("nichts geaendert")
	}
	if strings.Contains(neu, `p:Keywords="alt"`) || !strings.Contains(neu, "<p:Keywords>neu</p:Keywords>") {
		t.Errorf("Keywords:\n%s", neu)
	}
	if !strings.Contains(neu, `xmlns:dc="http://purl.org/dc/elements/1.1/"`) || !strings.Contains(neu, `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">T</rdf:li></rdf:Alt></dc:title>`) {
		t.Errorf("Titel:\n%s", neu)
	}
	if !strings.Contains(neu, `p:Producer="X"`) || strings.Contains(neu, "dc:creator") {
		t.Errorf("Fremdes veraendert:\n%s", neu)
	}
	var meta model.XMPMeta
	if err := xml.Unmarshal([]byte(neu), &meta); err != nil || meta.RDF.Description.Keywords != "neu" || meta.RDF.Description.Title.Alt.Entries[0] != "T" {
		t.Errorf("nach pdfcpu-Modell: %v %+v", err, meta.RDF.Description)
	}
	// Die selbstschliessende Description wird dabei geoeffnet.
	if strings.Contains(neu, "/>") && !strings.Contains(neu, "</rdf:Description>") {
		t.Errorf("Description nicht geoeffnet:\n%s", neu)
	}
	// Ohne Beschreibung und ohne RDF bleibt alles, wie es ist.
	if aus, g := xmpText("<x:xmpmeta/>", []eigenschaftsfeld{{"title", "T"}}); g || aus != "<x:xmpmeta/>" {
		t.Errorf("ohne RDF: %q %v", aus, g)
	}
}

func TestEigenschaftenPruefen(t *testing.T) {
	for name, e := range map[string]*Eigenschaften{
		"zu lang":       {Title: str(strings.Repeat("ä", HoechstEigenschaftZeichen+1))},
		"Zeilenumbruch": {Subject: str("a\nb")},
		"Tabulator":     {Author: str("a\tb")},
		"kein UTF-8":    {Keywords: str("a\xffb")},
	} {
		err := e.Pruefen()
		var ef *Eigenschaftsfehler
		if !errors.Is(err, ErrEigenschaftUngueltig) || !errors.As(err, &ef) || ef.Feld == "" {
			t.Errorf("%s: %v", name, err)
		}
		var aus bytes.Buffer
		if _, _, err := CommitBauenMit(context.Background(), bytes.NewReader(korpus.Textseiten(1)), nil, nil, e, &aus); !errors.Is(err, ErrEigenschaftUngueltig) {
			t.Errorf("%s ueber CommitBauenMit: %v", name, err)
		}
	}
	grenze := &Eigenschaften{Title: str(strings.Repeat("ä", HoechstEigenschaftZeichen) + "  ")}
	if err := grenze.Pruefen(); err != nil {
		t.Errorf("genau %d Zeichen (mit Leerraum): %v", HoechstEigenschaftZeichen, err)
	}
	var leer *Eigenschaften
	if !leer.Leer() || leer.Pruefen() != nil || !(&Eigenschaften{}).Leer() {
		t.Error("Leer/Pruefen am Nullwert")
	}
}

// TestEigenschaftenProbeSchreiben erzeugt die Probe fuer den pdf.js-Test
// im Frontend (eigenschaften.pdfjs.test.ts) — nur mit OIH_PROBE_ZIEL, die
// Bytes sind wegen ModDate nicht reproduzierbar.
func TestEigenschaftenProbeSchreiben(t *testing.T) {
	ziel := os.Getenv("OIH_PROBE_ZIEL")
	if ziel == "" {
		t.Skip("OIH_PROBE_ZIEL nicht gesetzt")
	}
	aus := eigenschaftenCommit(t, korpus.PDFA(), &Eigenschaften{
		Title: str("Angebot Küche – Müller & Söhne"), Subject: str("Rechnung 00123 <geprüft>"),
		Author: str("Erika Musterfrau"), Keywords: str("Rechnung; Küche; 2026"),
	})
	if err := os.WriteFile(ziel, aus, 0o644); err != nil {
		t.Fatal(err)
	}
}

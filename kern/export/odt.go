// SPDX-License-Identifier: Apache-2.0

package export

import (
	"fmt"
	"io"
	"strings"
)

// ODT schreibt das Modell als OpenDocument-Text: Absaetze (Standard),
// Ueberschriften („Heading 1“/„Heading 2“), Listen (eine Aufzaehlung),
// Tabellen mit Kopfzeilen. Vier Teile: mimetype (unkomprimiert, zuerst),
// META-INF/manifest.xml, content.xml, styles.xml. Keine Makros, keine
// externen Verweise, keine Bilder.
func ODT(w io.Writer, dok Dokument, opt Optionen) ([]Warnung, error) {
	folge, warn, err := schreibfolge(dok, opt)
	if err != nil {
		return nil, err
	}
	p := neuesPaket(w)
	if err := p.teil("mimetype", odtMime, true); err != nil {
		return nil, err
	}
	teile := []struct{ name, inhalt string }{
		{"META-INF/manifest.xml", odtManifest},
		{"styles.xml", odtStile},
		{"content.xml", odtInhalt(folge)},
	}
	for _, t := range teile {
		if err := p.teil(t.name, t.inhalt, false); err != nil {
			return nil, err
		}
	}
	if err := p.schliessen(); err != nil {
		return nil, err
	}
	return warn, nil
}

const (
	odtMime = "application/vnd.oasis.opendocument.text"
	odtKopf = `<?xml version="1.0" encoding="UTF-8"?>` + "\n"
	odtNS   = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
		`xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ` +
		`xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ` +
		`xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ` +
		`xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ` +
		`office:version="1.2"`
)

const odtManifest = odtKopf + `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
	`<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="` + odtMime + `"/>` +
	`<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
	`<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>` +
	`</manifest:manifest>`

const odtStile = odtKopf + `<office:document-styles ` + odtNS + `><office:styles>` +
	`<style:style style:name="Standard" style:family="paragraph" style:class="text"/>` +
	`<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text">` +
	`<style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/>` +
	`<style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>` +
	`<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:default-outline-level="1" style:class="text">` +
	`<style:text-properties fo:font-size="130%" fo:font-weight="bold"/></style:style>` +
	`<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:default-outline-level="2" style:class="text">` +
	`<style:text-properties fo:font-size="115%" fo:font-weight="bold"/></style:style>` +
	`<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>` +
	`<style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents" style:class="extra">` +
	`<style:text-properties fo:font-weight="bold"/></style:style>` +
	`</office:styles></office:document-styles>`

// odtInhalt baut content.xml aus der Schreibfolge. Aufeinanderfolgende
// Listenpunkte werden eine Liste.
func odtInhalt(folge []schritt) string {
	var b strings.Builder
	b.WriteString(odtKopf)
	b.WriteString(`<office:document-content ` + odtNS + `><office:automatic-styles>` +
		`<style:style style:name="Pumbruch" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>` +
		`<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="&#8226;">` +
		`<style:list-level-properties text:space-before="0.5cm" text:min-label-width="0.5cm"/></text:list-level-style-bullet></text:list-style>` +
		`</office:automatic-styles><office:body><office:text>`)
	inListe := false
	listeSchliessen := func() {
		if inListe {
			b.WriteString(`</text:list>`)
			inListe = false
		}
	}
	tabellen := 0
	for _, s := range folge {
		if s.umbruch {
			listeSchliessen()
			b.WriteString(`<text:p text:style-name="Pumbruch"/>`)
		}
		switch s.block.Art {
		case ArtListe:
			if !inListe {
				b.WriteString(`<text:list text:style-name="L1">`)
				inListe = true
			}
			b.WriteString(`<text:list-item>`)
			odtAbsatz(&b, "Standard", s.block.Text)
			b.WriteString(`</text:list-item>`)
			continue
		case ArtTabelle:
			listeSchliessen()
			tabellen++
			odtTabelle(&b, s.block.Tabelle, s.kopfzeilen, tabellen)
		case ArtUeberschrift:
			listeSchliessen()
			ebene := max(1, min(s.block.Ebene, 2))
			fmt.Fprintf(&b, `<text:h text:style-name="Heading_20_%d" text:outline-level="%d">`, ebene, ebene)
			odtText(&b, s.block.Text)
			b.WriteString(`</text:h>`)
		default:
			listeSchliessen()
			odtAbsatz(&b, "Standard", s.block.Text)
		}
	}
	listeSchliessen()
	b.WriteString(`</office:text></office:body></office:document-content>`)
	return b.String()
}

func odtAbsatz(b *strings.Builder, stil, text string) {
	b.WriteString(`<text:p text:style-name="` + stil + `">`)
	odtText(b, text)
	b.WriteString(`</text:p>`)
}

// odtText schreibt Text mit Zeilenumbruechen als text:line-break.
func odtText(b *strings.Builder, text string) {
	for i, z := range zeilenVon(text) {
		if i > 0 {
			b.WriteString(`<text:line-break/>`)
		}
		b.WriteString(xmlText(z))
	}
}

func odtTabelle(b *strings.Builder, t *Tabelle, kopfzeilen int, nr int) {
	if t == nil || t.Spalten == 0 {
		return
	}
	fmt.Fprintf(b, `<table:table table:name="Tabelle%d"><table:table-column table:number-columns-repeated="%d"/>`, nr, t.Spalten)
	zeile := func(zeile []Zelle, kopf bool) {
		b.WriteString(`<table:table-row>`)
		for k := 0; k < t.Spalten; k++ {
			text := ""
			if k < len(zeile) {
				text = zeile[k].Text
			}
			if text == "" {
				b.WriteString(`<table:table-cell/>`)
				continue
			}
			stil := "Table_20_Contents"
			if kopf {
				stil = "Table_20_Heading"
			}
			b.WriteString(`<table:table-cell office:value-type="string">`)
			odtAbsatz(b, stil, text)
			b.WriteString(`</table:table-cell>`)
		}
		b.WriteString(`</table:table-row>`)
	}
	kopf := min(kopfzeilen, len(t.Zeilen))
	if kopf > 0 {
		b.WriteString(`<table:table-header-rows>`)
		for _, z := range t.Zeilen[:kopf] {
			zeile(z, true)
		}
		b.WriteString(`</table:table-header-rows>`)
	}
	for _, z := range t.Zeilen[kopf:] {
		zeile(z, false)
	}
	b.WriteString(`</table:table>`)
}

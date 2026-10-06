// SPDX-License-Identifier: Apache-2.0

package export

import (
	"fmt"
	"io"
	"strings"
)

// DOCX schreibt das Modell als WordprocessingML-Paket: Absaetze,
// Ueberschriften (Heading1/Heading2), Listen (eine Aufzaehlung ueber
// numbering.xml), Tabellen (TableGrid, Kopfzeilen fett). Vier Teile,
// keine Makros, keine externen Verweise, keine Bilder.
//
// Der Writer ist bewusst klein: Er schreibt genau die Teile, die ein
// gueltiges Paket braucht ([Content_Types].xml, _rels/.rels,
// word/document.xml, word/styles.xml, word/numbering.xml und die
// Beziehungen des Dokuments). TestDocxOeffnetInLibreOffice prueft die
// Mindestgueltigkeit mit soffice, wenn es installiert ist.
func DOCX(w io.Writer, dok Dokument, opt Optionen) ([]Warnung, error) {
	folge, warn, err := schreibfolge(dok, opt)
	if err != nil {
		return nil, err
	}
	p := neuesPaket(w)
	teile := []struct{ name, inhalt string }{
		{"[Content_Types].xml", docxInhaltstypen},
		{"_rels/.rels", docxBeziehungen},
		{"word/_rels/document.xml.rels", docxDokumentBeziehungen},
		{"word/styles.xml", docxStile},
		{"word/numbering.xml", docxNummerierung},
		{"word/document.xml", docxDokument(folge)},
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
	docxKopf = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n"
	docxNS   = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	// docxTextbreite: A4 (11906 Twips) minus zwei Raender von 2,5 cm.
	docxTextbreite = 11906 - 2*1417
)

const docxInhaltstypen = docxKopf + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
	`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
	`<Default Extension="xml" ContentType="application/xml"/>` +
	`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
	`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
	`<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
	`</Types>`

const docxBeziehungen = docxKopf + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
	`</Relationships>`

const docxDokumentBeziehungen = docxKopf + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
	`</Relationships>`

const docxStile = docxKopf + `<w:styles ` + docxNS + `>` +
	`<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault>` +
	`<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
	`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
	`<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
	`<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>` +
	`<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
	`<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>` +
	`<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
	`<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>` +
	`<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
	`<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
	`<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
	`</w:tblBorders></w:tblPr></w:style>` +
	`</w:styles>`

const docxNummerierung = docxKopf + `<w:numbering ` + docxNS + `>` +
	`<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>` +
	`<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/>` +
	`<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
	`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
	`</w:numbering>`

// docxDokument baut word/document.xml aus der Schreibfolge.
func docxDokument(folge []schritt) string {
	var b strings.Builder
	b.WriteString(docxKopf)
	b.WriteString(`<w:document ` + docxNS + `><w:body>`)
	for _, s := range folge {
		if s.umbruch {
			b.WriteString(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
		}
		switch s.block.Art {
		case ArtTabelle:
			docxTabelle(&b, s.block.Tabelle, s.kopfzeilen)
			// Nach einer Tabelle verlangt Word einen Absatz, bevor die
			// naechste Tabelle oder das Ende kommt.
			b.WriteString(`<w:p/>`)
		case ArtUeberschrift:
			docxAbsatz(&b, fmt.Sprintf(`<w:pStyle w:val="Heading%d"/>`, max(1, min(s.block.Ebene, 2))), s.block.Text, false)
		case ArtListe:
			docxAbsatz(&b, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`, s.block.Text, false)
		default:
			docxAbsatz(&b, "", s.block.Text, false)
		}
	}
	b.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
		`<w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`)
	b.WriteString(`</w:body></w:document>`)
	return b.String()
}

// docxAbsatz schreibt einen Absatz mit Absatzeigenschaften; Zeilenumbrueche
// im Text werden w:br.
func docxAbsatz(b *strings.Builder, pPr, text string, fett bool) {
	b.WriteString(`<w:p>`)
	if pPr != "" {
		b.WriteString(`<w:pPr>` + pPr + `</w:pPr>`)
	}
	if text != "" {
		b.WriteString(`<w:r>`)
		if fett {
			b.WriteString(`<w:rPr><w:b/><w:bCs/></w:rPr>`)
		}
		for i, z := range zeilenVon(text) {
			if i > 0 {
				b.WriteString(`<w:br/>`)
			}
			b.WriteString(`<w:t xml:space="preserve">` + xmlText(z) + `</w:t>`)
		}
		b.WriteString(`</w:r>`)
	}
	b.WriteString(`</w:p>`)
}

func docxTabelle(b *strings.Builder, t *Tabelle, kopfzeilen int) {
	if t == nil || t.Spalten == 0 {
		return
	}
	breite := docxTextbreite / t.Spalten
	b.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>`)
	for k := 0; k < t.Spalten; k++ {
		fmt.Fprintf(b, `<w:gridCol w:w="%d"/>`, breite)
	}
	b.WriteString(`</w:tblGrid>`)
	for zi, zeile := range t.Zeilen {
		b.WriteString(`<w:tr>`)
		if zi < kopfzeilen {
			b.WriteString(`<w:trPr><w:tblHeader/></w:trPr>`)
		}
		for k := 0; k < t.Spalten; k++ {
			text := ""
			if k < len(zeile) {
				text = zeile[k].Text
			}
			fmt.Fprintf(b, `<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>`, breite)
			docxAbsatz(b, "", text, zi < kopfzeilen)
			b.WriteString(`</w:tc>`)
		}
		b.WriteString(`</w:tr>`)
	}
	b.WriteString(`</w:tbl>`)
}

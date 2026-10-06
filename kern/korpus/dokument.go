// SPDX-License-Identifier: Apache-2.0

package korpus

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"strings"
)

// Seitenform beschreibt eine Seite des Korpus.
type Seitenform struct {
	Breite, Hoehe float64
	// CropBox leer heisst: keine eigene CropBox. Sonst die Angabe als
	// PDF-Feld, z. B. "[36 36 559 806]".
	CropBox string
	// Drehung ist der /Rotate-Wert der Seite (0, 90, 180, 270).
	Drehung int
}

// A4 ist eine A4-Seite im Hochformat.
var A4 = Seitenform{Breite: 595, Hoehe: 842}

// dokument baut ein Dokument mit Seiten, deren Inhalt eine Marke
// "SEITE-NN" traegt. Tests erkennen daran nach dem Umsortieren, welche
// Quellseite wo gelandet ist.
type dokument struct {
	b          bau
	schrift    int
	seitenbaum int
	seiten     []int
	formen     []Seitenform
	anmerk     [][]int
	seitenZus  []string
	katalogZus []string
	namenZus   []string // Eintraege im /Names-Woerterbuch des Katalogs
	version    string
	// inhalt erzeugt den Inhalt einer Seite; nil heisst Standardtext.
	inhalt func(i int) string
	// inhaltDict sind weitere Eintraege im Woerterbuch des Inhaltsstroms,
	// etwa ein /Filter; leer heisst unkomprimiert.
	inhaltDict string
	// ressourcenZus sind weitere Eintraege im /Resources jeder Seite, etwa
	// ein Bild-XObject.
	ressourcenZus string
}

func neuesDokument(formen ...Seitenform) *dokument {
	d := &dokument{version: "1.7"}
	d.schrift = d.b.neu("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
	d.seitenbaum = d.b.reservieren()
	for range formen {
		d.seiten = append(d.seiten, d.b.reservieren())
	}
	d.formen = formen
	d.anmerk = make([][]int, len(formen))
	d.seitenZus = make([]string, len(formen))
	return d
}

// seitentext ist der Standardinhalt: Firmenname und Marke.
func seitentext(i int) string {
	return fmt.Sprintf("BT /F1 18 Tf 72 760 Td (Musterfirma GmbH) Tj ET\n"+
		"BT /F1 12 Tf 72 730 Td (Rechnung 00123 - %s) Tj ET", Marke(i))
}

// Marke ist die Kennung der Seite i (ab 0) im Seiteninhalt: "SEITE-01" fuer
// die erste Seite.
func Marke(i int) string { return fmt.Sprintf("SEITE-%02d", i+1) }

// anmerkung haengt eine Annotation an Seite i. Im Text steht {P} fuer den
// Verweis auf die Seite.
func (d *dokument) anmerkung(i int, text string) int {
	nr := d.b.neu(strings.ReplaceAll(text, "{P}", ref(d.seiten[i])))
	d.anmerk[i] = append(d.anmerk[i], nr)
	return nr
}

// anmerkungReserviert haengt eine vorab reservierte Nummer an Seite i.
func (d *dokument) anmerkungReserviert(i, nr int) {
	d.anmerk[i] = append(d.anmerk[i], nr)
}

func (d *dokument) fertig() []byte {
	for i, nr := range d.seiten {
		f := d.formen[i]
		text := seitentext(i)
		if d.inhalt != nil {
			text = d.inhalt(i)
		}
		inhalt := d.b.strom(d.inhaltDict, text)
		var s strings.Builder
		fmt.Fprintf(&s, "<< /Type /Page /Parent %s /MediaBox [0 0 %g %g] /Contents %s"+
			" /Resources << /Font << /F1 %s >> %s >>",
			ref(d.seitenbaum), f.Breite, f.Hoehe, ref(inhalt), ref(d.schrift), d.ressourcenZus)
		if f.CropBox != "" {
			fmt.Fprintf(&s, " /CropBox %s", f.CropBox)
		}
		if f.Drehung != 0 {
			fmt.Fprintf(&s, " /Rotate %d", f.Drehung)
		}
		if len(d.anmerk[i]) > 0 {
			fmt.Fprintf(&s, " /Annots %s", refs(d.anmerk[i]...))
		}
		if d.seitenZus[i] != "" {
			s.WriteString(" " + d.seitenZus[i])
		}
		s.WriteString(" >>")
		d.b.setzen(nr, s.String())
	}
	d.b.setzen(d.seitenbaum, fmt.Sprintf("<< /Type /Pages /Kids %s /Count %d >>",
		refs(d.seiten...), len(d.seiten)))

	info := d.b.neu("<< /Title (Musterfirma GmbH - Probe) /Author (Korpus) /Producer (OpenIntraPDF-Korpus) >>")
	zus := strings.Join(d.katalogZus, " ")
	if len(d.namenZus) > 0 {
		zus += " /Names << " + strings.Join(d.namenZus, " ") + " >>"
	}
	katalog := d.b.neu(fmt.Sprintf("<< /Type /Catalog /Pages %s %s >>", ref(d.seitenbaum), zus))
	return d.b.fertig(katalog, info, d.version)
}

// Textseiten erzeugt n A4-Seiten ohne Besonderheiten.
func Textseiten(n int) []byte {
	formen := make([]Seitenform, n)
	for i := range formen {
		formen[i] = A4
	}
	return neuesDokument(formen...).fertig()
}

// Textbombe erzeugt seiten Seiten, deren Flate-Inhaltsstrom aus teile
// Tj-Befehlen mit je teilGroesse Byte Text besteht — die praeparierte
// Datei aus #243: wenige Kilobyte, die ein Textleser ohne Grenzen zu
// Gigabyte Speicher entfaltet (die Datei des Befunds ist Textbombe(1, 20,
// 1<<20), 21 KB). Nur fuer Pruefungen der Grenzen; nicht in Alle().
func Textbombe(seiten, teile, teilGroesse int) []byte {
	formen := make([]Seitenform, seiten)
	for i := range formen {
		formen[i] = A4
	}
	d := neuesDokument(formen...)
	d.inhaltDict = "/Filter /FlateDecode"
	d.inhalt = func(int) string {
		var roh bytes.Buffer
		roh.WriteString("BT /F1 12 Tf 72 700 Td\n")
		text := strings.Repeat("A", teilGroesse)
		for i := 0; i < teile; i++ {
			roh.WriteString("(" + text + ") Tj\n")
		}
		roh.WriteString("ET")
		var aus bytes.Buffer
		w, _ := zlib.NewWriterLevel(&aus, zlib.BestCompression)
		_, _ = w.Write(roh.Bytes())
		_ = w.Close()
		return aus.String()
	}
	return d.fertig()
}

// Scan erzeugt Seiten, wie ein Scanner sie hinterlaesst: je Seite ein
// Bild auf der ganzen MediaBox und KEINE Textebene. Das Bild ist ein
// heller Block mit dunklem Kern (4x4 Pixel, DeviceGray, unkomprimiert) —
// genug fuer „Bildanteil 1, Zeichen 0“ und fuer eine Textebene darueber
// (OpenIntraPDF Etappe 3). Ohne Angabe: eine A4-Seite.
func Scan(formen ...Seitenform) []byte {
	if len(formen) == 0 {
		formen = []Seitenform{A4}
	}
	d := neuesDokument(formen...)
	bild := d.b.strom("/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8",
		"\xf0\xf0\xf0\xf0\xf0\x20\x20\xf0\xf0\x20\x20\xf0\xf0\xf0\xf0\xf0")
	d.ressourcenZus = "/XObject << /Im1 " + ref(bild) + " >>"
	d.inhalt = func(i int) string {
		return fmt.Sprintf("q %g 0 0 %g 0 0 cm /Im1 Do Q", formen[i].Breite, formen[i].Hoehe)
	}
	return d.fertig()
}

// Seitenformen erzeugt fuenf Seiten verschiedener Groesse und Lage: A4
// hoch, A4 quer, US-Letter, A4 mit versetzter CropBox, A4 mit /Rotate 90.
func Seitenformen() []byte {
	return neuesDokument(
		A4,
		Seitenform{Breite: 842, Hoehe: 595},
		Seitenform{Breite: 612, Hoehe: 792},
		Seitenform{Breite: 595, Hoehe: 842, CropBox: "[36 48 559 794]"},
		Seitenform{Breite: 595, Hoehe: 842, Drehung: 90},
	).fertig()
}

// GedrehtMitCropBox erzeugt zwei A4-Seiten mit /Rotate 90 UND versetzter
// CropBox [36 48 559 794] — der Abnahmefall aus Konzept Kap. 04 fuer
// Anmerkungen: Benutzerraum, Anzeige und CropBox-Versatz fallen
// auseinander.
func GedrehtMitCropBox() []byte {
	gedreht := Seitenform{Breite: 595, Hoehe: 842, CropBox: "[36 48 559 794]", Drehung: 90}
	return neuesDokument(gedreht, gedreht).fertig()
}

// Verschachtelt erzeugt vier Seiten in einem Seitenbaum mit
// Zwischenknoten, die MediaBox, Resources und Rotate VERERBEN. Die Seiten
// selbst tragen nur Parent und Contents — so, wie manche Drucktreiber
// schreiben. Seiten 1–2: A4 hoch, um 90 Grad gedreht (vom Zwischenknoten);
// Seiten 3–4: A4 quer (MediaBox vom Zwischenknoten).
func Verschachtelt() []byte {
	var b bau
	schrift := b.neu("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
	res := b.neu(fmt.Sprintf("<< /Font << /F1 %s >> >>", ref(schrift)))
	wurzel := b.reservieren()
	links := b.reservieren()
	rechts := b.reservieren()
	seiten := make([]int, 4)
	for i := range seiten {
		seiten[i] = b.reservieren()
	}
	for i, nr := range seiten {
		eltern := links
		if i >= 2 {
			eltern = rechts
		}
		inhalt := b.strom("", seitentext(i))
		b.setzen(nr, fmt.Sprintf("<< /Type /Page /Parent %s /Contents %s >>", ref(eltern), ref(inhalt)))
	}
	b.setzen(wurzel, fmt.Sprintf("<< /Type /Pages /Kids %s /Count 4 /MediaBox [0 0 595 842] /Resources %s >>",
		refs(links, rechts), ref(res)))
	b.setzen(links, fmt.Sprintf("<< /Type /Pages /Parent %s /Kids %s /Count 2 /Rotate 90 >>",
		ref(wurzel), refs(seiten[0], seiten[1])))
	b.setzen(rechts, fmt.Sprintf("<< /Type /Pages /Parent %s /Kids %s /Count 2 /MediaBox [0 0 842 595] >>",
		ref(wurzel), refs(seiten[2], seiten[3])))
	katalog := b.neu(fmt.Sprintf("<< /Type /Catalog /Pages %s >>", ref(wurzel)))
	return b.fertig(katalog, 0, "1.7")
}

// MitAnmerkungen erzeugt drei Seiten mit Anmerkungen, wie ein
// Prueflauf in einem PDF-Programm sie hinterlaesst:
//
//	Seite 1: Notiz (Text) mit Popup, Hervorhebung (Highlight)
//	Seite 2: Textfeld (FreeText), Freihand (Ink)
//	Seite 3: Verknuepfung (Link) auf Seite 1, Antwort (IRT) auf die Notiz
//
// Anmerkungen ohne Widgets, Links und Popups: 5 (Text, Highlight,
// FreeText, Ink, Antwort).
func MitAnmerkungen() []byte {
	d := neuesDokument(A4, A4, A4)
	notiz := d.b.reservieren()
	popup := d.b.reservieren()
	d.b.setzen(notiz, fmt.Sprintf("<< /Type /Annot /Subtype /Text /Rect [72 600 96 624] /P %s"+
		" /Contents (Bitte Betrag pruefen) /T (Erika Musterfrau) /NM (probe-notiz-1)"+
		" /M (D:20260929120000+02'00') /C [1 0.9 0] /Popup %s /Open false >>",
		ref(d.seiten[0]), ref(popup)))
	d.b.setzen(popup, fmt.Sprintf("<< /Type /Annot /Subtype /Popup /Rect [100 520 300 620] /P %s"+
		" /Parent %s /Open false >>", ref(d.seiten[0]), ref(notiz)))
	d.anmerkungReserviert(0, notiz)
	d.anmerkungReserviert(0, popup)
	d.anmerkung(0, "<< /Type /Annot /Subtype /Highlight /Rect [70 726 300 746] /P {P}"+
		" /QuadPoints [72 744 298 744 72 728 298 728] /C [1 1 0] /CA 0.4"+
		" /Contents (Rechnungsnummer) /T (Erika Musterfrau) /NM (probe-markierung-1) >>")
	d.anmerkung(1, "<< /Type /Annot /Subtype /FreeText /Rect [72 500 320 540] /P {P}"+
		" /Contents (Rechnung 00123 geprueft) /DA (/Helv 12 Tf 0 g) /T (Max Mustermann)"+
		" /NM (probe-textfeld-1) >>")
	d.anmerkung(1, "<< /Type /Annot /Subtype /Ink /Rect [90 380 220 470] /P {P}"+
		" /InkList [[100 400 150 460 210 390]] /C [0 0 1] /BS << /W 2 >>"+
		" /T (Max Mustermann) /NM (probe-freihand-1) >>")
	d.anmerkung(2, fmt.Sprintf("<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /P {P}"+
		" /Border [0 0 0] /Dest [%s /XYZ 0 842 0] >>", ref(d.seiten[0])))
	d.anmerkung(2, fmt.Sprintf("<< /Type /Annot /Subtype /Text /Rect [72 650 96 674] /P {P}"+
		" /Contents (Erledigt) /T (Max Mustermann) /NM (probe-antwort-1) /IRT %s >>", ref(notiz)))
	return d.fertig()
}

// formularfelder legt auf den Seiten des Dokuments Textfelder an und
// liefert die Eintraege fuer /AcroForm. Jeder Name wird ein Feld mit
// eigenem Widget; seite gibt an, auf welcher Seite.
func (d *dokument) formularfelder(namen []string, seite func(i int) int) []int {
	var felder []int
	for i, name := range namen {
		s := seite(i)
		y := 600 - 40*i
		nr := d.anmerkung(s, fmt.Sprintf("<< /Type /Annot /Subtype /Widget /FT /Tx /T %s /V %s"+
			" /Rect [300 %d 520 %d] /P {P} /F 4 /DA (/Helv 10 Tf 0 g) >>",
			pdfText(name), pdfText("Wert "+name), y, y+20))
		felder = append(felder, nr)
	}
	return felder
}

// acroForm setzt das Formular in den Katalog.
func (d *dokument) acroForm(felder []int, zusatz string) {
	d.katalogZus = append(d.katalogZus, fmt.Sprintf(
		"/AcroForm << /Fields %s /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv %s >> >> %s >>",
		refs(felder...), ref(d.schrift), zusatz))
}

// MitFormular erzeugt drei Seiten mit einem AcroForm:
//
//	Seite 1: Textfelder "Name" und "Betrag"
//	Seite 2: Textfeld "Datum"
//	Seite 1 und 3: ein Feld "Adresse" mit zwei Widgets (Eltern-/Kindfeld)
//
// Formularfelder (terminal): 4.
func MitFormular() []byte {
	d := neuesDokument(A4, A4, A4)
	felder := d.formularfelder([]string{"Name", "Betrag", "Datum"}, func(i int) int {
		if i == 2 {
			return 1
		}
		return 0
	})
	adresse := d.b.reservieren()
	w1 := d.anmerkung(0, fmt.Sprintf("<< /Type /Annot /Subtype /Widget /Parent %s /Rect [300 300 520 320]"+
		" /P {P} /F 4 >>", ref(adresse)))
	w2 := d.anmerkung(2, fmt.Sprintf("<< /Type /Annot /Subtype /Widget /Parent %s /Rect [300 300 520 320]"+
		" /P {P} /F 4 >>", ref(adresse)))
	d.b.setzen(adresse, fmt.Sprintf("<< /FT /Tx /T (Adresse) /V (Musterweg 1) /DA (/Helv 10 Tf 0 g) /Kids %s >>",
		refs(w1, w2)))
	d.acroForm(append(felder, adresse), "")
	return d.fertig()
}

// FormularMitNamen erzeugt eine Seite mit Textfeldern der angegebenen
// Namen — zum Binden zweier Formulare mit gleichen Feldnamen.
func FormularMitNamen(namen ...string) []byte {
	d := neuesDokument(A4)
	felder := d.formularfelder(namen, func(int) int { return 0 })
	d.acroForm(felder, "")
	return d.fertig()
}

// eingebetteteDatei legt eine eingebettete Datei samt Dateiangabe an und
// liefert die Nummer der Dateiangabe.
func (d *dokument) eingebetteteDatei(name, beschreibung, mime, inhalt string) int {
	strom := d.b.strom(fmt.Sprintf("/Type /EmbeddedFile /Subtype /%s /Params << /Size %d >>",
		strings.ReplaceAll(mime, "/", "#2F"), len(inhalt)), inhalt)
	return d.b.neu(fmt.Sprintf("<< /Type /Filespec /F %s /UF %s /Desc %s /EF << /F %s >> >>",
		pdfText(name), pdfText(name), pdfText(beschreibung), ref(strom)))
}

// rechnungXML ist die erfundene „maschinenlesbare Rechnung“ des Korpus.
const rechnungXML = `<?xml version="1.0" encoding="UTF-8"?>
<Rechnung nummer="00123">
  <Verkaeufer>Musterfirma GmbH</Verkaeufer>
  <Kaeufer>Beispiel AG</Kaeufer>
  <Betrag waehrung="EUR">119.00</Betrag>
</Rechnung>`

// MitAnhang erzeugt zwei Seiten mit zwei Anhaengen: eine eingebettete
// XML-„Rechnung“ im Namensbaum EmbeddedFiles (wie bei E-Rechnungen) und
// ein Lieferschein als Dateianlage-Anmerkung (FileAttachment) auf Seite 2.
// Anhaenge: 2.
func MitAnhang() []byte {
	return mitAnhang("rechnung.xml")
}

func mitAnhang(name string) []byte {
	d := neuesDokument(A4, A4)
	rechnung := d.eingebetteteDatei(name, "Rechnung 00123", "text/xml", rechnungXML)
	d.namenZus = append(d.namenZus, fmt.Sprintf("/EmbeddedFiles << /Names [%s %s] >>", pdfText(name), ref(rechnung)))
	lieferschein := d.eingebetteteDatei("lieferschein.txt", "Lieferschein 00456", "text/plain",
		"Lieferschein 00456\nMusterfirma GmbH\n1 Stueck Beispielware\n")
	d.anmerkung(1, fmt.Sprintf("<< /Type /Annot /Subtype /FileAttachment /Rect [500 700 520 730] /P {P}"+
		" /FS %s /Contents (Lieferschein) /Name /Paperclip /T (Erika Musterfrau) >>", ref(lieferschein)))
	return d.fertig()
}

// MitLesezeichen erzeugt vier Seiten mit Lesezeichen:
//
//	Deckblatt        -> Seite 1
//	Kapitel 1        -> Seite 2
//	  Abschnitt 1.1  -> Seite 3
//	Anhang           -> Seite 4
//
// Lesezeichen: 4.
func MitLesezeichen() []byte {
	d := neuesDokument(A4, A4, A4, A4)
	wurzel := d.b.reservieren()
	deck, kap, abs, anh := d.b.reservieren(), d.b.reservieren(), d.b.reservieren(), d.b.reservieren()
	ziel := func(i int) string { return fmt.Sprintf("[%s /XYZ 0 842 0]", ref(d.seiten[i])) }
	d.b.setzen(deck, fmt.Sprintf("<< /Title (Deckblatt) /Parent %s /Next %s /Dest %s >>", ref(wurzel), ref(kap), ziel(0)))
	d.b.setzen(kap, fmt.Sprintf("<< /Title (Kapitel 1) /Parent %s /Prev %s /Next %s /First %s /Last %s /Count 1 /Dest %s >>",
		ref(wurzel), ref(deck), ref(anh), ref(abs), ref(abs), ziel(1)))
	d.b.setzen(abs, fmt.Sprintf("<< /Title (Abschnitt 1.1) /Parent %s /A << /S /GoTo /D %s >> >>", ref(kap), ziel(2)))
	d.b.setzen(anh, fmt.Sprintf("<< /Title (Anhang) /Parent %s /Prev %s /Dest %s >>", ref(wurzel), ref(kap), ziel(3)))
	d.b.setzen(wurzel, fmt.Sprintf("<< /Type /Outlines /First %s /Last %s /Count 4 >>", ref(deck), ref(anh)))
	d.katalogZus = append(d.katalogZus, "/Outlines "+ref(wurzel), "/PageMode /UseOutlines")
	return d.fertig()
}

// MitSignaturfeld erzeugt zwei Seiten mit einem Signaturfeld, das einen
// Signaturwert (/V) traegt. Die Signatur ist KEINE echte: /Contents ist
// leer gefuellt. Fuer die Erkennung „signiert“ genuegt das Feld mit Wert;
// geprueft wird eine Signatur in Etappe 1 ohnehin nicht.
func MitSignaturfeld() []byte {
	d := neuesDokument(A4, A4)
	wert := d.b.neu("<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached" +
		" /Name (Erika Musterfrau) /M (D:20260929120000+02'00') /Reason (Freigabe)" +
		" /ByteRange [0 0 0 0] /Contents <" + strings.Repeat("00", 64) + "> >>")
	feld := d.anmerkung(1, fmt.Sprintf("<< /Type /Annot /Subtype /Widget /FT /Sig /T (Unterschrift)"+
		" /Rect [300 100 520 160] /P {P} /F 132 /V %s >>", ref(wert)))
	d.acroForm([]int{feld}, "/SigFlags 3")
	return d.fertig()
}

// MitJavaScript erzeugt eine Seite mit Dokument-JavaScript (Namensbaum
// JavaScript) und einer OpenAction, die es beim Oeffnen ausfuehren will.
// Der Inhalt ist harmlos; es geht nur um die Erkennung.
func MitJavaScript() []byte {
	d := neuesDokument(A4)
	skript := d.b.neu("<< /S /JavaScript /JS (app.alert\\('Musterfirma GmbH'\\);) >>")
	d.namenZus = append(d.namenZus, fmt.Sprintf("/JavaScript << /Names [(Begruessung) %s] >>", ref(skript)))
	d.katalogZus = append(d.katalogZus, "/OpenAction "+ref(skript))
	return d.fertig()
}

// Getaggt erzeugt zwei Seiten mit Strukturbaum (MarkInfo, StructTreeRoot)
// und markiertem Inhalt. Das Absatz-Element der zweiten Seite verweist mit
// /Pg auf seine Seite.
func Getaggt() []byte {
	d := neuesDokument(A4, A4)
	d.inhalt = func(i int) string {
		return fmt.Sprintf("/P <</MCID 0>> BDC\n%s\nEMC", seitentext(i))
	}
	baum := d.b.reservieren()
	dok := d.b.reservieren()
	abs := make([]int, 2)
	for i := range abs {
		abs[i] = d.b.reservieren()
	}
	for i, nr := range abs {
		d.b.setzen(nr, fmt.Sprintf("<< /Type /StructElem /S /P /P %s /Pg %s /K 0 >>", ref(dok), ref(d.seiten[i])))
		d.seitenZus[i] = fmt.Sprintf("/StructParents %d", i)
	}
	d.b.setzen(dok, fmt.Sprintf("<< /Type /StructElem /S /Document /P %s /K %s >>", ref(baum), refs(abs...)))
	eltern := d.b.neu(fmt.Sprintf("<< /Nums [0 [%s] 1 [%s]] >>", ref(abs[0]), ref(abs[1])))
	d.b.setzen(baum, fmt.Sprintf("<< /Type /StructTreeRoot /K %s /ParentTree %s /ParentTreeNextKey 2 >>",
		ref(dok), ref(eltern)))
	d.katalogZus = append(d.katalogZus, "/MarkInfo << /Marked true >>", "/StructTreeRoot "+ref(baum), "/Lang (de-DE)")
	return d.fertig()
}

// PDFA erzeugt eine Seite mit XMP-Metadaten, die PDF/A-2b behaupten. Die
// Datei ist NICHT wirklich PDF/A-konform (Schrift nicht eingebettet) — es
// geht allein um die Erkennung der Kennzeichnung.
func PDFA() []byte {
	d := neuesDokument(A4)
	xmp := `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Musterfirma GmbH - Probe</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
	meta := d.b.strom("/Type /Metadata /Subtype /XML", xmp)
	d.katalogZus = append(d.katalogZus, "/Metadata "+ref(meta))
	return d.fertig()
}

// Voll erzeugt fuenf Seiten mit allem, was beim Umsortieren erhalten
// bleiben muss — der Pflichtfall des Konzepts (Kap. 04: „Ein PDF mit
// eingebettetem Rechnungs-XML darf nach ‚eine Seite drehen‘ nicht nur noch
// optisch korrekt sein“):
//
//	Seite 1: Notiz, Textfeld "Name"
//	Seite 2: Hervorhebung, Dateianlage-Anmerkung (Lieferschein)
//	Seite 3: Freihand, Link auf Seite 5
//	Seite 4: Textfeld "Betrag"
//	Seite 5: keine
//	Katalog: eingebettete Rechnung, Lesezeichen je Seite, Seitenbeschriftung
//
// Anmerkungen (ohne Widgets/Links/Popups): 4 (Notiz, Hervorhebung,
// Dateianlage, Freihand). Formularfelder: 2. Anhaenge: 2. Lesezeichen: 5.
func Voll() []byte {
	d := neuesDokument(A4, A4, A4, A4, A4)
	d.anmerkung(0, "<< /Type /Annot /Subtype /Text /Rect [72 600 96 624] /P {P} /Contents (Notiz zu Seite 1)"+
		" /T (Erika Musterfrau) /NM (voll-notiz) >>")
	d.anmerkung(1, "<< /Type /Annot /Subtype /Highlight /Rect [70 726 300 746] /P {P}"+
		" /QuadPoints [72 744 298 744 72 728 298 728] /C [1 1 0] /NM (voll-markierung) >>")
	lieferschein := d.eingebetteteDatei("lieferschein.txt", "Lieferschein 00456", "text/plain", "Lieferschein 00456\n")
	d.anmerkung(1, fmt.Sprintf("<< /Type /Annot /Subtype /FileAttachment /Rect [500 700 520 730] /P {P}"+
		" /FS %s /Contents (Lieferschein) /Name /Paperclip >>", ref(lieferschein)))
	d.anmerkung(2, "<< /Type /Annot /Subtype /Ink /Rect [90 380 220 470] /P {P}"+
		" /InkList [[100 400 150 460 210 390]] /C [0 0 1] /NM (voll-freihand) >>")
	d.anmerkung(2, fmt.Sprintf("<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /P {P}"+
		" /A << /S /GoTo /D [%s /Fit] >> >>", ref(d.seiten[4])))
	felder := d.formularfelder([]string{"Name", "Betrag"}, func(i int) int { return i * 3 })
	d.acroForm(felder, "")

	rechnung := d.eingebetteteDatei("rechnung.xml", "Rechnung 00123", "text/xml", rechnungXML)
	d.namenZus = append(d.namenZus, fmt.Sprintf("/EmbeddedFiles << /Names [(rechnung.xml) %s] >>", ref(rechnung)))

	wurzel := d.b.reservieren()
	punkte := make([]int, 5)
	for i := range punkte {
		punkte[i] = d.b.reservieren()
	}
	for i, nr := range punkte {
		var s strings.Builder
		fmt.Fprintf(&s, "<< /Title (Seite %d) /Parent %s /Dest [%s /Fit]", i+1, ref(wurzel), ref(d.seiten[i]))
		if i > 0 {
			fmt.Fprintf(&s, " /Prev %s", ref(punkte[i-1]))
		}
		if i < len(punkte)-1 {
			fmt.Fprintf(&s, " /Next %s", ref(punkte[i+1]))
		}
		s.WriteString(" >>")
		d.b.setzen(nr, s.String())
	}
	d.b.setzen(wurzel, fmt.Sprintf("<< /Type /Outlines /First %s /Last %s /Count 5 >>", ref(punkte[0]), ref(punkte[4])))
	d.katalogZus = append(d.katalogZus, "/Outlines "+ref(wurzel),
		"/PageLabels << /Nums [0 << /S /r >> 1 << /S /D >>] >>")
	return d.fertig()
}

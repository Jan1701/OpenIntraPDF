// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"errors"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Inspektion sagt, was in einem PDF steckt. Die JSON-Namen sind die des
// Vertrags (GET /api/pdf/files/{id}, Feld inspection); links, widgets,
// user_password und xfa kommen als Auskunft dazu.
type Inspektion struct {
	Seiten  int    `json:"pages"`
	Version string `json:"pdf_version"`
	// Verschluesselt: Die Datei traegt ein /Encrypt — mit oder ohne
	// Benutzerpasswort.
	Verschluesselt bool `json:"encrypted"`
	// Benutzerpasswort: Ohne Passwort ist nichts lesbar. Dann sind alle
	// anderen Angaben leer.
	Benutzerpasswort bool `json:"user_password"`
	// Signiert: ein Signaturfeld mit Wert oder eine Zertifizierung
	// (/Perms DocMDP/UR3). Gueltig heisst das NICHT — geprueft wird die
	// Signatur hier nicht (Konzept Kap. 04: „Signatur vorhanden;
	// Gueltigkeit nicht geprueft“).
	Signiert       bool `json:"signed"`
	Formular       bool `json:"forms"`
	Formularfelder int  `json:"form_fields"`
	// XFA: Das Formular hat einen XFA-Teil. Den kann OpenIntraPDF nicht
	// bearbeiten; Seitenoperationen wuerden ihn zerlegen.
	XFA bool `json:"xfa"`
	// Anhaenge: eingebettete Dateien (Namensbaum EmbeddedFiles) plus
	// Dateianlage-Anmerkungen.
	Anhaenge    int `json:"attachments"`
	Lesezeichen int `json:"bookmarks"`
	// Anmerkungen zaehlt Kommentare aller Art — ohne Widgets
	// (Formularfelder), Links und Popups (das Fenster einer Notiz).
	Anmerkungen int  `json:"annotations"`
	Links       int  `json:"links"`
	Widgets     int  `json:"widgets"`
	JavaScript  bool `json:"javascript"`
	// PDFA: Die XMP-Metadaten BEHAUPTEN PDF/A. Geprueft ist das nicht.
	PDFA    bool `json:"pdfa"`
	Getaggt bool `json:"tagged"`
}

// Inspizieren oeffnet ein PDF und sagt, was darin steckt.
//
// Ein PDF mit Benutzerpasswort liefert eine Inspektion mit Verschluesselt
// und Benutzerpasswort — und ErrPasswort. Der Aufrufer kann dann sagen,
// dass ein Passwort noetig ist, statt „unlesbar“.
func Inspizieren(c context.Context, r io.ReadSeeker) (Inspektion, error) {
	ctx, err := lesen(c, r, model.LISTINFO)
	if errors.Is(err, ErrPasswort) {
		return Inspektion{Verschluesselt: true, Benutzerpasswort: true}, err
	}
	if err != nil {
		return Inspektion{}, err
	}
	return inspizieren(ctx), nil
}

// seitenzaehlung ist, was eine Seite zum Bericht beitraegt.
type seitenzaehlung struct {
	anmerkungen    int
	dateianlagen   int
	links, widgets int
	anmerkungsNrn  []int // alle Annotationen der Seite (Objektnummern)
	widgetNrn      []int
}

func zaehlen(x *model.XRefTable, seite types.Dict) seitenzaehlung {
	var z seitenzaehlung
	for _, a := range anmerkungen(x, seite) {
		if n := a.nr(); n > 0 {
			z.anmerkungsNrn = append(z.anmerkungsNrn, n)
		}
		switch a.art() {
		case artWidget:
			z.widgets++
			if n := a.nr(); n > 0 {
				z.widgetNrn = append(z.widgetNrn, n)
			}
		case artLink:
			z.links++
		case artAnmerkung:
			z.anmerkungen++
			if a.typ == "FileAttachment" {
				z.dateianlagen++
			}
		}
	}
	return z
}

// inspizieren liest die Angaben aus einem geoeffneten Dokument.
func inspizieren(ctx *model.Context) Inspektion {
	x := ctx.XRefTable
	i := Inspektion{
		Seiten:         ctx.PageCount,
		Version:        ctx.VersionString(),
		Verschluesselt: ctx.Encrypt != nil,
	}
	katalog, err := ctx.Catalog()
	if err != nil || katalog == nil {
		return i
	}

	if seiten, err := blaetter(ctx); err == nil {
		for _, s := range seiten {
			z := zaehlen(x, s.dict)
			i.Anmerkungen += z.anmerkungen
			i.Links += z.links
			i.Widgets += z.widgets
			i.Anhaenge += z.dateianlagen
		}
	}

	if form := alsDict(x, katalog["AcroForm"]); form != nil {
		felder := formularfelder(x, katalog)
		i.Formularfelder = len(felder)
		i.Formular = len(felder) > 0
		if _, ok := form.Find("XFA"); ok {
			i.XFA = true
			i.Formular = true
		}
		for _, f := range felder {
			if f.typ == "Sig" && f.wert {
				i.Signiert = true
			}
		}
	}
	if perms := alsDict(x, katalog["Perms"]); perms != nil {
		if _, ok := perms.Find("DocMDP"); ok {
			i.Signiert = true
		}
		if _, ok := perms.Find("UR3"); ok {
			i.Signiert = true
		}
	}

	i.Anhaenge += len(namensbaum(x, namensbaumVon(x, katalog, "EmbeddedFiles")))
	i.Lesezeichen = len(lesezeichen(x, katalog))
	i.JavaScript = enthaeltJavaScript(ctx, katalog)

	if mark := alsDict(x, katalog["MarkInfo"]); mark != nil {
		if b, ok := aufloesen(x, mark["Marked"]).(types.Boolean); ok && bool(b) {
			i.Getaggt = true
		}
	}
	if _, ok := katalog.Find("StructTreeRoot"); ok {
		i.Getaggt = true
	}

	if sd, ok := aufloesen(x, katalog["Metadata"]).(types.StreamDict); ok {
		kopie := sd
		if err := kopie.Decode(); err == nil {
			i.PDFA = enthaeltPdfaKennung(kopie.Content)
		}
	}
	return i
}

// enthaeltJavaScript sucht Skripte: im Namensbaum JavaScript und in jedem
// Objekt, das eine JavaScript-Aktion ist oder /JS traegt (OpenAction,
// Annotationen, Feldaktionen).
func enthaeltJavaScript(ctx *model.Context, katalog types.Dict) bool {
	x := ctx.XRefTable
	if len(namensbaum(x, namensbaumVon(x, katalog, "JavaScript"))) > 0 {
		return true
	}
	istSkript := func(d types.Dict) bool {
		if d == nil {
			return false
		}
		if _, ok := d.Find("JS"); ok {
			return true
		}
		return alsName(x, d["S"]) == "JavaScript"
	}
	if istSkript(alsDict(x, katalog["OpenAction"])) {
		return true
	}
	for nr, eintrag := range x.Table {
		if nr == 0 || eintrag == nil || eintrag.Free {
			continue
		}
		gen := 0
		if eintrag.Generation != nil {
			gen = *eintrag.Generation
		}
		o := aufloesen(x, *types.NewIndirectRef(nr, gen))
		var d types.Dict
		switch v := o.(type) {
		case types.Dict:
			d = v
		case types.StreamDict:
			d = v.Dict
		}
		if istSkript(d) {
			return true
		}
		// Direkt eingebettete Aktionen (/A << /S /JavaScript >>, /AA).
		for _, schluessel := range []string{"A", "OpenAction"} {
			if a, ok := d[schluessel].(types.Dict); ok && istSkript(a) {
				return true
			}
		}
		if aa, ok := d["AA"].(types.Dict); ok {
			for _, v := range aa {
				if a, ok := v.(types.Dict); ok && istSkript(a) {
					return true
				}
			}
		}
	}
	return false
}

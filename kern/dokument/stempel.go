// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Stempel (kind stamp, Etappe 5): ein abgerundeter Kasten mit doppeltem
// Rahmen und einem fetten Label, auf Wunsch mit „<Autor> · <Datum>“ in
// einer zweiten Zeile. Im PDF ist er ein Stamp mit /Name aus der festen
// Liste; Contents traegt den Text, damit andere Programme und die
// Kommentarliste ihn zeigen. Er ist nicht bearbeitbar: loeschen und neu
// setzen.

// Stempel ist das Feld stamp eines add-Befehls (nur bei kind stamp).
type Stempel struct {
	// Label wird genau so gesetzt (Grossschreibung macht die Oberflaeche).
	Label string `json:"label"`
	// Name ist der PDF-/Name aus stempelNamen.
	Name string `json:"name"`
	// Signed haengt „<Autor> · <Datum>“ an — beides setzt der Server.
	Signed bool `json:"signed"`
	// Lang bestimmt nur das Datumsformat (datumsformate).
	Lang string `json:"lang"`
}

// stempelNamen ist die feste Liste der /Name-Werte (ISO 32000-1 12.5.6.12
// kennt Approved, Draft, Confidential ...; die uebrigen sind unsere).
var stempelNamen = map[string]bool{
	"Approved": true, "Draft": true, "Confidential": true, "Checked": true, "Paid": true,
	"Booked": true, "Received": true, "Done": true, "Custom": true,
}

const (
	// StempelLabelHoechst ist die groesste Laenge des Labels in Zeichen.
	StempelLabelHoechst = 40
	// stempelLangHoechst begrenzt lang; unbekannte Werte geben ISO.
	stempelLangHoechst = 10
	// stempelSchriftHoechst ist die groesste Labelschrift.
	stempelSchriftHoechst = 28.0
	// stempelRand ist der Abstand des Textes zum Kastenrand: aeusserer
	// Rahmen 2 pt (Mitte bei 1), Luecke 2 pt, innerer Rahmen 0,75 pt,
	// dann 4 pt Luft.
	stempelRand = 9.0
)

// stempelRot ist die Vorgabefarbe #c62828.
var stempelRot = []float64{0.776, 0.157, 0.157}

// pruefen prueft die Felder ohne Dokument.
func (s *Stempel) pruefen(wo string) error {
	n := utf8.RuneCountInString(s.Label)
	if n < 1 || n > StempelLabelHoechst {
		return ungueltig(wo, fmt.Sprintf("stamp.label braucht 1 bis %d Zeichen", StempelLabelHoechst))
	}
	for _, r := range s.Label {
		if unicode.IsControl(r) {
			return ungueltig(wo, "stamp.label ist einzeilig, ohne Steuerzeichen")
		}
	}
	if !stempelNamen[s.Name] {
		return ungueltig(wo, "stamp.name unbekannt: "+s.Name)
	}
	if utf8.RuneCountInString(s.Lang) > stempelLangHoechst {
		return ungueltig(wo, "stamp.lang laenger als 10 Zeichen")
	}
	return nil
}

// datumsformate: OIH-Sprache -> Go-Layout des kurzen Datums nach CLDR,
// mit vierstelligem Jahr; en ist ISO (Vertrag). Unbekannt -> ISO.
var datumsformate = map[string]string{
	"bg": "2.01.2006 г.", "cs": "2. 1. 2006", "da": "02.01.2006", "de": "02.01.2006", "el": "2/1/2006",
	"en": "2006-01-02", "es": "2/1/2006", "et": "02.01.2006", "fi": "2.1.2006", "fr": "02/01/2006",
	"ga": "02/01/2006", "hr": "02. 01. 2006.", "hu": "2006. 01. 02.", "it": "02/01/2006", "ja": "2006/01/02",
	"lt": "2006-01-02", "lv": "02.01.2006", "mt": "02/01/2006", "nl": "02-01-2006", "pl": "02.01.2006",
	"pt": "02/01/2006", "ro": "02.01.2006", "sk": "2. 1. 2006", "sl": "2. 1. 2006", "sv": "2006-01-02",
	"uk": "02.01.2006",
}

// datumsformat liefert das Layout zu lang ("de", "de-DE", "DE" ...).
func datumsformat(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if i := strings.IndexAny(lang, "-_"); i > 0 {
		lang = lang[:i]
	}
	if f, ok := datumsformate[lang]; ok {
		return f
	}
	return "2006-01-02"
}

// stempel baut Contents und Erscheinungsbild eines Stempels in d.
func (a *anwender) stempel(d types.Dict, rect [4]float64, st Stempel, farbe []float64, drehung int) (bbox [4]float64, inhalt string, res types.Dict, matrix []float64, err error) {
	d["Name"] = types.Name(st.Name)
	text := st.Label
	zweite := ""
	if st.Signed {
		zweite = a.zeit.In(time.Local).Format(datumsformat(st.Lang))
		if autor := strings.TrimSpace(a.b.Autor); autor != "" {
			zweite = autor + " · " + zweite
		}
		text += "\n" + zweite
	}
	d["Contents"] = utf16(text)
	fett, err := a.satz(st.Label, true)
	if err != nil {
		return bbox, "", nil, nil, err
	}
	normal, err := a.satz(zweite, false)
	if err != nil {
		return bbox, "", nil, nil, err
	}
	w, h, matrix := drehmatrix(drehung, rect)
	bbox = [4]float64{0, 0, w, h}

	// Schriftgroesse: so gross, dass Label (und zweite Zeile) in Breite
	// und Hoehe passen, hoechstens 28 pt. Die zweite Zeile hat 40 % der
	// Labelgroesse, mindestens 6 pt.
	innen, hoehe := w-2*stempelRand, h-2*stempelRand
	fs := stempelSchriftHoechst
	if b := fett.breite(st.Label, 1); b > 0 {
		fs = math.Min(fs, innen/b)
	}
	if st.Signed {
		if b := normal.breite(zweite, 1); b > 0 && 6*b <= innen {
			fs = math.Min(fs, math.Max(15, innen/(0.4*b)))
		}
	}
	zweiteGr := func(fs float64) float64 { return math.Max(6, 0.4*fs) }
	block := func(fs float64) float64 {
		if !st.Signed {
			return 0.72 * fs
		}
		return 0.72*fs + 0.3*fs + 0.72*zweiteGr(fs)
	}
	for block(fs) > hoehe && fs > 4 {
		fs -= 0.5
	}
	fs = math.Max(fs, 4)
	fs2 := zweiteGr(fs)
	oben := (h + block(fs)) / 2
	y1 := oben - 0.72*fs
	y2 := y1 - 0.3*fs - 0.72*fs2

	nameF, objF := fett.ressource()
	nameN, objN := normal.ressource()
	res = types.Dict{"Font": types.Dict{nameF: objF, nameN: objN}}
	r := math.Min(8, math.Min(w, h)/4)
	var b strings.Builder
	fmt.Fprintf(&b, "q %s 2 w %s S 0.75 w %s S Q ", farbeOp(farbe, "RG"),
		rundeck(1, 1, w-2, h-2, r), rundeck(4.375, 4.375, w-8.75, h-8.75, math.Max(1, r-3.375)))
	fmt.Fprintf(&b, "q BT %s /%s %s Tf %s %s Td %s Tj ET Q", farbeOp(farbe, "rg"), nameF, zahl(fs),
		zahl((w-fett.breite(st.Label, fs))/2), zahl(y1), fett.tj(st.Label))
	if st.Signed {
		fmt.Fprintf(&b, " q BT %s /%s %s Tf %s %s Td %s Tj ET Q", farbeOp(farbe, "rg"), nameN, zahl(fs2),
			zahl((w-normal.breite(zweite, fs2))/2), zahl(y2), normal.tj(zweite))
	}
	return bbox, b.String(), res, matrix, nil
}

// rundeck ist der Pfad eines Rechtecks mit abgerundeten Ecken (Radius r).
func rundeck(x, y, w, h, r float64) string {
	k := 0.5523 * r
	return fmt.Sprintf("%s %s m %s %s l %s %s %s %s %s %s c %s %s l %s %s %s %s %s %s c %s %s l %s %s %s %s %s %s c %s %s l %s %s %s %s %s %s c h",
		zahl(x+r), zahl(y),
		zahl(x+w-r), zahl(y), zahl(x+w-r+k), zahl(y), zahl(x+w), zahl(y+r-k), zahl(x+w), zahl(y+r),
		zahl(x+w), zahl(y+h-r), zahl(x+w), zahl(y+h-r+k), zahl(x+w-r+k), zahl(y+h), zahl(x+w-r), zahl(y+h),
		zahl(x+r), zahl(y+h), zahl(x+r-k), zahl(y+h), zahl(x), zahl(y+h-r+k), zahl(x), zahl(y+h-r),
		zahl(x), zahl(y+r), zahl(x), zahl(y+r-k), zahl(x+r-k), zahl(y), zahl(x+r), zahl(y))
}

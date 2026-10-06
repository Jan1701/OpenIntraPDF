// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"errors"
	"fmt"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Lesehilfen ueber dem Objektmodell von pdfcpu.
//
// Sie sind nachsichtig: Ein kaputter Verweis liefert nil statt eines
// Fehlers. Fuer die Pruefung eines fremden Dokuments ist das richtig — ein
// Lesezeichen mit toter Zielangabe ist ein Befund, kein Absturz. Wo eine
// Luecke das Ergebnis verfaelschen wuerde (Seitenbaum), melden die
// Aufrufer selbst einen Fehler.

// tiefe begrenzt jeden Abstieg in Baeume des Dokuments. Kreise faengt die
// Besuchsliste; die Tiefe faengt absichtlich tiefe Baeume.
const tiefe = 64

func objNr(o types.Object) (int, bool) {
	ir, ok := o.(types.IndirectRef)
	if !ok {
		return 0, false
	}
	return ir.ObjectNumber.Value(), true
}

func aufloesen(x *model.XRefTable, o types.Object) types.Object {
	aus, err := x.Dereference(o)
	if err != nil {
		return nil
	}
	return aus
}

func alsDict(x *model.XRefTable, o types.Object) types.Dict {
	switch v := aufloesen(x, o).(type) {
	case types.Dict:
		return v
	case types.StreamDict:
		return v.Dict
	}
	return nil
}

func alsArray(x *model.XRefTable, o types.Object) types.Array {
	a, _ := aufloesen(x, o).(types.Array)
	return a
}

func alsName(x *model.XRefTable, o types.Object) string {
	n, _ := aufloesen(x, o).(types.Name)
	return string(n)
}

// alsText liest ein Stringliteral oder Hexliteral als Text.
func alsText(x *model.XRefTable, o types.Object) (string, bool) {
	switch v := aufloesen(x, o).(type) {
	case types.StringLiteral:
		s, err := types.StringLiteralToString(v)
		return s, err == nil
	case types.HexLiteral:
		s, err := types.HexLiteralToString(v)
		return s, err == nil
	}
	return "", false
}

// ============================================================
// Seitenbaum
// ============================================================

// vererbbar sind die Seitenattribute, die ein Zwischenknoten an seine
// Seiten weitergibt (ISO 32000-1, 7.7.3.4).
var vererbbar = []string{"Resources", "MediaBox", "CropBox", "Rotate"}

// blatt ist eine Seite mit dem, was sie von oben erbt.
type blatt struct {
	ref    types.IndirectRef
	dict   types.Dict
	geerbt map[string]types.Object
}

// blaetter liefert die Seiten in Lesereihenfolge.
func blaetter(ctx *model.Context) ([]blatt, error) {
	wurzel, err := ctx.Pages()
	if err != nil || wurzel == nil {
		return nil, fmt.Errorf("Seitenbaum fehlt: %v", err)
	}
	var aus []blatt
	besucht := map[int]bool{}
	var ab func(ref types.IndirectRef, geerbt map[string]types.Object, t int) error
	ab = func(ref types.IndirectRef, geerbt map[string]types.Object, t int) error {
		if t > tiefe {
			return errors.New("Seitenbaum zu tief")
		}
		nr := ref.ObjectNumber.Value()
		if besucht[nr] {
			return fmt.Errorf("Seitenbaum: Objekt %d doppelt", nr)
		}
		besucht[nr] = true
		d := alsDict(ctx.XRefTable, ref)
		if d == nil {
			return fmt.Errorf("Seitenbaum: Objekt %d fehlt", nr)
		}
		hier := make(map[string]types.Object, len(vererbbar))
		for k, v := range geerbt {
			hier[k] = v
		}
		art := alsName(ctx.XRefTable, d["Type"])
		kinder, hatKinder := d.Find("Kids")
		if art == "Pages" || (art == "" && hatKinder) {
			for _, k := range vererbbar {
				if v, ok := d.Find(k); ok && v != nil {
					hier[k] = v
				}
			}
			for _, kind := range alsArray(ctx.XRefTable, kinder) {
				kr, ok := kind.(types.IndirectRef)
				if !ok {
					return errors.New("Seitenbaum: Kind ohne indirekten Verweis")
				}
				if err := ab(kr, hier, t+1); err != nil {
					return err
				}
			}
			return nil
		}
		aus = append(aus, blatt{ref: ref, dict: d, geerbt: hier})
		return nil
	}
	if err := ab(*wurzel, map[string]types.Object{}, 0); err != nil {
		return nil, err
	}
	if len(aus) != ctx.PageCount {
		return nil, fmt.Errorf("Seitenbaum: %d Seiten gefunden, %d erwartet", len(aus), ctx.PageCount)
	}
	return aus, nil
}

// ============================================================
// Anmerkungen
// ============================================================

// Arten, in die der Bericht Annotationen einteilt.
const (
	artAnmerkung = "anmerkung" // was ein Mensch als Kommentar sieht
	artWidget    = "widget"    // Formularfeld-Darstellung
	artLink      = "link"      // Verknuepfung
	artPopup     = "popup"     // Fenster einer Notiz, gehoert zu ihr
)

type anmerkung struct {
	ref  *types.IndirectRef // nil bei direkt eingebetteter Annotation
	dict types.Dict
	typ  string // Subtype
}

// art ordnet eine Annotation ein. Popups zaehlen nicht als eigene
// Anmerkung: Sie sind das Fenster einer Notiz und verschwinden mit ihr.
func (a anmerkung) art() string {
	switch a.typ {
	case "Widget":
		return artWidget
	case "Link":
		return artLink
	case "Popup":
		return artPopup
	}
	return artAnmerkung
}

func (a anmerkung) nr() int {
	if a.ref == nil {
		return 0
	}
	return a.ref.ObjectNumber.Value()
}

// anmerkungen liest die Annotationen einer Seite.
func anmerkungen(x *model.XRefTable, seite types.Dict) []anmerkung {
	var aus []anmerkung
	for _, o := range alsArray(x, seite["Annots"]) {
		d := alsDict(x, o)
		if d == nil {
			continue
		}
		a := anmerkung{dict: d, typ: alsName(x, d["Subtype"])}
		if ir, ok := o.(types.IndirectRef); ok {
			r := ir
			a.ref = &r
		}
		aus = append(aus, a)
	}
	return aus
}

// ============================================================
// Formularfelder
// ============================================================

// feld ist ein Endfeld (terminal) des Formulars — das, was ein Mensch
// ausfuellt. Ein Feld mit mehreren Widgets ist EIN Feld.
type feld struct {
	name    string // voll qualifiziert, Teile mit Punkt verbunden
	typ     string // FT, geerbt
	wert    bool   // hat /V
	nr      int    // Objektnummer des Feldes (0 bei direkt)
	widgets []int  // Objektnummern der Widgets (das Feld selbst, wenn verschmolzen)
}

// istWidget sagt, ob ein Feldknoten zugleich Widget ist.
func istWidget(x *model.XRefTable, d types.Dict) bool {
	return alsName(x, d["Subtype"]) == "Widget"
}

// istFeldknoten unterscheidet Kinder, die Felder sind (mit /T), von
// Kindern, die nur Widgets eines Feldes sind.
func istFeldknoten(x *model.XRefTable, d types.Dict) bool {
	_, hatName := d.Find("T")
	return hatName || !istWidget(x, d)
}

// formularfelder liest die Endfelder aus /AcroForm /Fields.
func formularfelder(x *model.XRefTable, katalog types.Dict) []feld {
	form := alsDict(x, katalog["AcroForm"])
	if form == nil {
		return nil
	}
	var aus []feld
	besucht := map[int]bool{}
	var ab func(o types.Object, name, typ string, t int)
	ab = func(o types.Object, name, typ string, t int) {
		if t > tiefe {
			return
		}
		nr, indirekt := objNr(o)
		if indirekt {
			if besucht[nr] {
				return
			}
			besucht[nr] = true
		}
		d := alsDict(x, o)
		if d == nil {
			return
		}
		if teil, ok := alsText(x, d["T"]); ok {
			if name == "" {
				name = teil
			} else {
				name += "." + teil
			}
		}
		if ft := alsName(x, d["FT"]); ft != "" {
			typ = ft
		}
		var feldKinder, widgetKinder []types.Object
		for _, k := range alsArray(x, d["Kids"]) {
			kd := alsDict(x, k)
			if kd == nil {
				continue
			}
			if istFeldknoten(x, kd) {
				feldKinder = append(feldKinder, k)
			} else {
				widgetKinder = append(widgetKinder, k)
			}
		}
		if len(feldKinder) > 0 {
			for _, k := range feldKinder {
				ab(k, name, typ, t+1)
			}
			return
		}
		f := feld{name: name, typ: typ, nr: nr}
		if v, ok := d.Find("V"); ok && v != nil {
			f.wert = aufloesen(x, v) != nil
		}
		if istWidget(x, d) && indirekt {
			f.widgets = append(f.widgets, nr)
		}
		for _, w := range widgetKinder {
			if wn, ok := objNr(w); ok {
				f.widgets = append(f.widgets, wn)
			}
		}
		aus = append(aus, f)
	}
	for _, o := range alsArray(x, form["Fields"]) {
		ab(o, "", "", 0)
	}
	return aus
}

// ============================================================
// Namensbaeume und Lesezeichen
// ============================================================

type namenseintrag struct {
	schluessel string
	wert       types.Object
}

// namensbaum liest einen Namensbaum (ISO 32000-1, 7.9.6) roh aus dem
// Dokument.
func namensbaum(x *model.XRefTable, wurzel types.Object) []namenseintrag {
	var aus []namenseintrag
	besucht := map[int]bool{}
	var ab func(o types.Object, t int)
	ab = func(o types.Object, t int) {
		if t > tiefe {
			return
		}
		if nr, ok := objNr(o); ok {
			if besucht[nr] {
				return
			}
			besucht[nr] = true
		}
		d := alsDict(x, o)
		if d == nil {
			return
		}
		namen := alsArray(x, d["Names"])
		for i := 0; i+1 < len(namen); i += 2 {
			s, ok := alsText(x, namen[i])
			if !ok {
				continue
			}
			aus = append(aus, namenseintrag{s, namen[i+1]})
		}
		for _, k := range alsArray(x, d["Kids"]) {
			ab(k, t+1)
		}
	}
	ab(wurzel, 0)
	return aus
}

// namensbaumVon liefert die Wurzel eines Namensbaums aus /Names.
func namensbaumVon(x *model.XRefTable, katalog types.Dict, name string) types.Object {
	namen := alsDict(x, katalog["Names"])
	if namen == nil {
		return nil
	}
	return namen[name]
}

// lesezeichenPunkt ist ein Eintrag der Gliederung.
type lesezeichenPunkt struct {
	ref  types.IndirectRef
	dict types.Dict
}

// lesezeichen liest alle Eintraege der Gliederung in Dokumentreihenfolge.
func lesezeichen(x *model.XRefTable, katalog types.Dict) []lesezeichenPunkt {
	wurzel := alsDict(x, katalog["Outlines"])
	if wurzel == nil {
		return nil
	}
	var aus []lesezeichenPunkt
	besucht := map[int]bool{}
	var ab func(erster types.Object, t int)
	ab = func(erster types.Object, t int) {
		if t > tiefe {
			return
		}
		for o := erster; o != nil; {
			ir, ok := o.(types.IndirectRef)
			if !ok || besucht[ir.ObjectNumber.Value()] {
				return
			}
			besucht[ir.ObjectNumber.Value()] = true
			d := alsDict(x, ir)
			if d == nil {
				return
			}
			aus = append(aus, lesezeichenPunkt{ref: ir, dict: d})
			if kind, ok := d.Find("First"); ok {
				ab(kind, t+1)
			}
			o, _ = d.Find("Next")
		}
	}
	if erster, ok := wurzel.Find("First"); ok {
		ab(erster, 0)
	}
	return aus
}

// zielNamen: Arten einer Zielangabe (ISO 32000-1, 12.3.2.2).
var zielArten = map[string]bool{"XYZ": true, "Fit": true, "FitH": true, "FitV": true,
	"FitR": true, "FitB": true, "FitBH": true, "FitBV": true}

// istZielArray erkennt [Seite /Art ...].
func istZielArray(x *model.XRefTable, a types.Array) bool {
	return len(a) >= 2 && zielArten[alsName(x, a[1])]
}

// benannteZiele liest benannte Ziele aus Namensbaum und altem /Dests.
func benannteZiele(x *model.XRefTable, katalog types.Dict) map[string]types.Object {
	aus := map[string]types.Object{}
	if alt := alsDict(x, katalog["Dests"]); alt != nil {
		for k, v := range alt {
			aus[k] = v
		}
	}
	for _, e := range namensbaum(x, namensbaumVon(x, katalog, "Dests")) {
		aus[e.schluessel] = e.wert
	}
	return aus
}

// zielSeite loest eine Zielangabe (Array, Name, Zeichenkette, Dict mit
// /D) zur Objektnummer der Zielseite auf. 0 heisst: kein Seitenziel.
func zielSeite(x *model.XRefTable, ziel types.Object, benannt map[string]types.Object, t int) int {
	if t > 4 || ziel == nil {
		return 0
	}
	switch v := aufloesen(x, ziel).(type) {
	case types.Array:
		if len(v) > 0 {
			if nr, ok := objNr(v[0]); ok {
				return nr
			}
		}
	case types.Name:
		return zielSeite(x, benannt[string(v)], benannt, t+1)
	case types.StringLiteral, types.HexLiteral:
		s, _ := alsText(x, v)
		return zielSeite(x, benannt[s], benannt, t+1)
	case types.Dict:
		return zielSeite(x, v["D"], benannt, t+1)
	}
	return 0
}

// aktionsZiel liefert die Zielseite eines Eintrags mit /Dest oder einer
// GoTo-Aktion in /A.
func aktionsZiel(x *model.XRefTable, d types.Dict, benannt map[string]types.Object) int {
	if z, ok := d.Find("Dest"); ok {
		return zielSeite(x, z, benannt, 0)
	}
	a := alsDict(x, d["A"])
	if a != nil && alsName(x, a["S"]) == "GoTo" {
		return zielSeite(x, a["D"], benannt, 0)
	}
	return 0
}

// enthaeltPdfaKennung sucht die PDF/A-Kennzeichnung in XMP-Metadaten —
// als Element (<pdfaid:part>) oder Attribut (pdfaid:part="2").
func enthaeltPdfaKennung(xmp []byte) bool {
	s := string(xmp)
	return strings.Contains(s, "pdfaid:part")
}

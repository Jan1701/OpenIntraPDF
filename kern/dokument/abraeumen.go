// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"fmt"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Abraeumen nach dem Entfernen von Seiten.
//
// pdfcpu schreibt, was vom Katalog aus erreichbar ist. Eine entfernte
// Seite steht zwar nicht mehr im Seitenbaum — zeigt aber noch ein
// Lesezeichen, ein Link, ein benanntes Ziel, ein Formularfeld oder ein
// Strukturelement auf sie, landet sie ueber diesen Verweis doch wieder in
// der Datei, samt Inhalt. Wer eine Seite mit vertraulichem Inhalt
// entfernt, muss sich darauf verlassen koennen, dass sie weg ist.
//
// Deshalb zwei Stufen: erst gezielt (Lesezeichen, Links, Startaktion,
// Formular, benannte Ziele — mit Zaehlung und Warnung), dann ein
// allgemeiner Durchgang, der jeden restlichen Verweis auf ein verbotenes
// Objekt kappt. TestEntfernteSeiteIstWirklichWeg prueft, dass der Inhalt
// einer entfernten Seite nicht mehr in den Bytes steht.

func (u *umbau) abraeumen(kinder types.Array) error {
	// Annotationen der behaltenen Seiten (auch der Verdopplungen).
	behalten := map[int]bool{}
	for _, k := range kinder {
		for _, a := range anmerkungen(u.x, alsDict(u.x, k)) {
			if n := a.nr(); n > 0 {
				behalten[n] = true
			}
		}
	}
	for nr := range u.entfernt {
		u.verboten[nr] = true
	}
	for _, s := range u.seiten {
		if u.entfernt[s.ref.ObjectNumber.Value()] {
			for _, a := range anmerkungen(u.x, s.dict) {
				if n := a.nr(); n > 0 && !behalten[n] {
					u.verboten[n] = true
				}
			}
		}
	}

	u.benannt = benannteZiele(u.x, u.katalog)
	u.lesezeichenAbraeumen()
	u.linksAbraeumen(kinder)
	u.startaktionAbraeumen()
	u.formularAbraeumen()
	if err := u.benannteZieleAbraeumen(); err != nil {
		return err
	}
	u.saeubern(u.katalog, map[int]bool{u.x.Root.ObjectNumber.Value(): true}, "", 0)
	return nil
}

// zeigtAufEntfernte sagt, ob ein Eintrag (Lesezeichen, Link) auf eine
// entfernte Seite zeigt.
func (u *umbau) zeigtAufEntfernte(d types.Dict) bool {
	ziel := aktionsZiel(u.x, d, u.benannt)
	return ziel > 0 && u.entfernt[ziel]
}

// zielWeg entfernt Zielangabe und GoTo-Aktion eines Eintrags.
func (u *umbau) zielWeg(d types.Dict) {
	d.Delete("Dest")
	if a := alsDict(u.x, d["A"]); a != nil && alsName(u.x, a["S"]) == "GoTo" {
		d.Delete("A")
	}
}

// lesezeichenAbraeumen: Ein Lesezeichen auf eine entfernte Seite geht mit
// ihr — ausser es hat Unterpunkte; dann bleibt es als Ueberschrift ohne
// Ziel stehen (Warnung bookmark_target_removed), damit die Unterpunkte
// nicht mit verschwinden.
func (u *umbau) lesezeichenAbraeumen() {
	wurzelObj, ok := u.katalog.Find("Outlines")
	if !ok {
		return
	}
	wurzel := alsDict(u.x, wurzelObj)
	if wurzel == nil {
		return
	}
	besucht := map[int]bool{}
	var ebene func(eltern types.Dict, t int)
	ebene = func(eltern types.Dict, t int) {
		if t > tiefe {
			return
		}
		var kette []lesezeichenPunkt
		for o, _ := eltern.Find("First"); o != nil; {
			ir, ok := o.(types.IndirectRef)
			if !ok || besucht[ir.ObjectNumber.Value()] {
				break
			}
			besucht[ir.ObjectNumber.Value()] = true
			d := alsDict(u.x, ir)
			if d == nil {
				break
			}
			kette = append(kette, lesezeichenPunkt{ref: ir, dict: d})
			o, _ = d.Find("Next")
		}
		var bleiben []lesezeichenPunkt
		for _, p := range kette {
			ebene(p.dict, t+1)
			if u.zeigtAufEntfernte(p.dict) {
				if _, hatKinder := p.dict.Find("First"); hatKinder {
					u.zielWeg(p.dict)
					u.bericht.warnung(WarnungLesezeichenZielWeg)
				} else {
					u.lesezeichenMitSeiten++
					continue
				}
			}
			bleiben = append(bleiben, p)
		}
		if len(bleiben) == len(kette) {
			return
		}
		for i, p := range bleiben {
			p.dict.Delete("Prev")
			p.dict.Delete("Next")
			if i > 0 {
				p.dict["Prev"] = bleiben[i-1].ref
			}
			if i < len(bleiben)-1 {
				p.dict["Next"] = bleiben[i+1].ref
			}
		}
		if len(bleiben) == 0 {
			eltern.Delete("First")
			eltern.Delete("Last")
			return
		}
		eltern["First"] = bleiben[0].ref
		eltern["Last"] = bleiben[len(bleiben)-1].ref
	}
	ebene(wurzel, 0)

	// /Count neu rechnen: offen = positive Zahl der sichtbaren Nachfahren,
	// geschlossen = negative.
	gezaehlt := map[int]bool{}
	var sichtbar func(eltern types.Dict, t int) int
	sichtbar = func(eltern types.Dict, t int) int {
		if t > tiefe {
			return 0
		}
		n := 0
		for o, _ := eltern.Find("First"); o != nil; {
			ir, ok := o.(types.IndirectRef)
			if !ok || gezaehlt[ir.ObjectNumber.Value()] {
				break
			}
			gezaehlt[ir.ObjectNumber.Value()] = true
			d := alsDict(u.x, ir)
			if d == nil {
				break
			}
			offen := false
			if c, ok := aufloesen(u.x, d["Count"]).(types.Integer); ok && c > 0 {
				offen = true
			}
			unter := sichtbar(d, t+1)
			switch {
			case unter == 0:
				d.Delete("Count")
			case offen:
				d["Count"] = types.Integer(unter)
			default:
				d["Count"] = types.Integer(-unter)
			}
			n++
			if offen {
				n += unter
			}
			o, _ = d.Find("Next")
		}
		return n
	}
	gesamt := sichtbar(wurzel, 0)
	if _, ok := wurzel.Find("First"); !ok {
		u.katalog.Delete("Outlines")
		return
	}
	wurzel["Count"] = types.Integer(gesamt)
}

// linksAbraeumen: Links (und andere Annotationen mit GoTo) auf behaltenen
// Seiten, deren Ziel entfernt wurde, verlieren das Ziel. Die Annotation
// selbst bleibt — sie ist Teil der behaltenen Seite.
func (u *umbau) linksAbraeumen(kinder types.Array) {
	for _, k := range kinder {
		for _, a := range anmerkungen(u.x, alsDict(u.x, k)) {
			if u.zeigtAufEntfernte(a.dict) {
				u.zielWeg(a.dict)
				u.bericht.warnung(WarnungLinkZielWeg)
			}
		}
	}
}

// startaktionAbraeumen: Eine Startaktion, die auf eine entfernte Seite
// springt, entfaellt.
func (u *umbau) startaktionAbraeumen() {
	oa, ok := u.katalog.Find("OpenAction")
	if !ok {
		return
	}
	ziel := 0
	switch v := aufloesen(u.x, oa).(type) {
	case types.Array:
		ziel = zielSeite(u.x, v, u.benannt, 0)
	case types.Dict:
		if alsName(u.x, v["S"]) == "GoTo" {
			ziel = zielSeite(u.x, v["D"], u.benannt, 0)
		}
	}
	if ziel > 0 && u.entfernt[ziel] {
		u.katalog.Delete("OpenAction")
		u.bericht.warnung(WarnungStartaktionWeg)
	}
}

// formularAbraeumen nimmt Widgets entfernter Seiten aus dem Feldbaum.
// Ein Feld, dessen Widgets ALLE auf entfernten Seiten standen, geht mit
// ihnen (form_fields_removed_with_pages). Ein Feld mit einem Widget auf
// einer behaltenen Seite bleibt — mit diesem Widget.
func (u *umbau) formularAbraeumen() {
	form := alsDict(u.x, u.katalog["AcroForm"])
	if form == nil {
		return
	}
	vorher := len(formularfelder(u.x, u.katalog))
	besucht := map[int]bool{}
	var behalten func(o types.Object, t int) bool
	behalten = func(o types.Object, t int) bool {
		nr, indirekt := objNr(o)
		if indirekt {
			if u.verboten[nr] {
				return false
			}
			if besucht[nr] {
				return true
			}
			besucht[nr] = true
		}
		d := alsDict(u.x, o)
		if d == nil {
			return false
		}
		kinderObj, hatKinder := d.Find("Kids")
		if !hatKinder || t > tiefe {
			return true
		}
		kinder := alsArray(u.x, kinderObj)
		neu := types.Array{}
		for _, k := range kinder {
			if behalten(k, t+1) {
				neu = append(neu, k)
			}
		}
		if len(neu) == 0 && len(kinder) > 0 {
			return false
		}
		if len(neu) != len(kinder) {
			d["Kids"] = neu
		}
		return true
	}
	felder := alsArray(u.x, form["Fields"])
	neu := types.Array{}
	for _, f := range felder {
		if behalten(f, 0) {
			neu = append(neu, f)
		}
	}
	if len(neu) != len(felder) {
		form["Fields"] = neu
	}
	// Berechnungsreihenfolge: nur, was es noch gibt.
	if co := alsArray(u.x, form["CO"]); co != nil {
		rest := types.Array{}
		for _, f := range co {
			if nr, ok := objNr(f); ok && besucht[nr] && !u.verboten[nr] {
				rest = append(rest, f)
			}
		}
		form["CO"] = rest
	}
	u.felderMitSeiten = vorher - len(formularfelder(u.x, u.katalog))
}

// benannteZieleAbraeumen streicht benannte Ziele auf entfernte Seiten —
// im alten /Dests und im Namensbaum Dests.
//
// Der Namensbaum wird neu gebaut, nicht in pdfcpu geloescht: Node.Remove
// entfernt auch den Objektgraphen des Werts, und der fuehrt ueber das
// Seitenobjekt bis in den Seitenbaum.
func (u *umbau) benannteZieleAbraeumen() error {
	weg := 0
	if alt := alsDict(u.x, u.katalog["Dests"]); alt != nil {
		for k, v := range alt {
			if z := zielSeite(u.x, v, nil, 0); z > 0 && u.entfernt[z] {
				alt.Delete(k)
				weg++
			}
		}
	}

	eintraege := namensbaum(u.x, namensbaumVon(u.x, u.katalog, "Dests"))
	var bleiben []namenseintrag
	for _, e := range eintraege {
		if z := zielSeite(u.x, e.wert, nil, 0); z > 0 && u.entfernt[z] {
			weg++
			continue
		}
		bleiben = append(bleiben, e)
	}
	if len(bleiben) != len(eintraege) {
		if err := namensbaumErsetzen(u, "Dests", bleiben); err != nil {
			return err
		}
	}
	if weg > 0 {
		u.bericht.warnung(WarnungBenanntesZielWeg)
	}
	return nil
}

// namensbaumErsetzen setzt einen Namensbaum neu aus eintraege. pdfcpu
// haelt Namensbaeume zwischengespeichert (XRefTable.Names) und schreibt
// beim Speichern aus diesem Zwischenspeicher — geaendert wird deshalb
// dort, am selben Wurzel-Woerterbuch.
func namensbaumErsetzen(u *umbau, name string, eintraege []namenseintrag) error {
	return namensbaumSetzen(u.c, u.ctx, name, eintraege)
}

func namensbaumSetzen(c context.Context, ctx *model.Context, name string, eintraege []namenseintrag) error {
	x := ctx.XRefTable
	katalog, err := ctx.Catalog()
	if err != nil || katalog == nil {
		return fmt.Errorf("%w: Katalog fehlt", ErrNichtUnterstuetzt)
	}
	var d types.Dict
	if alt := x.Names[name]; alt != nil {
		d = alt.D
	}
	if d == nil {
		d = alsDict(x, namensbaumVon(x, katalog, name))
	}
	if d == nil {
		namen := alsDict(x, katalog["Names"])
		if namen == nil {
			namen = types.NewDict()
			katalog["Names"] = namen
		}
		d = types.NewDict()
		namen[name] = d
	}
	d.Delete("Kids")
	d.Delete("Names")
	d.Delete("Limits")
	knoten := &model.Node{D: d}
	for _, e := range eintraege {
		if err := knoten.Add(c, x, e.schluessel, e.wert, nil, nil); err != nil {
			return fmt.Errorf("%w: Namensbaum %s: %v", ErrNichtUnterstuetzt, name, err)
		}
	}
	if x.Names == nil {
		x.Names = map[string]*model.Node{}
	}
	x.Names[name] = knoten
	return nil
}

// saeubern kappt jeden restlichen Verweis auf ein verbotenes Objekt: In
// Woerterbuechern faellt der Schluessel weg, in Listen das Element; in
// den Blattlisten von Namens- und Zahlenbaeumen (Names, Nums) wird es zu
// null, damit die Paare nicht verrutschen. Eine Zielangabe [Seite /Fit]
// auf eine entfernte Seite faellt als Ganzes.
func (u *umbau) saeubern(o types.Object, besucht map[int]bool, schluessel string, t int) types.Object {
	if t > 4*tiefe {
		return o
	}
	switch v := o.(type) {
	case types.IndirectRef:
		nr := v.ObjectNumber.Value()
		if besucht[nr] {
			return o
		}
		besucht[nr] = true
		innen := aufloesen(u.x, v)
		switch w := innen.(type) {
		case types.Dict:
			u.saeubernDict(w, besucht, t)
		case types.StreamDict:
			u.saeubernDict(w.Dict, besucht, t)
		case types.Array:
			neu, geaendert := u.saeubernArray(w, besucht, schluessel, t)
			if geaendert {
				if e, ok := u.x.Table[nr]; ok && e != nil {
					e.Object = neu
				}
			}
		}
		return o
	case types.Dict:
		u.saeubernDict(v, besucht, t)
		return v
	case types.StreamDict:
		u.saeubernDict(v.Dict, besucht, t)
		return v
	case types.Array:
		neu, _ := u.saeubernArray(v, besucht, schluessel, t)
		return neu
	}
	return o
}

func (u *umbau) verbotenesZiel(o types.Object) bool {
	a := alsArray(u.x, o)
	if a == nil || !istZielArray(u.x, a) {
		return false
	}
	nr, ok := objNr(a[0])
	return ok && u.verboten[nr]
}

func (u *umbau) saeubernDict(d types.Dict, besucht map[int]bool, t int) {
	for k, v := range d {
		if nr, ok := objNr(v); ok && u.verboten[nr] {
			d.Delete(k)
			continue
		}
		if (k == "D" || k == "Dest") && u.verbotenesZiel(v) {
			d.Delete(k)
			continue
		}
		d[k] = u.saeubern(v, besucht, k, t+1)
	}
}

func (u *umbau) saeubernArray(a types.Array, besucht map[int]bool, schluessel string, t int) (types.Array, bool) {
	paarweise := schluessel == "Names" || schluessel == "Nums"
	neu := make(types.Array, 0, len(a))
	geaendert := false
	for _, v := range a {
		verboten := false
		if nr, ok := objNr(v); ok && u.verboten[nr] {
			verboten = true
		} else if _, ist := v.(types.Array); ist && u.verbotenesZiel(v) {
			verboten = true
		}
		if verboten {
			geaendert = true
			if paarweise {
				neu = append(neu, nil)
			}
			continue
		}
		neu = append(neu, u.saeubern(v, besucht, "", t+1))
	}
	return neu, geaendert
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Seite ist ein Eintrag im Seitenplan: welche Quellseite (ab 0) und wie
// weit sie ZUSAETZLICH gedreht wird (im Uhrzeigersinn, 0/90/180/270).
//
// Der Plan ist die vollstaendige neue Seitenfolge: Reihenfolge = Liste,
// fehlende Quellseiten sind entfernt, doppelte sind Verdopplungen. Ein
// Eintrag mit Leer (Etappe 9) ist eine NEUE leere Seite statt einer
// Quellseite; Quelle zaehlt dann nicht, Drehung ist ihr /Rotate.
type Seite struct {
	Quelle  int        `json:"source"`
	Drehung int        `json:"rotate"`
	Leer    *Leerseite `json:"blank,omitempty"`
}

// Leerseite ist das Format einer neuen leeren Seite: MediaBox [0 0 Breite
// Hoehe] in Punkt (Etappe 9, Vertrag Abschnitt 1).
type Leerseite struct {
	Breite float64 `json:"width"`
	Hoehe  float64 `json:"height"`
}

// HoechstSeitenmass ist die groesste Kantenlaenge einer leeren Seite in
// Punkt: 200 Zoll, die Grenze der PDF-Norm (ISO 32000-1, Anhang C).
const HoechstSeitenmass = 14400

// leer sagt, ob der Eintrag eine neue leere Seite ist.
func (s Seite) leer() bool { return s.Leer != nil }

// SeitenplanBauen schreibt das Dokument nach plan neu — ohne Rasterung:
// Text, Vektoren und Bilder bleiben, wie sie sind. Danach wird das
// Ergebnis erneut geoeffnet und geprueft; der Bericht beschreibt, was
// erhalten blieb.
//
// Verluste (Bericht.Verluste) sind kein Fehler: Das Ergebnis steht in
// ziel, und der Aufrufer entscheidet, ob er es so veroeffentlicht.
func SeitenplanBauen(c context.Context, quelle io.ReadSeeker, plan []Seite, ziel io.Writer) (Bericht, error) {
	ctx, err := lesen(c, quelle, model.COLLECT)
	if err != nil {
		return Bericht{}, err
	}
	ergebnis, _, bericht, err := seitenplan(c, ctx, plan)
	if err != nil {
		return Bericht{}, err
	}
	if _, err := ziel.Write(ergebnis); err != nil {
		return Bericht{}, err
	}
	return bericht, nil
}

// CommitBauen ist der gemeinsame Bau eines Commits: erst die
// Anmerkungsbefehle, dann der Seitenplan — beides am selben geoeffneten
// Dokument, damit eine Anmerkung mit ihrer Seite wandert (page ist der
// Index im Basisdokument). plan nil heisst: Seiten bleiben, wie sie sind;
// anm nil heisst: keine Anmerkungsbefehle.
//
// Nach dem Schreiben wird das Ergebnis wieder geoeffnet: Jede vorher
// vorhandene Anmerkung, die nicht geloescht wurde und deren Seite bleibt,
// muss noch da sein, jede neue ebenso, keine geloeschte — sonst ErrPruefung.
func CommitBauen(c context.Context, quelle io.ReadSeeker, anm *Anmerkungsbefehle, plan []Seite, ziel io.Writer) (Bericht, Anmerkungsergebnis, error) {
	return CommitBauenMit(c, quelle, anm, plan, nil, ziel)
}

// CommitBauenMit ist CommitBauen mit Eigenschaften (Etappe 8): Titel,
// Thema, Autor und Stichwoerter werden nach den Anmerkungen und vor dem
// Seitenplan ins Info-Woerterbuch (und ins XMP, falls vorhanden)
// geschrieben und nach dem Schreiben im Ergebnis nachgeprueft. eig nil
// heisst: Eigenschaften bleiben, wie sie sind. Seit Etappe 9 ist das ein
// Aufruf von CommitAusfuehren (commit.go).
func CommitBauenMit(c context.Context, quelle io.ReadSeeker, anm *Anmerkungsbefehle, plan []Seite, eig *Eigenschaften, ziel io.Writer) (Bericht, Anmerkungsergebnis, error) {
	return CommitAusfuehren(c, quelle, Commit{Anmerkungen: anm, Plan: plan, Eigenschaften: eig}, ziel)
}

// anmerkungenPruefen vergleicht das wieder geoeffnete Ergebnis mit dem,
// was die Anmerkungsbefehle hinterlassen haben sollten, und traegt die
// Zahlen in den Bericht ein.
func anmerkungenPruefen(nachCtx *model.Context, plan []Seite, erg Anmerkungsergebnis, b *Bericht) error {
	seiten, err := blaetter(nachCtx)
	if err != nil {
		return fmt.Errorf("%w: Ergebnis: %v", ErrPruefung, err)
	}
	da := map[int]bool{}
	kennungen := map[string]bool{}
	for _, s := range seiten {
		for _, a := range anmerkungen(nachCtx.XRefTable, s.dict) {
			// Links (Etappe 9) zaehlen fuer neue und geloeschte mit; im
			// Bestand (vorher) stehen sie nicht, weil ein Seitenplan sie
			// absichtlich abraeumen darf.
			if a.art() != artAnmerkung && a.art() != artLink {
				continue
			}
			if n := a.nr(); n > 0 {
				da[n] = true
			}
			if nm, ok := alsText(nachCtx.XRefTable, a.dict["NM"]); ok && nm != "" {
				kennungen[nm] = true
			}
		}
	}
	imPlan := map[int]bool{}
	for _, p := range plan {
		if !p.leer() {
			imPlan[p.Quelle] = true
		}
	}
	for nr, seite := range erg.vorher {
		switch {
		case erg.entfernt[nr]:
			if da[nr] {
				return fmt.Errorf("%w: geloeschte Anmerkung %d steht noch im Ergebnis", ErrPruefung, nr)
			}
		case !imPlan[seite]:
		case !da[nr]:
			return fmt.Errorf("%w: Anmerkung %d fehlt im Ergebnis", ErrPruefung, nr)
		default:
			b.AnmerkungenFremdBehalten++
		}
	}
	for _, n := range erg.neu {
		if !imPlan[n.seite] {
			continue
		}
		if !kennungen[n.nm] {
			return fmt.Errorf("%w: neue Anmerkung %d (%s) fehlt im Ergebnis", ErrPruefung, n.nr, n.nm)
		}
		b.AnmerkungenNeu++
	}
	// Geloeschte Links stehen nicht in vorher — auch sie muessen weg sein.
	for nr := range erg.entfernt {
		if _, bekannt := erg.vorher[nr]; !bekannt && da[nr] {
			return fmt.Errorf("%w: geloeschter Link %d steht noch im Ergebnis", ErrPruefung, nr)
		}
	}
	b.AnmerkungenEntfernt = len(erg.entfernt)
	return nil
}

// Extrahieren schreibt die Seiten (ab 0, in dieser Reihenfolge) als neues
// Dokument — dieselbe Erhaltung wie SeitenplanBauen.
func Extrahieren(c context.Context, quelle io.ReadSeeker, seiten []int, ziel io.Writer) (Bericht, error) {
	plan := make([]Seite, len(seiten))
	for i, s := range seiten {
		plan[i] = Seite{Quelle: s}
	}
	return SeitenplanBauen(c, quelle, plan, ziel)
}

// planPruefen weist leere, zu lange und unsinnige Plaene ab.
func planPruefen(plan []Seite, seiten int) error {
	if len(plan) == 0 {
		return ErrKeineSeiten
	}
	if len(plan) > HoechstSeiten {
		return ErrZuVieleSeiten
	}
	for i, p := range plan {
		switch {
		case p.leer():
			l := *p.Leer
			if !(l.Breite >= 1 && l.Breite <= HoechstSeitenmass && l.Hoehe >= 1 && l.Hoehe <= HoechstSeitenmass) {
				return fmt.Errorf("%w: Eintrag %d: leere Seite mit %g x %g Punkt", ErrPlanUngueltig, i, l.Breite, l.Hoehe)
			}
		case p.Quelle < 0 || p.Quelle >= seiten:
			return fmt.Errorf("%w: Eintrag %d nennt Seite %d, das Dokument hat %d", ErrPlanUngueltig, i, p.Quelle, seiten)
		}
		switch p.Drehung {
		case 0, 90, 180, 270:
		default:
			return fmt.Errorf("%w: Eintrag %d dreht um %d Grad", ErrPlanUngueltig, i, p.Drehung)
		}
	}
	return nil
}

// seitenplan fuehrt den Plan am geoeffneten Dokument aus, schreibt es,
// oeffnet das Ergebnis wieder und rechnet den Bericht. Der wieder
// geoeffnete Kontext kommt mit zurueck, damit ein Aufrufer weitere
// Pruefungen daran macht, ohne noch einmal zu lesen.
func seitenplan(c context.Context, ctx *model.Context, plan []Seite) ([]byte, *model.Context, Bericht, error) {
	if err := planPruefen(plan, ctx.PageCount); err != nil {
		return nil, nil, Bericht{}, err
	}
	vorher := inspizieren(ctx)
	seiten, err := blaetter(ctx)
	if err != nil {
		return nil, nil, Bericht{}, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	z := make([]seitenzaehlung, len(seiten))
	for i, s := range seiten {
		z[i] = zaehlen(ctx.XRefTable, s.dict)
	}

	u, err := neuerUmbau(c, ctx, seiten)
	if err != nil {
		return nil, nil, Bericht{}, err
	}
	if err := u.bauen(plan, vorher); err != nil {
		return nil, nil, Bericht{}, err
	}
	if err := c.Err(); err != nil {
		return nil, nil, Bericht{}, err
	}

	ergebnis, err := schreiben(c, ctx)
	if err != nil {
		return nil, nil, Bericht{}, err
	}
	// Wieder lesen mit den Kennwoertern der Basis: Ein Ergebnis mit
	// Benutzerpasswort (Etappe 9) oeffnet sich sonst nicht.
	nachKonf := konfiguration(model.LISTINFO)
	nachKonf.UserPW, nachKonf.OwnerPW = ctx.UserPW, ctx.OwnerPW
	nachCtx, err := lesenMit(c, bytes.NewReader(ergebnis), nachKonf)
	if err != nil {
		return nil, nil, Bericht{}, fmt.Errorf("%w: Ergebnis nicht wieder lesbar: %v", ErrPruefung, err)
	}
	nach := inspizieren(nachCtx)
	if nach.Seiten != len(plan) {
		return nil, nil, Bericht{}, fmt.Errorf("%w: %d Seiten geschrieben, %d geplant", ErrPruefung, nach.Seiten, len(plan))
	}

	b := u.bericht
	b.quelle = vorher
	b.Seiten = nach.Seiten
	imPlan := make([]bool, len(seiten))
	erwartetAnm, erwartetAnlagen := 0, 0
	for _, p := range plan {
		if p.leer() {
			continue
		}
		imPlan[p.Quelle] = true
		erwartetAnm += z[p.Quelle].anmerkungen
		erwartetAnlagen += z[p.Quelle].dateianlagen
	}
	anlagenAufSeiten := 0
	for i := range seiten {
		anlagenAufSeiten += z[i].dateianlagen
		if !imPlan[i] {
			b.AnmerkungenMitSeiten += z[i].anmerkungen
			b.AnhaengeMitSeiten += z[i].dateianlagen
		}
	}

	b.AnmerkungenBehalten = nach.Anmerkungen
	if nach.Anmerkungen < erwartetAnm {
		b.AnmerkungenVerloren = erwartetAnm - nach.Anmerkungen
		b.verlust(VerlustAnmerkungen)
	}

	b.FelderVorher, b.FelderNachher = vorher.Formularfelder, nach.Formularfelder
	b.FelderMitSeiten = u.felderMitSeiten
	if nach.Formularfelder < vorher.Formularfelder-u.felderMitSeiten {
		b.verlust(VerlustFelder)
	}
	if u.widgetsNichtKopiert > 0 {
		b.warnung(WarnungVerdoppeltOhneFelder)
		b.verlust(VerlustFelder)
	}

	b.AnhaengeVorher, b.AnhaengeNachher = vorher.Anhaenge, nach.Anhaenge
	eingebettet := vorher.Anhaenge - anlagenAufSeiten
	if nach.Anhaenge < eingebettet+erwartetAnlagen {
		b.verlust(VerlustAnhaenge)
	}

	b.LesezeichenVorher, b.LesezeichenNachher = vorher.Lesezeichen, nach.Lesezeichen
	b.LesezeichenMitSeiten = u.lesezeichenMitSeiten
	if nach.Lesezeichen < vorher.Lesezeichen-u.lesezeichenMitSeiten {
		b.verlust(VerlustLesezeichen)
	}
	b.leerAlsListe()
	return ergebnis, nachCtx, *b, nil
}

// umbau fuehrt einen Seitenplan an einem geoeffneten Dokument aus.
type umbau struct {
	c         context.Context
	ctx       *model.Context
	x         *model.XRefTable
	katalog   types.Dict
	seiten    []blatt
	wurzelRef types.IndirectRef
	wurzel    types.Dict

	bericht *Bericht
	// benannt sind die benannten Ziele VOR dem Abraeumen — Lesezeichen und
	// Links, die auf ein benanntes Ziel zeigen, werden damit aufgeloest.
	benannt map[string]types.Object
	// entfernt: Objektnummern der Seiten, die nicht im Plan stehen.
	entfernt map[int]bool
	// verboten: entfernte Seiten und Annotationen, die NUR auf ihnen
	// stehen. Kein Verweis darauf darf im Ergebnis bleiben — sonst
	// schriebe pdfcpu das Objekt ueber diesen Verweis wieder in die Datei.
	verboten map[int]bool

	felderMitSeiten      int
	lesezeichenMitSeiten int
	widgetsNichtKopiert  int
}

func neuerUmbau(c context.Context, ctx *model.Context, seiten []blatt) (*umbau, error) {
	katalog, err := ctx.Catalog()
	if err != nil || katalog == nil {
		return nil, fmt.Errorf("%w: Katalog fehlt", ErrNichtUnterstuetzt)
	}
	wurzelRef, err := ctx.Pages()
	if err != nil || wurzelRef == nil {
		return nil, fmt.Errorf("%w: Seitenbaum fehlt", ErrNichtUnterstuetzt)
	}
	wurzel := alsDict(ctx.XRefTable, *wurzelRef)
	if wurzel == nil {
		return nil, fmt.Errorf("%w: Seitenbaum fehlt", ErrNichtUnterstuetzt)
	}
	return &umbau{
		c: c, ctx: ctx, x: ctx.XRefTable, katalog: katalog, seiten: seiten,
		wurzelRef: *wurzelRef, wurzel: wurzel,
		bericht:  &Bericht{},
		entfernt: map[int]bool{}, verboten: map[int]bool{},
	}, nil
}

// kopie klont direkte Objekte; Verweise und einfache Werte bleiben.
func kopie(o types.Object) types.Object {
	switch v := o.(type) {
	case types.Dict:
		return v.Clone()
	case types.Array:
		return v.Clone()
	}
	return o
}

func (u *umbau) bauen(plan []Seite, vorher Inspektion) error {
	// 1. Vererbte Attribute in die Seiten schreiben. Der Seitenbaum wird
	// gleich flach — ohne diesen Schritt verloere eine Seite ihre
	// MediaBox, Ressourcen oder Drehung, sobald ihr Zwischenknoten
	// wegfaellt.
	for _, s := range u.seiten {
		for _, k := range vererbbar {
			if _, ok := s.dict.Find(k); ok {
				continue
			}
			if v, ok := s.geerbt[k]; ok {
				s.dict[k] = kopie(v)
			}
		}
	}

	// 2. Seiteninstanzen bilden. Verdopplungen werden aus dem UNVERAENDERTEN
	// Original geklont — deshalb vor jeder Drehung.
	type instanz struct {
		ref  types.IndirectRef
		dict types.Dict
	}
	instanzen := make([]instanz, len(plan))
	vorkommen := map[int]int{}
	for i, p := range plan {
		if p.leer() {
			ref, d, err := u.leereSeite(*p.Leer)
			if err != nil {
				return err
			}
			instanzen[i] = instanz{ref, d}
			continue
		}
		s := u.seiten[p.Quelle]
		if vorkommen[p.Quelle] == 0 {
			instanzen[i] = instanz{s.ref, s.dict}
		} else {
			ref, d, err := u.verdoppeln(s)
			if err != nil {
				return err
			}
			instanzen[i] = instanz{ref, d}
		}
		vorkommen[p.Quelle]++
	}

	// 3. Flacher Seitenbaum, Drehung.
	kinder := make(types.Array, 0, len(plan))
	for i, p := range plan {
		d := instanzen[i].dict
		d["Parent"] = u.wurzelRef
		if p.Drehung != 0 {
			d["Rotate"] = types.Integer(((drehungVon(u.x, d)+p.Drehung)%360 + 360) % 360)
		}
		kinder = append(kinder, instanzen[i].ref)
	}
	u.wurzel["Kids"] = kinder
	u.wurzel["Count"] = types.Integer(len(kinder))
	u.ctx.PageCount = len(kinder)

	identisch := len(plan) == len(u.seiten)
	for i, s := range u.seiten {
		if vorkommen[i] == 0 {
			u.entfernt[s.ref.ObjectNumber.Value()] = true
		}
		if identisch && (plan[i].leer() || plan[i].Quelle != i) {
			identisch = false
		}
	}

	// 4. Was auf entfernte Seiten zeigt, abraeumen.
	if len(u.entfernt) > 0 {
		if err := u.abraeumen(kinder); err != nil {
			return err
		}
	}

	// 5. Was sich auf Seitennummern bezieht, stimmt nach dem Umordnen nicht
	// mehr.
	if !identisch {
		if _, ok := u.katalog.Find("PageLabels"); ok {
			u.katalog.Delete("PageLabels")
			u.bericht.warnung(WarnungSeitenbeschriftungWeg)
		}
		if vorher.Getaggt {
			u.bericht.warnung(WarnungStruktur)
		}
	}
	if vorher.Signiert {
		u.bericht.warnung(WarnungSignaturUngueltig)
	}
	if vorher.PDFA {
		u.bericht.warnung(WarnungPdfaUngeprueft)
	}
	if vorher.Verschluesselt {
		u.bericht.warnung(WarnungVerschluesselung)
	}
	if vorher.JavaScript {
		u.bericht.warnung(WarnungJavaScript)
	}
	return nil
}

// drehungVon liest /Rotate (auch als Gleitkommazahl, wie manche
// Programme es schreiben).
func drehungVon(x *model.XRefTable, d types.Dict) int {
	switch v := aufloesen(x, d["Rotate"]).(type) {
	case types.Integer:
		return int(v)
	case types.Float:
		return int(v)
	}
	return 0
}

// leereSeite legt eine neue Seite ohne Inhalt an (Etappe 9): MediaBox im
// gewuenschten Format, leere Ressourcen und ein LEERER Inhaltsstrom — die
// Norm erlaubte auch gar keinen, aber pdfcpu (PageContent) und andere
// Werkzeuge stolpern ueber eine Seite ohne Contents; pdfcpus eigene
// EmptyPage schreibt ihn ebenso. Parent und Rotate setzt bauen wie bei
// jeder anderen Seite.
func (u *umbau) leereSeite(l Leerseite) (types.IndirectRef, types.Dict, error) {
	inhalt, err := u.x.NewStreamDictForBuf(nil)
	if err != nil {
		return types.IndirectRef{}, nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	if err := inhalt.Encode(); err != nil {
		return types.IndirectRef{}, nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	inhaltRef, err := u.x.IndRefForNewObject(*inhalt)
	if err != nil {
		return types.IndirectRef{}, nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	d := types.Dict{
		"Type":      types.Name("Page"),
		"MediaBox":  types.Array{types.Integer(0), types.Integer(0), masszahl(l.Breite), masszahl(l.Hoehe)},
		"Resources": types.Dict{},
		"Contents":  *inhaltRef,
	}
	ref, err := u.x.IndRefForNewObject(d)
	if err != nil {
		return types.IndirectRef{}, nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	return *ref, d, nil
}

// masszahl schreibt ein ganzzahliges Mass als Integer (wie jedes Programm
// eine MediaBox schreibt), sonst als Gleitkommazahl.
func masszahl(v float64) types.Object {
	if v == float64(int(v)) {
		return types.Integer(int(v))
	}
	return types.Float(v)
}

// verdoppeln legt eine zweite Instanz einer Seite an: eigenes
// Seitenobjekt, eigene Anmerkungsobjekte (mit /P auf die neue Seite,
// Popup und Antwortbezug umgehaengt). Inhalt, Ressourcen und
// Darstellungsstroeme werden geteilt — sie sind unveraenderlich.
//
// Widgets werden NICHT verdoppelt: Ein Widget gehoert zu genau einem
// Formularfeld, und ein zweites Feld gleichen Namens waere nach der Norm
// dasselbe Feld mit falscher Struktur. Der Bericht sagt das
// (duplicate_page_form_fields_not_copied).
func (u *umbau) verdoppeln(s blatt) (types.IndirectRef, types.Dict, error) {
	neu := s.dict.Clone().(types.Dict)
	// Der Strukturbaum kennt die neue Seite nicht; eine zweite Seite mit
	// derselben StructParents-Nummer wuerde ihn zerlegen.
	neu.Delete("StructParents")
	neu.Delete("Annots")
	ref, err := u.x.IndRefForNewObject(neu)
	if err != nil {
		return types.IndirectRef{}, nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}

	zuordnung := map[int]types.IndirectRef{}
	var neueAnm []types.Dict
	liste := types.Array{}
	for _, a := range anmerkungen(u.x, s.dict) {
		if a.art() == artWidget {
			u.widgetsNichtKopiert++
			continue
		}
		k := a.dict.Clone().(types.Dict)
		k.Delete("StructParent")
		k["P"] = *ref
		neueAnm = append(neueAnm, k)
		if a.ref == nil {
			liste = append(liste, k)
			continue
		}
		kr, err := u.x.IndRefForNewObject(k)
		if err != nil {
			return types.IndirectRef{}, nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		zuordnung[a.nr()] = *kr
		liste = append(liste, *kr)
	}
	for _, k := range neueAnm {
		for _, schluessel := range []string{"Popup", "Parent", "IRT"} {
			if nr, ok := objNr(k[schluessel]); ok {
				if z, ok := zuordnung[nr]; ok {
					k[schluessel] = z
				}
			}
		}
	}
	if len(liste) > 0 {
		neu["Annots"] = liste
	}
	return *ref, neu, nil
}

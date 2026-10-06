// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Eigenschaften (Etappe 8): Titel, Thema, Autor und Stichwoerter eines
// Dokuments als Feld properties im Commit. Der Server schreibt das
// Info-Woerterbuch und — falls ein XMP-Strom existiert — die passenden
// Felder dc:title, dc:description, dc:creator und pdf:Keywords darin.
// Fehlt der XMP-Strom, wird keiner angelegt.
//
// # Was pdfcpu dafuer anbietet (geprueft an v0.16.0)
//
//   - pdfcpu.PropertiesAdd/PropertiesRemove schreiben beliebige Schluessel
//     in das Info-Woerterbuch (UTF-16 mit BOM) — dieselbe Form, die hier
//     fuer Title, Subject, Author und Keywords genommen wird (utf16).
//   - pdfcpu.KeywordsAdd/KeywordsRemove pflegen Keywords im Info-Woerterbuch
//     und NEHMEN pdf:Keywords aus dem XMP heraus (model.RemoveKeywords);
//     geschrieben wird ins XMP nichts. Auch dc:title, dc:description und
//     dc:creator liest pdfcpu nur (model.XMPMeta beim Validieren).
//   - Producer, ModDate und CreationDate setzt pdfcpu bei jedem Schreiben
//     selbst (ensureInfoDict), wie bei jedem Commit.
//
// Der XMP-Teil steht deshalb minimal hier: Die vorhandenen Elemente werden
// im Text des Pakets ersetzt oder entfernt, fehlende in die rdf:Description
// eingefuegt, die den Namensraum deklariert (sonst in die erste, samt
// Deklaration). Alles andere im Paket bleibt, wie es war.

// HoechstEigenschaftZeichen ist die Hoechstlaenge je Wert (Vertrag).
const HoechstEigenschaftZeichen = 1000

// ErrEigenschaftUngueltig: ein Wert ist zu lang, kein UTF-8 oder traegt
// Steuerzeichen.
var ErrEigenschaftUngueltig = errors.New("dokument: Eigenschaft ungueltig")

// Eigenschaftsfehler nennt das Feld, das ErrEigenschaftUngueltig meint.
type Eigenschaftsfehler struct {
	Feld   string
	Detail string
}

func (f *Eigenschaftsfehler) Error() string {
	return "dokument: Eigenschaft " + f.Feld + " ungueltig: " + f.Detail
}
func (f *Eigenschaftsfehler) Unwrap() error { return ErrEigenschaftUngueltig }

// Eigenschaften ist das Feld properties eines Commits: ein fehlendes
// Feld bleibt, wie es ist; ein leerer String entfernt den Eintrag.
type Eigenschaften struct {
	Title    *string `json:"title,omitempty"`
	Subject  *string `json:"subject,omitempty"`
	Author   *string `json:"author,omitempty"`
	Keywords *string `json:"keywords,omitempty"`
}

// Leer sagt, ob kein Feld gesetzt ist.
func (e *Eigenschaften) Leer() bool {
	return e == nil || (e.Title == nil && e.Subject == nil && e.Author == nil && e.Keywords == nil)
}

// felder liefert die gesetzten Felder in fester Reihenfolge.
func (e *Eigenschaften) felder() []eigenschaftsfeld {
	var aus []eigenschaftsfeld
	for _, f := range []struct {
		name string
		wert *string
	}{{"title", e.Title}, {"subject", e.Subject}, {"author", e.Author}, {"keywords", e.Keywords}} {
		if f.wert != nil {
			aus = append(aus, eigenschaftsfeld{name: f.name, wert: strings.TrimSpace(*f.wert)})
		}
	}
	return aus
}

type eigenschaftsfeld struct {
	name string
	wert string
}

// infoSchluessel ist der Schluessel im Info-Woerterbuch je Feld.
var infoSchluessel = map[string]string{"title": "Title", "subject": "Subject", "author": "Author", "keywords": "Keywords"}

// Pruefen weist Werte ab, die ohne Dokument schon falsch sind: laenger als
// HoechstEigenschaftZeichen, kein UTF-8, Steuerzeichen (ausser dem
// Leerzeichen, das keines ist).
func (e *Eigenschaften) Pruefen() error {
	if e == nil {
		return nil
	}
	for _, f := range e.felder() {
		if !utf8.ValidString(f.wert) {
			return &Eigenschaftsfehler{Feld: f.name, Detail: "kein gueltiges UTF-8"}
		}
		if utf8.RuneCountInString(f.wert) > HoechstEigenschaftZeichen {
			return &Eigenschaftsfehler{Feld: f.name, Detail: fmt.Sprintf("laenger als %d Zeichen", HoechstEigenschaftZeichen)}
		}
		for _, r := range f.wert {
			if unicode.IsControl(r) {
				return &Eigenschaftsfehler{Feld: f.name, Detail: "Steuerzeichen"}
			}
		}
	}
	return nil
}

// EigenschaftenAnwenden schreibt die Felder in das Info-Woerterbuch des
// geoeffneten Dokuments und, falls vorhanden, in den XMP-Strom des
// Katalogs. Geschrieben wird hier nichts; das tut der Aufrufer.
func EigenschaftenAnwenden(ctx *model.Context, e Eigenschaften) error {
	if err := e.Pruefen(); err != nil {
		return err
	}
	felder := e.felder()
	if len(felder) == 0 {
		return nil
	}
	if ctx.Info == nil {
		ir, err := ctx.IndRefForNewObject(types.NewDict())
		if err != nil {
			return fmt.Errorf("%w: Info-Woerterbuch anlegen: %v", ErrNichtUnterstuetzt, err)
		}
		ctx.Info = ir
	}
	info, err := ctx.DereferenceDict(*ctx.Info)
	if err != nil || info == nil {
		return fmt.Errorf("%w: Info-Woerterbuch nicht lesbar", ErrNichtUnterstuetzt)
	}
	for _, f := range felder {
		if f.wert == "" {
			delete(info, infoSchluessel[f.name])
		} else {
			info[infoSchluessel[f.name]] = utf16(f.wert)
		}
	}
	return xmpAnwenden(ctx, felder)
}

// eigenschaftenLesen liest die vier Felder aus dem Info-Woerterbuch —
// fuer die Nachpruefung des geschriebenen Ergebnisses.
func eigenschaftenLesen(ctx *model.Context) map[string]string {
	aus := map[string]string{}
	if ctx.Info == nil {
		return aus
	}
	info, err := ctx.DereferenceDict(*ctx.Info)
	if err != nil || info == nil {
		return aus
	}
	for name, schluessel := range infoSchluessel {
		if s, ok := alsText(ctx.XRefTable, info[schluessel]); ok {
			aus[name] = s
		}
	}
	return aus
}

// eigenschaftenPruefen vergleicht das wieder geoeffnete Ergebnis mit den
// Befehlen: Jeder gesetzte Wert muss im Info-Woerterbuch stehen, jeder
// geleerte fehlen.
func eigenschaftenPruefen(nachCtx *model.Context, e Eigenschaften) error {
	ist := eigenschaftenLesen(nachCtx)
	for _, f := range e.felder() {
		if ist[f.name] != f.wert {
			return fmt.Errorf("%w: Eigenschaft %s steht als %q im Ergebnis, erwartet %q", ErrPruefung, f.name, ist[f.name], f.wert)
		}
	}
	return nil
}

// ============================================================
// XMP
// ============================================================

const (
	nsDC  = "http://purl.org/dc/elements/1.1/"
	nsPDF = "http://ns.adobe.com/pdf/1.3/"
)

// xmpElement beschreibt, wie ein Feld im XMP steht.
type xmpElement struct {
	ns, vorgabePrefix, name string
	// form: alt (rdf:Alt mit x-default), seq (rdf:Seq) oder text.
	form string
}

var xmpElemente = map[string]xmpElement{
	"title":    {nsDC, "dc", "title", "alt"},
	"subject":  {nsDC, "dc", "description", "alt"},
	"author":   {nsDC, "dc", "creator", "seq"},
	"keywords": {nsPDF, "pdf", "Keywords", "text"},
}

var (
	xmpDescriptionStart = regexp.MustCompile(`<rdf:Description\b[^>]*>`)
	xmpDescriptionEnde  = regexp.MustCompile(`</rdf:Description\s*>`)
	xmpRDFEnde          = regexp.MustCompile(`</rdf:RDF\s*>`)
)

// xmpAnwenden aendert den XMP-Strom des Katalogs, falls es einen gibt.
func xmpAnwenden(ctx *model.Context, felder []eigenschaftsfeld) error {
	katalog, err := ctx.Catalog()
	if err != nil || katalog == nil {
		return nil
	}
	roh, da := katalog.Find("Metadata")
	if !da {
		return nil
	}
	sd, _, err := ctx.DereferenceStreamDict(roh)
	if err != nil || sd == nil {
		return nil
	}
	if err := sd.Decode(); err != nil {
		// Ein Strom, den wir nicht lesen koennen, bleibt unangetastet.
		return nil
	}
	neu, geaendert := xmpText(string(sd.Content), felder)
	if !geaendert {
		return nil
	}
	sd.Content = []byte(neu)
	// XMP steht ungefiltert; ein fremder Filter bleibt, Encode rechnet ihn neu.
	if err := sd.Encode(); err != nil {
		return fmt.Errorf("%w: XMP schreiben: %v", ErrNichtUnterstuetzt, err)
	}
	if ir, ok := roh.(types.IndirectRef); ok {
		eintrag, gefunden := ctx.FindTableEntryForIndRef(&ir)
		if !gefunden || eintrag == nil {
			return fmt.Errorf("%w: XMP-Objekt fehlt in der Tabelle", ErrNichtUnterstuetzt)
		}
		eintrag.Object = *sd
	} else {
		katalog["Metadata"] = *sd
	}
	return nil
}

// xmpText setzt die Felder im Text eines XMP-Pakets. Ohne rdf:Description
// und ohne rdf:RDF bleibt der Text, wie er ist.
func xmpText(xmp string, felder []eigenschaftsfeld) (string, bool) {
	geaendert := false
	for _, f := range felder {
		el := xmpElemente[f.name]
		prefix := xmpPrefix(xmp, el.ns, el.vorgabePrefix)
		// Vorhandene Elemente (und die Attributform) entfernen.
		vorher := xmp
		xmp = regexp.MustCompile(`(?s)\s*<`+regexp.QuoteMeta(prefix+":"+el.name)+`\b[^>]*?/>`).ReplaceAllString(xmp, "")
		xmp = regexp.MustCompile(`(?s)\s*<`+regexp.QuoteMeta(prefix+":"+el.name)+`\b[^>]*>.*?</`+regexp.QuoteMeta(prefix+":"+el.name)+`\s*>`).ReplaceAllString(xmp, "")
		xmp = regexp.MustCompile(`\s+`+regexp.QuoteMeta(prefix+":"+el.name)+`="[^"]*"`).ReplaceAllString(xmp, "")
		if xmp != vorher {
			geaendert = true
		}
		if f.wert == "" {
			continue
		}
		element := xmpElementText(prefix, el, f.wert)
		neu, ok := xmpEinfuegen(xmp, prefix, el.ns, element)
		if ok {
			xmp = neu
			geaendert = true
		}
	}
	return xmp, geaendert
}

// xmpPrefix findet den Prefix, unter dem ein Namensraum im Paket
// deklariert ist; sonst die Vorgabe.
func xmpPrefix(xmp, ns, vorgabe string) string {
	m := regexp.MustCompile(`xmlns:([A-Za-z0-9_.-]+)="` + regexp.QuoteMeta(ns) + `"`).FindStringSubmatch(xmp)
	if m != nil {
		return m[1]
	}
	return vorgabe
}

func xmpElementText(prefix string, el xmpElement, wert string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(wert))
	w := b.String()
	n := prefix + ":" + el.name
	switch el.form {
	case "alt":
		return "<" + n + `><rdf:Alt><rdf:li xml:lang="x-default">` + w + "</rdf:li></rdf:Alt></" + n + ">"
	case "seq":
		return "<" + n + "><rdf:Seq><rdf:li>" + w + "</rdf:li></rdf:Seq></" + n + ">"
	default:
		return "<" + n + ">" + w + "</" + n + ">"
	}
}

// xmpEinfuegen setzt ein Element in die rdf:Description, die den
// Namensraum deklariert — sonst in die erste, samt Deklaration. Gibt es
// keine, entsteht eine vor </rdf:RDF>.
func xmpEinfuegen(xmp, prefix, ns, element string) (string, bool) {
	deklaration := `xmlns:` + prefix + `="` + ns + `"`
	starts := xmpDescriptionStart.FindAllStringIndex(xmp, -1)
	for _, s := range starts {
		if strings.Contains(xmp[s[0]:s[1]], deklaration) {
			return inDescription(xmp, s, "", element)
		}
	}
	// Der Namensraum steht nirgends (oder nur ausserhalb einer Description):
	// in die erste Description, mit Deklaration am Start-Tag.
	if len(starts) > 0 {
		zusatz := " " + deklaration
		if strings.Contains(xmp, deklaration) {
			zusatz = ""
		}
		return inDescription(xmp, starts[0], zusatz, element)
	}
	if rdf := xmpRDFEnde.FindStringIndex(xmp); rdf != nil {
		neu := `<rdf:Description rdf:about="" ` + deklaration + ">" + element + "</rdf:Description>"
		return xmp[:rdf[0]] + neu + xmp[rdf[0]:], true
	}
	return xmp, false
}

// inDescription setzt element ans Ende der rdf:Description, deren
// Start-Tag bei s steht; zusatz kommt ans Start-Tag. Eine selbstschliessende
// Description (<rdf:Description …/>) wird dafuer geoeffnet.
func inDescription(xmp string, s []int, zusatz, element string) (string, bool) {
	start := xmp[s[0]:s[1]]
	if strings.HasSuffix(start, "/>") {
		offen := strings.TrimSpace(strings.TrimSuffix(start, "/>")) + zusatz + ">"
		return xmp[:s[0]] + offen + element + "</rdf:Description>" + xmp[s[1]:], true
	}
	ende := xmpDescriptionEnde.FindStringIndex(xmp[s[1]:])
	if ende == nil {
		return xmp, false
	}
	start = strings.TrimSuffix(start, ">") + zusatz + ">"
	pos := s[1] + ende[0]
	return xmp[:s[0]] + start + xmp[s[1]:pos] + element + xmp[pos:], true
}

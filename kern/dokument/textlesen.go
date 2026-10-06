// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/ledongthuc/pdf"
	"github.com/pdfcpu/pdfcpu/pkg/font"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Textebene lesen (OpenIntraPDF Etappe 4): Woerter mit Lage aus der
// Textebene eines PDFs — ohne den Texterkennungsdienst.
//
// Der Dienst (Poppler) liefert dasselbe besser; er ist aber ein eigener
// Container im Profil ki, und ein Server ohne ihn soll Textseiten trotzdem
// exportieren koennen. Gelesen wird mit github.com/ledongthuc/pdf, das der
// Wiki-Arbeiter schon fuer die Textebene benutzt: Es liefert je Glyphe
// Schrift, Groesse, Lage und Vorschub im Benutzerraum der Seite. Daraus
// werden hier Woerter (Glyphen ohne Luecke), Zeilen (gleiche Grundlinie)
// und Bloecke (Zeilen ohne grossen Abstand, gleiche Groesse), und die
// Kaesten kommen ueber dieselbe Anzeigematrix wie die Textebene der
// Etappe 3 in den ANGEZEIGTEN Raum (Ursprung oben links, /Rotate
// angewandt).
//
// Grenzen: Text, der im Benutzerraum gedreht steht (etwa auf Seiten mit
// /Rotate), bekommt von der Bibliothek keinen Vorschub; seine Breite wird
// geschaetzt. Vertikale Schrift wird nicht erkannt.
//
// Schutz vor praeparierten Dateien (#243): Die Bibliothek wertet einen
// Inhaltsstrom in Content() ohne jede Grenze aus — ein 21-KB-PDF mit
// 20 MiB entpacktem Text aus Tj-Befehlen kostete 74 Sekunden und 7 GB.
// Darum laeuft die Auswertung hier ueber Interpret mit eigenem Lauf
// (textlauf): Der Strom wird vorher begrenzt entpackt (HoechstStromBytes),
// die Glyphen je Seite und je Dokument sind gedeckelt, jede Auswertung hat
// eine Zeitgrenze, und hoechstens textleseParallel laufen zugleich.

// Textzeile ist eine Zeile aus Woertern im angezeigten Raum.
type Textzeile struct{ Woerter []Wort }

// Seitentext sind die Woerter einer Seite aus der Textebene.
type Seitentext struct {
	// Nr ab 0.
	Nr int
	// Breite und Hoehe der angezeigten Seite in Punkten.
	Breite, Hoehe float64
	// Bild: Die Seite hat mindestens ein Bild-XObject.
	Bild bool
	// Unlesbar: Der Inhaltsstrom brachte die Bibliothek zum Absturz; die
	// Seite gilt als ohne Textebene.
	Unlesbar bool
	// Bloecke -> Zeilen -> Woerter, von oben nach unten.
	Bloecke [][]Textzeile
}

// Woerter zaehlt die Woerter der Seite.
func (s Seitentext) Woerter() int {
	n := 0
	for _, b := range s.Bloecke {
		for _, z := range b {
			n += len(z.Woerter)
		}
	}
	return n
}

const (
	// glyphenLuecke: Luecke zwischen zwei Glyphen in Schriftgroessen, ab
	// der ein neues Wort beginnt (Poppler nimmt 0,1; Kerning liegt
	// darunter, ein Wortabstand bei 0,25–0,35).
	glyphenLuecke = 0.15
	// grundlinienToleranz: Glyphen mit Grundlinien so nah beieinander (in
	// Schriftgroessen) stehen in einer Zeile.
	grundlinienToleranz = 0.25
	// blockabstand: Zeilen weiter auseinander (in Zeilenhoehen) beginnen
	// einen neuen Block; blockGroesse: eine andere Schriftgroesse auch.
	blockabstand = 1.5
	blockGroesse = 0.2
	// oberlaenge/unterlaenge des Wortkastens in Schriftgroessen.
	oberlaenge  = 0.8
	unterlaenge = 0.2
)

// Grenzen des Textlesens (#243).
const (
	// HoechstStromBytes: so gross darf der entpackte Inhaltsstrom einer
	// Seite (auch ein ToUnicode einer Schrift) sein; darueber gilt die
	// Seite als unlesbar. Textseiten haben Kilobyte, Zeichnungen wenige
	// Megabyte. Der Interpreter der Bibliothek legt Operanden bis zum
	// naechsten Befehl auf einen Stapel (~48 Byte je Zahl); 8 MiB halten
	// auch einen Strom aus lauter Zahlen unter einigen hundert MB.
	HoechstStromBytes = 8 << 20
	// HoechstGlyphenSeite: Glyphen je Seite; eine dichte A4-Seite hat
	// 5.000. Darueber gilt die Seite als unlesbar.
	HoechstGlyphenSeite = 200_000
	// HoechstGlyphenDokument: Glyphen je Aufruf; darueber ErrTextebeneZuGross.
	HoechstGlyphenDokument = 2_000_000
	// TextleseZeitgrenze gilt je Aufruf von HatTextebene/TextebeneLesen.
	TextleseZeitgrenze = 60 * time.Second
	// textleseParallel: so viele Auswertungen laufen zugleich; weitere warten.
	textleseParallel = 2
)

// ErrTextebeneZuGross: mehr als HoechstGlyphenDokument Glyphen.
var ErrTextebeneZuGross = fmt.Errorf("%w: Textebene mit mehr als %d Glyphen", ErrZuGross, HoechstGlyphenDokument)

// errSeiteUnlesbar: Der Inhaltsstrom der Seite ist nicht auswertbar
// (Absturz der Bibliothek, unbekannter Filter) oder ueberschreitet eine
// Grenze je Seite — die Seite gilt als ohne Textebene.
var errSeiteUnlesbar = errors.New("dokument: Seite nicht lesbar")

var textleseSemaphor = make(chan struct{}, textleseParallel)

// HatTextebene sagt, ob mindestens eine der Seiten (ab 0; leer = alle)
// Woerter in der Textebene hat — und hoert bei der ersten auf.
func HatTextebene(c context.Context, roh []byte, seiten []int) (bool, error) {
	gefunden := false
	_, err := textebeneLesen(c, roh, seiten, func(s Seitentext) bool {
		gefunden = s.Woerter() > 0
		return !gefunden
	})
	return gefunden, err
}

// TextebeneLesen liest die Woerter der Seiten (ab 0; leer = alle) aus der
// Textebene. Eine Seite ohne Text kommt mit leeren Bloecken zurueck.
func TextebeneLesen(c context.Context, roh []byte, seiten []int) ([]Seitentext, error) {
	return textebeneLesen(c, roh, seiten, func(Seitentext) bool { return true })
}

// textebeneLesen liest Seite fuer Seite; weiter sagt nach jeder, ob es
// weitergeht. Hoechstens textleseParallel Aufrufe laufen zugleich (das
// Warten endet mit dem Kontext), jeder hoechstens TextleseZeitgrenze.
func textebeneLesen(c context.Context, roh []byte, seiten []int, weiter func(Seitentext) bool) (aus []Seitentext, err error) {
	select {
	case textleseSemaphor <- struct{}{}:
		defer func() { <-textleseSemaphor }()
	case <-c.Done():
		return nil, c.Err()
	}
	c, abbrechen := context.WithTimeout(c, TextleseZeitgrenze)
	defer abbrechen()
	ctx, err := lesen(c, bytes.NewReader(roh), model.LISTINFO)
	if err != nil {
		return nil, err
	}
	blatt, err := blaetter(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	if seiten == nil {
		seiten = make([]int, len(blatt))
		for i := range seiten {
			seiten[i] = i
		}
	}
	lesbar := roh
	if ctx.Encrypt != nil {
		if lesbar, err = imSpeicherEntschluesseln(c, roh); err != nil {
			return nil, err
		}
	}
	leser, err := textleser(lesbar)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnlesbar, err)
	}
	gesamt := 0
	for _, n := range seiten {
		if err := c.Err(); err != nil {
			return nil, err
		}
		if n < 0 || n >= len(blatt) {
			return nil, ErrPlanUngueltig
		}
		s := blatt[n]
		box := angezeigteBox(ctx.XRefTable, s)
		drehung := wirksameDrehung(ctx.XRefTable, s)
		matrix := anzeigematrix(box, drehung)
		st := Seitentext{Nr: n, Breite: box[2] - box[0], Hoehe: box[3] - box[1], Bild: hatBild(ctx.XRefTable, s), Bloecke: [][]Textzeile{}}
		if drehung == 90 || drehung == 270 {
			st.Breite, st.Hoehe = st.Hoehe, st.Breite
		}
		glyphen, err := glyphenLesen(c, leser, n+1)
		switch {
		case errors.Is(err, errSeiteUnlesbar):
			st.Unlesbar = true
		case err != nil:
			return nil, err
		default:
			if gesamt += len(glyphen); gesamt > HoechstGlyphenDokument {
				return nil, ErrTextebeneZuGross
			}
			st.Bloecke = bloeckeBilden(glyphen, matrix)
		}
		aus = append(aus, st)
		if !weiter(st) {
			break
		}
	}
	return aus, nil
}

// imSpeicherEntschluesseln liefert eine geschuetzte Datei ohne Schutz --
// nur als Puffer fuer den Textleser, nie auf der Platte (#253).
//
// Die Bibliothek kennt nur V1/V2 mit RC4 und las selbst die nicht richtig
// (RC4-40 ergab keine Woerter); V4 (RC4-128, AES-128) und AES-256 lehnte
// sie ab. Ohne Texterkennungsdienst endete die Analyse geschuetzter
// Dateien deshalb auch mit richtigem Rechte-Kennwort bei pdf.unreadable.
// pdfcpu entschluesselt alle diese Arten.
//
// Entschluesselt wird nur, was sich ohne Oeffnen-Kennwort oeffnen laesst
// (Besitzerschutz) -- eine Datei mit Oeffnen-Kennwort scheitert vorher mit
// ErrPasswort. Ob der Text heraus darf, entscheidet NICHT diese Stelle:
// Wer Text weitergibt (Analyse, Export), prueft vorher das Kopier-Bit oder
// das Rechte-Kennwort (RechtPruefen). Die Probe auf eine Textebene
// (HatTextebene, Seitenarten) gibt keinen Text heraus.
//
// Der Puffer traegt den Kopf %PDF-1.7: Die Bibliothek nimmt nur 1.0 bis
// 1.7 an, und AES-256 schreibt der Adapter als PDF 2.0 (alsPDF20) -- jede
// in OIH geschuetzte Datei waere sonst auch entschluesselt unlesbar.
func imSpeicherEntschluesseln(c context.Context, roh []byte) ([]byte, error) {
	ctx, err := lesenMit(c, bytes.NewReader(roh), konfiguration(model.DECRYPT))
	if err != nil {
		return nil, err
	}
	v := model.V17
	ctx.HeaderVersion, ctx.RootVersion = &v, &v
	return schreiben(c, ctx)
}

// textleser oeffnet die Datei mit der Bibliothek; Abstuerze werden Fehler.
func textleser(roh []byte) (r *pdf.Reader, err error) {
	defer func() {
		if p := recover(); p != nil {
			r, err = nil, fmt.Errorf("pdf: %v", p)
		}
	}()
	return pdf.NewReader(bytes.NewReader(roh), int64(len(roh)))
}

// glyphe ist eine Glyphe im Benutzerraum.
type glyphe struct {
	x, y, breite, groesse float64
	text                  string
	// gemeldet ist das x, das die Bibliothek nannte — ohne eigenen
	// Vorschub bei Schriften ohne Breiten.
	gemeldet float64
}

// glyphenLesen holt die Glyphen einer Seite (ab 1): errSeiteUnlesbar, wenn
// der Inhaltsstrom die Bibliothek zum Absturz bringt oder eine Grenze je
// Seite reisst; ein Kontextfehler, wenn die Zeit um ist.
//
// Die Auswertung ist der Textteil von Content() der Bibliothek, nur mit
// Grenzen: Der Strom wird vorher begrenzt entpackt (stromBegrenzt), die
// Glyphen je Seite sind gedeckelt, und zwischen den Befehlen zaehlt der
// Kontext. Schriften ohne /Widths (die 14 Standardschriften, wie sie der
// Korpus und die Textebene der Etappe 3 benutzen) kennt die Bibliothek
// nicht: Sie meldet Breite 0 und rueckt nicht vor, alle Glyphen eines
// Laufs liegen auf demselben x. Dann kommen die Breiten aus den Metriken
// von pdfcpu (standardbreite) und der Vorschub von hier.
func glyphenLesen(c context.Context, r *pdf.Reader, nr int) (aus []glyphe, err error) {
	defer func() {
		if p := recover(); p != nil {
			if e, ok := p.(error); ok && (errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded)) {
				aus, err = nil, e
				return
			}
			aus, err = nil, errSeiteUnlesbar
		}
	}()
	if nr > r.NumPage() {
		return nil, nil
	}
	p := r.Page(nr)
	if p.V.IsNull() {
		return nil, nil
	}
	strom := p.V.Key("Contents")
	if strom.Kind() == pdf.Null {
		return nil, nil
	}
	if !stromBegrenzt(strom) {
		return nil, errSeiteUnlesbar
	}
	l := &textlauf{c: c, seite: p, schriften: map[string]*pdf.Font{}, zustand: zustand{th: 1, ctm: einheit}}
	pdf.Interpret(strom, l.befehl)
	return l.glyphen, nil
}

// stromBegrenzt entpackt einen Strom (oder eine Liste von Stroemen) ohne
// ihn zu behalten und sagt, ob er HoechstStromBytes einhaelt. Was kein
// Strom ist, hat nichts zu entpacken. Ein unbekannter Filter laesst die
// Bibliothek abstuerzen; das faengt der Aufrufer.
func stromBegrenzt(v pdf.Value) bool {
	var leser []io.Reader
	switch v.Kind() {
	case pdf.Stream:
		leser = []io.Reader{v.Reader()}
	case pdf.Array:
		for i := 0; i < v.Len(); i++ {
			if e := v.Index(i); e.Kind() == pdf.Stream {
				leser = append(leser, e.Reader())
			}
		}
	default:
		return true
	}
	rest := int64(HoechstStromBytes) + 1
	for _, r := range leser {
		n, _ := io.CopyN(io.Discard, r, rest)
		if rest -= n; rest <= 0 {
			return false
		}
	}
	return true
}

// matrix3 ist eine Matrix des Benutzerraums (wie in der Bibliothek).
type matrix3 [3][3]float64

var einheit = matrix3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}

func (x matrix3) mal(y matrix3) matrix3 {
	var z matrix3
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			for k := 0; k < 3; k++ {
				z[i][j] += x[i][k] * y[k][j]
			}
		}
	}
	return z
}

// zustand ist der Grafik- und Textzustand (ISO 32000-1, 8.4 und 9.3), den
// q/Q sichern und zuruecksetzen.
type zustand struct {
	schrift      *pdf.Font
	enc          pdf.TextEncoding
	tfs, tc, th  float64
	tl, trise    float64
	tm, tlm, ctm matrix3
}

// rohEncoder laesst die Bytes, wie sie sind — falls eine Schrift keine
// Kodierung liefert.
type rohEncoder struct{}

func (rohEncoder) Decode(raw string) string { return raw }

// textlauf ist die Auswertung eines Inhaltsstroms: Nur die Befehle, die
// Text setzen oder seine Lage bestimmen, werden gedeutet; alles andere
// (Pfade, Farben, Bilder) wird uebergangen.
type textlauf struct {
	c         context.Context
	seite     pdf.Page
	schriften map[string]*pdf.Font
	zustand
	stapel  []zustand
	glyphen []glyphe
	befehle int
}

// befehl ist der Rueckruf von Interpret je Befehl. Abbrueche (Zeit,
// Grenzen) gehen als panic hinaus, wie die Bibliothek selbst es haelt;
// glyphenLesen faengt sie.
func (l *textlauf) befehl(stk *pdf.Stack, op string) {
	args := make([]pdf.Value, stk.Len())
	for i := len(args) - 1; i >= 0; i-- {
		args[i] = stk.Pop()
	}
	if l.befehle++; l.befehle&255 == 0 {
		if err := l.c.Err(); err != nil {
			panic(err)
		}
	}
	zahl := func(i int) float64 { return args[i].Float64() }
	matrixAus := func() (m matrix3) {
		for i := 0; i < 6; i++ {
			m[i/2][i%2] = zahl(i)
		}
		m[2][2] = 1
		return m
	}
	switch op {
	case "cm":
		if len(args) == 6 {
			l.ctm = matrixAus().mal(l.ctm)
		}
	case "q":
		l.stapel = append(l.stapel, l.zustand)
	case "Q":
		if n := len(l.stapel); n > 0 {
			l.zustand = l.stapel[n-1]
			l.stapel = l.stapel[:n-1]
		}
	case "BT":
		l.tm, l.tlm = einheit, einheit
	case "T*":
		l.zeilenvorschub()
	case "Tc":
		if len(args) == 1 {
			l.tc = zahl(0)
		}
	case "TD", "Td":
		if len(args) == 2 {
			if op == "TD" {
				l.tl = -zahl(1)
			}
			l.tlm = matrix3{{1, 0, 0}, {0, 1, 0}, {zahl(0), zahl(1), 1}}.mal(l.tlm)
			l.tm = l.tlm
		}
	case "Tf":
		if len(args) == 2 {
			l.schriftWaehlen(args[0].Name())
			l.tfs = zahl(1)
		}
	case "\"":
		if len(args) == 3 {
			l.tc = zahl(1)
			l.zeilenvorschub()
			l.zeigen(args[2].RawString())
		}
	case "'":
		if len(args) == 1 {
			l.zeilenvorschub()
			l.zeigen(args[0].RawString())
		}
	case "Tj":
		if len(args) == 1 {
			l.zeigen(args[0].RawString())
		}
	case "TJ":
		if len(args) == 1 {
			v := args[0]
			for i := 0; i < v.Len(); i++ {
				if x := v.Index(i); x.Kind() == pdf.String {
					l.zeigen(x.RawString())
				} else {
					tx := -x.Float64() / 1000 * l.tfs * l.th
					l.tm = matrix3{{1, 0, 0}, {0, 1, 0}, {tx, 0, 1}}.mal(l.tm)
				}
			}
			// Wie die Bibliothek: ein Zeilenende als Wortgrenze nach jedem TJ.
			l.zeigen("\n")
		}
	case "TL":
		if len(args) == 1 {
			l.tl = zahl(0)
		}
	case "Tm":
		if len(args) == 6 {
			l.tm = matrixAus()
			l.tlm = l.tm
		}
	case "Ts":
		if len(args) == 1 {
			l.trise = zahl(0)
		}
	case "Tz":
		if len(args) == 1 {
			l.th = zahl(0) / 100
		}
	}
}

func (l *textlauf) zeilenvorschub() {
	l.tlm = matrix3{{1, 0, 0}, {0, 1, 0}, {0, -l.tl, 1}}.mal(l.tlm)
	l.tm = l.tlm
}

// schriftWaehlen holt die Schrift aus den Ressourcen der Seite — je Name
// einmal, mit ihrer Kodierung; ein ToUnicode jenseits der Stromgrenze
// macht die Seite unlesbar.
func (l *textlauf) schriftWaehlen(name string) {
	f := l.schriften[name]
	if f == nil {
		schrift := l.seite.Font(name)
		if !stromBegrenzt(schrift.V.Key("ToUnicode")) {
			panic(errSeiteUnlesbar)
		}
		f = &schrift
		l.schriften[name] = f
	}
	l.schrift = f
	l.enc = f.Encoder()
	if l.enc == nil {
		l.enc = rohEncoder{}
	}
}

// zeigen setzt die Glyphen einer Zeichenkette (Tj) in den Benutzerraum —
// wie showText in Content() der Bibliothek — und rueckt den Textpunkt vor.
// Die Grenze je Seite gilt vor dem Dekodieren: hoechstens eine Glyphe je
// Byte, also reicht die Laenge als Mass.
func (l *textlauf) zeigen(s string) {
	if len(l.glyphen)+len(s) > HoechstGlyphenSeite {
		panic(errSeiteUnlesbar)
	}
	enc := l.enc
	if enc == nil {
		enc = rohEncoder{}
	}
	schriftname := ""
	if l.schrift != nil {
		schriftname = l.schrift.BaseFont()
		if i := strings.Index(schriftname, "+"); i >= 0 {
			schriftname = schriftname[i+1:]
		}
	}
	n := 0
	for _, ch := range enc.Decode(s) {
		var w0 float64
		if n < len(s) && l.schrift != nil {
			w0 = l.schrift.Width(int(s[n]))
		}
		n++
		trm := matrix3{{l.tfs * l.th, 0, 0}, {0, l.tfs, 0}, {0, l.trise, 1}}.mal(l.tm).mal(l.ctm)
		groesse, x, y := trm[0][0], trm[2][0], trm[2][1]
		tx := w0/1000*l.tfs + l.tc
		tx *= l.th
		l.tm = matrix3{{1, 0, 0}, {0, 1, 0}, {tx, 0, 1}}.mal(l.tm)
		if groesse <= 0 || math.IsNaN(x) || math.IsNaN(y) {
			continue
		}
		g := glyphe{x: x, gemeldet: x, y: y, breite: w0 / 1000 * groesse, groesse: groesse, text: string(ch)}
		if g.breite <= 0 {
			g.breite = standardbreite(schriftname, g.text, groesse)
			if k := len(l.glyphen); k > 0 && l.glyphen[k-1].gemeldet == x && l.glyphen[k-1].y == y {
				g.x = l.glyphen[k-1].x + l.glyphen[k-1].breite
			}
		}
		l.glyphen = append(l.glyphen, g)
	}
}

// standardbreite ist die Breite eines Textes in einer der 14
// Standardschriften; fuer andere eine Schaetzung von einer halben
// Schriftgroesse je Zeichen.
func standardbreite(schrift, text string, groesse float64) float64 {
	if b, err := font.TextWidthFloat(context.Background(), text, schrift, groesse); err == nil && b > 0 {
		return b
	}
	return 0.5 * groesse * float64(len([]rune(text)))
}

// wortBau ist ein Wort im Benutzerraum waehrend des Baus.
type wortBau struct {
	x0, x1, y, groesse float64
	text               strings.Builder
}

// bloeckeBilden macht aus Glyphen Woerter, Zeilen und Bloecke und bringt
// die Kaesten in den angezeigten Raum.
func bloeckeBilden(glyphen []glyphe, matrix [6]float64) [][]Textzeile {
	// Nach Grundlinie (oben zuerst: im Benutzerraum grosses y) und x.
	slices.SortStableFunc(glyphen, func(a, b glyphe) int {
		if math.Abs(a.y-b.y) > grundlinienToleranz*math.Max(a.groesse, b.groesse) {
			if a.y > b.y {
				return -1
			}
			return 1
		}
		switch {
		case a.x < b.x:
			return -1
		case a.x > b.x:
			return 1
		}
		return 0
	})
	// Zeilen aus Glyphen, Woerter aus Luecken und Leerzeichen.
	type zeileBau struct {
		y, groesse float64
		woerter    []*wortBau
	}
	var zeilen []*zeileBau
	var lauf *wortBau
	for _, g := range glyphen {
		var z *zeileBau
		if n := len(zeilen); n > 0 && math.Abs(zeilen[n-1].y-g.y) <= grundlinienToleranz*math.Max(zeilen[n-1].groesse, g.groesse) {
			z = zeilen[n-1]
		} else {
			z = &zeileBau{y: g.y, groesse: g.groesse}
			zeilen = append(zeilen, z)
			lauf = nil
		}
		leer := strings.TrimFunc(g.text, unicode.IsSpace) == ""
		if leer {
			lauf = nil
			continue
		}
		if lauf != nil && g.x-lauf.x1 > glyphenLuecke*math.Max(lauf.groesse, g.groesse) {
			lauf = nil
		}
		if lauf == nil {
			lauf = &wortBau{x0: g.x, x1: g.x + g.breite, y: g.y, groesse: g.groesse}
			z.woerter = append(z.woerter, lauf)
		}
		lauf.text.WriteString(g.text)
		lauf.x1 = math.Max(lauf.x1, g.x+g.breite)
		lauf.groesse = math.Max(lauf.groesse, g.groesse)
	}
	// Bloecke: Zeilenabstand und Schriftgroesse.
	var bloecke [][]Textzeile
	var vorige *zeileBau
	for _, z := range zeilen {
		if len(z.woerter) == 0 {
			continue
		}
		var tz Textzeile
		for _, w := range z.woerter {
			text := strings.Map(func(r rune) rune {
				if unicode.IsControl(r) {
					return -1
				}
				return r
			}, w.text.String())
			if strings.TrimSpace(text) == "" {
				continue
			}
			tz.Woerter = append(tz.Woerter, kastenAnzeigen(matrix, w.x0, w.y-unterlaenge*w.groesse, w.x1, w.y+oberlaenge*w.groesse, text))
		}
		if len(tz.Woerter) == 0 {
			continue
		}
		neu := vorige == nil || vorige.y-z.y > blockabstand*math.Max(vorige.groesse, z.groesse) ||
			math.Abs(vorige.groesse-z.groesse) > blockGroesse*math.Max(vorige.groesse, z.groesse)
		if neu {
			bloecke = append(bloecke, nil)
		}
		bloecke[len(bloecke)-1] = append(bloecke[len(bloecke)-1], tz)
		vorige = z
	}
	return bloecke
}

// kastenAnzeigen bringt einen Kasten des Benutzerraums in den angezeigten
// Raum: alle vier Ecken abbilden, dann der umschliessende Kasten.
func kastenAnzeigen(m [6]float64, x0, y0, x1, y1 float64, text string) Wort {
	w := Wort{Text: text, X0: math.Inf(1), Y0: math.Inf(1), X1: math.Inf(-1), Y1: math.Inf(-1)}
	for _, e := range [][2]float64{{x0, y0}, {x1, y0}, {x0, y1}, {x1, y1}} {
		x, y := anwenden(m, e[0], e[1])
		w.X0, w.Y0 = math.Min(w.X0, x), math.Min(w.Y0, y)
		w.X1, w.Y1 = math.Max(w.X1, x), math.Max(w.Y1, y)
	}
	return w
}

// hatBild: Die Ressourcen der Seite (auch geerbte) fuehren ein XObject
// vom Untertyp Image.
func hatBild(x *model.XRefTable, s blatt) bool {
	res := alsDict(x, wirksam(s, "Resources"))
	if res == nil {
		return false
	}
	xobj := alsDict(x, res["XObject"])
	for _, o := range xobj {
		if sd, ok := aufloesen(x, o).(types.StreamDict); ok && alsName(x, sd.Dict["Subtype"]) == "Image" {
			return true
		}
	}
	return false
}

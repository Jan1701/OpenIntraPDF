// SPDX-License-Identifier: Apache-2.0

// Package erkennung ist der gemeinsame Teil der Texterkennung von
// OpenIntraPDF: Tesseract aufrufen, seine TSV-Ausgabe in Bloecke, Zeilen
// und Woerter mit Lage lesen, Seiten einordnen (Textebene vorhanden? quer
// liegend? unsicher?).
//
// Zwei Gastgeber teilen sich dieses Paket (Vertrag Etappe 6):
//
//   - der Texterkennungsdienst cmd/texterkennung neben oihd, der die Seiten
//     mit Poppler rastert;
//   - die Desktop-App, die die Seiten mit pdf.js rastert und Tesseract aus
//     ihrem eigenen Paket mitbringt.
//
// Das Rastern gehoert NICHT hierher: Was aus einem PDF ein Bild macht,
// entscheidet der Gastgeber (Poppler im Dienst, pdf.js in der App). Hier
// beginnt es beim Bild und endet bei Woertern im ANGEZEIGTEN Seitenraum:
// Punkte (1/72 Zoll), Ursprung oben links, die Drehung der Seite schon
// angewandt — so, wie die Seite auf dem Bildschirm steht und wie
// dokument.TextebeneBauen die Woerter erwartet.
//
// Wie die anderen Pakete unter openintrapdf importiert es nichts aus
// openintrahub.org/oih/core oder .../module -- und nur die
// Standardbibliothek: Der Texterkennungsdienst baut es in ein schlankes
// Abbild (docker/texterkennung.Dockerfile kopiert nur go.mod, dieses Paket
// und cmd/texterkennung). Am 30.09.2026 zog Auswerten ueber dokument.Wort
// pdfcpu mit hinein, und der Bau des Dienstes scheiterte; Auswerten lebt
// deshalb beim Gastgeber (clients/openintrapdf-desktop/woerter.go).
package erkennung

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	// MindestzeichenJeSeite: ab so vielen sichtbaren Zeichen gilt die
	// Textebene EINER Seite als vorhanden. Eine Seitenzahl oder ein Stempel
	// auf einem Scan reicht nicht — dann wird erkannt.
	MindestzeichenJeSeite = 20
	// UnsichereKonfidenz: Woerter darunter zaehlen als unsicher; eine Seite
	// gilt als unsicher, wenn mehr als ein Viertel ihrer Woerter unsicher
	// sind (Unsicher).
	UnsichereKonfidenz = 50
	// VorgabeDPI ist die Aufloesung, mit der Dienst und App eine Seite fuer
	// Tesseract rastern (TEXTERKENNUNG_DPI im Dienst).
	VorgabeDPI = 300
	// VorgabeSprachen sind die Sprachpakete, die Dienst und App mitbringen.
	VorgabeSprachen = "deu+eng"
	// Seitenzerlegung fuer Tesseract: --psm 3, vollautomatisch ohne
	// Ausrichtungserkennung.
	seitenzerlegung = "3"
)

// Wort ist ein erkanntes Wort mit Lage im angezeigten Seitenraum. Die
// JSON-Namen sind die Schnittstelle des Dienstes (POST /woerter).
type Wort struct {
	X0   float64 `json:"x0"`
	Y0   float64 `json:"y0"`
	X1   float64 `json:"x1"`
	Y1   float64 `json:"y1"`
	Text string  `json:"text"`
	// Konf: Sicherheit der Erkennung 0..100; -1 fuer Woerter aus der
	// Textebene, die niemand erkennen musste.
	Konf float64 `json:"konf"`
}

// Zeile ist eine Zeile aus Woertern.
type Zeile struct {
	Woerter []Wort `json:"woerter"`
}

// Block ist ein Absatzblock aus Zeilen, wie Tesseract ihn abgrenzt.
type Block struct {
	Zeilen []Zeile `json:"zeilen"`
}

// Tesseract ist das Programm mit seinen Einstellungen.
type Tesseract struct {
	// Programm ist der Pfad oder Name ("tesseract" ueber PATH).
	Programm string
	// Tessdata ist der Ordner der Sprachdaten; leer heisst die Vorgabe des
	// Programms (TESSDATA_PREFIX oder der einkompilierte Pfad).
	Tessdata string
	// Sprachen wie "deu+eng".
	Sprachen string
}

// Zustand ist, was Tesseract ueber sich sagt.
type Zustand struct {
	Fassung  string
	Sprachen []string
}

// args baut die gemeinsamen Argumente: Bild, Ausgabe, Sprache, Zerlegung.
func (t Tesseract) args(bild string, rest ...string) []string {
	a := []string{bild, "stdout", "-l", t.Sprachen, "--psm", seitenzerlegung}
	if t.Tessdata != "" {
		a = append(a, "--tessdata-dir", t.Tessdata)
	}
	return append(a, rest...)
}

// Zustand fragt Tesseract nach Fassung und Sprachen und prueft, dass jede
// eingestellte Sprache da ist. Fehlt eine, scheitert jeder Auftrag — dann
// soll schon die Gesundheitsauskunft rot sein, nicht erst der erste Scan.
func (t Tesseract) Zustand(ctx context.Context) (Zustand, error) {
	aus, err := Lauf(ctx, t.Programm, "--version")
	if err != nil {
		return Zustand{}, err
	}
	// Erste Zeile: "tesseract 5.5.0"
	erste, _, _ := strings.Cut(strings.TrimSpace(string(aus)), "\n")
	fassung := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(erste), "tesseract "), "v")
	if fassung == "" {
		return Zustand{}, errors.New("tesseract --version ohne Fassung")
	}

	listen := []string{"--list-langs"}
	if t.Tessdata != "" {
		listen = append(listen, "--tessdata-dir", t.Tessdata)
	}
	aus, err = Lauf(ctx, t.Programm, listen...)
	if err != nil {
		return Zustand{}, err
	}
	// Erste Zeile: 'List of available languages in "…" (3):', dann eine je Zeile.
	var sprachen []string
	for i, z := range strings.Split(string(aus), "\n") {
		if z = strings.TrimSpace(z); i > 0 && z != "" {
			sprachen = append(sprachen, z)
		}
	}
	slices.Sort(sprachen)
	for _, s := range strings.Split(t.Sprachen, "+") {
		if !slices.Contains(sprachen, s) {
			return Zustand{}, fmt.Errorf("Sprache %s fehlt (Sprachen=%s)", s, t.Sprachen)
		}
	}
	return Zustand{Fassung: fassung, Sprachen: sprachen}, nil
}

// Text erkennt den Text eines Seitenbilds als Fliesstext (fuer /text im
// Dienst: die Suche braucht keine Lagen).
func (t Tesseract) Text(ctx context.Context, bild string) (string, error) {
	aus, err := Lauf(ctx, t.Programm, t.args(bild)...)
	if err != nil {
		return "", err
	}
	return Sauber(string(aus)), nil
}

// SeiteErkennen laesst Tesseract die Woerter eines Seitenbilds samt Lage
// liefern (TSV). Die Lage kommt in Bildpunkten; bei dpi sind das 72/dpi
// Punkte — das Bild muss die Seite so zeigen, wie sie angezeigt wird
// (CropBox, Drehung angewandt).
func (t Tesseract) SeiteErkennen(ctx context.Context, bild string, dpi int) ([]Block, error) {
	if dpi <= 0 {
		return nil, fmt.Errorf("Aufloesung %d dpi ungueltig", dpi)
	}
	aus, err := Lauf(ctx, t.Programm, t.args(bild, "tsv")...)
	if err != nil {
		return nil, err
	}
	return TsvLesen(aus, 72/float64(dpi))
}

// TsvLesen liest die TSV-Ausgabe von Tesseract: Ebene 5 sind Woerter,
// Block/Absatz/Zeile ordnen sie. Absaetze gehen in ihrem Block auf. mass
// rechnet Bildpunkte in Punkte um (72/dpi).
func TsvLesen(aus []byte, mass float64) ([]Block, error) {
	type schluessel struct{ block, zeile int }
	var reihenfolge []int
	bloecke := map[int]*Block{}
	zeilenIndex := map[schluessel]int{}

	zeilen := bufio.NewScanner(bytes.NewReader(aus))
	zeilen.Buffer(make([]byte, 64*1024), 4*1024*1024)
	erste := true
	for zeilen.Scan() {
		if erste {
			erste = false
			continue // Kopfzeile
		}
		f := strings.Split(zeilen.Text(), "\t")
		if len(f) < 12 || f[0] != "5" {
			continue
		}
		text := Sauber(f[11])
		if text == "" {
			continue
		}
		zahl := func(i int) float64 { v, _ := strconv.ParseFloat(f[i], 64); return v }
		blockNr := int(zahl(2))
		// Absatz und Zeile zusammen machen die Zeile im Block eindeutig.
		zeilenNr := int(zahl(3))*100000 + int(zahl(4))
		links, oben, breite, hoehe := zahl(6), zahl(7), zahl(8), zahl(9)
		w := Wort{X0: Rund(links * mass), Y0: Rund(oben * mass),
			X1: Rund((links + breite) * mass), Y1: Rund((oben + hoehe) * mass),
			Text: text, Konf: Rund(zahl(10))}

		b, ok := bloecke[blockNr]
		if !ok {
			b = &Block{}
			bloecke[blockNr] = b
			reihenfolge = append(reihenfolge, blockNr)
		}
		k := schluessel{blockNr, zeilenNr}
		i, ok := zeilenIndex[k]
		if !ok {
			b.Zeilen = append(b.Zeilen, Zeile{})
			i = len(b.Zeilen) - 1
			zeilenIndex[k] = i
		}
		b.Zeilen[i].Woerter = append(b.Zeilen[i].Woerter, w)
	}
	if err := zeilen.Err(); err != nil {
		return nil, err
	}
	aus2 := make([]Block, 0, len(reihenfolge))
	for _, nr := range reihenfolge {
		aus2 = append(aus2, *bloecke[nr])
	}
	return aus2, nil
}

// ZeichenIn zaehlt die sichtbaren Zeichen aller Woerter.
func ZeichenIn(bloecke []Block) int {
	n := 0
	for _, b := range bloecke {
		for _, z := range b.Zeilen {
			for _, w := range z.Woerter {
				n += SichtbareZeichen(w.Text)
			}
		}
	}
	return n
}

// HatTextebene sagt, ob die Woerter einer Seite als Textebene zaehlen
// (MindestzeichenJeSeite).
func HatTextebene(bloecke []Block) bool {
	return ZeichenIn(bloecke) >= MindestzeichenJeSeite
}

// MeistSenkrecht: Mehr als die Haelfte der Woerter mit mindestens drei
// Zeichen ist deutlich hoeher als breit — der Scan liegt quer; erst
// drehen, dann erkennen.
func MeistSenkrecht(bloecke []Block) bool {
	hoch, alle := 0, 0
	for _, b := range bloecke {
		for _, z := range b.Zeilen {
			for _, w := range z.Woerter {
				if utf8.RuneCountInString(w.Text) < 3 {
					continue
				}
				alle++
				if (w.Y1 - w.Y0) > 1.5*(w.X1-w.X0) {
					hoch++
				}
			}
		}
	}
	return alle > 0 && hoch*2 > alle
}

// Unsicher sagt, ob eine Seite als unsicher gilt: mehr als ein Viertel
// ihrer Woerter unter UnsichereKonfidenz.
func Unsicher(unsicher, woerter int) bool {
	return unsicher*4 > woerter
}

// Sauber schneidet Leerraum an den Raendern ab (Tesseract endet jede Seite
// mit einem Seitenvorschub) und wirft Nullzeichen weg: PostgreSQL nimmt
// keine in einem text-Feld, und der Text landet dort.
func Sauber(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(s, "\x00", ""))
}

// SichtbareZeichen zaehlt, was kein Leerraum ist.
func SichtbareZeichen(s string) int {
	n := 0
	for _, r := range s {
		if !unicode.IsSpace(r) {
			n++
		}
	}
	return n
}

// Rund kuerzt auf zwei Nachkommastellen — genauer misst niemand, und die
// Antwort wird bei vielen Seiten sonst unnoetig lang.
func Rund(v float64) float64 {
	return math.Round(v*100) / 100
}

// Werkzeugfehler: Das Programm lief und endete mit Fehler. Anders als ein
// Programm, das gar nicht startet — das ist ein Fehler des Gastgebers.
type Werkzeugfehler struct {
	Programm string
	Code     int
	Meldung  string
}

func (f *Werkzeugfehler) Error() string {
	return fmt.Sprintf("%s endete mit %d: %s", f.Programm, f.Code, f.Meldung)
}

// Lauf startet ein Werkzeug und liefert seine Standardausgabe.
func Lauf(ctx context.Context, programm string, args ...string) ([]byte, error) {
	name := filepath.Base(programm)
	befehl := exec.CommandContext(ctx, programm, args...)
	var aus bytes.Buffer
	fehl := &kappe{rest: 2048}
	befehl.Stdout = &aus
	befehl.Stderr = fehl
	// Nach einem Abbruch nicht ewig auf die Ausgaberohre warten: Haelt ein
	// Kindprozess sie offen, kaeme Wait sonst nicht zurueck.
	befehl.WaitDelay = 5 * time.Second
	if err := befehl.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%s abgebrochen: %w", name, ctx.Err())
		}
		var ende *exec.ExitError
		if errors.As(err, &ende) {
			return nil, &Werkzeugfehler{Programm: name, Code: ende.ExitCode(), Meldung: fehl.ersteZeile()}
		}
		return nil, fmt.Errorf("%s nicht ausfuehrbar: %w", name, err)
	}
	return aus.Bytes(), nil
}

// kappe haelt hoechstens rest Bytes der Fehlerausgabe und verwirft den
// Rest: Poppler schreibt zu einer kaputten Datei gern tausende Zeilen
// "Syntax Error".
type kappe struct {
	b    bytes.Buffer
	rest int
}

func (k *kappe) Write(p []byte) (int, error) {
	if n := min(len(p), k.rest); n > 0 {
		k.b.Write(p[:n])
		k.rest -= n
	}
	return len(p), nil
}

// ersteZeile fuers Protokoll: Die Fehlermeldungen der Werkzeuge nennen
// Objektnummern und Schriftnamen, keinen Inhalt; gekuerzt wird trotzdem.
func (k *kappe) ersteZeile() string {
	z, _, _ := strings.Cut(strings.TrimSpace(k.b.String()), "\n")
	if len(z) > 200 {
		z = z[:200] + "…"
	}
	return z
}

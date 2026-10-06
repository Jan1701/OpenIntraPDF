// SPDX-License-Identifier: Apache-2.0

package export

import (
	"archive/zip"
	"io"
	"strings"
	"unicode/utf8"
)

// Gemeinsames der Writer-Formate (DOCX, ODT): die Schreibfolge aus dem
// Modell und das Paket aus ZIP und XML.

// schritt ist ein Block, wie der Writer ihn schreibt.
type schritt struct {
	// umbruch: Seitenumbruch vor diesem Block — nur, wenn die PDF-Seite
	// mit einem neuen Block beginnt (keine fortgesetzte Tabelle).
	umbruch    bool
	block      *Block
	kopfzeilen int
}

// schreibfolge bringt das Modell in die Reihenfolge fuer den Writer:
// wiederholte Kopf- und Fusszeilen einmal, abgewaehlte Tabellen gar
// nicht, Seitenumbrueche wo die Seite neu beginnt. Dazu die Warnungen:
// Bilder werden nicht exportiert.
func schreibfolge(dok Dokument, opt Optionen) ([]schritt, []Warnung, error) {
	if err := opt.pruefen(); err != nil {
		return nil, nil, err
	}
	gew, err := zellenPruefen(dok, opt)
	if err != nil {
		return nil, nil, err
	}
	kopfzeilen := map[int]int{}
	for _, g := range gew {
		kopfzeilen[g.tabelle.Index] = g.kopfzeilen
	}
	var folge []schritt
	for i := range dok.Seiten {
		s := &dok.Seiten[i]
		erster := true
		for j := range s.Bloecke {
			b := &s.Bloecke[j]
			if b.Wiederholt {
				continue
			}
			k := 0
			if b.Tabelle != nil {
				n, ok := kopfzeilen[b.Tabelle.Index]
				if !ok {
					continue
				}
				k = n
			}
			folge = append(folge, schritt{umbruch: erster && i > 0 && !s.Fortsetzung, block: b, kopfzeilen: k})
			erster = false
		}
	}
	var warn warnungen
	bilderWarnung(dok, &warn)
	return folge, warn.ergebnis(), nil
}

// paket schreibt ein ZIP mit XML-Teilen.
type paket struct {
	zw *zip.Writer
}

func neuesPaket(w io.Writer) *paket { return &paket{zw: zip.NewWriter(w)} }

// teil legt eine Datei ab; gespeichert=true ohne Kompression (die
// mimetype-Datei eines ODT muss so liegen).
func (p *paket) teil(name string, inhalt string, gespeichert bool) error {
	kopf := &zip.FileHeader{Name: name, Method: zip.Deflate}
	if gespeichert {
		kopf.Method = zip.Store
	}
	f, err := p.zw.CreateHeader(kopf)
	if err != nil {
		return err
	}
	_, err = io.WriteString(f, inhalt)
	return err
}

func (p *paket) schliessen() error { return p.zw.Close() }

// xmlText maskiert Text fuer XML und wirft Zeichen weg, die XML 1.0 nicht
// erlaubt (Steuerzeichen ausser Tab, LF, CR; U+FFFE/U+FFFF; kaputtes
// UTF-8).
func xmlText(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		i += n
		switch {
		case r == utf8.RuneError && n == 1:
			continue
		case r == '&':
			b.WriteString("&amp;")
		case r == '<':
			b.WriteString("&lt;")
		case r == '>':
			b.WriteString("&gt;")
		case r == '"':
			b.WriteString("&quot;")
		case r == '\t' || r == '\n' || r == '\r':
			b.WriteRune(r)
		case r < 0x20 || r == 0xFFFE || r == 0xFFFF || (r >= 0xD800 && r <= 0xDFFF):
			continue
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// zeilenVon teilt einen Text an Zeilenumbruechen — jede Zeile wird ein
// Lauf, dazwischen ein Umbruch.
func zeilenVon(s string) []string {
	return strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
}

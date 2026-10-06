// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	uni16 "unicode/utf16"

	"github.com/pdfcpu/pdfcpu/pkg/font"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Schrift der Erscheinungsbilder (Etappe 5, Vertrag vom 30.09.2026).
//
// Regel: Laesst sich der ganze zu zeichnende Text in WinAnsi darstellen,
// bleibt es bei Helvetica bzw. Helvetica-Bold (Standard-14, nicht
// eingebettet, wie bisher). Sonst kommt Noto Sans Regular bzw. Bold
// (Latein, Griechisch, Kyrillisch; OFL 1.1, siehe schriften/README.md) als
// eingebettete Teilmenge: Type0 mit Identity-H und ToUnicode, damit
// Kopieren und Suchen den echten Text liefern. Was auch Noto Sans nicht
// hat (etwa Japanisch), wird als Fragezeichen gezeichnet, und der Bericht
// bekommt die Warnung glyphs_missing; Contents behaelt den vollen Text.
//
// # Warum pdfcpu nur zur Haelfte
//
// pdfcpu bringt das Lesen einer TrueType-Datei, ihre Metriken und die
// Teilmengenbildung mit (pkg/font: InstallFontFromBytes, Repository.Subset).
// Beides haengt an einem Schriftordner auf der Platte: Installieren
// schreibt eine .gob-Datei, das Repository liest sie; ohne Ordner geht es
// nicht. Der Ordner ist aber kein globaler Zustand, der sich zwischen
// Anfragen stoert: font.RepositoryForDir haelt je Ordner ein eigenes,
// einmal geladenes und danach unveraenderliches Repository (sync.Map,
// eigener Mutex), und die globale Variable font.UserFontDir bleibt
// unberuehrt. Deshalb: einmal je Prozess (sync.Once) in einen privaten
// Ordner unter os.TempDir installieren, dessen Name aus dem Hash der
// eingebetteten Dateien entsteht. Ein zweiter Prozess findet ihn vor und
// installiert nichts mehr; laufen zwei gleichzeitig, schadet es nicht,
// weil pdfcpu die .gob atomar schreibt (Tempdatei, Pruefung, Umbenennen).
// Kein Systemschrift-Zugriff, kein Netz.
//
// Die Schriftwoerterbuecher (Type0, CIDFontType2, FontDescriptor, W,
// ToUnicode) schreibt der Adapter dagegen selbst. pdfcpus Woerterbuchbau
// (pkg/pdfcpu/font.EnsureFontDict) sucht die Schrift ueber
// xRefTable.FontRepository(), und das ist bei der zustandslosen
// Konfiguration dieses Pakets (konfiguration(): kein Konfigurationsordner)
// immer das leere Repository der Kernschriften. Ausserdem wuerfelt pdfcpu
// den Teilmengen-Praefix (subFontPrefix, mit der Uhr gesaet); der Vertrag
// verlangt ein deterministisches Ergebnis. Die Woerterbuecher sind 60
// Zeilen ISO 32000-1 9.7 — weniger, als ein Umweg ueber pdfcpus Konfiguration
// kosten wuerde.
//
// # Warum die Schriftdateien vor dem Installieren verschlankt werden
//
// pdfcpus Teilmenge ersetzt nur glyf und loca; alle anderen Tabellen gehen
// unveraendert mit. Bei Noto Sans sind das GPOS (87 KB), post mit allen
// Glyphnamen (43 KB) und GSUB (12 KB) — zusammen fast 150 KB fuer einen
// Stempel mit zwanzig Zeichen (gemessen am 30.09.2026: 191 KB Teilmenge).
// Ein PDF-Programm braucht davon nichts: Die Glyphen werden ueber Identity-H
// direkt angesprochen, OpenType-Layout findet nicht statt. Deshalb behaelt
// sfntVerschlanken nur die Tabellen, die pdfcpu zum Lesen und ein Programm
// zum Zeichnen braucht, und macht post zur Fassung 3 (ohne Namen). Die
// eingebetteten Originaldateien bleiben unveraendert; schriften/README.md
// nennt Quelle, Fassung und SHA-256.

//go:embed schriften/NotoSans-Regular.ttf schriften/NotoSans-Bold.ttf
var notoDateien embed.FS

// PostScript-Namen der beiden Schnitte — so heissen sie in der Namenstabelle
// der Dateien, und so legt pdfcpu sie im Repository ab.
const (
	notoRegular = "NotoSans-Regular"
	notoFett    = "NotoSans-Bold"
)

// Ressourcennamen der Schriften in Erscheinungsbildern.
const (
	schriftHelv  = "Helv"
	schriftHelvB = "HelvB"
	schriftNoto  = "OIHNoto"
	schriftNotoB = "OIHNotoB"
)

var helveticaFett = types.Dict{
	"Type": types.Name("Font"), "Subtype": types.Name("Type1"),
	"BaseFont": types.Name("Helvetica-Bold"), "Encoding": types.Name("WinAnsiEncoding"),
}

// notoSchriften ist der einmal je Prozess eingerichtete Satz.
type notoSchriften struct {
	repo   *font.Repository
	metrik map[string]font.TTFLight // je PostScript-Name
}

var (
	notoEinmal sync.Once
	notoStand  *notoSchriften
	notoFehler error
)

// noto liefert die eingerichteten Schriften; beim ersten Aufruf werden sie
// installiert. Scheitert das (kein beschreibbarer Temp-Ordner), scheitert
// jeder Befehl, der Noto braucht — Texte in WinAnsi bleiben davon unberuehrt.
func noto() (*notoSchriften, error) {
	notoEinmal.Do(func() { notoStand, notoFehler = notoEinrichten() })
	if notoFehler != nil {
		return nil, fmt.Errorf("%w: Schrift Noto Sans: %v", ErrNichtUnterstuetzt, notoFehler)
	}
	return notoStand, nil
}

func notoEinrichten() (*notoSchriften, error) {
	dateien := map[string][]byte{}
	pruef := sha256.New()
	for _, n := range []string{notoRegular, notoFett} {
		bb, err := notoDateien.ReadFile("schriften/" + n + ".ttf")
		if err != nil {
			return nil, err
		}
		dateien[n] = bb
		pruef.Write(bb)
	}
	// Die Verschlankung gehoert zum Hash: eine andere Auswahl an Tabellen
	// ist ein anderer Ordner.
	pruef.Write([]byte("verschlankt-1"))
	ordner := filepath.Join(os.TempDir(), "oih-openintrapdf-schriften-"+hex.EncodeToString(pruef.Sum(nil))[:16])
	if err := os.MkdirAll(ordner, 0o700); err != nil {
		return nil, err
	}
	for n, bb := range dateien {
		if _, err := os.Stat(filepath.Join(ordner, n+".gob")); err == nil {
			continue
		}
		schlank, err := sfntVerschlanken(bb)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", n, err)
		}
		if err := font.InstallFontFromBytesQuiet(ordner, n, schlank); err != nil {
			return nil, fmt.Errorf("%s: %w", n, err)
		}
	}
	s := &notoSchriften{repo: font.RepositoryForDir(ordner), metrik: map[string]font.TTFLight{}}
	for n := range dateien {
		m, ok, err := s.repo.UserFont(context.Background(), n)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("%s: nach dem Einrichten nicht im Repository (PostScript-Name weicht ab?)", n)
		}
		s.metrik[n] = m
	}
	return s, nil
}

// sfntBehalten sind die Tabellen, die bleiben: was pdfcpu zum Lesen
// braucht (head, hhea, maxp, OS/2, hmtx, cmap, name, post) und was ein
// Programm zum Zeichnen braucht (glyf, loca; cvt/fpgm/prep bei gehinteten
// Schriften). GSUB, GPOS, GDEF, DSIG, kern fallen weg.
var sfntBehalten = map[string]bool{
	"head": true, "hhea": true, "maxp": true, "OS/2": true, "hmtx": true, "cmap": true,
	"name": true, "post": true, "glyf": true, "loca": true, "cvt ": true, "fpgm": true, "prep": true,
}

// sfntVerschlanken schreibt eine TrueType-Datei mit den Tabellen aus
// sfntBehalten neu; post wird zur Fassung 3 (nur der 32-Byte-Kopf, keine
// Glyphnamen). Verzeichnis, Ausrichtung und Pruefsummen werden neu
// gerechnet, checkSumAdjustment im head ebenso.
func sfntVerschlanken(bb []byte) ([]byte, error) {
	if len(bb) < 12 || binary.BigEndian.Uint32(bb) != 0x00010000 {
		return nil, errors.New("keine TrueType-Datei")
	}
	n := int(binary.BigEndian.Uint16(bb[4:]))
	if len(bb) < 12+16*n {
		return nil, errors.New("Tabellenverzeichnis unvollstaendig")
	}
	type tabelle struct {
		tag   string
		daten []byte
	}
	var tabellen []tabelle
	for i := 0; i < n; i++ {
		e := bb[12+16*i:]
		tag := string(e[:4])
		off, l := binary.BigEndian.Uint32(e[8:]), binary.BigEndian.Uint32(e[12:])
		if !sfntBehalten[tag] {
			continue
		}
		if uint64(off)+uint64(l) > uint64(len(bb)) {
			return nil, fmt.Errorf("Tabelle %s ragt ueber das Dateiende", tag)
		}
		daten := bb[off : off+l]
		switch tag {
		case "post":
			if len(daten) < 32 {
				return nil, errors.New("post-Tabelle zu kurz")
			}
			daten = append([]byte{}, daten[:32]...)
			binary.BigEndian.PutUint32(daten, 0x00030000)
		case "head":
			if len(daten) < 54 {
				return nil, errors.New("head-Tabelle zu kurz")
			}
			// Die Pruefsumme des head wird mit checkSumAdjustment = 0 gerechnet.
			daten = append([]byte{}, daten...)
			binary.BigEndian.PutUint32(daten[8:], 0)
		}
		tabellen = append(tabellen, tabelle{tag, daten})
	}
	sort.Slice(tabellen, func(i, j int) bool { return tabellen[i].tag < tabellen[j].tag })
	m := len(tabellen)
	kopf := make([]byte, 12)
	binary.BigEndian.PutUint32(kopf, 0x00010000)
	binary.BigEndian.PutUint16(kopf[4:], uint16(m))
	pot, sel := 1, 0
	for pot*2 <= m {
		pot *= 2
		sel++
	}
	binary.BigEndian.PutUint16(kopf[6:], uint16(pot*16))
	binary.BigEndian.PutUint16(kopf[8:], uint16(sel))
	binary.BigEndian.PutUint16(kopf[10:], uint16(m*16-pot*16))
	verz := make([]byte, 16*m)
	var koerper bytes.Buffer
	anfang := 12 + 16*m
	headOff := -1
	for i, t := range tabellen {
		e := verz[16*i:]
		copy(e, t.tag)
		binary.BigEndian.PutUint32(e[4:], sfntPruefsumme(t.daten))
		binary.BigEndian.PutUint32(e[8:], uint32(anfang+koerper.Len()))
		binary.BigEndian.PutUint32(e[12:], uint32(len(t.daten)))
		if t.tag == "head" {
			headOff = anfang + koerper.Len()
		}
		koerper.Write(t.daten)
		for koerper.Len()%4 != 0 {
			koerper.WriteByte(0)
		}
	}
	aus := make([]byte, 0, anfang+koerper.Len())
	aus = append(aus, kopf...)
	aus = append(aus, verz...)
	aus = append(aus, koerper.Bytes()...)
	if headOff >= 0 {
		binary.BigEndian.PutUint32(aus[headOff+8:], 0xB1B0AFBA-sfntPruefsumme(aus))
	}
	return aus, nil
}

// sfntPruefsumme ist die Summe der Big-Endian-32-Bit-Woerter, wie die
// TrueType-Norm sie fuer Tabellen und die ganze Datei verlangt.
func sfntPruefsumme(b []byte) uint32 {
	var s uint32
	for i := 0; i < len(b); i += 4 {
		var w [4]byte
		copy(w[:], b[i:])
		s += binary.BigEndian.Uint32(w[:])
	}
	return s
}

// ============================================================
// Schriftwahl und Setzen
// ============================================================

// winAnsiDarstellbar sagt, ob WinAnsi (Helvetica) jeden Rune des Textes
// kennt. Zeilenumbrueche und Tabulatoren zaehlen nicht: Sie werden nicht
// gezeichnet.
func winAnsiDarstellbar(s string) bool {
	for _, r := range s {
		switch {
		case r == '\n', r == '\r', r == '\t':
		case r >= 32 && r < 127, r >= 160 && r < 256:
		default:
			if _, ok := winAnsiSonder[r]; !ok {
				return false
			}
		}
	}
	return true
}

// notoVerwendung sammelt, was ein Lauf aus einem Noto-Schnitt braucht: die
// Glyphen aller Erscheinungsbilder und das Schriftobjekt, das sie teilen.
// Das Objekt wird vorab angelegt (ref, zunaechst ein Platzhalter) und am
// Ende des Laufs gefuellt (schriftenAbschliessen), wenn die Teilmenge
// feststeht. So traegt ein Commit mit zwanzig Stempeln eine Teilmenge, nicht
// zwanzig.
type notoVerwendung struct {
	name   string
	metrik font.TTFLight
	ref    types.IndirectRef
	gids   map[uint16]bool
	// runen: Glyph -> der Rune, der ihn zuerst brauchte (fuer ToUnicode;
	// pdfcpus Umkehrtabelle kann fuer das Leerzeichen U+00A0 nennen).
	runen map[uint16]rune
	// fehlt: ein Zeichen hatte auch in Noto keinen Glyph.
	fehlt bool
}

// glyph liefert den Glyph eines Runes, ohne ihn zu vermerken (zum
// Messen); ok ist false, wenn die Schrift ihn nicht hat — dann kommt das
// Fragezeichen.
func (v *notoVerwendung) glyph(r rune) (uint16, bool) {
	g, ok := v.metrik.Chars[uint32(r)]
	if !ok || g == 0 {
		return v.metrik.Chars['?'], false
	}
	return g, true
}

// gid vermerkt den Glyph als benutzt (zum Zeichnen).
func (v *notoVerwendung) gid(r rune) uint16 {
	g, ok := v.glyph(r)
	if !ok {
		v.fehlt = true
		r = '?'
	}
	v.gids[g] = true
	if _, da := v.runen[g]; !da {
		v.runen[g] = r
	}
	return g
}

// satz ist die Schrift eines Textes im Erscheinungsbild: Helvetica, wenn
// WinAnsi ihn darstellt, sonst Noto Sans aus der geteilten Verwendung des
// Laufs.
type satz struct {
	c    context.Context
	fett bool
	noto *notoVerwendung // nil: Helvetica
}

// satz waehlt die Schrift fuer text.
func (a *anwender) satz(text string, fett bool) (*satz, error) {
	s := &satz{c: a.c, fett: fett}
	if winAnsiDarstellbar(text) {
		return s, nil
	}
	v, ok := a.noto[fett]
	if !ok {
		n, err := noto()
		if err != nil {
			return nil, err
		}
		name := notoRegular
		if fett {
			name = notoFett
		}
		ref, err := a.x.IndRefForNewObject(types.Dict{"Type": types.Name("Font")})
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		v = &notoVerwendung{name: name, metrik: n.metrik[name], ref: *ref, gids: map[uint16]bool{}, runen: map[uint16]rune{}}
		if a.noto == nil {
			a.noto = map[bool]*notoVerwendung{}
		}
		a.noto[fett] = v
	}
	s.noto = v
	return s, nil
}

// breite misst text in Punkt bei Schriftgroesse gr.
func (s *satz) breite(text string, gr float64) float64 {
	if s.noto == nil {
		name := "Helvetica"
		if s.fett {
			name = "Helvetica-Bold"
		}
		// Gemessen wird der WinAnsi-kodierte Text: pdfcpu schlaegt bei
		// Kernschriften je Byte nach (siehe textstrom).
		w, err := font.TextWidthFloat(s.c, string(winAnsiKodiert(text)), name, gr)
		if err != nil {
			return 0
		}
		return w
	}
	var w int
	for _, r := range text {
		g, _ := s.noto.glyph(r)
		if int(g) < len(s.noto.metrik.GlyphWidths) {
			w += s.noto.metrik.GlyphWidths[g]
		}
	}
	return float64(w) / 1000 * gr
}

// tj kodiert text als Operanden fuer Tj: bei Noto als Hex-Zeichenkette der
// Glyphnummern (zwei Byte je Zeichen, Identity-H), sonst als
// WinAnsi-Literal.
func (s *satz) tj(text string) string {
	if s.noto == nil {
		return "(" + winAnsi(text) + ")"
	}
	var b strings.Builder
	b.WriteByte('<')
	for _, r := range text {
		fmt.Fprintf(&b, "%04X", s.noto.gid(r))
	}
	b.WriteByte('>')
	return b.String()
}

// ressource liefert Ressourcennamen und Schriftobjekt fuer /Font.
func (s *satz) ressource() (string, types.Object) {
	switch {
	case s.noto != nil && s.fett:
		return schriftNotoB, s.noto.ref
	case s.noto != nil:
		return schriftNoto, s.noto.ref
	case s.fett:
		return schriftHelvB, helveticaFett
	}
	return schriftHelv, helvetica
}

// ============================================================
// Schriftobjekte schreiben
// ============================================================

// schriftenAbschliessen fuellt die Platzhalter der Noto-Verwendungen mit
// Teilmenge und Woerterbuechern und traegt glyphs_missing ein.
func (a *anwender) schriftenAbschliessen() error {
	for _, fett := range []bool{false, true} {
		v, ok := a.noto[fett]
		if !ok {
			continue
		}
		if v.fehlt {
			a.erg.warnung(WarnungGlyphenFehlen)
		}
		if err := a.notoSchreiben(v); err != nil {
			return err
		}
	}
	return nil
}

// notoSchreiben baut Type0 -> CIDFontType2 -> FontDescriptor -> FontFile2
// (Teilmenge) samt W und ToUnicode (ISO 32000-1 9.7.4, 9.7.6, 9.10.3) und
// setzt das Type0-Woerterbuch in das vorab angelegte Objekt.
func (a *anwender) notoSchreiben(v *notoVerwendung) error {
	n, err := noto()
	if err != nil {
		return err
	}
	if len(v.gids) == 0 {
		v.gid(' ')
	}
	gids := make([]int, 0, len(v.gids))
	for g := range v.gids {
		gids = append(gids, int(g))
	}
	sort.Ints(gids)
	teil, err := n.repo.Subset(a.c, v.name, v.gids)
	if err != nil {
		return fmt.Errorf("%w: Teilmenge %s: %v", ErrNichtUnterstuetzt, v.name, err)
	}
	basis := teilmengenKennung(v.name, gids) + "+" + v.name
	m := v.metrik

	datei, err := a.strom(teil, types.Dict{"Length1": types.Integer(len(teil))})
	if err != nil {
		return err
	}
	flags := 1 << 5 // Nonsymbolic
	if m.FixedPitch {
		flags |= 1
	}
	if m.ItalicAngle != 0 {
		flags |= 1 << 6
	}
	stemV := 80
	if m.Bold {
		flags |= 1 << 18
		stemV = 120
	}
	beschreibung, err := a.x.IndRefForNewObject(types.Dict{
		"Type": types.Name("FontDescriptor"), "FontName": types.Name(basis), "Flags": types.Integer(flags),
		"FontBBox": types.NewNumberArray(m.LLx, m.LLy, m.URx, m.URy), "ItalicAngle": types.Float(m.ItalicAngle),
		"Ascent": types.Integer(m.Ascent), "Descent": types.Integer(m.Descent), "CapHeight": types.Integer(m.CapHeight),
		"StemV": types.Integer(stemV), "FontFile2": *datei,
	})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	// W: Laeufe aufeinanderfolgender Glyphen als "erste [w1 w2 ...]".
	var w types.Array
	for i := 0; i < len(gids); {
		var lauf types.Array
		j := i
		for ; j < len(gids) && gids[j] == gids[i]+(j-i); j++ {
			breite := 0
			if gids[j] < len(m.GlyphWidths) {
				breite = m.GlyphWidths[gids[j]]
			}
			lauf = append(lauf, types.Integer(breite))
		}
		w = append(w, types.Integer(gids[i]), lauf)
		i = j
	}
	cid, err := a.x.IndRefForNewObject(types.Dict{
		"Type": types.Name("Font"), "Subtype": types.Name("CIDFontType2"), "BaseFont": types.Name(basis),
		"CIDSystemInfo": types.Dict{"Registry": types.StringLiteral("Adobe"), "Ordering": types.StringLiteral("Identity"),
			"Supplement": types.Integer(0)},
		"FontDescriptor": *beschreibung, "DW": types.Integer(1000), "W": w, "CIDToGIDMap": types.Name("Identity"),
	})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	zuUnicode, err := a.strom([]byte(toUnicode(v, gids)), nil)
	if err != nil {
		return err
	}
	e, ok := a.x.FindTableEntry(v.ref.ObjectNumber.Value(), v.ref.GenerationNumber.Value())
	if !ok || e == nil {
		return fmt.Errorf("%w: Schriftobjekt %d fehlt", ErrNichtUnterstuetzt, v.ref.ObjectNumber.Value())
	}
	e.Object = types.Dict{
		"Type": types.Name("Font"), "Subtype": types.Name("Type0"), "BaseFont": types.Name(basis),
		"Encoding": types.Name("Identity-H"), "DescendantFonts": types.Array{*cid}, "ToUnicode": *zuUnicode,
	}
	return nil
}

// strom legt einen Flate-komprimierten Datenstrom als neues Objekt an.
func (a *anwender) strom(daten []byte, zusatz types.Dict) (*types.IndirectRef, error) {
	sd, err := a.x.NewStreamDictForBuf(daten)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	for k, v := range zusatz {
		sd.Insert(k, v)
	}
	if err := sd.Encode(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	ref, err := a.x.IndRefForNewObject(*sd)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	return ref, nil
}

// teilmengenKennung ist der sechsbuchstabige Praefix einer Teilmenge (ISO
// 32000-1 9.6.4) — aus Schrift und Glyphen abgeleitet, damit dasselbe
// Ergebnis dieselbe Datei gibt.
func teilmengenKennung(name string, gids []int) string {
	h := fnv.New32a()
	h.Write([]byte(name))
	var b [4]byte
	for _, g := range gids {
		binary.BigEndian.PutUint32(b[:], uint32(g))
		h.Write(b[:])
	}
	v := h.Sum32()
	var aus [6]byte
	for i := range aus {
		aus[i] = 'A' + byte(v%26)
		v /= 26
	}
	return string(aus[:])
}

// toUnicode schreibt die CMap Glyph -> Unicode fuer die benutzten Glyphen
// (bfchar in Bloecken zu hoechstens 100, wie die Norm es verlangt).
func toUnicode(v *notoVerwendung, gids []int) string {
	var b strings.Builder
	b.WriteString("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
		"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
		"/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n" +
		"1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n")
	for i := 0; i < len(gids); i += 100 {
		ende := min(i+100, len(gids))
		fmt.Fprintf(&b, "%d beginbfchar\n", ende-i)
		for _, g := range gids[i:ende] {
			r, ok := v.runen[uint16(g)]
			if !ok {
				r = rune(v.metrik.ToUnicode[uint16(g)])
			}
			fmt.Fprintf(&b, "<%04X> <", g)
			for _, u := range uni16.Encode([]rune{r}) {
				fmt.Fprintf(&b, "%04X", u)
			}
			b.WriteString(">\n")
		}
		b.WriteString("endbfchar\n")
	}
	b.WriteString("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend")
	return b.String()
}

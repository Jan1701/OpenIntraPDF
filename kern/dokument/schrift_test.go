// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"encoding/binary"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/font"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Eingebettete Schrift (Etappe 5).

// schriftbild beschreibt eine Type0-Schrift im Ergebnis.
type schriftbild struct {
	basis, kodierung, cidTyp, cidZuGid string
	toUnicode, datei                   bool
	dateiLaenge                        int
}

// type0Schriften sammelt alle Type0-Schriften der Datei.
func type0Schriften(t *testing.T, pdf []byte) []schriftbild {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	x := ctx.XRefTable
	var aus []schriftbild
	for nr, e := range x.Table {
		if nr == 0 || e == nil || e.Free {
			continue
		}
		d, ok := e.Object.(types.Dict)
		if !ok || alsName(x, d["Type"]) != "Font" || alsName(x, d["Subtype"]) != "Type0" {
			continue
		}
		b := schriftbild{basis: alsName(x, d["BaseFont"]), kodierung: alsName(x, d["Encoding"])}
		_, b.toUnicode = aufloesen(x, d["ToUnicode"]).(types.StreamDict)
		if kinder := alsArray(x, d["DescendantFonts"]); len(kinder) == 1 {
			cid := alsDict(x, kinder[0])
			b.cidTyp = alsName(x, cid["Subtype"])
			b.cidZuGid = alsName(x, cid["CIDToGIDMap"])
			if fd := alsDict(x, cid["FontDescriptor"]); fd != nil {
				if sd, ok := aufloesen(x, fd["FontFile2"]).(types.StreamDict); ok {
					b.datei = true
					if l, ok := aufloesen(x, sd.Dict["Length1"]).(types.Integer); ok {
						b.dateiLaenge = int(l)
					}
				}
			}
		}
		aus = append(aus, b)
	}
	return aus
}

// Polnisch, Griechisch, Kyrillisch in Textfeld, Post-it und Stempel: Noto
// Sans als Type0/Identity-H mit ToUnicode; Helvetica bleibt fuer
// WinAnsi-Texte; pdftotext liefert den echten Text.
func TestSchriftNotoFuerFremdeZeichen(t *testing.T) {
	aus, b, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "f", Page: 0, Kind: "freetext", Rect: []float64{100, 700, 400, 740}, Contents: "Zażółć gęślą jaźń", FontSize: 14},
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 500, 300, 600}, Contents: "Ελληνικά σημείωση για τον λογαριασμό"},
		{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{100, 400, 300, 450}, Stamp: &Stempel{Label: "ПРОВЕРЕНО", Name: "Checked", Signed: true, Lang: "bg"}},
		{ClientID: "h", Page: 0, Kind: "freetext", Rect: []float64{100, 300, 400, 340}, Contents: "Nur Latein äöü €"},
	}}, nil)
	if len(b.Warnungen) != 0 {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	bilder := anmerkungsbilder(t, aus)
	nr := func(i int) int { return bildVon(t, bilder, erg.Added[i].NM).nr }
	if inhalt, _, _ := apStrom(t, aus, nr(0)); !strings.Contains(inhalt, "/"+schriftNoto+" 14 Tf") || !strings.Contains(inhalt, "> Tj") {
		t.Errorf("Textfeld: %s", inhalt)
	}
	if inhalt, _, _ := apStrom(t, aus, nr(1)); !strings.Contains(inhalt, "/"+schriftNoto+" 11 Tf") || strings.Count(inhalt, "> Tj") < 2 {
		t.Errorf("Post-it: %s", inhalt)
	}
	// Das bulgarische Datum endet auf „г.“ — auch die zweite Zeile braucht Noto.
	if inhalt, _, _ := apStrom(t, aus, nr(2)); !strings.Contains(inhalt, "/"+schriftNotoB+" ") || !strings.Contains(inhalt, "/"+schriftNoto+" ") {
		t.Errorf("Stempel (Label fett Noto, zweite Zeile Noto): %s", inhalt)
	}
	if inhalt, _, _ := apStrom(t, aus, nr(3)); !strings.Contains(inhalt, "/Helv 12 Tf") || !strings.Contains(inhalt, "(Nur Latein \\344\\366\\374 \\200) Tj") {
		t.Errorf("WinAnsi-Text nicht mehr mit Helvetica: %s", inhalt)
	}
	schriften := type0Schriften(t, aus)
	if len(schriften) != 2 {
		t.Fatalf("%d Type0-Schriften, erwartet 2 (normal und fett): %+v", len(schriften), schriften)
	}
	for _, s := range schriften {
		if !strings.HasSuffix(s.basis, "+NotoSans-Regular") && !strings.HasSuffix(s.basis, "+NotoSans-Bold") || len(s.basis) < 8 || s.basis[6] != '+' ||
			s.kodierung != "Identity-H" || s.cidTyp != "CIDFontType2" || s.cidZuGid != "Identity" || !s.toUnicode || !s.datei || s.dateiLaenge == 0 {
			t.Errorf("Schrift %+v", s)
		}
	}
	// Ein Textfeld, ein Post-it und die Stempelzeile teilen sich EINE
	// Teilmenge je Schnitt — also zwei Schriftobjekte, nicht vier.
	popplerOhneSyntaxfehler(t, aus)
	pt := popplerText(t, aus)
	for _, w := range []string{"Zażółć", "gęślą", "jaźń", "Ελληνικά", "λογαριασμό", "ПРОВЕРЕНО", "Latein"} {
		if !strings.Contains(pt, w) {
			t.Errorf("pdftotext ohne %q:\n%s", w, pt)
		}
	}
}

// Was auch Noto Sans nicht hat: Fragezeichen und glyphs_missing; Contents
// bleibt voll.
func TestSchriftGlyphenFehlen(t *testing.T) {
	aus, b, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 500, 300, 600}, Contents: "日本語のメモ und Ärger"},
	}}, nil)
	if !enthaelt(b.Warnungen, WarnungGlyphenFehlen) || enthaelt(b.Warnungen, WarnungPostitGekuerzt) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	bild := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM)
	if bild.inhalt != "日本語のメモ und Ärger" {
		t.Errorf("Contents %q", bild.inhalt)
	}
	if pt := popplerText(t, aus); !strings.Contains(pt, "?????? und Ärger") {
		t.Errorf("pdftotext:\n%s", pt)
	}
	// Ohne fremde Zeichen keine Warnung.
	_, b, _ = commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "z", Page: 0, Kind: "sticky", Rect: []float64{100, 500, 300, 600}, Contents: "Zażółć"},
	}}, nil)
	if len(b.Warnungen) != 0 {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
}

// Mass des Vertrags: Ein Stempel mit ~20 verschiedenen Zeichen aus Noto
// Sans macht die Datei um hoechstens 60 KB groesser als derselbe Stempel
// mit Helvetica.
func TestSchriftDateigroesse(t *testing.T) {
	stempel := func(label string) []byte {
		aus, _, _ := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{
			{ClientID: "s", Page: 0, Kind: "stamp", Rect: []float64{50, 600, 450, 650}, Stamp: &Stempel{Label: label, Name: "Custom"}},
		}, Zeit: time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)}, nil)
		return aus
	}
	helvetica := stempel("GEPRUEFT UND FREIGEGEBEN 42")
	noto := stempel("ZAŻÓŁĆ GĘŚLĄ JAŹŃ ΩΨ Д")
	if s := type0Schriften(t, noto); len(s) != 1 {
		t.Fatalf("Type0-Schriften: %+v", s)
	}
	zuwachs := len(noto) - len(helvetica)
	t.Logf("Datei mit Helvetica %d Byte, mit Noto Sans %d Byte, Zuwachs %d Byte (%.1f KB)", len(helvetica), len(noto), zuwachs, float64(zuwachs)/1024)
	if zuwachs > 60*1024 {
		t.Errorf("Zuwachs %d Byte ueber 60 KB", zuwachs)
	}
	// Derselbe Inhalt gibt denselben Teilmengen-Praefix.
	if a, b := type0Schriften(t, noto), type0Schriften(t, stempel("ZAŻÓŁĆ GĘŚLĄ JAŹŃ ΩΨ Д")); a[0].basis != b[0].basis {
		t.Errorf("Praefix nicht deterministisch: %s / %s", a[0].basis, b[0].basis)
	}
}

// Gleichzeitige Commits mit eingebetteter Schrift (Vertrag: -race).
func TestSchriftGleichzeitig(t *testing.T) {
	var wg sync.WaitGroup
	fehler := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			var aus bytes.Buffer
			text := []string{"Zażółć gęślą jaźń", "Ελληνικά", "Привет", "Grüße"}[i%4]
			_, _, err := CommitBauen(context.Background(), bytes.NewReader(korpus.Textseiten(2)), &Anmerkungsbefehle{Add: []NeueAnmerkung{
				{Page: i % 2, Kind: "sticky", Rect: []float64{100, 500, 300, 600}, Contents: text},
				{Page: i % 2, Kind: "stamp", Rect: []float64{100, 400, 300, 450}, Stamp: &Stempel{Label: strings.ToUpper(text), Name: "Custom", Signed: true, Lang: "pl"}},
			}, Autor: "Parallel"}, nil, &aus)
			if err != nil {
				fehler <- err
				return
			}
			if i%4 != 3 && len(type0Schriften(t, aus.Bytes())) != 2 {
				fehler <- context.DeadlineExceeded
			}
		}(i)
	}
	wg.Wait()
	close(fehler)
	for err := range fehler {
		t.Error(err)
	}
}

// Die verschlankte Datei liest pdfcpu wie das Original (gleiche Metriken),
// ist aber ohne GPOS/GSUB und ohne Glyphnamen deutlich kleiner.
func TestSfntVerschlanken(t *testing.T) {
	roh, err := notoDateien.ReadFile("schriften/NotoSans-Regular.ttf")
	if err != nil {
		t.Fatal(err)
	}
	schlank, err := sfntVerschlanken(roh)
	if err != nil {
		t.Fatal(err)
	}
	// Ohne GPOS/GSUB/GDEF und Glyphnamen bleiben etwa zwei Drittel (glyf
	// traegt den Loewenanteil und bleibt hier noch ganz).
	if len(schlank) >= len(roh)*3/4 {
		t.Errorf("verschlankt %d Byte, Original %d", len(schlank), len(roh))
	}
	tags := map[string]int{}
	n := int(binary.BigEndian.Uint16(schlank[4:]))
	for i := 0; i < n; i++ {
		e := schlank[12+16*i:]
		tags[string(e[:4])] = int(binary.BigEndian.Uint32(e[12:]))
	}
	for _, weg := range []string{"GPOS", "GSUB", "GDEF"} {
		if _, da := tags[weg]; da {
			t.Errorf("%s noch da", weg)
		}
	}
	if tags["post"] != 32 || tags["glyf"] == 0 || tags["cmap"] == 0 {
		t.Errorf("Tabellen %v", tags)
	}
	ordner := t.TempDir()
	if err := font.InstallFontFromBytesQuiet(ordner, "probe", schlank); err != nil {
		t.Fatal(err)
	}
	if err := font.InstallFontFromBytesQuiet(ordner+"/voll", "probe", roh); err == nil {
		t.Fatal("Ordner voll muesste fehlen")
	}
	repo := font.RepositoryForDir(ordner)
	m, ok, err := repo.UserFont(context.Background(), notoRegular)
	if err != nil || !ok {
		t.Fatalf("Metriken: %v %v", ok, err)
	}
	if m.UnitsPerEm != 1000 || m.GlyphCount < 3000 || m.Chars['ż'] == 0 || m.Chars['Ω'] == 0 || m.Chars['Д'] == 0 || m.Chars['€'] == 0 || m.Chars['日'] != 0 {
		t.Errorf("Metriken %s: upem %d Glyphen %d", m.PostscriptName, m.UnitsPerEm, m.GlyphCount)
	}
}

func TestWinAnsiDarstellbar(t *testing.T) {
	for text, erwartet := range map[string]bool{
		"":                        true,
		"Grüße 12 € „so“ – ok\n?": true,
		"Zażółć":                  false,
		"Ελληνικά":                false,
		"Привет":                  false,
		"日本":                      false,
		"Tab\tund Zeile\r\n":      true,
	} {
		if got := winAnsiDarstellbar(text); got != erwartet {
			t.Errorf("%q: %v", text, got)
		}
	}
}

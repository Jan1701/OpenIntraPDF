// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Hilfen der Adaptertests.

var markeMuster = regexp.MustCompile(`SEITE-\d\d`)

// geoeffnet liest ein Ergebnis zurueck — mit derselben Leseroutine wie
// der Adapter, aber ohne dessen Auswertung.
func geoeffnet(t *testing.T, pdf []byte) *model.Context {
	t.Helper()
	ctx, err := lesen(context.Background(), bytes.NewReader(pdf), model.LISTINFO)
	if err != nil {
		t.Fatalf("Ergebnis nicht lesbar: %v", err)
	}
	return ctx
}

func katalogVon(t *testing.T, ctx *model.Context) types.Dict {
	t.Helper()
	k, err := ctx.Catalog()
	if err != nil || k == nil {
		t.Fatalf("Katalog: %v", err)
	}
	return k
}

// seitenbild beschreibt eine Seite des Ergebnisses: Marke im Inhalt,
// wirksame Drehung, MediaBox, CropBox.
type seitenbild struct {
	marke    string
	drehung  int
	mediaBox string
	cropBox  string
}

func seitenbilder(t *testing.T, pdf []byte) []seitenbild {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	seiten, err := blaetter(ctx)
	if err != nil {
		t.Fatalf("Seitenbaum: %v", err)
	}
	aus := make([]seitenbild, len(seiten))
	for i, s := range seiten {
		inhalt, err := ctx.PageContent(s.dict, i+1)
		if err != nil && !errors.Is(err, model.ErrNoContent) {
			t.Fatalf("Seite %d: Inhalt: %v", i+1, err)
		}
		b := seitenbild{marke: markeMuster.FindString(string(inhalt))}
		wirksam := func(k string) types.Object {
			if v, ok := s.dict.Find(k); ok {
				return v
			}
			return s.geerbt[k]
		}
		if r, ok := aufloesen(ctx.XRefTable, wirksam("Rotate")).(types.Integer); ok {
			b.drehung = int(r)
		}
		if a := alsArray(ctx.XRefTable, wirksam("MediaBox")); a != nil {
			b.mediaBox = a.PDFString()
		}
		if a := alsArray(ctx.XRefTable, wirksam("CropBox")); a != nil {
			b.cropBox = a.PDFString()
		}
		aus[i] = b
	}
	return aus
}

func marken(t *testing.T, pdf []byte) []string {
	t.Helper()
	var aus []string
	for _, b := range seitenbilder(t, pdf) {
		aus = append(aus, b.marke)
	}
	return aus
}

// alleObjekteAlsText liefert jedes Objekt der Datei als Text, Datenstroeme
// entpackt. Damit sucht ein Test nach Inhalten, die in komprimierten
// Objektstroemen stecken koennten — ein blosses bytes.Contains auf der
// Datei saehe sie nicht.
func alleObjekteAlsText(t *testing.T, pdf []byte) string {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	var s strings.Builder
	for nr, e := range ctx.Table {
		if nr == 0 || e == nil || e.Free {
			continue
		}
		gen := 0
		if e.Generation != nil {
			gen = *e.Generation
		}
		o := aufloesen(ctx.XRefTable, *types.NewIndirectRef(nr, gen))
		switch v := o.(type) {
		case types.StreamDict:
			s.WriteString(v.Dict.PDFString())
			k := v
			if err := k.Decode(); err == nil {
				s.Write(k.Content)
			}
		case nil:
		default:
			s.WriteString(v.PDFString())
		}
		s.WriteString("\n")
	}
	return s.String()
}

func inspektion(t *testing.T, pdf []byte) Inspektion {
	t.Helper()
	i, err := Inspizieren(context.Background(), bytes.NewReader(pdf))
	if err != nil {
		t.Fatalf("Inspizieren: %v", err)
	}
	return i
}

func plan(seiten ...int) []Seite {
	aus := make([]Seite, len(seiten))
	for i, s := range seiten {
		aus[i] = Seite{Quelle: s}
	}
	return aus
}

func bauen(t *testing.T, quelle []byte, p []Seite) ([]byte, Bericht) {
	t.Helper()
	var aus bytes.Buffer
	b, err := SeitenplanBauen(context.Background(), bytes.NewReader(quelle), p, &aus)
	if err != nil {
		t.Fatalf("SeitenplanBauen: %v", err)
	}
	return aus.Bytes(), b
}

func gleich(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func enthaelt(liste []string, s string) bool {
	for _, e := range liste {
		if e == s {
			return true
		}
	}
	return false
}

// eingebetteterInhalt liefert den entpackten Inhalt einer eingebetteten
// Datei aus dem Namensbaum.
func eingebetteterInhalt(t *testing.T, pdf []byte, schluessel string) []byte {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	x := ctx.XRefTable
	for _, e := range namensbaum(x, namensbaumVon(x, katalogVon(t, ctx), "EmbeddedFiles")) {
		if e.schluessel != schluessel {
			continue
		}
		ef := alsDict(x, alsDict(x, e.wert)["EF"])
		sd, ok := aufloesen(x, ef["F"]).(types.StreamDict)
		if !ok {
			t.Fatalf("Anhang %q ohne Datenstrom", schluessel)
		}
		if err := sd.Decode(); err != nil {
			t.Fatalf("Anhang %q: %v", schluessel, err)
		}
		return sd.Content
	}
	t.Fatalf("Anhang %q fehlt", schluessel)
	return nil
}

// erscheinungsbilder zaehlt Annotationen, deren normales Erscheinungsbild
// (/AP /N) sich aufloesen laesst und Inhalt hat.
func erscheinungsbilder(t *testing.T, pdf []byte) (mitAP, lesbar int) {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	x := ctx.XRefTable
	seiten, err := blaetter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range seiten {
		for _, a := range anmerkungen(x, s.dict) {
			ap := alsDict(x, a.dict["AP"])
			if ap == nil {
				continue
			}
			mitAP++
			var stroeme []types.Object
			switch n := aufloesen(x, ap["N"]).(type) {
			case types.StreamDict:
				stroeme = append(stroeme, n)
			case types.Dict:
				for _, v := range n {
					stroeme = append(stroeme, aufloesen(x, v))
				}
			}
			ok := len(stroeme) > 0
			for _, st := range stroeme {
				sd, ist := st.(types.StreamDict)
				if !ist {
					ok = false
					break
				}
				if err := sd.Decode(); err != nil || len(sd.Content) == 0 {
					ok = false
					break
				}
			}
			if ok {
				lesbar++
			}
		}
	}
	return mitAP, lesbar
}

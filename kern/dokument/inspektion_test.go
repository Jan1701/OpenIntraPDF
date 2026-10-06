// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

func TestInspektionDesKorpus(t *testing.T) {
	besitzer, err := korpus.MitBesitzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	faelle := []struct {
		name string
		pdf  []byte
		soll Inspektion
	}{
		{"Textseiten", korpus.Textseiten(3), Inspektion{Seiten: 3}},
		{"Anmerkungen", korpus.MitAnmerkungen(), Inspektion{Seiten: 3, Anmerkungen: 5, Links: 1}},
		{"Formular", korpus.MitFormular(), Inspektion{Seiten: 3, Formular: true, Formularfelder: 4, Widgets: 5}},
		{"Anhang", korpus.MitAnhang(), Inspektion{Seiten: 2, Anhaenge: 2, Anmerkungen: 1}},
		{"Lesezeichen", korpus.MitLesezeichen(), Inspektion{Seiten: 4, Lesezeichen: 4}},
		{"Signaturfeld", korpus.MitSignaturfeld(), Inspektion{Seiten: 2, Signiert: true, Formular: true, Formularfelder: 1, Widgets: 1}},
		{"JavaScript", korpus.MitJavaScript(), Inspektion{Seiten: 1, JavaScript: true}},
		{"Getaggt", korpus.Getaggt(), Inspektion{Seiten: 2, Getaggt: true}},
		{"PDFA", korpus.PDFA(), Inspektion{Seiten: 1, PDFA: true}},
		{"Voll", korpus.Voll(), Inspektion{Seiten: 5, Formular: true, Formularfelder: 2, Widgets: 2,
			Anhaenge: 2, Lesezeichen: 5, Anmerkungen: 4, Links: 1}},
		{"Besitzerpasswort", besitzer, Inspektion{Seiten: 3, Verschluesselt: true}},
	}
	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			ist := inspektion(t, f.pdf)
			ist.Version = ""
			if ist != f.soll {
				t.Errorf("\nist  %+v\nsoll %+v", ist, f.soll)
			}
		})
	}
}

func TestBenutzerpasswortWirdErkannt(t *testing.T) {
	pdf, err := korpus.MitBenutzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	i, err := Inspizieren(context.Background(), bytes.NewReader(pdf))
	if !errors.Is(err, ErrPasswort) {
		t.Fatalf("Fehler %v, erwartet ErrPasswort", err)
	}
	if !i.Verschluesselt || !i.Benutzerpasswort {
		t.Errorf("Inspektion %+v", i)
	}
	var aus bytes.Buffer
	if _, err := SeitenplanBauen(context.Background(), bytes.NewReader(pdf), plan(0), &aus); !errors.Is(err, ErrPasswort) {
		t.Errorf("Seitenplan: %v, erwartet ErrPasswort", err)
	}
}

func TestKeinPdfUndKaputt(t *testing.T) {
	if _, err := Inspizieren(context.Background(), bytes.NewReader([]byte("Hallo, ich bin eine Textdatei."))); !errors.Is(err, ErrKeinPDF) {
		t.Errorf("Textdatei: %v, erwartet ErrKeinPDF", err)
	}
	if _, err := Inspizieren(context.Background(), bytes.NewReader([]byte("%PDF-1.7\nkaputt\n%%EOF"))); !errors.Is(err, ErrUnlesbar) {
		t.Errorf("kaputtes PDF: %v, erwartet ErrUnlesbar", err)
	}
	abgeschnitten := korpus.Voll()
	abgeschnitten = abgeschnitten[:len(abgeschnitten)/3]
	if _, err := Inspizieren(context.Background(), bytes.NewReader(abgeschnitten)); err == nil {
		t.Log("abgeschnittenes PDF: pdfcpu hat es repariert gelesen — zulaessig")
	} else if !errors.Is(err, ErrUnlesbar) {
		t.Errorf("abgeschnittenes PDF: %v, erwartet ErrUnlesbar", err)
	}
}

// riesig gibt vor, groesser als die Grenze zu sein, ohne Speicher zu
// belegen.
type riesig struct{ pos int64 }

func (r *riesig) Read(p []byte) (int, error) { return 0, io.EOF }
func (r *riesig) Seek(o int64, woher int) (int64, error) {
	if woher == io.SeekEnd {
		r.pos = HoechstBytes + 1 + o
	} else {
		r.pos = o
	}
	return r.pos, nil
}

func TestZuGrossWirdAbgewiesen(t *testing.T) {
	if _, err := Inspizieren(context.Background(), &riesig{}); !errors.Is(err, ErrZuGross) {
		t.Errorf("%v, erwartet ErrZuGross", err)
	}
}

// Ein abgebrochener Kontext bricht ab, statt zu Ende zu rechnen.
func TestAbbruchWirdDurchgereicht(t *testing.T) {
	c, abbrechen := context.WithCancel(context.Background())
	abbrechen()
	var aus bytes.Buffer
	if _, err := SeitenplanBauen(c, bytes.NewReader(korpus.Voll()), plan(0), &aus); !errors.Is(err, context.Canceled) {
		t.Errorf("%v, erwartet context.Canceled", err)
	}
}

// pdfcpu legt ohne Vorkehrung einen Konfigurationsordner unter
// ~/.config an. Der Dienst hat dort nichts zu suchen.
func TestKeinKonfigurationsordner(t *testing.T) {
	heim := t.TempDir()
	t.Setenv("HOME", heim)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(heim, ".config"))
	if _, err := Inspizieren(context.Background(), bytes.NewReader(korpus.Voll())); err != nil {
		t.Fatal(err)
	}
	var aus bytes.Buffer
	if _, err := SeitenplanBauen(context.Background(), bytes.NewReader(korpus.Voll()), plan(1, 0), &aus); err != nil {
		t.Fatal(err)
	}
	eintraege, _ := os.ReadDir(heim)
	if len(eintraege) != 0 {
		t.Errorf("im Heimverzeichnis entstand etwas: %v", eintraege)
	}
}

// Die Fassung in der Faehigkeitsauskunft muss die eingebundene sein.
func TestEngineFassungPasstZuGoMod(t *testing.T) {
	roh, err := os.ReadFile("../../go.mod")
	if err != nil {
		t.Fatal(err)
	}
	muster := regexp.MustCompile(`(?m)^\s*github\.com/pdfcpu/pdfcpu (v\S+)`)
	treffer := muster.FindSubmatch(roh)
	if treffer == nil || string(treffer[1]) != EngineVersion {
		t.Errorf("go.mod nennt %q, EngineVersion ist %q", treffer, EngineVersion)
	}
}

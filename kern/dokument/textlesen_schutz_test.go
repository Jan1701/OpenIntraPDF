// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Der lokale Leser und geschuetzte Dateien (#253).
//
// github.com/ledongthuc/pdf kennt nur V1/V2 mit RC4 -- und las selbst die
// nicht richtig (RC4-40: keine Woerter). V4 (RC4-128 und AES-128, so
// schreibt pdfcpu beide) und AES-256 lehnte es ganz ab. Ohne
// Texterkennungsdienst endete eine Analyse geschuetzter Dateien deshalb
// auch mit richtigem Rechte-Kennwort bei 422 pdf.unreadable.

// schutzVariante verschluesselt roh nur mit Rechte-Kennwort (Oeffnen-
// Kennwort leer) und nur dem Druckrecht -- in der genannten Art.
func schutzVariante(t *testing.T, roh []byte, aes bool, bits int, pdf20 bool) []byte {
	t.Helper()
	konf := konfiguration(model.ENCRYPT)
	konf.OwnerPW = "rechte-456"
	konf.EncryptUsingAES = aes
	konf.EncryptKeyLength = bits
	konf.Permissions = model.PermissionsPrint
	ctx, err := lesenMit(context.Background(), bytes.NewReader(roh), konf)
	if err != nil {
		t.Fatal(err)
	}
	if pdf20 {
		alsPDF20(ctx)
	}
	aus, err := schreiben(context.Background(), ctx)
	if err != nil {
		t.Fatal(err)
	}
	return aus
}

func alleWoerter(seiten []Seitentext) string {
	var teile []string
	for _, s := range seiten {
		for _, b := range s.Bloecke {
			for _, z := range b {
				teile = append(teile, woerterText(z))
			}
		}
	}
	return strings.Join(teile, " | ")
}

// Jede Art, die pdfcpu schreibt, liest der lokale Leser jetzt wie die
// ungeschuetzte Datei -- entschluesselt im Speicher.
func TestTextebeneLesenGeschuetzt(t *testing.T) {
	ctx := context.Background()
	klar, err := TextebeneLesen(ctx, korpus.Rechnung(), nil)
	if err != nil {
		t.Fatal(err)
	}
	erwartet := alleWoerter(klar)
	if !strings.Contains(erwartet, "Rechnung") {
		t.Fatalf("ungeschuetzte Rechnung ohne Text: %q", erwartet)
	}
	for _, f := range []struct {
		name        string
		aes         bool
		bits        int
		pdf20       bool
		dictMerkmal string
	}{
		{"RC4-40 (V1)", false, 40, false, "/V 1"},
		{"RC4-128 (V4)", false, 128, false, "/CFM/V2"},
		{"AES-128 (V4)", true, 128, false, "/CFM/AESV2"},
		{"AES-256 (R5)", true, 256, false, "/R 5"},
		{"AES-256 (R6)", true, 256, true, "/R 6"},
	} {
		roh := schutzVariante(t, korpus.Rechnung(), f.aes, f.bits, f.pdf20)
		if !bytes.Contains(roh, []byte(f.dictMerkmal)) {
			t.Fatalf("%s: Verschluesselung nicht wie erwartet (%s fehlt)", f.name, f.dictMerkmal)
		}
		seiten, err := TextebeneLesen(ctx, roh, nil)
		if err != nil {
			t.Errorf("%s: %v", f.name, err)
			continue
		}
		if got := alleWoerter(seiten); got != erwartet {
			t.Errorf("%s: Text weicht ab\n  geschuetzt %q\nungeschuetzt %q", f.name, got, erwartet)
		}
		if hat, err := HatTextebene(ctx, roh, []int{0}); err != nil || !hat {
			t.Errorf("%s: HatTextebene = %v, %v", f.name, hat, err)
		}
	}
}

// Mit Oeffnen-Kennwort bleibt die Datei zu: Entschluesselt wird nur, was
// pdfcpu ohne Kennwort oeffnet. Die Rechte prueft der Aufrufer vorher
// (RechtPruefen): mit falschem Rechte-Kennwort kein Lesen.
func TestTextebeneLesenGeschuetztGrenzen(t *testing.T) {
	ctx := context.Background()
	zu, err := korpus.MitBenutzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := TextebeneLesen(ctx, zu, nil); !errors.Is(err, ErrPasswort) {
		t.Errorf("Datei mit Oeffnen-Kennwort: %v, erwartet ErrPasswort", err)
	}
	for _, f := range []struct {
		name  string
		aes   bool
		bits  int
		pdf20 bool
	}{{"AES-128 (V4)", true, 128, false}, {"AES-256 (R6)", true, 256, true}} {
		roh := schutzVariante(t, korpus.Rechnung(), f.aes, f.bits, f.pdf20)
		if err := RechtPruefen(ctx, bytes.NewReader(roh), "", "copy"); !errors.Is(err, ErrRechteEingeschraenkt) {
			t.Errorf("%s ohne Kennwort: %v, erwartet ErrRechteEingeschraenkt", f.name, err)
		}
		if err := RechtPruefen(ctx, bytes.NewReader(roh), "falsch-789", "copy"); !errors.Is(err, ErrPasswortFalsch) {
			t.Errorf("%s mit falschem Kennwort: %v, erwartet ErrPasswortFalsch", f.name, err)
		}
		if err := RechtPruefen(ctx, bytes.NewReader(roh), "rechte-456", "copy"); err != nil {
			t.Errorf("%s mit richtigem Kennwort: %v", f.name, err)
		}
	}
	// Die Grenzen aus #243 gelten auch hinter dem Schutz: Die Textbombe
	// endet verschluesselt so schnell wie offen.
	bombe := schutzVariante(t, korpus.Textbombe(1, 20, 1<<20), true, 256, true)
	start := time.Now()
	if hat, err := HatTextebene(ctx, bombe, []int{0}); hat {
		t.Errorf("verschluesselte Textbombe: hat=%v err=%v", hat, err)
	}
	if d := time.Since(start); d > time.Second {
		t.Errorf("verschluesselte Textbombe: %v, erlaubt sind unter einer Sekunde", d)
	}
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Kennwortschutz (Etappe 9, Vertrag Abschnitt 3): Die geschuetzte Kopie
// oeffnet sich mit pdfcpu nur mit dem richtigen Kennwort und traegt die
// Rechte-Bits; Kennwort entfernen schreibt ohne Schutz; die Rechte-Bits
// einer fremd geschuetzten Datei sperren den Commit ohne Rechte-Kennwort.
// (pdf.js prueft dieselbe Probe in schutz.pdfjs.test.ts.)

// oeffnenMit liest ein PDF mit pdfcpu und den genannten Kennwoertern — so,
// wie ein fremdes Programm es taete, nicht ueber den Adapter.
func oeffnenMit(pdf []byte, benutzer, besitzer string) (*model.Context, error) {
	konf := model.NewStatelessConfiguration()
	konf.Offline = true
	konf.UserPW = benutzer
	konf.OwnerPW = besitzer
	return api.ReadAndValidate(context.Background(), bytes.NewReader(pdf), konf)
}

func schuetzen(t *testing.T, quelle []byte, s Schutz) []byte {
	t.Helper()
	var aus bytes.Buffer
	if err := Verschluesseln(context.Background(), bytes.NewReader(quelle), s, &aus); err != nil {
		t.Fatalf("Verschluesseln: %v", err)
	}
	return aus.Bytes()
}

var nurDrucken = Rechte{Drucken: true}

func TestVerschluesselnOeffnenKennwort(t *testing.T) {
	aus := schuetzen(t, korpus.MitAnmerkungen(), Schutz{Benutzerpasswort: "oeffnen-123", Besitzerpasswort: "rechte-456", Rechte: nurDrucken})
	// Ohne Kennwort geht nichts, mit falschem nichts, mit dem Oeffnen-Kennwort
	// und mit dem Rechte-Kennwort geht es.
	if _, err := oeffnenMit(aus, "", ""); !errors.Is(err, pdfcpu.ErrWrongPassword) {
		t.Errorf("ohne Kennwort: %v", err)
	}
	if _, err := oeffnenMit(aus, "falsch-789", ""); !errors.Is(err, pdfcpu.ErrWrongPassword) {
		t.Errorf("falsches Kennwort: %v", err)
	}
	ctx, err := oeffnenMit(aus, "oeffnen-123", "")
	if err != nil {
		t.Fatalf("Oeffnen-Kennwort: %v", err)
	}
	// AES-256 als Revision 6 (#250): pdfcpu schreibt sie nur bei PDF 2.0;
	// Revision 5 (ein SHA-256-Schritt) ist veraltet und laesst sich offline
	// um Groessenordnungen schneller raten.
	if ctx.E == nil || ctx.E.R != 6 || ctx.E.L != 256 || ctx.E.V != 5 {
		t.Fatalf("kein AES-256 als R6 (V=5, R=6, L=256): R=%d V=%d L=%d", ctx.E.R, ctx.E.V, ctx.E.L)
	}
	if !bytes.HasPrefix(aus, []byte("%PDF-2.0")) {
		t.Errorf("Kopf %q, erwartet %%PDF-2.0", aus[:8])
	}
	if r := RechteVon(ctx.E.P); r != nurDrucken {
		t.Errorf("Rechte %+v, erwartet nur Drucken (P=%d)", r, ctx.E.P)
	}
	if _, err := oeffnenMit(aus, "", "rechte-456"); err != nil {
		t.Errorf("Rechte-Kennwort: %v", err)
	}
	// Der Inhalt ist vollstaendig: Seiten, Anmerkungen, Link.
	i := inspizieren(ctx)
	if i.Seiten != 3 || i.Anmerkungen != 5 || i.Links != 1 || !i.Verschluesselt {
		t.Errorf("Inspektion %+v", i)
	}
	if m, err := korpus.Marken(aus); err == nil || len(m) != 0 {
		t.Errorf("Marken ohne Kennwort lesbar: %v %v", m, err)
	}
}

func TestVerschluesselnNurRechteKennwort(t *testing.T) {
	alle := Rechte{Drucken: true, Kopieren: true, Aendern: true, Kommentieren: true, Ausfuellen: true}
	aus := schuetzen(t, korpus.Voll(), Schutz{Besitzerpasswort: "rechte-456", Rechte: alle})
	// Ohne Kennwort lesbar, alle Rechte gesetzt; das Rechte-Kennwort gilt.
	ctx, err := oeffnenMit(aus, "", "")
	if err != nil {
		t.Fatalf("ohne Kennwort: %v", err)
	}
	if r := RechteVon(ctx.E.P); r != alle {
		t.Errorf("Rechte %+v", r)
	}
	if i := inspizieren(ctx); i.Seiten != 5 || i.Lesezeichen != 5 || i.Anhaenge != 2 || i.Formularfelder != 2 || i.Anmerkungen != 4 {
		t.Errorf("Inspektion %+v", i)
	}
	if err := besitzerPruefen(context.Background(), bytes.NewReader(aus), "rechte-456"); err != nil {
		t.Errorf("Rechte-Kennwort prueft nicht: %v", err)
	}
	if err := besitzerPruefen(context.Background(), bytes.NewReader(aus), "falsch-789"); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("falsches Rechte-Kennwort: %v", err)
	}
	// Jede Rechtekombination kommt so zurueck, wie sie hinein ging —
	// Kommentieren schliesst Ausfuellen ein (Norm, Bit 6 ueber Bit 9).
	for _, r := range []Rechte{{}, {Kopieren: true}, {Aendern: true, Kommentieren: true}, {Ausfuellen: true}, {Drucken: true, Ausfuellen: true}} {
		aus := schuetzen(t, korpus.Textseiten(1), Schutz{Besitzerpasswort: "rechte-456", Rechte: r})
		ctx, err := oeffnenMit(aus, "", "")
		if err != nil {
			t.Fatal(err)
		}
		erwartet := r
		if r.Kommentieren {
			erwartet.Ausfuellen = true
		}
		if got := RechteVon(ctx.E.P); got != erwartet {
			t.Errorf("Rechte %+v kamen als %+v zurueck", r, got)
		}
	}
}

func TestVerschluesselnGrenzen(t *testing.T) {
	versuch := func(quelle []byte, s Schutz) error {
		var aus bytes.Buffer
		return Verschluesseln(context.Background(), bytes.NewReader(quelle), s, &aus)
	}
	if err := versuch(korpus.Textseiten(1), Schutz{Besitzerpasswort: "kurz"}); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("kurzes Rechte-Kennwort: %v", err)
	}
	if err := versuch(korpus.Textseiten(1), Schutz{Benutzerpasswort: "kurz", Besitzerpasswort: "rechte-456"}); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("kurzes Oeffnen-Kennwort: %v", err)
	}
	if err := versuch(korpus.Textseiten(1), Schutz{}); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("ohne Rechte-Kennwort: %v", err)
	}
	besitzer, _ := korpus.MitBesitzerpasswort()
	if err := versuch(besitzer, Schutz{Besitzerpasswort: "rechte-456"}); !errors.Is(err, ErrVerschluesselteQuelle) {
		t.Errorf("schon verschluesselt: %v", err)
	}
	// Mit Benutzerpasswort ist die Quelle ebenfalls schon verschluesselt.
	benutzer, _ := korpus.MitBenutzerpasswort()
	if err := versuch(benutzer, Schutz{Besitzerpasswort: "rechte-456"}); !errors.Is(err, ErrVerschluesselteQuelle) {
		t.Errorf("mit Benutzerpasswort: %v", err)
	}
}

// Kennwort entfernen: Commit mit Passwort und Entschluesseln schreibt eine
// Fassung ohne Schutz — nur mit dem Rechte-Kennwort (#248). Das
// Oeffnen-Kennwort allein wird abgewiesen, denn mit dem Schutz fielen auch
// die Rechte-Bits des Besitzers.
func TestKennwortEntfernen(t *testing.T) {
	benutzer, _ := korpus.MitBenutzerpasswort()
	for name, a := range map[string]Commit{
		"Rechte-Kennwort als Passwort":              {Passwort: korpus.ProbeBesitzerpasswort, Entschluesseln: true},
		"Oeffnen-Kennwort plus Rechte-Kennwort":     {Passwort: korpus.ProbeBenutzerpasswort, Besitzerpasswort: korpus.ProbeBesitzerpasswort, Entschluesseln: true},
		"Rechte-Kennwort als Besitzerpasswort":      {Besitzerpasswort: korpus.ProbeBesitzerpasswort, Entschluesseln: true},
		"Oeffnen-Kennwort, Rechte-Kennwort doppelt": {Passwort: korpus.ProbeBesitzerpasswort, Besitzerpasswort: korpus.ProbeBesitzerpasswort, Entschluesseln: true},
	} {
		var aus bytes.Buffer
		b, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(benutzer), a, &aus)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if i := inspektion(t, aus.Bytes()); i.Verschluesselt || i.Benutzerpasswort || i.Seiten != 2 {
			t.Errorf("%s: Inspektion %+v", name, i)
		}
		if m := marken(t, aus.Bytes()); !gleich(m, []string{"SEITE-01", "SEITE-02"}) {
			t.Errorf("%s: Marken %v", name, m)
		}
		if b.Seiten != 2 {
			t.Errorf("%s: Bericht %+v", name, b)
		}
	}
	// Nur das Oeffnen-Kennwort (#248): 422 pdf.permission_restricted mit "decrypt" —
	// auch, wenn es zusaetzlich als Rechte-Kennwort genannt wird. Nichts wird geschrieben.
	for name, a := range map[string]Commit{
		"nur Oeffnen-Kennwort":                 {Passwort: korpus.ProbeBenutzerpasswort, Entschluesseln: true},
		"Oeffnen-Kennwort als Rechte-Kennwort": {Besitzerpasswort: korpus.ProbeBenutzerpasswort, Entschluesseln: true},
	} {
		var aus bytes.Buffer
		_, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(benutzer), a, &aus)
		var rf *Rechtefehler
		if name == "nur Oeffnen-Kennwort" {
			if !errors.As(err, &rf) || !gleich(rf.Fehlend, []string{"decrypt"}) {
				t.Errorf("%s: %v", name, err)
			}
		} else if !errors.Is(err, ErrPasswortFalsch) {
			// Ein ausdrueckliches Rechte-Kennwort, das keines ist, ist falsch.
			t.Errorf("%s: %v", name, err)
		}
		if aus.Len() != 0 {
			t.Errorf("%s: trotz Ablehnung %d Byte geschrieben", name, aus.Len())
		}
	}
	// Eine Datei mit nur EINEM Kennwort (Oeffnen = Rechte): Es entschluesselt weiter.
	einziges := schuetzen(t, korpus.Textseiten(2), Schutz{Benutzerpasswort: "einziges-1", Besitzerpasswort: "einziges-1", Rechte: nurDrucken})
	var ausEinziges bytes.Buffer
	if _, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(einziges), Commit{Passwort: "einziges-1", Entschluesseln: true}, &ausEinziges); err != nil {
		t.Fatalf("einziges Kennwort: %v", err)
	}
	if i := inspektion(t, ausEinziges.Bytes()); i.Verschluesselt || i.Seiten != 2 {
		t.Errorf("einziges Kennwort: Inspektion %+v", i)
	}
	// Nur Besitzerschutz: das Rechte-Kennwort nimmt ihn.
	besitzer, _ := korpus.MitBesitzerpasswort()
	var aus bytes.Buffer
	if _, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(besitzer), Commit{Passwort: korpus.ProbeBesitzerpasswort, Entschluesseln: true}, &aus); err != nil {
		t.Fatalf("Besitzerschutz entfernen: %v", err)
	}
	if i := inspektion(t, aus.Bytes()); i.Verschluesselt {
		t.Errorf("noch verschluesselt: %+v", i)
	}
	// Falsches Kennwort, kein Kennwort, nicht verschluesselt.
	versuch := func(quelle []byte, a Commit) error {
		var aus bytes.Buffer
		_, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(quelle), a, &aus)
		return err
	}
	if err := versuch(benutzer, Commit{Passwort: "falsch-789", Entschluesseln: true}); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("falsches Kennwort: %v", err)
	}
	if err := versuch(benutzer, Commit{Entschluesseln: true}); !errors.Is(err, ErrPasswort) {
		t.Errorf("ohne Kennwort: %v", err)
	}
	if err := versuch(korpus.Textseiten(1), Commit{Entschluesseln: true}); !errors.Is(err, ErrNichtVerschluesselt) {
		t.Errorf("nicht verschluesselt: %v", err)
	}
	// Mit Besitzerschutz, aber nur dem (falschen) Oeffnen-Kennwort: Die Datei
	// oeffnet sich ohne Kennwort, das genannte ist also kein Rechte-Kennwort,
	// und Entschluesseln ohne eines geht nicht.
	if err := versuch(besitzer, Commit{Passwort: "falsch-789", Entschluesseln: true}); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("Besitzerschutz mit falschem Kennwort: %v", err)
	}
}

// Rechte einer fremd geschuetzten Datei: Die Korpusdatei erlaubt nur
// Drucken. Seiten, Eigenschaften und Anmerkungen brauchen das Rechte-
// Kennwort; ein falsches wird abgelehnt.
func TestCommitRechteEingeschraenkt(t *testing.T) {
	besitzer, _ := korpus.MitBesitzerpasswort()
	versuch := func(a Commit) error {
		var aus bytes.Buffer
		_, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(besitzer), a, &aus)
		return err
	}
	notiz := &Anmerkungsbefehle{Add: []NeueAnmerkung{{Page: 0, Kind: "note", Rect: []float64{72, 500}, Contents: "x"}}, Autor: "E"}
	faelle := map[string]struct {
		a      Commit
		fehlen []string
	}{
		"Seitenplan":    {Commit{Plan: plan(1, 0, 2)}, []string{"modify"}},
		"Eigenschaften": {Commit{Eigenschaften: &Eigenschaften{Title: str("Neu")}}, []string{"modify"}},
		"Anmerkungen":   {Commit{Anmerkungen: notiz}, []string{"annotate"}},
		"alles":         {Commit{Plan: plan(0, 1, 2), Anmerkungen: notiz}, []string{"modify", "annotate"}},
	}
	for name, f := range faelle {
		err := versuch(f.a)
		var rf *Rechtefehler
		if !errors.As(err, &rf) || !gleich(rf.Fehlend, f.fehlen) {
			t.Errorf("%s ohne Kennwort: %v", name, err)
		}
		if err := versuch(Commit{Plan: f.a.Plan, Eigenschaften: f.a.Eigenschaften, Anmerkungen: f.a.Anmerkungen, Besitzerpasswort: korpus.ProbeBesitzerpasswort}); err != nil {
			t.Errorf("%s mit Rechte-Kennwort: %v", name, err)
		}
	}
	if err := versuch(Commit{Plan: plan(1, 0, 2), Besitzerpasswort: "falsch-789"}); !errors.Is(err, ErrPasswortFalsch) {
		t.Errorf("falsches Rechte-Kennwort: %v", err)
	}
	// Ein Plan, der nichts aendert (Identitaet), und Entschluesseln ohne Kennwort: ebenfalls Rechte.
	if err := versuch(Commit{}); err != nil {
		t.Errorf("leerer Auftrag: %v", err)
	}
	// Datei mit Benutzerpasswort (auch nur Drucken): Das Oeffnen-Kennwort
	// genuegt nicht zum Aendern, das Rechte-Kennwort schon.
	benutzer, _ := korpus.MitBenutzerpasswort()
	var aus bytes.Buffer
	_, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(benutzer), Commit{Plan: plan(1, 0), Passwort: korpus.ProbeBenutzerpasswort}, &aus)
	if !errors.Is(err, ErrRechteEingeschraenkt) {
		t.Errorf("Benutzerpasswort, Seitenplan: %v", err)
	}
	aus.Reset()
	if _, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(benutzer), Commit{Plan: plan(1, 0), Passwort: korpus.ProbeBenutzerpasswort, Besitzerpasswort: korpus.ProbeBesitzerpasswort}, &aus); err != nil {
		t.Errorf("Benutzerpasswort mit Rechte-Kennwort: %v", err)
	}
	// Mit dem Rechte-Kennwort GEOEFFNET (pdf.js nimmt es als Oeffnen-Kennwort): Der
	// Commit traegt es als Passwort, kein eigenes Rechte-Kennwort — und geht.
	var ohneBenutzer bytes.Buffer
	if _, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(benutzer), Commit{Plan: plan(1, 0), Passwort: korpus.ProbeBesitzerpasswort}, &ohneBenutzer); err != nil {
		t.Errorf("mit Rechte-Kennwort geoeffnet: %v", err)
	}
	// Der Schutz bleibt beim Umsortieren: ohne Kennwort nicht lesbar, mit dem Benutzerpasswort schon.
	if _, err := oeffnenMit(aus.Bytes(), "", ""); !errors.Is(err, pdfcpu.ErrWrongPassword) {
		t.Errorf("Schutz ging beim Umsortieren verloren: %v", err)
	}
	if ctx, err := oeffnenMit(aus.Bytes(), korpus.ProbeBenutzerpasswort, ""); err != nil {
		t.Errorf("Ergebnis mit Benutzerpasswort: %v", err)
	} else if ctx.PageCount != 2 || ctx.Encrypt == nil {
		t.Errorf("%d Seiten, Encrypt %v", ctx.PageCount, ctx.Encrypt)
	}
}

// Schreibt die Probe fuer den pdf.js-Test (schutz.pdfjs.test.ts): Oeffnen-
// Kennwort „probe-oeffnen“, Rechte-Kennwort „probe-rechte“, nur Drucken.
func TestSchutzProbeSchreiben(t *testing.T) {
	ziel := os.Getenv("OIH_PROBE_ZIEL")
	if ziel == "" {
		t.Skip("OIH_PROBE_ZIEL nicht gesetzt")
	}
	aus := schuetzen(t, korpus.Textseiten(2), Schutz{Benutzerpasswort: "probe-oeffnen", Besitzerpasswort: "probe-rechte", Rechte: nurDrucken})
	if err := os.WriteFile(ziel, aus, 0o644); err != nil {
		t.Fatal(err)
	}
}

// RechtPruefen (Kopier-/Aendern-Bit beim Anlegen von Auftraegen): Eine
// ungeschuetzte Quelle erlaubt alles; bei einer geschuetzten entscheidet
// das Bit oder das Rechte-Kennwort; ein falsches wird abgewiesen.
func TestRechtPruefen(t *testing.T) {
	ctx := context.Background()
	pruefen := func(quelle []byte, besitzer, recht string) error {
		return RechtPruefen(ctx, bytes.NewReader(quelle), besitzer, recht)
	}
	if err := pruefen(korpus.Textseiten(1), "", "copy"); err != nil {
		t.Errorf("ungeschuetzt, copy: %v", err)
	}
	if err := pruefen(korpus.Textseiten(1), "egal-123", "modify"); err != nil {
		t.Errorf("ungeschuetzt, modify mit Kennwort: %v", err)
	}
	// Nur Drucken (Korpus): Kopieren und Aendern fehlen.
	besitzer, _ := korpus.MitBesitzerpasswort()
	for _, recht := range []string{"copy", "modify"} {
		err := pruefen(besitzer, "", recht)
		var rf *Rechtefehler
		if !errors.As(err, &rf) || !gleich(rf.Fehlend, []string{recht}) {
			t.Errorf("nur Drucken, %s: %v", recht, err)
		}
		if err := pruefen(besitzer, korpus.ProbeBesitzerpasswort, recht); err != nil {
			t.Errorf("nur Drucken, %s mit Rechte-Kennwort: %v", recht, err)
		}
		if err := pruefen(besitzer, "falsch-789", recht); !errors.Is(err, ErrPasswortFalsch) {
			t.Errorf("nur Drucken, %s mit falschem Kennwort: %v", recht, err)
		}
	}
	// Kopieren erlaubt, Aendern nicht.
	kopierbar := schuetzen(t, korpus.Textseiten(1), Schutz{Besitzerpasswort: "rechte-456", Rechte: Rechte{Kopieren: true}})
	if err := pruefen(kopierbar, "", "copy"); err != nil {
		t.Errorf("kopierbar, copy: %v", err)
	}
	if err := pruefen(kopierbar, "", "modify"); !errors.Is(err, ErrRechteEingeschraenkt) {
		t.Errorf("kopierbar, modify: %v", err)
	}
	// Oeffnen-Kennwort: Ohne es ist die Datei fuer Auftraege nicht lesbar.
	benutzer, _ := korpus.MitBenutzerpasswort()
	if err := pruefen(benutzer, "", "copy"); !errors.Is(err, ErrPasswort) {
		t.Errorf("Oeffnen-Kennwort: %v", err)
	}
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Seiten aus einer anderen Datei (Etappe 9, Vertrag Abschnitt 2): die
// Quellen haengen hinten an der Basis, der Plan nennt sie ab PageCount der
// Basis; Anmerkungen der eingefuegten Seiten bleiben; Grenzen wie beim
// Binden.

func ausfuehren(t *testing.T, basis []byte, a Commit) ([]byte, Bericht, Anmerkungsergebnis) {
	t.Helper()
	var aus bytes.Buffer
	b, erg, err := CommitAusfuehren(context.Background(), bytes.NewReader(basis), a, &aus)
	if err != nil {
		t.Fatalf("CommitAusfuehren: %v", err)
	}
	return aus.Bytes(), b, erg
}

func TestQuellenEinfuegen(t *testing.T) {
	// Basis: zwei Textseiten. Quelle: Seite 1 und 3 der Anmerkungsdatei
	// (Notiz mit Popup + Markierung; Link + Antwort) — eingeschoben
	// zwischen die Basisseiten, Seite 3 vor Seite 1.
	quelle := Quelle{Inhalt: bytes.NewReader(korpus.MitAnmerkungen()), Seiten: []int{2, 0}, Titel: "Anhang"}
	plan := []Seite{{Quelle: 0}, {Quelle: 2}, {Quelle: 3, Drehung: 90}, {Quelle: 1}}
	aus, b, _ := ausfuehren(t, korpus.Textseiten(2), Commit{Plan: plan, Quellen: []Quelle{quelle}})
	if m := marken(t, aus); !gleich(m, []string{"SEITE-01", "SEITE-03", "SEITE-01", "SEITE-02"}) {
		t.Errorf("Reihenfolge %v", m)
	}
	if b.Seiten != 4 {
		t.Errorf("Bericht %+v", b)
	}
	bilder := seitenbilder(t, aus)
	if bilder[2].drehung != 90 || bilder[1].drehung != 0 {
		t.Errorf("Drehung %+v %+v", bilder[1], bilder[2])
	}
	// Anmerkungen der eingefuegten Seiten: Link + Antwort auf Seite 2,
	// Notiz + Popup + Markierung auf Seite 3. Die Antwort zeigt auf die
	// Notiz, die mitkam.
	typen := map[int]map[string]int{}
	for _, a := range anmerkungsbilder(t, aus) {
		if typen[a.seite] == nil {
			typen[a.seite] = map[string]int{}
		}
		typen[a.seite][a.typ]++
	}
	if typen[1]["Link"] != 1 || typen[1]["Text"] != 1 || typen[2]["Text"] != 1 || typen[2]["Popup"] != 1 || typen[2]["Highlight"] != 1 {
		t.Errorf("Anmerkungen je Seite: %+v", typen)
	}
	if i := inspektion(t, aus); i.Anmerkungen != 3 || i.Links != 1 {
		t.Errorf("Inspektion %+v", i)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Ohne Seitenliste kommt die ganze Quelle; ohne Plan steht sie hinten.
// Anmerkungsbefehle zaehlen weiter im Basisdokument.
func TestQuellenGanzUndAnmerkungen(t *testing.T) {
	anm := &Anmerkungsbefehle{Add: []NeueAnmerkung{{ClientID: "n", Page: 1, Kind: "note", Rect: []float64{72, 500}, Contents: "Basis"}}}
	aus, b, erg := ausfuehren(t, korpus.Textseiten(2), Commit{
		Anmerkungen: anm,
		Quellen:     []Quelle{{Inhalt: bytes.NewReader(korpus.Textseiten(3)), Titel: "Drei"}},
	})
	if m := marken(t, aus); !gleich(m, []string{"SEITE-01", "SEITE-02", "SEITE-01", "SEITE-02", "SEITE-03"}) {
		t.Errorf("Reihenfolge %v", m)
	}
	if b.Seiten != 5 || b.AnmerkungenNeu != 1 || len(erg.Added) != 1 {
		t.Errorf("Bericht %+v, Ergebnis %+v", b, erg)
	}
	if n := bildVon(t, anmerkungsbilder(t, aus), erg.Added[0].NM); n.seite != 1 {
		t.Errorf("Notiz auf Seite %d, erwartet 2 (Basis)", n.seite+1)
	}
}

// Formularfelder aus zwei Dokumenten: gleiche Namen werden gemeldet, bleiben
// aber getrennte Felder; Anhaenge mit gleichem Namen werden umbenannt.
func TestQuellenFelderUndAnhaenge(t *testing.T) {
	aus, b, _ := ausfuehren(t, korpus.FormularMitNamen("Name", "Betrag"), Commit{
		Quellen: []Quelle{
			{Inhalt: bytes.NewReader(korpus.FormularMitNamen("Name")), Titel: "Formular"},
			{Inhalt: bytes.NewReader(korpus.MitAnhang()), Titel: "Anhang"},
		},
	})
	if !enthaelt(b.Warnungen, WarnungFeldkollision) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	i := inspektion(t, aus)
	if i.Formularfelder != 3 || i.Anhaenge < 1 {
		t.Errorf("Inspektion %+v", i)
	}
	if len(b.Verluste) != 0 {
		t.Errorf("Verluste %v", b.Verluste)
	}
	// Dieselbe Anhangdatei zweimal: der zweite Schluessel wird umbenannt.
	aus, b, _ = ausfuehren(t, korpus.MitAnhang(), Commit{Quellen: []Quelle{{Inhalt: bytes.NewReader(korpus.MitAnhang())}}})
	if !enthaelt(b.Warnungen, WarnungAnhangUmbenannt) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	if n := inspektion(t, aus).Anhaenge; n != 2*inspektion(t, korpus.MitAnhang()).Anhaenge {
		t.Errorf("%d Anhaenge nach dem Einfuegen", n)
	}
}

func TestQuellenGrenzen(t *testing.T) {
	basis := korpus.Textseiten(1)
	versuch := func(a Commit) error {
		var aus bytes.Buffer
		_, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(basis), a, &aus)
		return err
	}
	besitzer, err := korpus.MitBesitzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	if err := versuch(Commit{Quellen: []Quelle{{Inhalt: bytes.NewReader(besitzer)}}}); !errors.Is(err, ErrVerschluesselteQuelle) {
		t.Errorf("verschluesselte Quelle: %v", err)
	}
	// Seite, die es in der Quelle nicht gibt.
	if err := versuch(Commit{Quellen: []Quelle{{Inhalt: bytes.NewReader(korpus.Textseiten(2)), Seiten: []int{5}}}}); !errors.Is(err, ErrPlanUngueltig) {
		t.Errorf("Seite ausserhalb: %v", err)
	}
	// Der Plan nennt eine Seite hinter den angehaengten.
	if err := versuch(Commit{Quellen: []Quelle{{Inhalt: bytes.NewReader(korpus.Textseiten(2))}}, Plan: []Seite{{Quelle: 0}, {Quelle: 3}}}); !errors.Is(err, ErrPlanUngueltig) {
		t.Errorf("Plan ausserhalb: %v", err)
	}
	viele := make([]Quelle, HoechstQuellen+1)
	for i := range viele {
		viele[i] = Quelle{Inhalt: bytes.NewReader(basis)}
	}
	if err := versuch(Commit{Quellen: viele}); !errors.Is(err, ErrZuVieleQuellen) {
		t.Errorf("zu viele Quellen: %v", err)
	}
	// Eine Quelle mit Benutzerpasswort ist nicht lesbar.
	benutzer, err := korpus.MitBenutzerpasswort()
	if err != nil {
		t.Fatal(err)
	}
	if err := versuch(Commit{Quellen: []Quelle{{Inhalt: bytes.NewReader(benutzer)}}}); !errors.Is(err, ErrPasswort) {
		t.Errorf("Benutzerpasswort: %v", err)
	}
}

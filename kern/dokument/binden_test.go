// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

func binden(t *testing.T, jeQuelle bool, quellen ...Quelle) ([]byte, Bericht) {
	t.Helper()
	var aus bytes.Buffer
	b, err := Binden(context.Background(), quellen, jeQuelle, &aus)
	if err != nil {
		t.Fatalf("Binden: %v", err)
	}
	return aus.Bytes(), b
}

func quelle(pdf []byte, titel string, seiten ...int) Quelle {
	q := Quelle{Inhalt: bytes.NewReader(pdf), Titel: titel}
	if len(seiten) > 0 {
		q.Seiten = seiten
	}
	return q
}

func feldnamenVon(t *testing.T, pdf []byte) []string {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	var aus []string
	for _, f := range formularfelder(ctx.XRefTable, katalogVon(t, ctx)) {
		aus = append(aus, f.name)
	}
	sort.Strings(aus)
	return aus
}

// Zwei Formulare mit einem gleichnamigen Feld: pdfcpu verschmilzt sie
// nicht, sondern haengt die Felder der zweiten Quelle unter ein
// Elternfeld. Beide Felder "Name" bleiben mit eigenem Wert erhalten.
func TestBindenGleichnamigeFelderVerschmelzenNicht(t *testing.T) {
	aus, b := binden(t, false,
		quelle(korpus.FormularMitNamen("Name", "Betrag"), "Angebot"),
		quelle(korpus.FormularMitNamen("Name", "Datum"), "Auftrag"))
	if !enthaelt(b.Warnungen, WarnungFeldkollision) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
	namen := feldnamenVon(t, aus)
	if len(namen) != 4 {
		t.Fatalf("Felder %v, erwartet 4 einzelne", namen)
	}
	for i := 1; i < len(namen); i++ {
		if namen[i] == namen[i-1] {
			t.Errorf("Feldname %q doppelt", namen[i])
		}
	}
	if b.FelderVorher != 4 || b.FelderNachher != 4 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	if m := marken(t, aus); !gleich(m, []string{"SEITE-01", "SEITE-01"}) {
		t.Errorf("Seiten %v", m)
	}
}

// Ohne gleiche Namen keine Warnung.
func TestBindenVerschiedeneFelderOhneWarnung(t *testing.T) {
	_, b := binden(t, false,
		quelle(korpus.FormularMitNamen("Name"), "A"),
		quelle(korpus.FormularMitNamen("Datum"), "B"))
	if enthaelt(b.Warnungen, WarnungFeldkollision) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
}

// Zwei E-Rechnungen mit gleichnamigem Anhang: pdfcpu allein verwirft den
// zweiten still. Der Adapter benennt ihn um — beide bleiben, mit Inhalt.
func TestBindenGleichnamigeAnhaengeBleiben(t *testing.T) {
	aus, b := binden(t, false,
		quelle(korpus.MitAnhang(), "Rechnung 1"),
		quelle(korpus.MitAnhang(), "Rechnung 2"))
	if !enthaelt(b.Warnungen, WarnungAnhangUmbenannt) || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	if b.AnhaengeVorher != 4 || b.AnhaengeNachher != 4 {
		t.Errorf("Anhaenge vorher %d, nachher %d, erwartet 4/4", b.AnhaengeVorher, b.AnhaengeNachher)
	}
	if len(eingebetteterInhalt(t, aus, "rechnung.xml")) == 0 || len(eingebetteterInhalt(t, aus, "rechnung (2).xml")) == 0 {
		t.Error("eine der beiden Rechnungen fehlt")
	}
}

// Lesezeichen je Quelle: ein Eintrag je Quelle mit ihrem Titel, die
// eigenen Lesezeichen darunter.
func TestBindenLesezeichenJeQuelle(t *testing.T) {
	aus, b := binden(t, true,
		quelle(korpus.Textseiten(2), "Angebot"),
		quelle(korpus.MitLesezeichen(), "Handbuch"))
	ctx := geoeffnet(t, aus)
	var titel []string
	for _, p := range lesezeichen(ctx.XRefTable, katalogVon(t, ctx)) {
		s, _ := alsText(ctx.XRefTable, p.dict["Title"])
		titel = append(titel, s)
	}
	soll := []string{"Angebot", "Handbuch", "Deckblatt", "Kapitel 1", "Abschnitt 1.1", "Anhang"}
	if !gleich(titel, soll) {
		t.Errorf("Lesezeichen %v, erwartet %v", titel, soll)
	}
	if b.LesezeichenVorher != 4 || b.LesezeichenNachher != 6 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
}

// Ohne Lesezeichen je Quelle bleiben die Lesezeichen der Quellen, wie sie
// sind — und zeigen auf die richtigen Seiten.
func TestBindenLesezeichenBleiben(t *testing.T) {
	aus, b := binden(t, false,
		quelle(korpus.Textseiten(2), "A"),
		quelle(korpus.MitLesezeichen(), "B"))
	if b.LesezeichenNachher != 4 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
	ctx := geoeffnet(t, aus)
	seiten, _ := blaetter(ctx)
	seiteVon := map[int]int{}
	for i, s := range seiten {
		seiteVon[s.ref.ObjectNumber.Value()] = i
	}
	benannt := benannteZiele(ctx.XRefTable, katalogVon(t, ctx))
	for _, p := range lesezeichen(ctx.XRefTable, katalogVon(t, ctx)) {
		titel, _ := alsText(ctx.XRefTable, p.dict["Title"])
		if titel == "Deckblatt" {
			if s := seiteVon[aktionsZiel(ctx.XRefTable, p.dict, benannt)]; s != 2 {
				t.Errorf("Deckblatt zeigt auf Seite %d, erwartet 3", s+1)
			}
		}
	}
}

// Seitenauswahl je Quelle und Reihenfolge.
func TestBindenMitSeitenauswahl(t *testing.T) {
	aus, b := binden(t, false,
		quelle(korpus.Textseiten(3), "A", 2, 0),
		quelle(korpus.Voll(), "B", 4))
	if m := marken(t, aus); !gleich(m, []string{"SEITE-03", "SEITE-01", "SEITE-05"}) {
		t.Errorf("Seiten %v", m)
	}
	// Aus Voll bleibt nur Seite 5: keine Anmerkungen, kein Feld, die
	// eingebettete Rechnung (Katalog) bleibt, das Lesezeichen "Seite 5".
	if b.Seiten != 3 || b.FelderNachher != 0 || b.AnhaengeNachher != 1 || b.LesezeichenNachher != 1 || len(b.Verluste) != 0 {
		t.Errorf("Bericht %+v", b)
	}
}

func TestBindenSigniertWarnt(t *testing.T) {
	_, b := binden(t, false,
		quelle(korpus.MitSignaturfeld(), "Vertrag"),
		quelle(korpus.Textseiten(1), "Anlage"))
	if !enthaelt(b.Warnungen, WarnungSignierteQuelle) {
		t.Errorf("Warnungen %v", b.Warnungen)
	}
}

func TestBindenGrenzen(t *testing.T) {
	var aus bytes.Buffer
	if _, err := Binden(context.Background(), nil, false, &aus); !errors.Is(err, ErrKeineSeiten) {
		t.Errorf("ohne Quellen: %v", err)
	}
	viele := make([]Quelle, HoechstQuellen+1)
	for i := range viele {
		viele[i] = quelle(korpus.Textseiten(1), "")
	}
	if _, err := Binden(context.Background(), viele, false, &aus); !errors.Is(err, ErrZuVieleQuellen) {
		t.Errorf("zu viele Quellen: %v", err)
	}
	pw, _ := korpus.MitBenutzerpasswort()
	if _, err := Binden(context.Background(), []Quelle{quelle(korpus.Textseiten(1), ""), quelle(pw, "")}, false, &aus); !errors.Is(err, ErrPasswort) {
		t.Errorf("Quelle mit Passwort: %v", err)
	}
	besitzer, _ := korpus.MitBesitzerpasswort()
	if _, err := Binden(context.Background(), []Quelle{quelle(korpus.Textseiten(1), ""), quelle(besitzer, "")}, false, &aus); !errors.Is(err, ErrVerschluesselteQuelle) {
		t.Errorf("Quelle mit Besitzerpasswort: %v, erwartet ErrVerschluesselteQuelle", err)
	}
	if aus.Len() != 0 {
		t.Error("trotz Fehler geschrieben")
	}
}

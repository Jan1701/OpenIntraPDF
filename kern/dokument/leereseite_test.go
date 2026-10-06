// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Leere Seite im Seitenplan (Etappe 9, Vertrag Abschnitt 1): Format und
// Drehung wie verlangt, kein Inhalt, Nachbarn unveraendert; Grenzen; mit
// Anmerkungsbefehlen im selben Commit.

func leer(breite, hoehe float64, drehung int) Seite {
	return Seite{Quelle: -1, Drehung: drehung, Leer: &Leerseite{Breite: breite, Hoehe: hoehe}}
}

func TestLeereSeiteEinfuegen(t *testing.T) {
	aus, b := bauen(t, korpus.Textseiten(3), []Seite{{Quelle: 0}, leer(595, 842, 90), {Quelle: 1}, {Quelle: 2}})
	if b.Seiten != 4 {
		t.Fatalf("Bericht %+v", b)
	}
	if m := marken(t, aus); !gleich(m, []string{"SEITE-01", "", "SEITE-02", "SEITE-03"}) {
		t.Errorf("Reihenfolge %v", m)
	}
	bilder := seitenbilder(t, aus)
	if bilder[1].mediaBox != "[0 0 595 842]" || bilder[1].drehung != 90 || bilder[1].marke != "" {
		t.Errorf("leere Seite %+v", bilder[1])
	}
	if bilder[0].drehung != 0 || bilder[2].drehung != 0 {
		t.Errorf("Nachbarn gedreht: %+v %+v", bilder[0], bilder[2])
	}
	// Leerer Inhaltsstrom (wie pdfcpus EmptyPage), leere Ressourcen, Parent gesetzt.
	ctx := geoeffnet(t, aus)
	seiten, err := blaetter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if inhalt, err := ctx.PageContent(seiten[1].dict, 2); !errors.Is(err, model.ErrNoContent) && (err != nil || len(bytes.TrimSpace(inhalt)) != 0) {
		t.Errorf("Inhalt der leeren Seite: %q, %v", inhalt, err)
	}
	if _, hat := seiten[1].dict.Find("Contents"); !hat {
		t.Error("die leere Seite hat keinen (leeren) Inhaltsstrom")
	}
	if _, hat := seiten[1].dict.Find("Parent"); !hat {
		t.Error("die leere Seite hat keinen Parent")
	}
	if r := alsDict(ctx.XRefTable, seiten[1].dict["Resources"]); r == nil {
		t.Error("die leere Seite hat keine Ressourcen")
	}
	if i := inspektion(t, aus); i.Seiten != 4 || i.Anmerkungen != 0 {
		t.Errorf("Inspektion %+v", i)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Querformat ohne Drehung, am Anfang und am Ende, dazu eine Verdopplung
// der leeren Seite — jede leere Seite ist ein eigenes Objekt.
func TestLeereSeitenMehrfach(t *testing.T) {
	aus, _ := bauen(t, korpus.Textseiten(2), []Seite{leer(842, 595, 0), {Quelle: 1}, leer(300, 300, 180), leer(300, 300, 180)})
	bilder := seitenbilder(t, aus)
	if len(bilder) != 4 {
		t.Fatalf("%d Seiten", len(bilder))
	}
	if bilder[0].mediaBox != "[0 0 842 595]" || bilder[0].drehung != 0 {
		t.Errorf("erste %+v", bilder[0])
	}
	if bilder[1].marke != "SEITE-02" {
		t.Errorf("zweite %+v", bilder[1])
	}
	if bilder[2].mediaBox != "[0 0 300 300]" || bilder[2].drehung != 180 || bilder[3].mediaBox != "[0 0 300 300]" {
		t.Errorf("dritte/vierte %+v %+v", bilder[2], bilder[3])
	}
	ctx := geoeffnet(t, aus)
	seiten, _ := blaetter(ctx)
	if seiten[2].ref.ObjectNumber == seiten[3].ref.ObjectNumber {
		t.Error("zwei leere Seiten teilen sich ein Objekt")
	}
	if m := marken(t, aus); !gleich(m, []string{"", "SEITE-02", "", ""}) {
		t.Errorf("Marken %v", m)
	}
}

func TestLeereSeiteGrenzen(t *testing.T) {
	quelle := korpus.Textseiten(2)
	for name, s := range map[string]Seite{
		"Breite 0":      leer(0, 842, 0),
		"Hoehe negativ": leer(595, -1, 0),
		"zu gross":      leer(HoechstSeitenmass+1, 842, 0),
		"Drehung 45":    leer(595, 842, 45),
	} {
		var aus bytes.Buffer
		_, err := SeitenplanBauen(context.Background(), bytes.NewReader(quelle), []Seite{{Quelle: 0}, s}, &aus)
		if !errors.Is(err, ErrPlanUngueltig) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Nur leere Seiten: erlaubt (der Plan ist nicht leer), die Quellseiten entfallen.
	aus, b := bauen(t, quelle, []Seite{leer(595, 842, 0)})
	if b.Seiten != 1 || marken(t, aus)[0] != "" {
		t.Errorf("nur leere Seite: %+v %v", b, marken(t, aus))
	}
}

// Eine leere Seite stoert die Anmerkungsbefehle nicht: page zaehlt im
// Basisdokument, die Zusatzdrehung bleibt der Quellseite zugeordnet.
func TestLeereSeiteMitAnmerkungen(t *testing.T) {
	anm := &Anmerkungsbefehle{Add: []NeueAnmerkung{{ClientID: "n", Page: 1, Kind: "note", Rect: []float64{72, 500}, Contents: "hinter der leeren Seite"}}}
	aus, b, erg := commit(t, korpus.MitAnmerkungen(), anm, []Seite{{Quelle: 0}, leer(595, 842, 0), {Quelle: 1, Drehung: 90}, {Quelle: 2}})
	if len(erg.Added) != 1 || b.Seiten != 4 || b.AnmerkungenNeu != 1 {
		t.Fatalf("Ergebnis %+v Bericht %+v", erg, b)
	}
	bilder := anmerkungsbilder(t, aus)
	neu := bildVon(t, bilder, erg.Added[0].NM)
	if neu.seite != 2 {
		t.Errorf("neue Notiz auf Seite %d, erwartet 3 (hinter der leeren Seite)", neu.seite+1)
	}
	// Die leere Seite traegt keine Annots.
	ctx := geoeffnet(t, aus)
	seiten, _ := blaetter(ctx)
	if _, hat := seiten[1].dict.Find("Annots"); hat {
		t.Error("die leere Seite hat Annots")
	}
	if alsName(ctx.XRefTable, seiten[1].dict["Type"]) != "Page" {
		t.Error("Type der leeren Seite ist nicht Page")
	}
}

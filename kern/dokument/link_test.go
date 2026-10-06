// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Links (Etappe 9, Vertrag Abschnitt 4): kind link in annotations.add mit
// uri oder page_target; /Subtype /Link, /Border [0 0 0], /A URI bzw. GoTo;
// nur http, https, mailto; Loeschen mit Urheberschaft; kein Text, kein
// Status. (pdf.js liest dieselbe Probe in link.pdfjs.test.ts.)

func seiteZiel(n int) *int { return &n }

func linkBefehle() *Anmerkungsbefehle {
	return &Anmerkungsbefehle{Add: []NeueAnmerkung{
		{ClientID: "web", Page: 0, Kind: "link", Rect: []float64{72, 700, 300, 720}, URI: "https://example.org/angebot?nr=00123&x=(a)"},
		{ClientID: "post", Page: 0, Kind: "link", Rect: []float64{72, 650, 300, 670}, URI: "mailto:vertrieb@example.org"},
		{ClientID: "ziel", Page: 2, Kind: "link", Rect: []float64{72, 600, 300, 620}, PageTarget: seiteZiel(1)},
	}, Autor: "Erika Musterfrau"}
}

// linkDict liest das Woerterbuch eines Links ueber seine NM.
func linkDict(t *testing.T, pdf []byte, nm string) (types.Dict, int) {
	t.Helper()
	ctx := geoeffnet(t, pdf)
	seiten, _ := blaetter(ctx)
	for i, s := range seiten {
		for _, a := range anmerkungen(ctx.XRefTable, s.dict) {
			if n, _ := alsText(ctx.XRefTable, a.dict["NM"]); n == nm {
				return a.dict, i
			}
		}
	}
	t.Fatalf("Link %s fehlt", nm)
	return nil, 0
}

func TestLinkAnlegen(t *testing.T) {
	aus, b, erg := commit(t, korpus.Textseiten(3), linkBefehle(), nil)
	if len(erg.Added) != 3 || b.AnmerkungenNeu != 3 {
		t.Fatalf("Ergebnis %+v, Bericht %+v", erg, b)
	}
	ctx := geoeffnet(t, aus)
	x := ctx.XRefTable
	web, seite := linkDict(t, aus, erg.Added[0].NM)
	if seite != 0 || alsName(x, web["Subtype"]) != "Link" {
		t.Errorf("Web-Link: Seite %d, %v", seite, web)
	}
	if alsArray(x, web["Border"]).PDFString() != "[0 0 0]" {
		t.Errorf("Border %v", web["Border"])
	}
	if _, hat := web.Find("AP"); hat {
		t.Error("ein Link hat kein Erscheinungsbild")
	}
	if _, hat := web.Find("T"); hat {
		t.Error("ein Link traegt keinen Autor im PDF")
	}
	aktion := alsDict(x, web["A"])
	if alsName(x, aktion["S"]) != "URI" {
		t.Fatalf("Aktion %v", aktion)
	}
	if uri, _ := alsText(x, aktion["URI"]); uri != "https://example.org/angebot?nr=00123&x=(a)" {
		t.Errorf("URI %q", uri)
	}
	post, _ := linkDict(t, aus, erg.Added[1].NM)
	if uri, _ := alsText(x, alsDict(x, post["A"])["URI"]); uri != "mailto:vertrieb@example.org" {
		t.Errorf("mailto %q", uri)
	}
	ziel, seite := linkDict(t, aus, erg.Added[2].NM)
	if seite != 2 {
		t.Errorf("Zielseiten-Link auf Seite %d", seite+1)
	}
	gehe := alsDict(x, ziel["A"])
	if alsName(x, gehe["S"]) != "GoTo" {
		t.Fatalf("Aktion %v", gehe)
	}
	seiten, _ := blaetter(ctx)
	if zielSeite(x, gehe["D"], nil, 0) != seiten[1].ref.ObjectNumber.Value() || alsName(x, alsArray(x, gehe["D"])[1]) != "Fit" {
		t.Errorf("Ziel %v, erwartet Seite 2 mit Fit", gehe["D"])
	}
	if i := inspizieren(ctx); i.Links != 3 || i.Anmerkungen != 0 {
		t.Errorf("Inspektion %+v", i)
	}
	popplerOhneSyntaxfehler(t, aus)
}

// Mit Seitenplan: Der Link wandert mit seiner Seite; faellt die Zielseite
// weg, verliert er sein Ziel (link_target_removed) — wie jeder Link.
func TestLinkMitSeitenplan(t *testing.T) {
	aus, b, erg := commit(t, korpus.Textseiten(3), linkBefehle(), []Seite{{Quelle: 2}, {Quelle: 0}})
	if len(erg.Added) != 3 || b.Seiten != 2 || !enthaelt(b.Warnungen, WarnungLinkZielWeg) {
		t.Fatalf("Ergebnis %+v, Bericht %+v", erg, b)
	}
	if _, seite := linkDict(t, aus, erg.Added[2].NM); seite != 0 {
		t.Errorf("Zielseiten-Link auf Seite %d, erwartet 1", seite+1)
	}
	if _, seite := linkDict(t, aus, erg.Added[0].NM); seite != 1 {
		t.Errorf("Web-Link auf Seite %d, erwartet 2", seite+1)
	}
}

func TestLinkPruefung(t *testing.T) {
	rect := []float64{72, 700, 300, 720}
	faelle := map[string]NeueAnmerkung{
		"javascript":     {Kind: "link", Rect: rect, URI: "javascript:alert(1)"},
		"file":           {Kind: "link", Rect: rect, URI: "file:///etc/passwd"},
		"data":           {Kind: "link", Rect: rect, URI: "data:text/html,hi"},
		"relativ":        {Kind: "link", Rect: rect, URI: "/nur/pfad"},
		"ohne Host":      {Kind: "link", Rect: rect, URI: "https://"},
		"Steuerzeichen":  {Kind: "link", Rect: rect, URI: "https://example.org/\x01"},
		"zu lang":        {Kind: "link", Rect: rect, URI: "https://example.org/" + strings.Repeat("a", HoechstAdresse)},
		"beides":         {Kind: "link", Rect: rect, URI: "https://example.org", PageTarget: seiteZiel(0)},
		"nichts":         {Kind: "link", Rect: rect},
		"ohne Flaeche":   {Kind: "link", Rect: []float64{72, 700, 72, 720}, URI: "https://example.org"},
		"Seite negativ":  {Kind: "link", Rect: rect, PageTarget: seiteZiel(-1)},
		"uri bei Notiz":  {Kind: "note", Rect: []float64{72, 700}, URI: "https://example.org"},
		"Ziel bei Notiz": {Kind: "note", Rect: []float64{72, 700}, PageTarget: seiteZiel(0)},
	}
	for name, a := range faelle {
		b := &Anmerkungsbefehle{Add: []NeueAnmerkung{a}}
		if err := b.Pruefen(); !errors.Is(err, ErrAnmerkungUngueltig) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Zielseite, die es nicht gibt: erst am Dokument zu erkennen.
	err := commitFehler(t, korpus.Textseiten(2), &Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "link", Rect: rect, PageTarget: seiteZiel(5)}}})
	if !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("Zielseite ausserhalb: %v", err)
	}
	// Grossschreibung im Schema und Umlaute in der Adresse gehen (prozentkodiert).
	aus, _, erg := commit(t, korpus.Textseiten(1), &Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "link", Rect: rect, URI: "HTTPS://example.org/Küche"}}}, nil)
	d, _ := linkDict(t, aus, erg.Added[0].NM)
	if uri, _ := alsText(geoeffnet(t, aus).XRefTable, alsDict(geoeffnet(t, aus).XRefTable, d["A"])["URI"]); uri != "HTTPS://example.org/K%C3%BCche" {
		t.Errorf("URI %q", uri)
	}
}

// Loeschen und Aendern wie bei anderen OIH-Anmerkungen: mit
// Kommentarrecht nur eigene (NM in Eigene); ein fremder Link (ohne NM, aus
// dem Korpus) braucht edit; Text und Status gibt es an einem Link nicht.
func TestLinkLoeschenUndAendern(t *testing.T) {
	aus, _, erg := commit(t, korpus.MitAnmerkungen(), linkBefehle(), nil)
	eigener := erg.Added[0]
	fremder := 0
	ctx := geoeffnet(t, aus)
	seiten, _ := blaetter(ctx)
	for _, a := range anmerkungen(ctx.XRefTable, seiten[2].dict) {
		if a.art() == artLink {
			if nm, _ := alsText(ctx.XRefTable, a.dict["NM"]); nm == "" {
				fremder = a.nr()
			}
		}
	}
	if fremder == 0 {
		t.Fatal("der fremde Korpus-Link fehlt")
	}
	nurEigene := func(befehle Anmerkungsbefehle) Anmerkungsbefehle {
		befehle.NurEigene = true
		befehle.Eigene = map[string]bool{eigener.NM: true}
		return befehle
	}
	// Eigener Link mit Kommentarrecht: weg.
	nach, b, _ := commit(t, aus, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: eigener.Ref}}, NurEigene: true, Eigene: map[string]bool{eigener.NM: true}}, nil)
	if i := inspektion(t, nach); i.Links != 3 || b.AnmerkungenEntfernt != 1 {
		t.Errorf("nach dem Loeschen: %+v, Bericht %+v", i, b)
	}
	// Fremder Link mit Kommentarrecht: abgelehnt; mit edit: weg.
	if err := commitFehler(t, aus, ptr(nurEigene(Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: verweisVon(fremder)}}}))); !errors.Is(err, ErrFremdeAnmerkung) {
		t.Errorf("fremder Link mit Kommentarrecht: %v", err)
	}
	nach, _, _ = commit(t, aus, &Anmerkungsbefehle{Delete: []Anmerkungsverweis{{Ref: verweisVon(fremder)}}}, nil)
	if i := inspektion(t, nach); i.Links != 3 {
		t.Errorf("fremder Link mit edit: %+v", i)
	}
	// Text oder Status an einem Link: 422.
	if err := commitFehler(t, aus, &Anmerkungsbefehle{Update: []Anmerkungstext{{Ref: eigener.Ref, Contents: "x"}}}); !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("Text an Link: %v", err)
	}
	if err := commitFehler(t, aus, &Anmerkungsbefehle{State: []Anmerkungsstatus{{Ref: eigener.Ref, State: "completed"}}}); !errors.Is(err, ErrAnmerkungUngueltig) {
		t.Errorf("Status an Link: %v", err)
	}
	// Eine Antwort auf einen Link gibt es nicht.
	if err := commitFehler(t, aus, &Anmerkungsbefehle{Add: []NeueAnmerkung{{Kind: "note", Page: 0, Rect: []float64{1, 1}, ReplyTo: eigener.Ref}}}); err == nil {
		t.Error("Antwort auf einen Link angenommen")
	}
}

func ptr(b Anmerkungsbefehle) *Anmerkungsbefehle { return &b }

// Schreibt die Probe fuer den pdf.js-Test (link.pdfjs.test.ts): Web-Link
// und mailto auf Seite 1, Zielseiten-Link auf Seite 3 nach Seite 2.
func TestLinkProbeSchreiben(t *testing.T) {
	ziel := os.Getenv("OIH_PROBE_ZIEL")
	if ziel == "" {
		t.Skip("OIH_PROBE_ZIEL nicht gesetzt")
	}
	var aus bytes.Buffer
	if _, _, err := CommitAusfuehren(context.Background(), bytes.NewReader(korpus.Textseiten(3)), Commit{Anmerkungen: linkBefehle()}, &aus); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ziel, aus.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

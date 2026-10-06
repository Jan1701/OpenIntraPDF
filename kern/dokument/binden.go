// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Quelle ist ein Dokument beim Binden.
type Quelle struct {
	Inhalt io.ReadSeeker
	// Seiten (ab 0, in dieser Reihenfolge); nil heisst alle.
	Seiten []int
	// Titel des Lesezeichens, das die Quelle im Ergebnis bekommt, wenn
	// Lesezeichen je Quelle verlangt sind.
	Titel string
}

// Binden haengt die Quellen in dieser Reihenfolge aneinander.
//
// Mit lesezeichenJeQuelle bekommt jede Quelle ein Lesezeichen mit ihrem
// Titel, unter dem ihre eigenen Lesezeichen haengen; sonst bleiben die
// Lesezeichen der Quellen nebeneinander, wie sie sind.
//
// pdfcpu verschmilzt gleichnamige Formularfelder nicht: Ab der zweiten
// Quelle mit Formular haengt es deren Felder unter ein neues Elternfeld
// (Name = laufende Nummer), aus "Name" wird etwa "1.Name". Der Adapter
// meldet gleiche Namen als Warnung form_field_collision und prueft nach
// dem Schreiben, dass alle Felder einzeln und eindeutig benannt da sind —
// sonst ErrFormularKollision.
//
// Gleichnamige eingebettete Dateien verwirft pdfcpu beim Zusammenfuehren
// der Namensbaeume still (Namensbaum ohne Verweisliste: der zweite
// Eintrag faellt weg). Der Adapter benennt sie vorher eindeutig um
// ("rechnung.xml" -> "rechnung (2).xml"; Warnung attachment_renamed).
func Binden(c context.Context, quellen []Quelle, lesezeichenJeQuelle bool, ziel io.Writer) (Bericht, error) {
	if len(quellen) == 0 {
		return Bericht{}, ErrKeineSeiten
	}
	if len(quellen) > HoechstQuellen {
		return Bericht{}, ErrZuVieleQuellen
	}
	var b Bericht
	var erwartet Inspektion
	ctxs := make([]*model.Context, len(quellen))
	titel := make([]string, len(quellen))
	seiten := 0
	feldnamen := map[string]int{}
	anhangNamen := map[string]bool{}

	for i, q := range quellen {
		// Gelesen wird nicht im Modus MERGECREATE: Dann meldete pdfcpu jede
		// verschluesselte Datei nur als „this file is encrypted“, auch
		// eine mit Benutzerpasswort — und die soll ErrPasswort sein.
		ctx, err := lesen(c, q.Inhalt, model.LISTINFO)
		if err != nil {
			return Bericht{}, fmt.Errorf("Quelle %d: %w", i+1, err)
		}
		if ctx.Encrypt != nil {
			return Bericht{}, fmt.Errorf("Quelle %d: %w", i+1, ErrVerschluesselteQuelle)
		}
		if q.Seiten != nil {
			p := make([]Seite, len(q.Seiten))
			for j, s := range q.Seiten {
				p[j] = Seite{Quelle: s}
			}
			auszug, _, tb, err := seitenplan(c, ctx, p)
			if err != nil {
				return Bericht{}, fmt.Errorf("Quelle %d: %w", i+1, err)
			}
			b.AnmerkungenMitSeiten += tb.AnmerkungenMitSeiten
			b.FelderVorher += tb.FelderVorher
			b.FelderMitSeiten += tb.FelderMitSeiten
			b.AnhaengeVorher += tb.AnhaengeVorher
			b.AnhaengeMitSeiten += tb.AnhaengeMitSeiten
			b.LesezeichenVorher += tb.LesezeichenVorher
			b.LesezeichenMitSeiten += tb.LesezeichenMitSeiten
			for _, w := range tb.Warnungen {
				b.warnung(w)
			}
			for _, v := range tb.Verluste {
				b.verlust(v)
			}
			if ctx, err = lesen(c, bytes.NewReader(auszug), model.LISTINFO); err != nil {
				return Bericht{}, fmt.Errorf("%w: Auszug der Quelle %d: %v", ErrPruefung, i+1, err)
			}
		}
		insp := inspizieren(ctx)
		if q.Seiten == nil {
			b.FelderVorher += insp.Formularfelder
			b.AnhaengeVorher += insp.Anhaenge
			b.LesezeichenVorher += insp.Lesezeichen
		}
		seiten += insp.Seiten
		if seiten > HoechstSeiten {
			return Bericht{}, ErrZuVieleSeiten
		}
		erwartet.Seiten += insp.Seiten
		erwartet.Anmerkungen += insp.Anmerkungen
		erwartet.Formularfelder += insp.Formularfelder
		erwartet.Anhaenge += insp.Anhaenge
		erwartet.Lesezeichen += insp.Lesezeichen
		if insp.Signiert {
			b.warnung(WarnungSignierteQuelle)
		}
		if insp.JavaScript {
			b.warnung(WarnungJavaScript)
		}
		if insp.Getaggt {
			b.warnung(WarnungStruktur)
		}
		if insp.PDFA {
			b.warnung(WarnungPdfaUngeprueft)
		}

		katalog, err := ctx.Catalog()
		if err != nil {
			return Bericht{}, fmt.Errorf("%w: Quelle %d ohne Katalog", ErrUnlesbar, i+1)
		}
		gesehen := map[string]bool{}
		for _, f := range formularfelder(ctx.XRefTable, katalog) {
			if !gesehen[f.name] {
				gesehen[f.name] = true
				feldnamen[f.name]++
			}
		}
		umbenannt, err := anhaengeEindeutig(c, ctx, katalog, anhangNamen)
		if err != nil {
			return Bericht{}, err
		}
		if umbenannt > 0 {
			b.warnung(WarnungAnhangUmbenannt)
		}

		ctxs[i] = ctx
		titel[i] = strings.TrimSpace(q.Titel)
		if titel[i] == "" {
			titel[i] = fmt.Sprintf("Dokument %d", i+1)
		}
	}
	for _, n := range feldnamen {
		if n > 1 {
			b.warnung(WarnungFeldkollision)
			break
		}
	}

	ziel0 := ctxs[0]
	ziel0.Configuration.CreateBookmarks = true
	if lesezeichenJeQuelle {
		ziel0.Configuration.MergeBookmarkMode = model.MergeBookmarkModeWrap
		if err := pdfcpu.EnsureOutlines(c, ziel0, titel[0], false); err != nil {
			return Bericht{}, fmt.Errorf("%w: Lesezeichen anlegen: %v", ErrNichtUnterstuetzt, err)
		}
		erwartet.Lesezeichen += len(quellen)
	} else {
		ziel0.Configuration.MergeBookmarkMode = model.MergeBookmarkModePreserve
	}
	for i := 1; i < len(ctxs); i++ {
		if err := c.Err(); err != nil {
			return Bericht{}, err
		}
		if err := pdfcpu.MergeXRefTables(c, titel[i], ctxs[i], ziel0, false, false); err != nil {
			return Bericht{}, fmt.Errorf("%w: Quelle %d anhaengen: %v", ErrNichtUnterstuetzt, i+1, err)
		}
	}

	ergebnis, err := schreiben(c, ziel0)
	if err != nil {
		return Bericht{}, err
	}
	nachCtx, err := lesen(c, bytes.NewReader(ergebnis), model.LISTINFO)
	if err != nil {
		return Bericht{}, fmt.Errorf("%w: Ergebnis nicht wieder lesbar: %v", ErrPruefung, err)
	}
	nach := inspizieren(nachCtx)
	if nach.Seiten != erwartet.Seiten {
		return Bericht{}, fmt.Errorf("%w: %d Seiten gebunden, %d erwartet", ErrPruefung, nach.Seiten, erwartet.Seiten)
	}

	// Formularfelder: jedes Feld einzeln und eindeutig benannt da?
	nachKatalog, _ := nachCtx.Catalog()
	namen := map[string]bool{}
	for _, f := range formularfelder(nachCtx.XRefTable, nachKatalog) {
		if namen[f.name] {
			return Bericht{}, fmt.Errorf("%w: Feld %q gibt es nach dem Binden mehrfach", ErrFormularKollision, f.name)
		}
		namen[f.name] = true
	}
	if nach.Formularfelder != erwartet.Formularfelder {
		return Bericht{}, fmt.Errorf("%w: %d Felder nach dem Binden, %d erwartet", ErrFormularKollision,
			nach.Formularfelder, erwartet.Formularfelder)
	}

	b.Seiten = nach.Seiten
	b.AnmerkungenBehalten = nach.Anmerkungen
	if nach.Anmerkungen < erwartet.Anmerkungen {
		b.AnmerkungenVerloren = erwartet.Anmerkungen - nach.Anmerkungen
		b.verlust(VerlustAnmerkungen)
	}
	b.FelderNachher = nach.Formularfelder
	b.AnhaengeNachher = nach.Anhaenge
	if nach.Anhaenge < erwartet.Anhaenge {
		b.verlust(VerlustAnhaenge)
	}
	b.LesezeichenNachher = nach.Lesezeichen
	if nach.Lesezeichen < erwartet.Lesezeichen {
		b.verlust(VerlustLesezeichen)
	}
	b.leerAlsListe()
	if _, err := ziel.Write(ergebnis); err != nil {
		return Bericht{}, err
	}
	return b, nil
}

// anhaengeEindeutig benennt eingebettete Dateien um, deren Schluessel in
// einer frueheren Quelle schon vorkam, und traegt die Schluessel dieser
// Quelle in belegt ein. Liefert die Zahl der Umbenennungen.
//
// Umbenannt wird der Schluessel im Namensbaum, nicht der Dateiname in der
// Dateiangabe: Wer die Datei oeffnet, sieht weiter ihren Namen.
func anhaengeEindeutig(c context.Context, ctx *model.Context, katalog types.Dict, belegt map[string]bool) (int, error) {
	eintraege := namensbaum(ctx.XRefTable, namensbaumVon(ctx.XRefTable, katalog, "EmbeddedFiles"))
	umbenannt := 0
	for i, e := range eintraege {
		if !belegt[e.schluessel] {
			belegt[e.schluessel] = true
			continue
		}
		endung := path.Ext(e.schluessel)
		stamm := strings.TrimSuffix(e.schluessel, endung)
		for n := 2; ; n++ {
			kandidat := fmt.Sprintf("%s (%d)%s", stamm, n, endung)
			if !belegt[kandidat] {
				eintraege[i].schluessel = kandidat
				belegt[kandidat] = true
				break
			}
		}
		umbenannt++
	}
	if umbenannt == 0 {
		return 0, nil
	}
	return umbenannt, namensbaumSetzen(c, ctx, "EmbeddedFiles", eintraege)
}

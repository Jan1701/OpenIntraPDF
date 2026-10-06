// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Commit ist der ganze Auftrag eines Commits (Etappe 9 fasst zusammen,
// was Etappe 2 und 8 als einzelne Parameter trugen). Jeder Teil darf
// fehlen; was fehlt, bleibt, wie es ist.
type Commit struct {
	Anmerkungen   *Anmerkungsbefehle
	Plan          []Seite
	Eigenschaften *Eigenschaften
	// Quellen (Etappe 9, Vertrag Abschnitt 2): fremde Dokumente, deren
	// Seiten VOR allem anderen hinten an die Basis gehaengt werden — ueber
	// denselben Weg wie Binden (MergeXRefTables). Der Plan nennt sie dann
	// ab PageCount der Basis, in der Reihenfolge der Quellen und ihrer
	// Seitenlisten; Anmerkungsbefehle zaehlen weiter im Basisdokument.
	Quellen []Quelle
	// Passwort (Etappe 9, Abschnitt 3) oeffnet eine Basis mit
	// Benutzerpasswort; Besitzerpasswort ist das Rechte-Kennwort, das die
	// Rechte-Bits der Datei aufhebt (leer: das Passwort gilt als beides).
	// Beide gehen nur in die pdfcpu-Konfiguration dieses Aufrufs.
	Passwort         string
	Besitzerpasswort string
	// Entschluesseln schreibt das Ergebnis ohne Schutz (Kennwort entfernen).
	Entschluesseln bool
}

// passwortGegeben sagt, ob der Auftrag ein Kennwort traegt.
func (a Commit) passwortGegeben() bool { return a.Passwort != "" || a.Besitzerpasswort != "" }

// CommitAusfuehren baut einen Commit: Quellen anhaengen, Anmerkungsbefehle,
// Eigenschaften, Seitenplan — alles am selben geoeffneten Dokument, damit
// eine Anmerkung mit ihrer Seite wandert (page ist der Index im
// Basisdokument). Plan nil heisst: die Seiten bleiben, wie sie sind
// (angehaengte Quellen stuenden dann hinten).
//
// Nach dem Schreiben wird das Ergebnis wieder geoeffnet: Jede vorher
// vorhandene Anmerkung, die nicht geloescht wurde und deren Seite bleibt,
// muss noch da sein, jede neue ebenso, keine geloeschte — sonst ErrPruefung.
func CommitAusfuehren(c context.Context, quelle io.ReadSeeker, a Commit, ziel io.Writer) (Bericht, Anmerkungsergebnis, error) {
	if err := a.Eigenschaften.Pruefen(); err != nil {
		return Bericht{}, Anmerkungsergebnis{}, err
	}
	if len(a.Quellen) > HoechstQuellen {
		return Bericht{}, Anmerkungsergebnis{}, ErrZuVieleQuellen
	}
	// Der Lesemodus: COLLECT wie bisher; mit Passwort LISTINFO, weil pdfcpu
	// sonst fuer COLLECT das Kopierrecht der Datei verlangt — ob der Vorgang
	// erlaubt ist, entscheidet rechteFehlen; DECRYPT laesst den Schreiber den
	// Schutz weglassen.
	cmd := model.COLLECT
	if a.passwortGegeben() {
		cmd = model.LISTINFO
	}
	if a.Entschluesseln {
		cmd = model.DECRYPT
	}
	ctx, err := lesenMit(c, quelle, mitPasswort(cmd, a.Passwort, a.Besitzerpasswort))
	if err != nil {
		return Bericht{}, Anmerkungsergebnis{}, err
	}
	if ctx.Encrypt != nil && ctx.E != nil {
		// Rechte-Bits einer geschuetzten Datei: Ohne gueltiges Rechte-Kennwort
		// gilt, was die Datei erlaubt (Vertrag: 422 pdf.permission_restricted).
		besitzerOK, err := besitzerErkannt(c, quelle, a.Passwort, a.Besitzerpasswort)
		if err != nil {
			return Bericht{}, Anmerkungsergebnis{}, err
		}
		if !besitzerOK {
			if fehlt := rechteFehlen(ctx.E.P, a); len(fehlt) > 0 {
				return Bericht{}, Anmerkungsergebnis{}, &Rechtefehler{Fehlend: fehlt}
			}
		}
	} else if a.Entschluesseln {
		return Bericht{}, Anmerkungsergebnis{}, ErrNichtVerschluesselt
	}
	var warnungen []string
	if len(a.Quellen) > 0 {
		if warnungen, err = quellenAnhaengen(c, ctx, a.Quellen); err != nil {
			return Bericht{}, Anmerkungsergebnis{}, err
		}
	}
	erg := Anmerkungsergebnis{Added: []AnmerkungHinzugefuegt{}}
	if a.Anmerkungen == nil {
		// Auch ohne Befehle zaehlt der Bericht, was an Anmerkungen da war
		// und blieb.
		seiten, err := blaetter(ctx)
		if err != nil {
			return Bericht{}, Anmerkungsergebnis{}, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		erg.vorher = anmerkungsbestand(ctx.XRefTable, seiten)
	} else {
		befehle := *a.Anmerkungen
		befehle.Zusatzdrehung = map[int]int{}
		for _, p := range a.Plan {
			// Bei Verdopplung zaehlt die erste Instanz; eine leere Seite hat keine Quelle.
			if _, schon := befehle.Zusatzdrehung[p.Quelle]; !schon && !p.leer() {
				befehle.Zusatzdrehung[p.Quelle] = p.Drehung
			}
		}
		if erg, err = AnmerkungenAnwenden(c, ctx, befehle); err != nil {
			return Bericht{}, Anmerkungsergebnis{}, err
		}
	}
	eig := a.Eigenschaften
	if !eig.Leer() {
		if err := EigenschaftenAnwenden(ctx, *eig); err != nil {
			return Bericht{}, Anmerkungsergebnis{}, err
		}
	}
	plan := a.Plan
	if plan == nil {
		plan = make([]Seite, ctx.PageCount)
		for i := range plan {
			plan[i] = Seite{Quelle: i}
		}
	}
	ergebnis, nachCtx, bericht, err := seitenplan(c, ctx, plan)
	if err != nil {
		return Bericht{}, Anmerkungsergebnis{}, err
	}
	if err := anmerkungenPruefen(nachCtx, plan, erg, &bericht); err != nil {
		return Bericht{}, Anmerkungsergebnis{}, err
	}
	if !eig.Leer() {
		if err := eigenschaftenPruefen(nachCtx, *eig); err != nil {
			return Bericht{}, Anmerkungsergebnis{}, err
		}
	}
	if len(a.Quellen) > 0 {
		if err := felderEindeutig(nachCtx); err != nil {
			return Bericht{}, Anmerkungsergebnis{}, err
		}
	}
	for _, w := range warnungen {
		bericht.warnung(w)
	}
	for _, w := range erg.warnungen {
		bericht.warnung(w)
	}
	if _, err := ziel.Write(ergebnis); err != nil {
		return Bericht{}, Anmerkungsergebnis{}, err
	}
	return bericht, erg, nil
}

// quellenAnhaengen haengt die Seiten der Quellen hinten an das geoeffnete
// Dokument — wie Binden, nur in eine bestehende Basis: verschluesselte
// Quellen gehen nicht (ErrVerschluesselteQuelle), eine Seitenliste wird
// vorher als Auszug gebaut, gleichnamige Anhaenge werden eindeutig
// umbenannt, gleiche Feldnamen gemeldet (pdfcpu haengt sie unter ein
// Elternfeld, felderEindeutig prueft das Ergebnis). Liefert die Warnungen
// fuer den Bericht.
func quellenAnhaengen(c context.Context, ctx *model.Context, quellen []Quelle) ([]string, error) {
	katalog, err := ctx.Catalog()
	if err != nil || katalog == nil {
		return nil, fmt.Errorf("%w: Katalog fehlt", ErrNichtUnterstuetzt)
	}
	var warnungen []string
	warnung := func(code string) {
		for _, w := range warnungen {
			if w == code {
				return
			}
		}
		warnungen = append(warnungen, code)
	}
	feldnamen := map[string]bool{}
	for _, f := range formularfelder(ctx.XRefTable, katalog) {
		feldnamen[f.name] = true
	}
	anhangNamen := map[string]bool{}
	for _, e := range namensbaum(ctx.XRefTable, namensbaumVon(ctx.XRefTable, katalog, "EmbeddedFiles")) {
		anhangNamen[e.schluessel] = true
	}
	// Lesezeichen der Quellen bleiben, wie sie sind (kein Umschlag je Quelle).
	ctx.Configuration.CreateBookmarks = true
	ctx.Configuration.MergeBookmarkMode = model.MergeBookmarkModePreserve
	seiten := ctx.PageCount
	for i, q := range quellen {
		if err := c.Err(); err != nil {
			return nil, err
		}
		src, err := lesen(c, q.Inhalt, model.LISTINFO)
		if err != nil {
			return nil, fmt.Errorf("Quelle %d: %w", i+1, err)
		}
		if src.Encrypt != nil {
			return nil, fmt.Errorf("Quelle %d: %w", i+1, ErrVerschluesselteQuelle)
		}
		if q.Seiten != nil {
			p := make([]Seite, len(q.Seiten))
			for j, s := range q.Seiten {
				p[j] = Seite{Quelle: s}
			}
			auszug, _, _, err := seitenplan(c, src, p)
			if err != nil {
				return nil, fmt.Errorf("Quelle %d: %w", i+1, err)
			}
			if src, err = lesen(c, bytes.NewReader(auszug), model.LISTINFO); err != nil {
				return nil, fmt.Errorf("%w: Auszug der Quelle %d: %v", ErrPruefung, i+1, err)
			}
		}
		insp := inspizieren(src)
		seiten += insp.Seiten
		if seiten > HoechstSeiten {
			return nil, ErrZuVieleSeiten
		}
		if insp.Signiert {
			warnung(WarnungSignierteQuelle)
		}
		if insp.JavaScript {
			warnung(WarnungJavaScript)
		}
		if insp.Getaggt {
			warnung(WarnungStruktur)
		}
		srcKatalog, err := src.Catalog()
		if err != nil {
			return nil, fmt.Errorf("%w: Quelle %d ohne Katalog", ErrUnlesbar, i+1)
		}
		for _, f := range formularfelder(src.XRefTable, srcKatalog) {
			if feldnamen[f.name] {
				warnung(WarnungFeldkollision)
			}
			feldnamen[f.name] = true
		}
		umbenannt, err := anhaengeEindeutig(c, src, srcKatalog, anhangNamen)
		if err != nil {
			return nil, err
		}
		if umbenannt > 0 {
			warnung(WarnungAnhangUmbenannt)
		}
		if err := pdfcpu.MergeXRefTables(c, q.Titel, src, ctx, false, false); err != nil {
			return nil, fmt.Errorf("%w: Quelle %d anhaengen: %v", ErrNichtUnterstuetzt, i+1, err)
		}
	}
	if ctx.PageCount != seiten {
		return nil, fmt.Errorf("%w: %d Seiten nach dem Anhaengen, %d erwartet", ErrPruefung, ctx.PageCount, seiten)
	}
	return warnungen, nil
}

// felderEindeutig prueft im wieder geoeffneten Ergebnis, dass jedes
// Formularfeld einzeln und eindeutig benannt da ist — sonst
// ErrFormularKollision (wie beim Binden).
func felderEindeutig(nachCtx *model.Context) error {
	katalog, err := nachCtx.Catalog()
	if err != nil || katalog == nil {
		return nil
	}
	namen := map[string]bool{}
	for _, f := range formularfelder(nachCtx.XRefTable, katalog) {
		if namen[f.name] {
			return fmt.Errorf("%w: Feld %q gibt es nach dem Einfuegen mehrfach", ErrFormularKollision, f.name)
		}
		namen[f.name] = true
	}
	return nil
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Druckfassung (Etappe 8) schreibt die genannten Seiten (ab 0, in dieser
// Reihenfolge; leer heisst alle) als eigenes Dokument zum Drucken — mit
// pdfcpus ExtractPages, dem Kern von Trim und Collect. Ohne anmerkungen
// bleiben nur die Widgets (Formularfelder) auf den Seiten; alles andere
// (Notizen, Markierungen, Stempel, Popups, Links) wird weggelassen, nicht
// abgeflacht. Gespeichert wird nichts, es gibt keinen Bericht: Das
// Ergebnis ist eine Kopie fuer den Drucker, nicht fuer die Ablage.
//
// Geschuetzte Quelle (#247): passwort oeffnet eine Datei mit Oeffnen-
// Kennwort, besitzer ist das Rechte-Kennwort (leer: passwort gilt als
// beides). Verbieten die Rechte-Bits das Drucken und fehlt ein gueltiges
// Rechte-Kennwort, gibt es Rechtefehler{"print"}. Sonst behaelt die Kopie
// den Schutz der Quelle: AES-256 (R6), ohne Oeffnen-Kennwort, mit einem
// Rechte-Kennwort aus crypto/rand, das niemand kennt, und denselben
// Rechte-Bits — Kopieren und Aendern bleiben gesperrt, Drucken geht.
func Druckfassung(c context.Context, quelle io.ReadSeeker, seiten []int, anmerkungen bool, passwort, besitzer string, ziel io.Writer) error {
	// Mit Kennwort LISTINFO statt COLLECT: pdfcpu verlangte sonst das
	// Kopierrecht der Datei — hier zaehlt das Druckrecht (wie commit.go).
	cmd := model.COLLECT
	if passwort != "" || besitzer != "" {
		cmd = model.LISTINFO
	}
	ctx, err := lesenMit(c, quelle, mitPasswort(cmd, passwort, besitzer))
	if err != nil {
		return err
	}
	var schutz *model.Configuration
	if ctx.Encrypt != nil && ctx.E != nil {
		besitzerOK, err := besitzerErkannt(c, quelle, passwort, besitzer)
		if err != nil {
			return err
		}
		if !besitzerOK && !RechteVon(ctx.E.P).Drucken {
			return &Rechtefehler{Fehlend: []string{"print"}}
		}
		schutz = schutzKonfiguration(Schutz{Besitzerpasswort: zufallskennwort()})
		schutz.Permissions = model.PermissionFlags(ctx.E.P)
	}
	if len(seiten) == 0 {
		seiten = make([]int, ctx.PageCount)
		for i := range seiten {
			seiten[i] = i
		}
	}
	if len(seiten) > HoechstSeiten {
		return ErrZuVieleSeiten
	}
	nummern := make([]int, len(seiten))
	for i, s := range seiten {
		if s < 0 || s >= ctx.PageCount {
			return fmt.Errorf("%w: Seite %d, das Dokument hat %d", ErrPlanUngueltig, s, ctx.PageCount)
		}
		nummern[i] = s + 1
	}
	if !anmerkungen {
		blaetter, err := blaetter(ctx)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
		}
		for _, b := range blaetter {
			nurWidgets(ctx.XRefTable, b.dict)
		}
	}
	if err := c.Err(); err != nil {
		return err
	}
	aus, err := pdfcpu.ExtractPages(c, ctx, nummern, false)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	ergebnis, err := schreiben(c, aus)
	if err != nil {
		return err
	}
	if schutz != nil {
		// Der Auszug ist ein neuer Kontext ohne Encrypt (und ohne Lesestand,
		// den pdfcpu beim verschluesselten Schreiben braucht): den Schutz
		// bekommt er auf demselben Weg wie Verschluesseln — noch einmal im
		// Modus ENCRYPT lesen, dann schreiben.
		kopie, err := lesenMit(c, bytes.NewReader(ergebnis), schutz)
		if err != nil {
			return fmt.Errorf("%w: Druckfassung schuetzen: %v", ErrPruefung, err)
		}
		alsPDF20(kopie)
		if ergebnis, err = schreiben(c, kopie); err != nil {
			return err
		}
	}
	_, err = ziel.Write(ergebnis)
	return err
}

// nurWidgets laesst von /Annots einer Seite nur die Widgets stehen.
func nurWidgets(x *model.XRefTable, seite types.Dict) {
	alt, da := seite.Find("Annots")
	if !da {
		return
	}
	var behalten types.Array
	for _, o := range alsArray(x, alt) {
		d := alsDict(x, o)
		if d != nil && alsName(x, d["Subtype"]) == "Widget" {
			behalten = append(behalten, o)
		}
	}
	if len(behalten) == 0 {
		delete(seite, "Annots")
		return
	}
	seite["Annots"] = behalten
}

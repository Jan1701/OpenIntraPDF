// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/export"
)

// Fehler ist, was eine Bindung der Oberflaeche zurueckgibt, wenn etwas
// nicht geht — in derselben Form, die der Arbeitsplatz vom Server kennt
// (PdfHostFehler: Status, Code, Params). Wails reicht von einem error nur
// den Text durch; deshalb steht die Form als JSON im Text, und der
// Desktop-Gastgeber (DesktopHost.ts) liest sie wieder heraus.
//
// Die Codes sind die des Servers (pdf.version_conflict, pdf.no_pages …),
// damit die Oberflaeche dieselben Saetze zeigt wie in OIH.
type Fehler struct {
	Status int            `json:"status"`
	Code   string         `json:"code"`
	Params map[string]any `json:"params,omitempty"`
}

func (f *Fehler) Error() string {
	roh, err := json.Marshal(f)
	if err != nil {
		return `{"status":500,"code":"error.internal"}`
	}
	return string(roh)
}

// fehler baut einen Fehler mit Status und Code.
func fehler(status int, code string, params map[string]any) error {
	return &Fehler{Status: status, Code: code, Params: params}
}

// konflikt ist der 412 des Servers: Die Datei hat inzwischen einen anderen
// Stand.
func konflikt(aktuell int) error {
	return fehler(http.StatusPreconditionFailed, "pdf.version_conflict", map[string]any{"current_version": aktuell})
}

// nichtGefunden: unbekannte Kennung — dieselbe Antwort wie Drive fuer
// eine Datei, die es nicht gibt oder die man nicht sehen darf.
func nichtGefunden() error { return fehler(http.StatusNotFound, "drive.not_found", nil) }

// ungueltig: ein Rumpf, der nicht zum Vertrag passt.
func ungueltig(detail string) error {
	return fehler(http.StatusBadRequest, "error.invalid_body", map[string]any{"detail": detail})
}

// intern: unsere Seite (Platte, Programmfehler). Der Grund geht ins
// Protokoll des Aufrufers, nicht in die Oberflaeche.
func intern(err error) error {
	if err == nil {
		return nil
	}
	var f *Fehler
	if errors.As(err, &f) {
		return f
	}
	return fehler(http.StatusInternalServerError, "error.internal", map[string]any{"detail": err.Error()})
}

// kernFehler uebersetzt die Fehler des Adapters wie drive.pdfFehler — mit
// denselben Codes, damit die Oberflaeche dieselben Saetze zeigt.
func kernFehler(err error) error {
	if err == nil {
		return nil
	}
	var af *dokument.Anmerkungsfehler
	if !errors.As(err, &af) {
		af = &dokument.Anmerkungsfehler{}
	}
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return fehler(http.StatusRequestTimeout, "error.cancelled", nil)
	case errors.Is(err, dokument.ErrZuVieleBefehle):
		return fehler(http.StatusRequestEntityTooLarge, "pdf.too_many_operations",
			map[string]any{"max_operations": dokument.HoechstBefehle, "max_chars": dokument.HoechstZeichen, "max_points": dokument.HoechstPunkte})
	case errors.Is(err, dokument.ErrAnmerkungHatAntworten):
		return fehler(http.StatusUnprocessableEntity, "pdf.annotation_has_replies", map[string]any{"ref": af.Ref, "replies": af.Antworten})
	case errors.Is(err, dokument.ErrFremdeAnmerkung):
		return fehler(http.StatusForbidden, "auth.permission_denied", map[string]any{"required": "edit", "ref": af.Ref})
	case errors.Is(err, dokument.ErrAnmerkungUngueltig):
		return fehler(http.StatusUnprocessableEntity, "pdf.invalid_annotation", map[string]any{"ref": af.Ref, "detail": af.Detail})
	case errors.Is(err, dokument.ErrEigenschaftUngueltig):
		var ef *dokument.Eigenschaftsfehler
		if !errors.As(err, &ef) {
			ef = &dokument.Eigenschaftsfehler{}
		}
		return fehler(http.StatusUnprocessableEntity, "pdf.invalid_properties",
			map[string]any{"field": ef.Feld, "detail": ef.Detail, "max_chars": dokument.HoechstEigenschaftZeichen})
	case errors.Is(err, dokument.ErrRechteEingeschraenkt):
		// Die Rechte-Bits der Datei verbieten den Vorgang (Etappe 9).
		var rf *dokument.Rechtefehler
		fehlend := []string{}
		if errors.As(err, &rf) {
			fehlend = rf.Fehlend
		}
		return fehler(http.StatusUnprocessableEntity, "pdf.permission_restricted", map[string]any{"restricted": fehlend})
	case errors.Is(err, dokument.ErrPasswortFalsch):
		return fehler(http.StatusUnprocessableEntity, "pdf.wrong_password", nil)
	case errors.Is(err, dokument.ErrNichtVerschluesselt):
		return fehler(http.StatusUnprocessableEntity, "pdf.unsupported", map[string]any{"reason": "not_encrypted"})
	case errors.Is(err, dokument.ErrPasswort):
		return fehler(http.StatusUnprocessableEntity, "pdf.requires_password", nil)
	case errors.Is(err, dokument.ErrKeinPDF):
		return fehler(http.StatusUnprocessableEntity, "pdf.not_pdf", nil)
	case errors.Is(err, dokument.ErrUnlesbar):
		return fehler(http.StatusUnprocessableEntity, "pdf.unreadable", nil)
	case errors.Is(err, dokument.ErrZuGross):
		return fehler(http.StatusRequestEntityTooLarge, "pdf.too_large", map[string]any{"max": dokument.HoechstBytes})
	case errors.Is(err, dokument.ErrZuVieleSeiten):
		return fehler(http.StatusRequestEntityTooLarge, "pdf.too_many_pages", map[string]any{"max": dokument.HoechstSeiten})
	case errors.Is(err, dokument.ErrZuVieleQuellen):
		return fehler(http.StatusRequestEntityTooLarge, "pdf.too_many_sources", map[string]any{"max": dokument.HoechstQuellen})
	case errors.Is(err, dokument.ErrKeineSeiten):
		return fehler(http.StatusUnprocessableEntity, "pdf.no_pages", nil)
	case errors.Is(err, dokument.ErrPlanUngueltig):
		return fehler(http.StatusUnprocessableEntity, "pdf.invalid_plan", nil)
	case errors.Is(err, dokument.ErrFormularKollision):
		return fehler(http.StatusUnprocessableEntity, "pdf.form_collision", nil)
	case errors.Is(err, dokument.ErrVerschluesselteQuelle):
		return fehler(http.StatusUnprocessableEntity, "pdf.unsupported", map[string]any{"reason": "encrypted_source"})
	case errors.Is(err, dokument.ErrNichtUnterstuetzt):
		return fehler(http.StatusUnprocessableEntity, "pdf.unsupported", nil)
	case errors.Is(err, export.ErrTabelleFehlt):
		return fehler(http.StatusUnprocessableEntity, "pdf.table_not_found", nil)
	case errors.Is(err, export.ErrZuGross):
		return fehler(http.StatusRequestEntityTooLarge, "pdf.export_too_large",
			map[string]any{"max_pages": export.HoechstSeiten, "max_cells": export.HoechstZellen})
	case errors.Is(err, export.ErrOptionUngueltig):
		return ungueltig(err.Error())
	}
	return intern(err)
}

// verlustePruefen: Verliert das Ergebnis etwas, obwohl die Seiten
// bleiben, wird nicht still gespeichert (422 pdf.preservation_failed),
// ausser der Rumpf nimmt genau diese Klassen in Kauf — wie im Server.
func verlustePruefen(b dokument.Bericht, hinnehmen []string) error {
	rest := b.NichtHingenommen(hinnehmen)
	if len(rest) == 0 {
		return nil
	}
	return fehler(http.StatusUnprocessableEntity, "pdf.preservation_failed", map[string]any{"losses": rest, "report": b})
}

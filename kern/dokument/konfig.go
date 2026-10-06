// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Grenzen laut Vertrag Etappe 1 (GET /api/pdf/capabilities).
const (
	// HoechstBytes ist die groesste Datei, die der Adapter annimmt: 100 MiB.
	HoechstBytes = 100 << 20
	// HoechstSeiten gilt fuer Quelle und Ergebnis.
	HoechstSeiten = 2000
	// HoechstQuellen ist die groesste Zahl Dokumente beim Binden.
	HoechstQuellen = 20
)

// EngineName und EngineVersion stehen in der Faehigkeitsauskunft. Die
// Fassung muss zu source/go.mod passen; TestEngineFassungPasstZuGoMod
// prueft das.
const (
	EngineName    = "pdfcpu"
	EngineVersion = "v0.16.0"
)

// Fehler des Adapters. Der Gastgeber uebersetzt sie in seine Antworten
// (Drive: pdf.* Fehlerschluessel).
var (
	// ErrKeinPDF: Die Datei faengt nicht wie ein PDF an.
	ErrKeinPDF = errors.New("dokument: kein PDF")
	// ErrUnlesbar: pdfcpu kann die Datei nicht oeffnen.
	ErrUnlesbar = errors.New("dokument: PDF nicht lesbar")
	// ErrPasswort: Die Datei ist mit einem Benutzerpasswort verschluesselt.
	ErrPasswort = errors.New("dokument: Passwort noetig")
	// ErrZuGross: groesser als HoechstBytes.
	ErrZuGross = errors.New("dokument: Datei zu gross")
	// ErrZuVieleSeiten: mehr als HoechstSeiten in Quelle oder Ergebnis.
	ErrZuVieleSeiten = errors.New("dokument: zu viele Seiten")
	// ErrZuVieleQuellen: mehr als HoechstQuellen beim Binden.
	ErrZuVieleQuellen = errors.New("dokument: zu viele Quellen")
	// ErrKeineSeiten: Der Plan ist leer.
	ErrKeineSeiten = errors.New("dokument: keine Seiten")
	// ErrPlanUngueltig: Eine Seite gibt es nicht oder die Drehung ist
	// kein Vielfaches von 90 Grad.
	ErrPlanUngueltig = errors.New("dokument: Seitenplan ungueltig")
	// ErrFormularKollision: Beim Binden sind gleichnamige Formularfelder
	// verschmolzen oder nicht mehr eindeutig.
	ErrFormularKollision = errors.New("dokument: Formularfelder kollidieren")
	// ErrNichtUnterstuetzt: pdfcpu kann das Ergebnis nicht schreiben.
	ErrNichtUnterstuetzt = errors.New("dokument: Vorgang fuer dieses PDF nicht unterstuetzt")
	// ErrVerschluesselteQuelle: Beim Binden ist eine Quelle verschluesselt
	// (auch nur mit Besitzerpasswort). pdfcpu bindet keine
	// verschluesselten Dateien, und sie dafuer zu entschluesseln hiesse,
	// die Rechte des Besitzers zu umgehen (Konzept Kap. 04: „keine
	// Umgehung per Parser-Flag“).
	ErrVerschluesselteQuelle = fmt.Errorf("%w: verschluesselte Quelle", ErrNichtUnterstuetzt)
	// ErrPruefung: Das geschriebene Ergebnis hielt der Nachpruefung nicht
	// stand (falsche Seitenzahl, nicht wieder lesbar). Ein Programmfehler
	// oder eine pdfcpu-Grenze — nie still weiterreichen.
	ErrPruefung = errors.New("dokument: Ergebnis hielt der Pruefung nicht stand")
	// ErrPasswortFalsch (Etappe 9): Ein mitgegebenes Passwort passt nicht —
	// weder als Oeffnen- noch als Rechte-Kennwort.
	ErrPasswortFalsch = errors.New("dokument: Passwort falsch")
	// ErrNichtVerschluesselt (Etappe 9): Entschluesseln verlangt, aber die
	// Datei traegt keinen Schutz.
	ErrNichtVerschluesselt = errors.New("dokument: Datei nicht verschluesselt")
	// ErrRechteEingeschraenkt (Etappe 9): Die Datei verbietet den Vorgang
	// ueber ihre Rechte-Bits, und das Rechte-Kennwort fehlt.
	ErrRechteEingeschraenkt = errors.New("dokument: Rechte der Datei verbieten den Vorgang")
)

var ohneKonfigurationsordner sync.Once

// konfiguration baut eine zustandslose pdfcpu-Konfiguration fuer cmd.
//
// Zustandslos heisst: pdfcpu liest und schreibt keinen Konfigurationsordner
// unter ~/.config — der Dienst laeuft als eigener Benutzer ohne
// beschreibbares Heimverzeichnis, und ein Adapter hat dort nichts zu
// suchen. DisableConfigDir faengt die Stellen in pdfcpu, die ohne
// uebergebene Konfiguration auf die Vorgabe zurueckfallen.
func konfiguration(cmd model.CommandMode) *model.Configuration {
	ohneKonfigurationsordner.Do(api.DisableConfigDir)
	k := model.NewStatelessConfiguration()
	k.Cmd = cmd
	// Kein Netz: Die Zertifikatspruefung (CRL/OCSP) ginge sonst nach draussen.
	k.Offline = true
	k.ValidateLinks = false
	k.Limits.MaxInputBytes = HoechstBytes
	// Ein bearbeitetes Dokument soll aussehen wie das alte: keine
	// Zusammenlegung von Schriften oder Ressourcen, die wir nicht bestellt
	// haben.
	k.Optimize = false
	k.OptimizeBeforeWriting = false
	k.OptimizeResourceDicts = false
	return k
}

// groesse ermittelt die Laenge und spult zurueck.
func groesse(r io.ReadSeeker) (int64, error) {
	n, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, err
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return 0, err
	}
	return n, nil
}

// kopfPruefen sieht nach, ob die Datei wie ein PDF anfaengt. Die Norm
// erlaubt Muell vor dem Kopf; gesucht wird in den ersten 1024 Byte, wie
// es die gaengigen Leser tun.
func kopfPruefen(r io.ReadSeeker) error {
	kopf := make([]byte, 1024)
	n, err := io.ReadFull(r, kopf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return err
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if !bytes.Contains(kopf[:n], []byte("%PDF-")) {
		return ErrKeinPDF
	}
	return nil
}

// lesen oeffnet ein PDF mit pdfcpu und uebersetzt die Fehler.
func lesen(c context.Context, r io.ReadSeeker, cmd model.CommandMode) (*model.Context, error) {
	return lesenMit(c, r, konfiguration(cmd))
}

// lesenMit ist lesen mit einer vorbereiteten Konfiguration — fuer Passwoerter
// (Etappe 9). Ein falsches mitgegebenes Passwort ist ErrPasswortFalsch, ein
// fehlendes ErrPasswort; die Befehle ENCRYPT, DECRYPT und SETPERMISSIONS
// melden ueber pdfcpu, wenn die Datei (nicht) verschluesselt ist.
func lesenMit(c context.Context, r io.ReadSeeker, konf *model.Configuration) (*model.Context, error) {
	if r == nil {
		return nil, ErrUnlesbar
	}
	n, err := groesse(r)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnlesbar, err)
	}
	if n > HoechstBytes {
		return nil, ErrZuGross
	}
	if err := kopfPruefen(r); err != nil {
		return nil, err
	}
	mitPasswort := konf.UserPW != "" || konf.OwnerPW != ""
	ctx, err := api.ReadAndValidate(c, r, konf)
	switch {
	case err == nil:
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return nil, err
	case errors.Is(err, pdfcpu.ErrWrongPassword) && mitPasswort, errors.Is(err, pdfcpu.ErrOwnerPasswordRequired):
		return nil, ErrPasswortFalsch
	case errors.Is(err, pdfcpu.ErrWrongPassword):
		return nil, ErrPasswort
	case errors.Is(err, pdfcpu.ErrEncrypted):
		return nil, ErrVerschluesselteQuelle
	case errors.Is(err, pdfcpu.ErrNotEncrypted):
		return nil, ErrNichtVerschluesselt
	case errors.Is(err, pdfcpu.ErrPermissionDenied):
		return nil, ErrRechteEingeschraenkt
	case errors.Is(err, model.ErrInputSizeLimit):
		return nil, ErrZuGross
	default:
		return nil, fmt.Errorf("%w: %v", ErrUnlesbar, err)
	}
	if ctx.PageCount > HoechstSeiten {
		return nil, ErrZuVieleSeiten
	}
	return ctx, nil
}

// schreiben schreibt den Kontext in einen Puffer.
func schreiben(c context.Context, ctx *model.Context) ([]byte, error) {
	var aus bytes.Buffer
	if err := api.WriteContext(c, ctx, &aus); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %v", ErrNichtUnterstuetzt, err)
	}
	if aus.Len() > HoechstBytes {
		return nil, ErrZuGross
	}
	return aus.Bytes(), nil
}

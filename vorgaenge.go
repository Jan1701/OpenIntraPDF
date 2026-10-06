// SPDX-License-Identifier: Apache-2.0

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// Idempotenz wie pdf_commits im Server, nur im Speicher je Sitzung
// (Vertrag Etappe 6): Die Oberflaeche schickt zu jedem Schreibbefehl einen
// Schluessel und wiederholt ihn nach einem Fehlschlag mit demselben Rumpf.
// Gleicher Schluessel + gleicher Rumpf -> das gespeicherte Ergebnis;
// anderer Rumpf -> 409 pdf.idempotency_mismatch; noch unterwegs -> 409
// pdf.idempotency_in_progress.

type vorgang struct {
	hash    string
	fertig  bool
	antwort json.RawMessage
}

// Vorgaenge merkt sich die Schluessel dieser Sitzung.
type Vorgaenge struct {
	mu    sync.Mutex
	liste map[string]*vorgang
}

func neueVorgaenge() *Vorgaenge { return &Vorgaenge{liste: map[string]*vorgang{}} }

// anfrageHash: SHA-256 ueber Route, Datei und den NEU kodierten Rumpf —
// Leerraum und Feldreihenfolge machen keinen Unterschied, nur der Inhalt.
func anfrageHash(route, dateiID string, rumpf any) string {
	roh, _ := json.Marshal(rumpf)
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%s\x00", route, dateiID)
	h.Write(roh)
	return hex.EncodeToString(h.Sum(nil))
}

// Ausfuehren laesst arbeit genau einmal je Schluessel laufen. Eine
// Wiederholung mit demselben Rumpf bekommt das gespeicherte Ergebnis (in
// ziel entpackt), ohne dass arbeit noch einmal laeuft. Scheitert arbeit,
// wird der Schluessel freigegeben: Derselbe darf es noch einmal versuchen.
func (v *Vorgaenge) Ausfuehren(schluessel, route, dateiID string, rumpf any, ziel any, arbeit func() (any, error)) error {
	if schluessel == "" {
		return fehler(http.StatusPreconditionRequired, "pdf.idempotency_key_required", nil)
	}
	if len(schluessel) > 200 {
		return ungueltig("Idempotency-Key laenger als 200 Zeichen")
	}
	hash := anfrageHash(route, dateiID, rumpf)

	v.mu.Lock()
	alt, bekannt := v.liste[schluessel]
	if bekannt {
		v.mu.Unlock()
		if alt.hash != hash {
			return fehler(http.StatusConflict, "pdf.idempotency_mismatch", nil)
		}
		if !alt.fertig {
			return fehler(http.StatusConflict, "pdf.idempotency_in_progress", nil)
		}
		return json.Unmarshal(alt.antwort, ziel)
	}
	neu := &vorgang{hash: hash}
	v.liste[schluessel] = neu
	v.mu.Unlock()

	ergebnis, err := arbeit()
	v.mu.Lock()
	defer v.mu.Unlock()
	if err != nil {
		delete(v.liste, schluessel)
		return err
	}
	roh, err := json.Marshal(ergebnis)
	if err != nil {
		delete(v.liste, schluessel)
		return intern(err)
	}
	neu.antwort, neu.fertig = roh, true
	return json.Unmarshal(roh, ziel)
}

// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Kennwortschutz (Etappe 9, Vertrag Abschnitt 3).
//
// Die Datei in der Ablage bleibt ungeschuetzt; geschuetzt wird eine Kopie
// zum Herunterladen (Verschluesseln). Umgekehrt nimmt ein Commit mit
// Passwort den Schutz von der Datei (Commit.Entschluesseln). Passwoerter
// gehen nur in die pdfcpu-Konfiguration des einen Aufrufs; der Adapter
// speichert und protokolliert sie nicht.

// Rechte sind die Benutzerrechte einer geschuetzten Kopie (ISO 32000-1,
// Tabelle 22). Was hier false ist, darf nur, wer das Rechte-Kennwort hat.
type Rechte struct {
	Drucken      bool `json:"print"`
	Kopieren     bool `json:"copy"`
	Aendern      bool `json:"modify"`
	Kommentieren bool `json:"annotate"`
	Ausfuellen   bool `json:"fill"`
}

// Schutz beschreibt die geschuetzte Kopie: Oeffnen-Kennwort (leer = jeder
// darf oeffnen), Rechte-Kennwort (Pflicht) und die Rechte. Verschluesselt
// wird mit AES-256.
type Schutz struct {
	Benutzerpasswort string
	Besitzerpasswort string
	Rechte           Rechte
}

// MindestPasswortLaenge gilt fuer beide Kennwoerter (Vertrag: sechs Zeichen).
const MindestPasswortLaenge = 6

// Rechte-Bits der Norm, wie pdfcpu sie zaehlt (Bit 1 = 1<<0).
const (
	rechtDruckenGrob    = model.PermissionPrintRev2
	rechtAendern        = model.PermissionModify
	rechtKopieren       = model.PermissionExtract
	rechtKommentieren   = model.PermissionModAnnFillForm
	rechtAusfuellen     = model.PermissionFillRev3
	rechtKopierenRev3   = model.PermissionExtractRev3
	rechtZusammenfuegen = model.PermissionAssembleRev3
	rechtDruckenFein    = model.PermissionPrintRev3
)

// bits uebersetzt die Rechte in das P-Feld des Encrypt-Woerterbuchs: Die
// Bits, die die Norm auf 1 verlangt, kommen aus PermissionsNone; jedes
// gewaehrte Recht setzt seine Bits (Rev. 2 und Rev. 3 zusammen).
func (r Rechte) bits() model.PermissionFlags {
	p := model.PermissionsNone
	if r.Drucken {
		p |= rechtDruckenGrob | rechtDruckenFein
	}
	if r.Aendern {
		p |= rechtAendern | rechtZusammenfuegen
	}
	if r.Kopieren {
		p |= rechtKopieren | rechtKopierenRev3
	}
	if r.Kommentieren {
		p |= rechtKommentieren
	}
	if r.Ausfuellen {
		p |= rechtAusfuellen
	}
	return p
}

// RechteVon liest die Rechte aus einem P-Feld (fuer Tests und Auskunft).
func RechteVon(p int) Rechte {
	f := model.PermissionFlags(p)
	return Rechte{
		Drucken:      f&rechtDruckenGrob != 0 || f&rechtDruckenFein != 0,
		Kopieren:     f&rechtKopieren != 0,
		Aendern:      f&rechtAendern != 0,
		Kommentieren: f&rechtKommentieren != 0,
		Ausfuellen:   f&rechtAusfuellen != 0 || f&rechtKommentieren != 0,
	}
}

// Verschluesseln schreibt eine mit AES-256 geschuetzte Kopie der Quelle.
// Eine schon verschluesselte Quelle wird nicht umgeschrieben
// (ErrVerschluesselteQuelle), eine mit Benutzerpasswort nicht gelesen
// (ErrPasswort). Gelesen wird im Modus ENCRYPT, geschrieben ohne weitere
// Aenderung — pdfcpu legt beim Schreiben das Encrypt-Woerterbuch an.
func Verschluesseln(c context.Context, quelle io.ReadSeeker, s Schutz, ziel io.Writer) error {
	if len(s.Besitzerpasswort) < MindestPasswortLaenge ||
		(s.Benutzerpasswort != "" && len(s.Benutzerpasswort) < MindestPasswortLaenge) {
		return ErrPasswortFalsch
	}
	ctx, err := lesenMit(c, quelle, schutzKonfiguration(s))
	if err != nil {
		return err
	}
	alsPDF20(ctx)
	ergebnis, err := schreiben(c, ctx)
	if err != nil {
		return err
	}
	_, err = ziel.Write(ergebnis)
	return err
}

// schutzKonfiguration ist die pdfcpu-Konfiguration, mit der ein Kontext beim
// Schreiben das Encrypt-Woerterbuch bekommt: AES-256 mit den Kennwoertern
// und Rechten aus s.
func schutzKonfiguration(s Schutz) *model.Configuration {
	konf := konfiguration(model.ENCRYPT)
	konf.UserPW = s.Benutzerpasswort
	konf.OwnerPW = s.Besitzerpasswort
	konf.EncryptUsingAES = true
	konf.EncryptKeyLength = 256
	konf.Permissions = s.Rechte.bits()
	return konf
}

// alsPDF20 setzt die Version des Kontexts auf 2.0, bevor er verschluesselt
// geschrieben wird (#250): pdfcpu schreibt AES-256 nur dann als Revision 6
// (ISO 32000-2, Kennwortableitung mit Iteration, Algorithmus 2.B); sonst
// als Revision 5 (Adobe Extension Level 3, ein einziger SHA-256-Schritt,
// in ISO 32000-2 veraltet). Der Kopf wird %PDF-2.0, ein /Version im
// Katalog faellt weg — pdf.js und pdfcpu lesen beides.
func alsPDF20(ctx *model.Context) {
	v := model.V20
	ctx.HeaderVersion = &v
	ctx.RootVersion = &v
}

// mitPasswort baut die Konfiguration fuer das Lesen einer geschuetzten
// Basis: Das Oeffnen-Kennwort gilt zugleich als Rechte-Kennwort, falls kein
// eigenes genannt ist — bei einer Datei mit nur einem Kennwort ist es
// dasselbe (Vertrag Abschnitt 3).
func mitPasswort(cmd model.CommandMode, passwort, besitzer string) *model.Configuration {
	konf := konfiguration(cmd)
	konf.UserPW = passwort
	konf.OwnerPW = besitzer
	if konf.OwnerPW == "" {
		konf.OwnerPW = passwort
	}
	return konf
}

// besitzerPruefen sagt, ob besitzer das Rechte-Kennwort der verschluesselten
// Quelle ist. pdfcpu merkt sich nicht, welches Kennwort gepasst hat; es
// prueft beim Lesen erst das Rechte-, dann das Oeffnen-Kennwort. Darum
// geht die Probe mit einem Oeffnen-Kennwort, das sicher falsch ist
// (Zufall): Oeffnet sich die Datei trotzdem, war es das Rechte-Kennwort —
// unabhaengig davon, ob die Datei ein Oeffnen-Kennwort hat oder womit sie
// geoeffnet wurde. Sonst ErrPasswortFalsch.
func besitzerPruefen(c context.Context, quelle io.ReadSeeker, besitzer string) error {
	if _, err := quelle.Seek(0, io.SeekStart); err != nil {
		return err
	}
	konf := konfiguration(model.LISTINFO)
	konf.UserPW = "oih-probe-" + zufallskennwort()
	konf.OwnerPW = besitzer
	_, err := lesenMit(c, quelle, konf)
	return err
}

// RechteKennwortPruefen sagt, ob besitzer das Rechte-Kennwort der Quelle
// ist (#247): nil, ErrPasswortFalsch oder ErrNichtVerschluesselt. Die
// Oberflaeche hebt ihre Sperren erst auf, wenn der Server das bestaetigt
// hat; gespeichert und protokolliert wird nichts.
func RechteKennwortPruefen(c context.Context, quelle io.ReadSeeker, besitzer string) error {
	ctx, err := lesen(c, quelle, model.LISTINFO)
	if err != nil && !errors.Is(err, ErrPasswort) {
		return err
	}
	if err == nil && ctx.Encrypt == nil {
		return ErrNichtVerschluesselt
	}
	if besitzer == "" {
		return ErrPasswortFalsch
	}
	return besitzerPruefen(c, quelle, besitzer)
}

// RechtPruefen sagt, ob ein Vorgang an der Quelle erlaubt ist, der das
// genannte Recht braucht — "copy" (Text herausloesen: Export, Analyse,
// Texterkennungsdienst) oder "modify" (eine neue Fassung schreiben, etwa
// die Texterkennung). Eine ungeschuetzte Quelle erlaubt alles. Bei einer
// geschuetzten entscheidet das Rechte-Bit, es sei denn, besitzer ist das
// Rechte-Kennwort; ein genanntes, aber falsches ist ErrPasswortFalsch.
// Fehlt das Recht: Rechtefehler{recht} (422 pdf.permission_restricted).
// Gedacht fuer das ANLEGEN von Auftraegen, damit kein Kennwort im Auftrag
// liegen muss.
func RechtPruefen(c context.Context, quelle io.ReadSeeker, besitzer, recht string) error {
	ctx, err := lesen(c, quelle, model.LISTINFO)
	if err != nil {
		return err
	}
	if ctx.Encrypt == nil || ctx.E == nil {
		return nil
	}
	if besitzer != "" {
		return besitzerPruefen(c, quelle, besitzer)
	}
	r := RechteVon(ctx.E.P)
	erlaubt := false
	switch recht {
	case "copy":
		erlaubt = r.Kopieren
	case "modify":
		erlaubt = r.Aendern
	}
	if !erlaubt {
		return &Rechtefehler{Fehlend: []string{recht}}
	}
	return nil
}

// besitzerErkannt sagt, ob die Kennwoerter eines Aufrufs das Rechte-Kennwort
// der verschluesselten Quelle enthalten. Ohne eigenes Rechte-Kennwort gilt
// das Oeffnen-Kennwort als Kandidat (eine Datei mit nur einem Kennwort):
// Passt es nicht, ist das kein Fehler, sondern false — die Rechte-Bits der
// Datei entscheiden dann. Ein ausdrueckliches Rechte-Kennwort, das keines
// ist, ist ErrPasswortFalsch.
func besitzerErkannt(c context.Context, quelle io.ReadSeeker, passwort, besitzerpasswort string) (bool, error) {
	besitzer := besitzerpasswort
	if besitzer == "" {
		besitzer = passwort
	}
	if besitzer == "" {
		return false, nil
	}
	if err := besitzerPruefen(c, quelle, besitzer); err != nil {
		if !errors.Is(err, ErrPasswortFalsch) || besitzerpasswort != "" {
			return false, err
		}
		return false, nil
	}
	return true, nil
}

// zufallskennwort liefert 48 Hexzeichen aus crypto/rand — als Oeffnen-
// Kennwort, das sicher falsch ist (besitzerPruefen), und als Rechte-
// Kennwort einer Kopie, deren Schutz niemand aufheben koennen soll.
func zufallskennwort() string {
	var zufall [24]byte
	_, _ = rand.Read(zufall[:])
	return hex.EncodeToString(zufall[:])
}

// rechteFehlen nennt, was die Rechte-Bits einer geschuetzten Datei dem
// Commit ohne Rechte-Kennwort verbieten: "modify" fuer Seiten, Quellen und
// Eigenschaften, "annotate" fuer Anmerkungsbefehle, "decrypt" fuer das
// Entfernen des Schutzes (#248: den Schutz nimmt nur, wer das
// Rechte-Kennwort hat — wie in Acrobat; das Oeffnen-Kennwort allein
// liesse sonst auch die Rechte-Bits des Besitzers fallen). Leer heisst:
// erlaubt.
func rechteFehlen(p int, a Commit) []string {
	f := model.PermissionFlags(p)
	var fehlt []string
	seiten := a.Plan != nil || len(a.Quellen) > 0
	if (seiten && f&rechtAendern == 0 && f&rechtZusammenfuegen == 0) || (!a.Eigenschaften.Leer() && f&rechtAendern == 0) {
		fehlt = append(fehlt, "modify")
	}
	if !a.Anmerkungen.Leer() && f&rechtKommentieren == 0 {
		fehlt = append(fehlt, "annotate")
	}
	if a.Entschluesseln {
		fehlt = append(fehlt, "decrypt")
	}
	return fehlt
}

// Rechtefehler traegt zu ErrRechteEingeschraenkt, welche Rechte fehlen.
type Rechtefehler struct {
	Fehlend []string
}

func (f *Rechtefehler) Error() string { return ErrRechteEingeschraenkt.Error() }
func (f *Rechtefehler) Unwrap() error { return ErrRechteEingeschraenkt }

// SPDX-License-Identifier: Apache-2.0

package korpus

import (
	"bytes"
	"context"
	"fmt"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Die Passwoerter des Korpus. Erfunden und nur hier gueltig — sie schuetzen
// nichts, sie machen die Dateien nur verschluesselt.
const (
	ProbeBesitzerpasswort = "korpus-besitzer-0123"
	ProbeBenutzerpasswort = "korpus-benutzer-4567"
)

// verschluesseln verschluesselt ein Korpusdokument mit AES-256.
//
// Ohne Benutzerpasswort (nur Besitzerschutz) oeffnet jedes Programm die
// Datei; die Rechte (hier: nur drucken) sind eine Bitte an das Programm.
// Mit Benutzerpasswort ist ohne Passwort nichts lesbar.
func verschluesseln(roh []byte, benutzer, besitzer string) ([]byte, error) {
	konf := model.NewStatelessConfiguration()
	konf.UserPW = benutzer
	konf.OwnerPW = besitzer
	konf.EncryptUsingAES = true
	konf.EncryptKeyLength = 256
	konf.Permissions = model.PermissionsPrint
	konf.Offline = true
	var aus bytes.Buffer
	if err := api.Encrypt(context.Background(), bytes.NewReader(roh), &aus, konf); err != nil {
		return nil, fmt.Errorf("korpus: verschluesseln: %w", err)
	}
	return aus.Bytes(), nil
}

// MitBesitzerpasswort erzeugt drei Textseiten, geschuetzt nur mit einem
// Besitzerpasswort (Benutzerpasswort leer): lesbar ohne Passwort, die
// Rechte erlauben nur Drucken.
func MitBesitzerpasswort() ([]byte, error) {
	return verschluesseln(Textseiten(3), "", ProbeBesitzerpasswort)
}

// MitBenutzerpasswort erzeugt zwei Textseiten, die ohne Passwort nicht
// lesbar sind.
func MitBenutzerpasswort() ([]byte, error) {
	return verschluesseln(Textseiten(2), ProbeBenutzerpasswort, ProbeBesitzerpasswort)
}

// Dokument ist ein Eintrag des Korpus.
type Dokument struct {
	// Name ist der Dateiname, unter dem cmd/pdfkorpus es ablegt.
	Name string
	// Beschreibung sagt, wofuer das Dokument da ist.
	Beschreibung string
	Inhalt       []byte
}

// Alle liefert den ganzen Korpus in fester Reihenfolge.
func Alle() ([]Dokument, error) {
	besitzer, err := MitBesitzerpasswort()
	if err != nil {
		return nil, err
	}
	benutzer, err := MitBenutzerpasswort()
	if err != nil {
		return nil, err
	}
	return []Dokument{
		{"01-textseiten.pdf", "drei schlichte A4-Seiten", Textseiten(3)},
		{"02-seitenformen.pdf", "A4 hoch/quer, Letter, versetzte CropBox, /Rotate 90", Seitenformen()},
		{"03-verschachtelt.pdf", "Seitenbaum mit Zwischenknoten, vererbte MediaBox/Rotate/Resources", Verschachtelt()},
		{"04-anmerkungen.pdf", "Notiz mit Popup und Antwort, Hervorhebung, Textfeld, Freihand, Link", MitAnmerkungen()},
		{"05-formular.pdf", "AcroForm: Name, Betrag, Datum, Adresse mit zwei Widgets", MitFormular()},
		{"06-anhang.pdf", "eingebettete XML-Rechnung und Lieferschein als Dateianlage", MitAnhang()},
		{"07-lesezeichen.pdf", "Lesezeichen mit Unterpunkt, Ziel per Dest und per GoTo", MitLesezeichen()},
		{"08-signaturfeld.pdf", "Signaturfeld mit Wert (keine echte Signatur)", MitSignaturfeld()},
		{"09-javascript.pdf", "Dokument-JavaScript und OpenAction", MitJavaScript()},
		{"10-getaggt.pdf", "Strukturbaum mit markiertem Inhalt", Getaggt()},
		{"11-pdfa.pdf", "XMP mit PDF/A-2b-Kennzeichnung (nicht konform)", PDFA()},
		{"12-voll.pdf", "Anmerkungen, Formular, Anhaenge, Lesezeichen, Seitenbeschriftung", Voll()},
		{"13-besitzerpasswort.pdf", "AES-256, nur Besitzerpasswort, Rechte: nur drucken", besitzer},
		{"14-benutzerpasswort.pdf", "AES-256 mit Benutzerpasswort", benutzer},
		{"15-scan.pdf", "Scanseiten ohne Textebene: A4 und /Rotate 90 mit versetzter CropBox",
			Scan(A4, Seitenform{Breite: 595, Hoehe: 842, CropBox: "[36 48 559 794]", Drehung: 90})},
		{"16-rechnung.pdf", "Rechnung mit Textebene: Ueberschriften, Absaetze, Liste, Positionstabelle ueber zwei Seiten", Rechnung()},
	}, nil
}

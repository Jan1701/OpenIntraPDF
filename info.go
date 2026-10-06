// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"errors"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
	"github.com/Jan1701/OpenIntraPDF/kern/erkennung"
)

// Was der Arbeitsplatz beim Oeffnen ueber die Datei erfaehrt — dieselbe
// Form wie GET /api/pdf/files/{id} in Drive (typen.ts: PdfInfo), damit
// der Arbeitsplatz keinen Unterschied sieht.

type Faehigkeit struct {
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}

type Faehigkeiten struct {
	Pages       Faehigkeit `json:"pages"`
	Extract     Faehigkeit `json:"extract"`
	Merge       Faehigkeit `json:"merge"`
	Annotations Faehigkeit `json:"annotations"`
	OCR         Faehigkeit `json:"ocr"`
	Export      Faehigkeit `json:"export"`
}

type Info struct {
	FileID       string              `json:"file_id"`
	Name         string              `json:"name"`
	Version      int                 `json:"version"`
	SHA256       string              `json:"sha256"`
	Size         int64               `json:"size"`
	Access       string              `json:"access"`
	Inspection   dokument.Inspektion `json:"inspection"`
	Capabilities Faehigkeiten        `json:"capabilities"`
}

// faehigkeitenFuer leitet aus Dokument und Erkennung ab, was geht — die
// Regeln von drive.pdfFaehigkeitenFuer fuer das Recht „edit“: Die Datei
// gehoert der Person, die sie geoeffnet hat. Ein signiertes Original wird
// nicht ersetzt (als neue Datei geht es); ein XFA-Formular bleibt lesbar.
// ocr sagt, ob das mitgelieferte Tesseract laeuft; ohne es ist die
// Erkennung requires_worker, und der Export traegt nur mit Textebene.
func faehigkeitenFuer(i dokument.Inspektion, ocr, textebene bool) Faehigkeiten {
	ja := Faehigkeit{State: "available"}
	if i.Benutzerpasswort {
		p := Faehigkeit{State: "requires_password", Reason: "user_password"}
		return Faehigkeiten{Pages: p, Extract: p, Merge: p, Annotations: p, OCR: p, Export: p}
	}
	f := Faehigkeiten{Pages: ja, Extract: ja, Merge: ja, Annotations: ja, OCR: ja, Export: ja}
	if !ocr && !textebene {
		f.Export = Faehigkeit{State: "requires_worker", Reason: "no_text_layer"}
	}
	switch {
	case i.Signiert:
		f.Pages = Faehigkeit{State: "blocked_by_document", Reason: "signed_original"}
	case i.XFA:
		f.Pages = Faehigkeit{State: "unsupported", Reason: "xfa_form"}
	}
	switch {
	case !ocr:
		f.OCR = Faehigkeit{State: "requires_worker", Reason: "no_ocr_worker"}
	case i.Signiert:
		f.OCR = Faehigkeit{State: "blocked_by_document", Reason: "signed_original"}
	case i.XFA:
		f.OCR = Faehigkeit{State: "unsupported", Reason: "xfa_form"}
	}
	switch {
	case i.Signiert:
		f.Annotations = Faehigkeit{State: "blocked_by_document", Reason: "signed_original"}
	case i.XFA:
		f.Annotations = Faehigkeit{State: "unsupported", Reason: "xfa_form"}
	}
	if i.XFA {
		f.Extract = Faehigkeit{State: "unsupported", Reason: "xfa_form"}
		f.Merge = f.Extract
	}
	if i.Verschluesselt {
		f.Merge = Faehigkeit{State: "unsupported", Reason: "encrypted_source"}
	}
	return f
}

// infoFuer inspiziert die geladenen Bytes und baut die Auskunft.
func infoFuer(ctx context.Context, d *Datei, ocr bool) (*Info, error) {
	insp, err := dokument.Inspizieren(ctx, bytes.NewReader(d.Basis))
	if err != nil && !errors.Is(err, dokument.ErrPasswort) {
		return nil, kernFehler(err)
	}
	textebene := false
	if !ocr && !insp.Benutzerpasswort {
		// Ohne Erkennung entscheidet die Textebene ueber den Export —
		// geprueft an den ersten Seiten, wie im Server.
		n := min(insp.Seiten, 5)
		seiten := make([]int, n)
		for i := range seiten {
			seiten[i] = i
		}
		if n > 0 {
			hat, err := dokument.HatTextebene(ctx, d.Basis, seiten)
			textebene = err == nil && hat
		}
	}
	return &Info{
		FileID: d.ID, Name: d.Name, Version: d.Version, SHA256: d.SHA256, Size: d.Groesse, Access: "edit",
		Inspection: insp, Capabilities: faehigkeitenFuer(insp, ocr, textebene),
	}, nil
}

// ------------------------------------------------------------------
// Seitenarten (GET /api/pdf/files/{id}/pages)
// ------------------------------------------------------------------

type Seitenart struct {
	Page       int     `json:"page"`
	Kind       string  `json:"kind"`
	Chars      int     `json:"chars"`
	ImageRatio float64 `json:"image_ratio"`
}

type Seitenarten struct {
	Version int         `json:"version"`
	Pages   []Seitenart `json:"pages"`
}

// seitenartenFuer ordnet jede Seite ein: text, scan, gemischt oder leer —
// aus der Textebene, die der Go-Kern selbst liest (dokument.TextebeneLesen,
// derselbe Weg wie der Server ohne Erkennungsdienst). Der Bildanteil ist
// hier 1, wenn die Seite ein Bild traegt, sonst 0: pdfcpu kennt keine
// Bildflaeche wie pdfimages, und fuer die Vorauswahl der Erkennung reicht
// „Bild da, Text nicht“.
func seitenartenFuer(ctx context.Context, d *Datei) (*Seitenarten, error) {
	texte, err := dokument.TextebeneLesen(ctx, d.Basis, nil)
	if err != nil {
		return nil, kernFehler(err)
	}
	aus := &Seitenarten{Version: d.Version, Pages: make([]Seitenart, 0, len(texte))}
	for _, st := range texte {
		zeichen := zeichenDerSeite(st)
		s := Seitenart{Page: st.Nr, Chars: zeichen}
		if st.Bild {
			s.ImageRatio = 1
		}
		text := zeichen >= erkennung.MindestzeichenJeSeite
		switch {
		case text && st.Bild:
			s.Kind = "gemischt"
		case st.Bild:
			s.Kind = "scan"
		case text:
			s.Kind = "text"
		default:
			s.Kind = "leer"
		}
		aus.Pages = append(aus.Pages, s)
	}
	return aus, nil
}

// zeichenDerSeite zaehlt die sichtbaren Zeichen der Textebene einer Seite.
func zeichenDerSeite(st dokument.Seitentext) int {
	n := 0
	for _, b := range st.Bloecke {
		for _, z := range b {
			for _, w := range z.Woerter {
				n += erkennung.SichtbareZeichen(w.Text)
			}
		}
	}
	return n
}

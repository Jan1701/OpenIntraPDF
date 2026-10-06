// SPDX-License-Identifier: Apache-2.0

package dokument

import "slices"

// Bericht ist der Erhaltungsbericht eines Schreibvorgangs: was vorher da
// war, was nachher da ist, was mit entfernten Seiten gegangen ist — und
// was verloren ging, obwohl die zugehoerigen Seiten bleiben.
//
// Die Zahlen „nachher“ stammen aus dem ERNEUT GEOEFFNETEN Ergebnis, nicht
// aus dem, was der Adapter zu schreiben glaubte.
//
// JSON-Namen wie im Vertrag (Feld report); die *_removed_with_pages-Felder
// und losses kommen als Auskunft dazu.
type Bericht struct {
	Seiten int `json:"pages"`

	AnmerkungenBehalten  int `json:"kept_annotations"`
	AnmerkungenVerloren  int `json:"dropped_annotations"`
	AnmerkungenMitSeiten int `json:"annotations_removed_with_pages"`
	// Anmerkungsbefehle (Etappe 2): angelegt, auf Befehl entfernt (mit
	// mitgehenden Antworten), und wie viele der vorher vorhandenen im
	// Ergebnis wieder gefunden wurden — jede nicht geloeschte auf einer
	// behaltenen Seite muss dabei sein, sonst scheitert der Vorgang.
	AnmerkungenNeu           int `json:"annotations_added"`
	AnmerkungenEntfernt      int `json:"annotations_removed"`
	AnmerkungenFremdBehalten int `json:"annotations_kept_foreign"`

	FelderVorher    int `json:"form_fields_before"`
	FelderNachher   int `json:"form_fields_after"`
	FelderMitSeiten int `json:"form_fields_removed_with_pages"`

	AnhaengeVorher    int `json:"attachments_before"`
	AnhaengeNachher   int `json:"attachments_after"`
	AnhaengeMitSeiten int `json:"attachments_removed_with_pages"`

	LesezeichenVorher    int `json:"bookmarks_before"`
	LesezeichenNachher   int `json:"bookmarks_after"`
	LesezeichenMitSeiten int `json:"bookmarks_removed_with_pages"`

	// Warnungen sind Hinweise (Codes), keine Fehler: etwa ein Lesezeichen,
	// dessen Ziel entfernt wurde.
	Warnungen []string `json:"warnings"`
	// Verluste nennt die Klassen, die verloren gingen, obwohl ihre Seiten
	// bleiben: annotations, form_fields, attachments, bookmarks. Nicht leer
	// heisst: nicht still speichern (Vertrag: 422 pdf.preservation_failed),
	// ausser der Aufrufer nimmt genau diese Klassen in Kauf.
	Verluste []string `json:"losses"`

	// quelle ist die Inspektion der Quelle vor dem Umbau (nur Seitenplan).
	quelle Inspektion
}

// Quelle liefert die Inspektion der Quelle, wie sie VOR dem Umbau war —
// damit der Aufrufer ohne zweites Oeffnen entscheiden kann, ob er das
// Ergebnis veroeffentlicht (etwa: signiertes Original nicht ersetzen).
func (b Bericht) Quelle() Inspektion { return b.quelle }

// Verlustklassen.
const (
	VerlustAnmerkungen = "annotations"
	VerlustFelder      = "form_fields"
	VerlustAnhaenge    = "attachments"
	VerlustLesezeichen = "bookmarks"
)

// Warnungscodes.
const (
	WarnungSignaturUngueltig     = "signature_invalidated"
	WarnungSignierteQuelle       = "signed_source"
	WarnungLesezeichenZielWeg    = "bookmark_target_removed"
	WarnungLinkZielWeg           = "link_target_removed"
	WarnungBenanntesZielWeg      = "named_destination_removed"
	WarnungStartaktionWeg        = "open_action_removed"
	WarnungSeitenbeschriftungWeg = "page_labels_removed"
	WarnungStruktur              = "structure_tree_not_updated"
	WarnungVerdoppeltOhneFelder  = "duplicate_page_form_fields_not_copied"
	WarnungPdfaUngeprueft        = "pdfa_not_verified"
	WarnungVerschluesselung      = "encryption_kept"
	WarnungJavaScript            = "javascript_kept"
	WarnungFeldkollision         = "form_field_collision"
	WarnungAnhangUmbenannt       = "attachment_renamed"
	// Anmerkungen (Etappe 5): Der Text eines Post-its passte auch mit 7 pt
	// nicht auf den Zettel; ein Zeichen hatte auch in Noto Sans keinen
	// Glyph und wurde als Fragezeichen gezeichnet. Contents ist jeweils
	// vollstaendig.
	WarnungPostitGekuerzt = "sticky_text_truncated"
	WarnungGlyphenFehlen  = "glyphs_missing"
)

func (b *Bericht) warnung(code string) {
	if !slices.Contains(b.Warnungen, code) {
		b.Warnungen = append(b.Warnungen, code)
	}
}

func (b *Bericht) verlust(klasse string) {
	if !slices.Contains(b.Verluste, klasse) {
		b.Verluste = append(b.Verluste, klasse)
	}
}

// leerAlsListe sorgt dafuer, dass JSON [] statt null zeigt.
func (b *Bericht) leerAlsListe() {
	if b.Warnungen == nil {
		b.Warnungen = []string{}
	}
	if b.Verluste == nil {
		b.Verluste = []string{}
	}
}

// NichtHingenommen liefert die Verlustklassen, die nicht in hinnehmen
// stehen. Leer heisst: Speichern ist in Ordnung.
func (b Bericht) NichtHingenommen(hinnehmen []string) []string {
	var aus []string
	for _, v := range b.Verluste {
		if !slices.Contains(hinnehmen, v) {
			aus = append(aus, v)
		}
	}
	return aus
}

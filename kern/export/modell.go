// SPDX-License-Identifier: Apache-2.0

package export

import "errors"

// ============================================================
// Eingabe: Woerter mit Lage
// ============================================================

// Wort ist ein Wort mit seiner Lage im ANGEZEIGTEN Seitenraum: Punkte,
// Ursprung oben links, Y nach unten, /Rotate schon angewandt — so, wie der
// Texterkennungsdienst und die Textebene es liefern.
type Wort struct {
	X0, Y0, X1, Y1 float64
	Text           string
	// Konf: Sicherheit der Erkennung 0..100; -1 aus der Textebene.
	Konf float64
}

// Wortzeile ist eine Zeile, wie der Lieferant sie sieht.
type Wortzeile struct{ Woerter []Wort }

// Wortblock ist ein Absatz oder Textblock, wie der Lieferant ihn sieht.
type Wortblock struct{ Zeilen []Wortzeile }

// Quellen einer Seite.
const (
	QuelleTextebene = "text_layer"
	QuelleOCR       = "ocr"
	QuelleLeer      = "none"
)

// Seitenwoerter sind die Woerter einer Seite.
type Seitenwoerter struct {
	// Nr ist die Seite ab 0, wie ueberall in den PDF-Routen.
	Nr            int
	Breite, Hoehe float64
	// Quelle: QuelleTextebene, QuelleOCR oder QuelleLeer.
	Quelle string
	// Bildanteil 0..1 der Seitenflaeche; 0, wenn unbekannt. Daraus
	// entsteht die Warnung images_not_exported.
	Bildanteil float64
	Bloecke    []Wortblock
}

// ============================================================
// Das Dokumentmodell
// ============================================================

// Dokument ist das Zwischenmodell (Vertrag Etappe 4). Die JSON-Namen sind
// die der Routen (englisch); GET /api/pdf/jobs/{id}/model liefert es der
// Vorschau.
type Dokument struct {
	Heuristik int       `json:"heuristics_version"`
	Quelle    Quelle    `json:"source"`
	Warnungen []Warnung `json:"warnings"`
	Seiten    []Seite   `json:"pages"`
}

// Quelle nennt das PDF und die untersuchten Seiten (ab 0).
type Quelle struct {
	Sha256 string `json:"sha256"`
	Seiten []int  `json:"pages"`
}

// Seite ist eine untersuchte Seite mit ihren Bloecken in Lesereihenfolge.
type Seite struct {
	Nr     int     `json:"page"`
	Breite float64 `json:"width"`
	Hoehe  float64 `json:"height"`
	Quelle string  `json:"source"`
	// Bildanteil der Seitenflaeche, aus der Seitenauskunft des Dienstes.
	Bildanteil float64 `json:"image_ratio"`
	// Fortsetzung: Die Seite begann mit einer Tabelle, die mit der
	// Tabelle der Vorseite zusammengefuehrt wurde. Der Writer-Export setzt
	// hier keinen Seitenumbruch.
	Fortsetzung bool    `json:"continues_table"`
	Bloecke     []Block `json:"blocks"`
}

// Arten eines Blocks.
const (
	ArtAbsatz       = "paragraph"
	ArtUeberschrift = "heading"
	ArtListe        = "list"
	ArtTabelle      = "table"
)

// Block ist ein Absatz, eine Ueberschrift, ein Listenpunkt oder eine
// Tabelle. Die Textfelder gelten fuer die ersten drei, Tabelle nur fuer
// die vierte.
type Block struct {
	Art string `json:"type"`
	// Ebene: bei Ueberschriften 1 oder 2, bei Listen die Einrueckung (1).
	Ebene int `json:"level,omitempty"`
	// Zeilen sind die Zeilen, wie sie im PDF stehen; Text ist der
	// zusammengezogene Absatz (Silbentrennung aufgeloest, Listenmarke
	// entfernt).
	Zeilen []string `json:"lines,omitempty"`
	Text   string   `json:"text,omitempty"`
	// Groesse ist die mittlere Zeilenhoehe in Punkten.
	Groesse float64 `json:"font_size,omitempty"`
	Quelle  string  `json:"source,omitempty"`
	// Unsicher: mehr als ein Viertel der Woerter unter 50 % Sicherheit.
	Unsicher bool `json:"uncertain,omitempty"`
	// KopfFuss: eine Kopf- oder Fusszeile (gleicher Text an gleicher
	// Stelle auf mindestens drei Seiten) — auch das erste Vorkommen.
	// Wiederholt: ein weiteres Vorkommen; der Writer-Export laesst es aus.
	KopfFuss   bool `json:"header_footer,omitempty"`
	Wiederholt bool `json:"repeated,omitempty"`
	// Lage [x0 y0 x1 y1] im angezeigten Seitenraum — die Vorschau springt
	// damit zur Stelle im PDF.
	Lage    [4]float64 `json:"bbox"`
	Tabelle *Tabelle   `json:"table,omitempty"`
}

// Tabelle ist ein erkanntes Raster. Zeilen sind rechteckig: jede Zeile
// hat Spalten Zellen, leere eingeschlossen.
type Tabelle struct {
	// Index zaehlt die Tabellen des Dokuments ab 0, in Lesereihenfolge.
	Index int `json:"index"`
	// Seiten (ab 0), ueber die die Tabelle laeuft — mehrere nach einer
	// Zusammenfuehrung.
	Seiten     []int `json:"pages"`
	Spalten    int   `json:"cols"`
	Kopfzeilen int   `json:"header_rows"`
	// Typvorschlag je Spalte: text, number oder date — nur, wenn ALLE
	// nicht-leeren Zellen unter den Kopfzeilen passen.
	Typvorschlag []string  `json:"column_types"`
	Zeilen       [][]Zelle `json:"rows"`
}

// Zelle ist eine Zelle mit Rohtext, Herkunft und Lage.
type Zelle struct {
	Text   string `json:"text"`
	Quelle string `json:"source,omitempty"`
	// Konf: kleinste Sicherheit der Woerter der Zelle; -1 aus der
	// Textebene oder leer.
	Konf float64    `json:"confidence"`
	Lage [4]float64 `json:"bbox"`
}

// Warnung ist eine Auffaelligkeit der Erkennung oder des Schreibens. Die
// Codes stehen in den Warnungs-Konstanten; die Oberflaeche uebersetzt sie.
type Warnung struct {
	Code string `json:"code"`
	// Count: wie oft (Zellen, Seiten), wenn es zaehlbar ist.
	Count int `json:"count,omitempty"`
	// Pages: betroffene Seiten ab 0.
	Pages []int `json:"pages,omitempty"`
	// Detail: ein kurzer Code, der die Entscheidung erklaert (etwa
	// "columns" bei tables_not_merged).
	Detail string `json:"detail,omitempty"`
}

// Warnungscodes.
const (
	// WarnungKopfFuss: derselbe Text an derselben Stelle auf mindestens
	// drei Seiten; im Writer-Export bleibt er einmal.
	WarnungKopfFuss = "repeated_header_footer"
	// WarnungZusammengefuehrt: Tabellen zweier Seiten wurden eine.
	WarnungZusammengefuehrt = "tables_merged"
	// WarnungNichtZusammengefuehrt: an einem Seitenwechsel stehen zwei
	// Tabellen, die nicht zusammenpassen (Detail: columns oder header).
	WarnungNichtZusammengefuehrt = "tables_not_merged"
	// WarnungBilder: Seiten mit Bildern; Bilder werden nicht exportiert.
	WarnungBilder = "images_not_exported"
	// WarnungFormelschutz: so viele CSV-Zellen bekamen ein fuehrendes '.
	WarnungFormelschutz = "csv_formula_guarded"
	// WarnungZahlBleibtText: als number gewaehlt, aber nicht als Zahl
	// lesbar (auch fuehrende Nullen) — bleibt Text.
	WarnungZahlBleibtText = "number_kept_as_text"
	// WarnungDatumBleibtText: als date gewaehlt, aber nicht eindeutig
	// (etwa 03/04/2026) — bleibt Text.
	WarnungDatumBleibtText = "date_kept_as_text"
	// WarnungCSVEineTabelle: weitere gewaehlte Tabellen fehlen in der CSV.
	WarnungCSVEineTabelle = "csv_single_table"
	// WarnungUnsicher: Bloecke mit unsicherer Erkennung.
	WarnungUnsicher = "low_confidence_blocks"
)

// Grenzen (Vertrag Etappe 4).
const (
	// HoechstSeiten je Analyse.
	HoechstSeiten = 200
	// HoechstZellen je Export, ueber alle gewaehlten Tabellen.
	HoechstZellen = 100_000
)

// Fehler des Pakets.
var (
	// ErrZuGross: mehr als HoechstZellen Zellen.
	ErrZuGross = errors.New("export: zu viele Zellen")
	// ErrTabelleFehlt: Der Index nennt keine Tabelle des Modells.
	ErrTabelleFehlt = errors.New("export: Tabelle nicht gefunden")
	// ErrOptionUngueltig: Spaltentyp, Zahlenformat oder Trennzeichen
	// unbekannt.
	ErrOptionUngueltig = errors.New("export: Option ungueltig")
)

// Tabellen liefert die Tabellen des Modells in Lesereihenfolge.
func (d Dokument) Tabellen() []*Tabelle {
	var aus []*Tabelle
	for i := range d.Seiten {
		for j := range d.Seiten[i].Bloecke {
			if t := d.Seiten[i].Bloecke[j].Tabelle; t != nil {
				aus = append(aus, t)
			}
		}
	}
	return aus
}

// Tabelle sucht die Tabelle mit dem Index.
func (d Dokument) Tabelle(index int) *Tabelle {
	for _, t := range d.Tabellen() {
		if t.Index == index {
			return t
		}
	}
	return nil
}

// Zaehlung ist, was result_meta ueber ein Modell sagt.
type Zaehlung struct {
	Seiten       int
	Absaetze     int
	Ueberschrift int
	Listen       int
	Tabellen     []*Tabelle
	OCRSeiten    []int
	Unsichere    []int
}

// Zaehlen zaehlt die Bloecke des Modells fuer result_meta.
func (d Dokument) Zaehlen() Zaehlung {
	z := Zaehlung{Seiten: len(d.Seiten), OCRSeiten: []int{}, Unsichere: []int{}, Tabellen: d.Tabellen()}
	for _, s := range d.Seiten {
		if s.Quelle == QuelleOCR {
			z.OCRSeiten = append(z.OCRSeiten, s.Nr)
		}
		unsicher := false
		for _, b := range s.Bloecke {
			switch b.Art {
			case ArtAbsatz:
				z.Absaetze++
			case ArtUeberschrift:
				z.Ueberschrift++
			case ArtListe:
				z.Listen++
			}
			if b.Unsicher {
				unsicher = true
			}
			if b.Tabelle != nil {
				for _, zeile := range b.Tabelle.Zeilen {
					for _, zelle := range zeile {
						if zelle.Konf >= 0 && zelle.Konf < unsichereKonfidenz && zelle.Text != "" {
							unsicher = true
						}
					}
				}
			}
		}
		if unsicher {
			z.Unsichere = append(z.Unsichere, s.Nr)
		}
	}
	return z
}

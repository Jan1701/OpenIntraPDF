// SPDX-License-Identifier: Apache-2.0
//
// Die Schnittstelle zwischen dem PDF-Arbeitsplatz und seinem Gastgeber.
//
// Der Arbeitsplatz (dieser Ordner) kennt weder OIH noch Drive noch das
// Wiki. Alles, was nach draußen geht — Datei holen, speichern, Ziel wählen,
// drucken —, läuft über einen `PdfHost`. So kann dieselbe Oberfläche später
// auch im Desktop-Programm laufen, dort mit einem Gastgeber, der lokale
// Dateien öffnet (Konzept Kap. 03, „Ein Kern, zwei Gastgeber“).
//
// Feldnamen im JSON sind englisch (Konzept Kap. 03), weil sie der Vertrag
// mit dem Server so festlegt; alles Eigene heißt deutsch wie im Haus.

/** Wirksames Recht an der Datei, vom Server berechnet. */
export type PdfZugriff = 'view' | 'comment' | 'edit';

/** Zustand einer Fähigkeit (Konzept Kap. 01, „Produktgrenzen“). */
export type FaehigkeitsStand =
    | 'available'
    | 'read_only'
    | 'requires_password'
    | 'requires_worker'
    | 'unsupported'
    | 'blocked_by_document';

export interface PdfFaehigkeit {
    state: FaehigkeitsStand;
    /** Maschinenlesbarer Grund, z. B. `signed_original`. */
    reason?: string;
}

/** Was der Server beim Öffnen über die Datei herausgefunden hat. */
export interface PdfInspektion {
    pages: number;
    pdf_version?: string;
    encrypted?: boolean;
    /** Ohne Kennwort nicht lesbar (Etappe 9); `encrypted` ohne dies = nur Rechte-Kennwort. */
    user_password?: boolean;
    signed?: boolean;
    forms?: boolean;
    form_fields?: number;
    attachments?: number;
    bookmarks?: number;
    annotations?: number;
    javascript?: boolean;
    pdfa?: boolean;
    tagged?: boolean;
}

/** Antwort von `GET /api/pdf/files/{id}` (Vertrag Etappe 1). */
export interface PdfInfo {
    file_id: string;
    name: string;
    version: number;
    sha256: string;
    size?: number;
    access: PdfZugriff;
    inspection?: PdfInspektion;
    capabilities?: {
        pages?: PdfFaehigkeit;
        extract?: PdfFaehigkeit;
        merge?: PdfFaehigkeit;
        /** Etappe 2; fehlt bei einem älteren Server — dann gibt es kein Kommentieren. */
        annotations?: PdfFaehigkeit;
        /**
         * Etappe 3. `available` nur, wenn der Dienst gesund ist, sonst
         * `requires_worker` — die Gruppe „Text erkennen“ erklärt dann,
         * was fehlt, statt zu verschwinden (Konzept Kap. 01).
         */
        ocr?: PdfFaehigkeit;
        /**
         * Etappe 4. `available`, wenn der Dienst gesund ist oder eine
         * Textebene vorhanden ist. Fehlt sie (älterer Server), gibt es
         * keine Gruppe „Exportieren“.
         */
        export?: PdfFaehigkeit;
    };
}

// ---------------------------------------------------------------------
// Texterkennung und Aufträge (Vertrag Etappe 3)
// ---------------------------------------------------------------------

/** Was der Dienst auf einer Seite vorfindet. */
export type SeitenArt = 'text' | 'scan' | 'gemischt' | 'leer';

export interface SeitenArtEintrag {
    /** Seite der gespeicherten Fassung, ab 0. */
    page: number;
    kind: SeitenArt;
    chars: number;
    /** Bildanteil 0–1. */
    image_ratio: number;
}

/** Antwort von `GET /api/pdf/files/{id}/pages`. */
export interface SeitenArten {
    version: number;
    pages: SeitenArtEintrag[];
}

export type OcrSprache = 'deu' | 'eng' | 'deu+eng';

/** Rumpf von `POST /api/pdf/files/{id}/jobs`. */
export interface OcrBefehl {
    kind: 'ocr';
    expected_version: number;
    options: {
        /** Seiten ab 0; `null` = alle Seiten ohne Text (entscheidet der Server). */
        pages: number[] | null;
        languages: OcrSprache;
    };
    /** Rechte-Kennwort einer geschützten Datei, deren Rechte-Bits (Ändern) den Auftrag sonst verbieten; nur für diesen Aufruf. */
    owner_password?: string;
}

export type AuftragsStand = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * `result.meta` eines fertigen Auftrags. Seiten ab 0. OCR (Etappe 3) und
 * Analyse (Etappe 4) füllen verschiedene Felder derselben Stelle.
 */
export interface AuftragsMeta {
    pages_recognized?: number[];
    pages_skipped?: { page: number; reason: string }[];
    low_confidence_pages?: number[];
    words?: number;
    // Analyse (Vertrag Etappe 4)
    pages?: number;
    paragraphs?: number;
    headings?: number;
    lists?: number;
    tables?: { index: number; page: number; rows: number; cols: number }[];
    ocr_pages?: number[];
    low_confidence?: number[];
    warnings?: ExportWarnung[];
}

/** Ein Auftrag, wie `GET /api/pdf/jobs/{id}` ihn liefert. */
export interface PdfAuftrag {
    id: string;
    kind: 'ocr' | 'export' | 'analyse';
    state: AuftragsStand;
    progress?: { done: number; total: number };
    /** Fehlercode bei `failed`. */
    error?: string | null;
    result?: { size?: number; sha256?: string; meta?: AuftragsMeta } | null;
    expires_at?: string | null;
    /** Nicht im Vertrag, aber in der Tabelle — wer es liefert, hilft beim Wiederfinden. */
    base_version?: number;
}

/** Rumpf von `POST /api/pdf/jobs/{id}/commit`. */
export interface AuftragVeroeffentlichen {
    destination: CommitZiel;
    comment?: string;
    /** Wie beim Commit (Etappe 1): nur nach bestätigtem Erhaltungsbericht. */
    accept_losses?: string[];
}

// ---------------------------------------------------------------------
// Exportieren nach Writer und Tabelle (Vertrag Etappe 4)
// ---------------------------------------------------------------------

/** Rumpf von `POST /api/pdf/files/{id}/jobs` für die Analyse (Schritt 1). */
export interface AnalyseBefehl {
    kind: 'analyse';
    expected_version: number;
    options: {
        /** Seiten ab 0; `null` = alle. */
        pages: number[] | null;
        languages: OcrSprache;
    };
    /** Rechte-Kennwort einer geschützten Datei, deren Rechte-Bits (Kopieren) den Auftrag sonst verbieten; nur für diesen Aufruf. */
    owner_password?: string;
}

export type ExportFormat = 'docx' | 'odt' | 'xlsx' | 'csv';
export type SpaltenTyp = 'text' | 'number' | 'date';
export type ZahlenGebiet = 'de' | 'en';

/**
 * Eine Warnung des Servers (Paket `openintrapdf/export`, `Warnung`): Code
 * wie `images_not_exported`, dazu Anzahl, Seiten ab 0 und ein kurzes
 * Detail. Ein nackter Code wird ebenfalls gelesen.
 */
export type ExportWarnung = string | { code: string; count?: number; pages?: number[]; detail?: string };

/** Rumpf von `POST /api/pdf/jobs/{id}/export` (Schritt 2). */
export interface ExportBefehl {
    format: ExportFormat;
    tables: { index: number; include: boolean; header_rows: number; column_types: SpaltenTyp[] }[];
    number_locale: ZahlenGebiet;
    /** Nur bei `csv`: Trennzeichen und die EINE Tabelle. */
    csv?: { delimiter: string; table: number };
    destination: PdfZiel;
}

/** Antwort 201 des Exports: die neue Drive-Datei. */
export interface ExportErgebnis {
    file_id: string;
    name: string;
    size?: number;
    warnings?: ExportWarnung[];
}

/** `[x0, y0, x1, y1]` in Punkten im angezeigten Seitenraum, Ursprung oben links. */
export type SeitenLage = [number, number, number, number];

/**
 * Das Dokumentmodell von `GET /api/pdf/jobs/{id}/model`, wie die Vorschau
 * es braucht (Vertrag Etappe 4, „Dokumentmodell“). Auf dem Draht heißen
 * die Felder englisch (Go-Paket `openintrapdf/export`, `Dokument`);
 * `modellLesen` in exportieren.ts bringt sie in diese Form.
 */
export interface ModellAbsatz {
    typ: 'absatz';
    art: 'absatz' | 'ueberschrift' | 'liste';
    ebene: number;
    text: string;
    quelle: 'textebene' | 'ocr' | 'leer';
    /** Mehr als ein Viertel der Wörter unter 50 % Sicherheit. */
    unsicher: boolean;
    /** Kopf- oder Fußzeile, die schon auf einer früheren Seite stand — der Writer lässt sie aus. */
    wiederholt: boolean;
    lage: SeitenLage | null;
}

export interface ModellZelle {
    text: string;
    /** Kleinste Sicherheit der Wörter, 0–100; fehlt bei Textebene oder leerer Zelle (Server: -1). */
    konf?: number;
}

export interface ModellTabelle {
    typ: 'tabelle';
    index: number;
    zeilen: ModellZelle[][];
    spalten: number;
    kopfzeilen: number;
    typvorschlag: SpaltenTyp[];
    lage: SeitenLage | null;
}

export type ModellBlock = ModellAbsatz | ModellTabelle;

export interface ModellSeite {
    /** Seite ab 1, wie die Leseansicht zählt (der Draht zählt ab 0). */
    nr: number;
    /** Woher der Text kam; `leer` = weder Textebene noch Erkennung. */
    quelle: 'textebene' | 'ocr' | 'leer';
    bloecke: ModellBlock[];
}

export interface Modell {
    warnungen: ExportWarnung[];
    seiten: ModellSeite[];
}

// ---------------------------------------------------------------------
// Anmerkungsbefehle (Vertrag Etappe 2)
// ---------------------------------------------------------------------

export type AnmerkungsArt =
    | 'note' | 'highlight' | 'underline' | 'strikeout' | 'freetext'
    | 'ink' | 'line' | 'arrow' | 'square' | 'circle'
    /** Etappe 5: Post-it (FreeText mit Zettel-Erscheinungsbild) und Stempel. */
    | 'sticky' | 'stamp'
    /** Etappe 9: Verknüpfung ohne sichtbaren Rahmen, mit Web-Adresse oder Zielseite. */
    | 'link';

/** `[llx, lly, urx, ury]` im PDF-Benutzerraum. */
export type PdfRechteck = [number, number, number, number];

/** PDF-`/Name` eines Stempels — nur diese Liste nimmt der Server an (Vertrag Etappe 5). */
export type StempelName = 'Approved' | 'Draft' | 'Confidential' | 'Checked' | 'Paid' | 'Booked' | 'Received' | 'Done' | 'Custom';

/**
 * Das Feld `stamp` eines Stempelbefehls (nur bei `kind: "stamp"`).
 *
 * `label` geht GENAU so hinaus, wie es hier steht — die Großschreibung
 * macht die Oberfläche. Autor und Datum der zweiten Zeile (`signed`) setzt
 * der Server aus seinem Wissen; der Client schickt beides nicht. `lang`
 * bestimmt nur das Datumsformat.
 */
export interface StempelAngabe {
    /** Einzeilig, 1–40 Zeichen, ohne Steuerzeichen. */
    label: string;
    name: StempelName;
    signed: boolean;
    /** Eine der 26 OIH-Sprachen, höchstens 10 Zeichen. */
    lang: string;
}

/**
 * Eine neue Anmerkung (`annotations.add`). Alle Koordinaten liegen im
 * PDF-Benutzerraum der Quellseite; `page` ist der Index dieser Seite im
 * BASISDOKUMENT (0-basiert), nicht im neuen Seitenplan. Autor und `NM`
 * setzt der Server; `client_id` dient nur der Zuordnung von Antworten
 * innerhalb desselben Commits.
 */
export interface AnmerkungHinzu {
    client_id: string;
    page: number;
    kind: AnmerkungsArt;
    rect: PdfRechteck;
    /** Je Quad 8 Zahlen: oben links, oben rechts, unten links, unten rechts. */
    quads?: number[][];
    /** Je Strich eine flache Punktliste x, y, x, y, … */
    paths?: number[][];
    line?: [number, number, number, number];
    contents: string;
    /** r, g, b jeweils 0–1. Beim Post-it die Füllfarbe des Zettels, beim Stempel Rahmen und Schrift. */
    color: [number, number, number];
    width?: number;
    font_size?: number;
    /** Nur bei `kind: "stamp"`; sonst lehnt der Server den Befehl ab (400). */
    stamp?: StempelAngabe;
    /** Nur bei `kind: "link"` (Etappe 9), genau eines: Web-Adresse (http, https, mailto) oder Zielseite im Basisdokument ab 0. */
    uri?: string;
    page_target?: number;
    /** Kennung einer gespeicherten Anmerkung (`7R`) oder eine `client_id`. */
    reply_to: string | null;
}

/**
 * Befehle an gespeicherte Anmerkungen. `page` ist auch hier Pflicht (der
 * Server prüft, dass die Kennung eine Anmerkung dieser Seite ist).
 */
export interface AnmerkungAendern { ref: string; page: number; contents: string }
export interface AnmerkungLoeschen { ref: string; page: number }
export interface AnmerkungStatus { ref: string; page: number; state: 'completed' | 'none' }

export interface AnmerkungsBefehle {
    add?: AnmerkungHinzu[];
    update?: AnmerkungAendern[];
    delete?: AnmerkungLoeschen[];
    state?: AnmerkungStatus[];
}

/**
 * Ergebnis von `PdfHost.laden()`.
 *
 * ⚠️ Der Puffer geht an pdf.js über und ist danach leer (pdf.js schickt ihn
 * an seinen Worker). Ein Gastgeber, der die Bytes noch zum Drucken oder
 * Herunterladen braucht, legt sich VORHER eine Kopie an (z. B. als Blob).
 */
export interface PdfLadung {
    daten: ArrayBuffer;
    /** Fassung genau dieser Bytes — die Basis für `expected_version`. */
    version?: number;
    /** SHA-256 genau dieser Bytes — die Basis für `expected_sha256`. */
    sha256?: string;
    /**
     * Die zu diesen Bytes passende Info. Wer sie mitliefert, erspart dem
     * Arbeitsplatz den zweiten Aufruf von `info()` — und die Frage, ob beide
     * Antworten zur selben Fassung gehören.
     */
    info?: PdfInfo;
}

/** Eine Seite im Seitenplan des Commit-Befehls. */
export interface CommitSeite {
    /** Seite der Basisfassung, ab 0; `-1` bei einer leeren Seite. */
    source: number;
    /** ZUSÄTZLICHE Drehung im Uhrzeigersinn; bei einer leeren Seite ihre ganze Drehung. */
    rotate: 0 | 90 | 180 | 270;
    /** Eine neue leere Seite in Punkt (Etappe 9); `source` zählt dann nicht. */
    blank?: { width: number; height: number };
}

export type CommitZiel =
    | { kind: 'new_version' }
    | { kind: 'new_file'; drive_id: string; folder_id: string | null; name: string };

/**
 * Eigenschaften des Dokuments (Etappe 8): je höchstens 1000 Zeichen, keine
 * Steuerzeichen; ein leerer String entfernt den Eintrag. Der Server
 * schreibt das Info-Wörterbuch und, falls vorhanden, das XMP.
 */
export interface PdfEigenschaften {
    title?: string;
    subject?: string;
    author?: string;
    keywords?: string;
}

/**
 * Rumpf von `POST /api/pdf/files/{id}/commit`.
 *
 * `pages` fehlt, wenn der Seitenplan unverändert ist — und IMMER beim Recht
 * `comment`, das nur Anmerkungsbefehle schicken darf. Der Server wendet
 * erst `annotations` auf die Basis an und danach den Seitenplan.
 */
export interface CommitBefehl {
    expected_version: number;
    expected_sha256: string;
    pages?: CommitSeite[];
    annotations?: AnmerkungsBefehle;
    /** Nur mit Recht `edit` (Etappe 8). */
    properties?: PdfEigenschaften;
    /**
     * Seiten anderer Drive-Dateien (Etappe 9): Der Server hängt sie in dieser
     * Reihenfolge hinten an die Basis; `pages[].source` nennt sie ab der
     * Seitenzahl der Basis. Leserecht an jeder Quelle, sonst 404; nur mit `edit`.
     */
    sources?: BindeQuelle[];
    /**
     * Kennwörter (Etappe 9): `password` öffnet eine Datei mit Öffnen-Kennwort,
     * `owner_password` hebt ihre Rechte-Bits auf, `decrypt` speichert die
     * neue Fassung ohne Schutz (nur mit `edit`). Sie gehen nur in diesen
     * Aufruf; der Server speichert und protokolliert sie nicht.
     */
    password?: string;
    owner_password?: string;
    decrypt?: { password: string };
    destination: CommitZiel;
    comment?: string;
    /** Nur nach ausdrücklicher Bestätigung eines Erhaltungsberichts. */
    accept_losses?: string[];
}

/** Was beim Schreiben erhalten blieb und was nicht. */
export interface ErhaltungsBericht {
    kept_annotations?: number;
    dropped_annotations?: number;
    form_fields_before?: number;
    form_fields_after?: number;
    attachments_before?: number;
    attachments_after?: number;
    bookmarks_before?: number;
    bookmarks_after?: number;
    warnings?: string[];
}

export interface CommitErgebnis {
    file_id: string;
    version: number;
    sha256: string;
    name: string;
    report?: ErhaltungsBericht;
    /** Welche Kennung jede neue Anmerkung im PDF bekommen hat. */
    annotations?: { added: { client_id: string; ref: string; nm: string }[] };
}

/** Ein Ablageort für eine neue Datei. `drive_id` '' = eigene Ablage. */
export interface PdfZiel {
    drive_id: string;
    folder_id: string | null;
    name: string;
}

/** Rumpf von `POST /api/pdf/files/{id}/extract`. */
export interface ExtraktBefehl {
    /** Seiten der gespeicherten Fassung, ab 0. */
    pages: number[];
    /** `one` = eine Datei mit allen Seiten, `each` = je Seite eine Datei. */
    mode: 'one' | 'each';
    destination: PdfZiel;
}

export interface ExtraktErgebnis {
    files: { file_id: string; name: string; version: number }[];
}

// ---------------------------------------------------------------------
// Dateien binden (`POST /api/pdf/merge`, Vertrag Etappe 1)
// ---------------------------------------------------------------------

/** Eine Quelle beim Binden. */
export interface BindeQuelle {
    file_id: string;
    /** Fassung, die gebunden werden soll; weicht sie ab, antwortet der Server 412. */
    expected_version?: number;
    /** Seiten der gespeicherten Fassung, ab 0; fehlt = alle Seiten. */
    pages?: number[];
}

/** Rumpf von `POST /api/pdf/merge`. Höchstens 20 Quellen (Server: `HoechstQuellen`). */
export interface BindeBefehl {
    sources: BindeQuelle[];
    destination: PdfZiel;
    /** Je Quelle ein Lesezeichen mit ihrem Namen im Ergebnis. */
    bookmarks_per_source: boolean;
    /** Nur nach ausdrücklicher Bestätigung eines Erhaltungsberichts. */
    accept_losses?: string[];
}

/** Antwort 201 des Bindens: die neue Datei. */
export interface BindeErgebnis {
    file_id: string;
    name: string;
    version: number;
    sha256?: string;
    report?: ErhaltungsBericht;
}

/** Rumpf von `POST /api/pdf/files/{id}/print` (Etappe 8): Seiten ab 0, leer = alle. */
export interface DruckBefehl {
    pages: number[];
    annotations: boolean;
    expected_version: number;
    /** Öffnen- und Rechte-Kennwort einer geschützten Datei (#247), wie beim Commit; nur für diesen Aufruf. */
    password?: string;
    owner_password?: string;
}

/**
 * Rumpf von `POST /api/pdf/files/{id}/protected` (Etappe 9): eine mit AES-256
 * geschützte Kopie zum Herunterladen. Die Datei in der Ablage bleibt
 * ungeschützt; der Server speichert nichts und kein Kennwort.
 */
export interface SchutzBefehl {
    /** Öffnen-Kennwort; fehlt es, darf jeder öffnen. */
    user_password?: string;
    /** Rechte-Kennwort (Pflicht); bei nur einem Öffnen-Kennwort dasselbe. */
    owner_password: string;
    permissions: { print: boolean; copy: boolean; modify: boolean; annotate: boolean; fill: boolean };
    expected_version: number;
}

/** Eine frühere Fassung der Datei (Etappe 8), wie `GET /api/files/{id}/versions` sie kennt. */
export interface PdfFassung {
    version: number;
    /** Bytes. */
    size: number;
    /** RFC 3339. */
    created_at: string;
    /** Anzeigename der Person, wenn bekannt. */
    created_by?: string;
}

/** Eine Drive-Datei, wie der Dateiwähler des Gastgebers sie liefert. */
export interface DateiWahl {
    id: string;
    name: string;
}

/** Wofür ein Ziel gewählt wird — bestimmt Überschrift und Knopf im Dialog. */
export type ZielZweck = 'neue_datei' | 'extrahieren' | 'teilen' | 'exportieren' | 'binden';

export interface ZielAnfrage {
    zweck: ZielZweck;
    /** Vorschlag für den Dateinamen. */
    name: string;
}

/**
 * Der Gastgeber des Arbeitsplatzes.
 *
 * Fehlt `speichern`, gibt es KEINEN Bearbeiten-Modus und keine
 * Bearbeitungswerkzeuge — so im Wiki, das nur lesen lässt.
 *
 * Fehler meldet ein Gastgeber als `PdfHostFehler`, damit der Arbeitsplatz
 * 412, 422 und Netzfehler auseinanderhalten kann.
 */
export interface PdfHost {
    laden(): Promise<PdfLadung>;
    /** Info zur Datei (`GET /api/pdf/files/{id}`); fehlt im Wiki. */
    info?(): Promise<PdfInfo>;
    /**
     * Die angemeldete Person, soweit der Gastgeber sie kennt (Etappe 5):
     * Ihr Name steht in der Vorschau eines Stempels mit „Name und Datum“.
     * Gespeichert wird, was der Server setzt — nicht dieser Name.
     */
    person?: { name: string };
    /**
     * Lädt den GESPEICHERTEN Stand herunter, nie den Entwurf. Fehlt es,
     * gibt es keinen Herunterladen-Knopf — so in der Desktop-App, wo die
     * Datei schon auf der Platte liegt und „Kopie sichern“ im Menü steht.
     */
    herunterladen?(): Promise<void>;
    /** Druckt den gespeicherten Stand — alle Seiten, mit Anmerkungen. */
    drucken?(): Promise<void>;
    /**
     * Die Teil-PDF zum Drucken (Etappe 8): Seitenbereich und/oder ohne
     * Anmerkungen. Drive: `POST /api/pdf/files/{id}/print`; der Server
     * speichert nichts. Fehlt es, gibt es nur „alle Seiten“.
     */
    druckfassung?(befehl: DruckBefehl): Promise<ArrayBuffer>;
    /**
     * Druckt fertige PDF-Bytes über den Druckweg des Gastgebers (Desktop).
     * Fehlt es, druckt der Arbeitsplatz sie selbst im versteckten Rahmen.
     */
    bytesDrucken?(daten: ArrayBuffer, name: string): Promise<void>;
    /** Ohne Dialog auf den Standarddrucker (nur Desktop: Linux `lp`, macOS `lpr`). */
    schnelldruck?(): Promise<void>;
    /**
     * Eine geschützte Kopie des gespeicherten Stands (Etappe 9): Drive
     * `POST /api/pdf/files/{id}/protected`. Fehlt es, gibt es den Eintrag
     * „Geschützt herunterladen“ nicht. Lesen genügt.
     */
    geschuetzt?(befehl: SchutzBefehl): Promise<ArrayBuffer>;
    /**
     * Prüft das Rechte-Kennwort einer fremd geschützten Datei am Gastgeber
     * (#247): Drive `POST /api/pdf/files/{id}/owner-password`, 204 oder
     * `pdf.wrong_password`; gespeichert wird nichts. Fehlt es, gibt es den
     * Eintrag „Rechte-Kennwort eingeben“ nicht — die Sperren fallen nur für
     * ein Kennwort, das der Gastgeber bestätigt hat.
     */
    rechteKennwortPruefen?(kennwort: string): Promise<void>;
    speichern?(befehl: CommitBefehl, schluessel: string): Promise<CommitErgebnis>;
    extrahieren?(befehl: ExtraktBefehl, schluessel: string): Promise<ExtraktErgebnis>;
    /** Zielordner und Namen erfragen; `null` = abgebrochen. */
    zielWaehlen?(anfrage: ZielAnfrage): Promise<PdfZiel | null>;

    // Texterkennung (Etappe 3). Fehlt `ocrStarten`, gibt es die Gruppe
    // „Text erkennen“ nicht — so im Wiki.
    /** Seitenarten der gespeicherten Fassung (`GET …/pages`). */
    seitenarten?(): Promise<SeitenArten>;
    /** Reiht einen Auftrag ein (`POST …/jobs`, 202). */
    ocrStarten?(befehl: OcrBefehl, schluessel: string): Promise<PdfAuftrag>;
    /** Eigene offene und fertige Aufträge zur Datei (`GET /api/pdf/jobs?file_id=`). */
    auftraege?(fileId: string): Promise<PdfAuftrag[]>;
    auftrag?(id: string): Promise<PdfAuftrag>;
    auftragAbbrechen?(id: string): Promise<void>;
    /** Das Ergebnis-PDF zur Vorschau. Der Puffer geht wie bei `laden` an pdf.js über. */
    ergebnisLaden?(id: string): Promise<ArrayBuffer>;
    /** Macht aus dem Ergebnis eine Fassung oder neue Datei (`POST /api/pdf/jobs/{id}/commit`). */
    auftragVeroeffentlichen?(id: string, rumpf: AuftragVeroeffentlichen, schluessel: string): Promise<CommitErgebnis>;

    // Exportieren (Etappe 4). Fehlt eine der drei Methoden, gibt es die
    // Gruppe „Exportieren“ nicht — so im Wiki. Abfrage und Abbruch laufen
    // über `auftrag`, `auftraege` und `auftragAbbrechen` wie bei der OCR.
    /** Reiht die Analyse ein (`POST …/jobs` mit `kind: analyse`, 202). */
    analyseStarten?(befehl: AnalyseBefehl, schluessel: string): Promise<PdfAuftrag>;
    /** Das Dokumentmodell eines fertigen Auftrags (`GET /api/pdf/jobs/{id}/model`), roh. */
    modellLaden?(id: string): Promise<unknown>;
    /** Schreibt die neue Datei (`POST /api/pdf/jobs/{id}/export`, 201). */
    exportieren?(id: string, befehl: ExportBefehl, schluessel: string): Promise<ExportErgebnis>;

    // Dateien binden (Server seit Etappe 1). Fehlt `binden` oder
    // `dateienWaehlen`, gibt es die Gruppe „Dateien binden“ nicht — so im
    // Wiki. Lesen genügt, denn das Ergebnis ist eine neue Datei.
    /** Bindet mehrere Dateien zu einer neuen (`POST /api/pdf/merge`, 201). */
    binden?(befehl: BindeBefehl, schluessel: string): Promise<BindeErgebnis>;
    /** Weitere PDF-Dateien aus der Ablage wählen; leer = abgebrochen. */
    dateienWaehlen?(): Promise<DateiWahl[]>;
    /** Info zu einer beliebigen Datei (`GET /api/pdf/files/{id}`) — Fassung, Seitenzahl, Signatur, Formular. */
    quelleInfo?(id: string): Promise<PdfInfo>;

    // Fassungen (Etappe 8). Fehlt `fassungen` oder `fassungLaden`, gibt es
    // „Fassungen“ im Datei-Menü nicht — so im Wiki und auf dem Desktop.
    /** Die früheren Fassungen der Datei (`GET /api/files/{id}/versions`), neueste zuerst. */
    fassungen?(): Promise<PdfFassung[]>;
    /** Die Bytes einer Fassung, nur zum Ansehen. Der Puffer geht wie bei `laden` an pdf.js über. */
    fassungLaden?(version: number): Promise<ArrayBuffer>;
    /**
     * Macht eine Fassung zur neuen aktuellen (`POST /api/files/{id}/versions/{v}/restore`);
     * legt wie Drive eine neue Fassung an. Nur mit Recht `edit` angeboten.
     */
    fassungWiederherstellen?(version: number): Promise<{ version?: number }>;
}

/**
 * Ein Fehler des Gastgebers mit HTTP-Status und Fehlercode.
 *
 * `status` 0 heißt: keine Antwort (Netz weg, Zeitüberschreitung). `meldung`
 * ist ein fertiger, übersetzter Satz des Gastgebers, falls er einen hat —
 * der Arbeitsplatz zeigt ihn unter seiner eigenen Zustandsanzeige.
 */
export class PdfHostFehler extends Error {
    readonly status: number;
    readonly code: string;
    readonly params: Record<string, unknown>;
    readonly meldung?: string;

    constructor(status: number, code: string, params: Record<string, unknown> = {}, meldung?: string) {
        super(meldung || code);
        this.name = 'PdfHostFehler';
        this.status = status;
        this.code = code;
        this.params = params;
        this.meldung = meldung;
    }

    /** Erhaltungsbericht bei `pdf.preservation_failed`. */
    get bericht(): ErhaltungsBericht | undefined {
        const b = this.params.report;
        return b && typeof b === 'object' ? (b as ErhaltungsBericht) : undefined;
    }

    /** Aktuelle Fassung bei `pdf.version_conflict`. */
    get aktuelleVersion(): number | undefined {
        const v = Number(this.params.current_version);
        return Number.isFinite(v) && v > 0 ? v : undefined;
    }
}

/** Macht aus allem, was geworfen wurde, einen PdfHostFehler. */
export function alsHostFehler(fehler: unknown): PdfHostFehler {
    if (fehler instanceof PdfHostFehler) return fehler;
    const text = fehler instanceof Error ? fehler.message : undefined;
    return new PdfHostFehler(0, 'network', {}, text);
}

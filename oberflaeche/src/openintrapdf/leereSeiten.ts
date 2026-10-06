// SPDX-License-Identifier: Apache-2.0
//
// „Leere Seiten prüfen“ — Kandidaten VORSCHLAGEN, nie selbst entfernen.
//
// Der alte Betrachter hat jede Seite klein gerendert, die nicht weißen
// Bildpunkte gezählt und alles unter 0,2 % sofort zum Entfernen vorgemerkt.
// Das ist eine Schätzung, keine Wahrheit: Eine Seite mit einem blassen
// Stempel oder einer dünnen Unterschrift kann durchrutschen. Deshalb gilt
// jetzt (Konzept Kap. 01, Ablauf „Scan aufräumen“):
//
//   - Eine Seite mit Text (getTextContent), mit Anmerkungen oder mit
//     Formularfeldern ist NIE Kandidat — egal, wie weiß sie aussieht.
//   - Nur was dann noch (fast) keine sichtbaren Bildpunkte hat, wird
//     vorgeschlagen, MIT Grund und kleiner Vorschau.
//   - Ein Mensch bestätigt; erst dann landet es als Befehl im Entwurf und
//     ist wie jeder andere Schritt rückgängig zu machen.

/** Was über eine Seite gemessen wurde. */
export interface SeitenBefund {
    /** Anzahl sichtbarer Zeichen (ohne Leerraum) in der Textebene. */
    textZeichen: number;
    /** Anmerkungen außer Formularfeldern (Notizen, Links, Stempel …). */
    anmerkungen: number;
    /** Formularfelder (Widgets). */
    formularfelder: number;
    /** Anteil nicht weißer Bildpunkte, 0..1. */
    anteilNichtWeiss: number;
}

/** Warum eine Seite vorgeschlagen wird. */
export type LeerGrund = 'kein_inhalt' | 'fast_leer';

/** Unter diesem Anteil gilt eine Seite als fast leer (wie im alten Betrachter). */
export const SCHWELLE_FAST_LEER = 0.002;

/** Die Kandidatenregel. `null` = kein Kandidat. */
export function leerGrund(b: SeitenBefund): LeerGrund | null {
    if (b.textZeichen > 0 || b.anmerkungen > 0 || b.formularfelder > 0) return null;
    if (b.anteilNichtWeiss <= 0) return 'kein_inhalt';
    if (b.anteilNichtWeiss < SCHWELLE_FAST_LEER) return 'fast_leer';
    return null;
}

/**
 * Anteil nicht weißer Bildpunkte in RGBA-Daten.
 *
 * Jeder `schritt`-te Bildpunkt genügt für die Schätzung. „Nicht weiß“ heißt:
 * ein Farbkanal unter 230 — Scanrauschen knapp unter Weiß zählt nicht.
 */
export function nichtWeissAnteil(rgba: ArrayLike<number>, schritt = 4): number {
    const sprung = 4 * Math.max(1, schritt);
    let gezaehlt = 0;
    let dunkel = 0;
    for (let i = 0; i + 2 < rgba.length; i += sprung) {
        gezaehlt++;
        if (rgba[i] < 230 || rgba[i + 1] < 230 || rgba[i + 2] < 230) dunkel++;
    }
    return gezaehlt ? dunkel / gezaehlt : 0;
}

/** Zählt sichtbare Zeichen einer pdf.js-Textebene. */
export function zeichenZaehlen(items: readonly unknown[]): number {
    let n = 0;
    for (const item of items) {
        const str = (item as { str?: unknown }).str;
        if (typeof str === 'string') n += str.replace(/\s+/g, '').length;
    }
    return n;
}

/** pdf.js-Anmerkungstypen, soweit hier gebraucht (AnnotationType). */
export const ANMERKUNG_POPUP = 16;
export const ANMERKUNG_WIDGET = 20;

/** Teilt eine Anmerkungsliste in Formularfelder und übrige Anmerkungen. */
export function anmerkungenZaehlen(liste: readonly { annotationType?: number }[]): { anmerkungen: number; formularfelder: number } {
    let anmerkungen = 0;
    let formularfelder = 0;
    for (const a of liste) {
        if (a.annotationType === ANMERKUNG_WIDGET) formularfelder++;
        // Ein Popup gehört zu einer anderen Anmerkung, die schon zählt.
        else if (a.annotationType !== ANMERKUNG_POPUP) anmerkungen++;
    }
    return { anmerkungen, formularfelder };
}

// ---------------------------------------------------------------------
// Der Lauf über das Dokument
// ---------------------------------------------------------------------

/** Das Nötigste einer pdf.js-Seite — damit sich der Lauf ohne pdf.js prüfen lässt. */
export interface PruefSeite {
    rotate: number;
    getTextContent(): Promise<{ items: readonly unknown[] }>;
    getAnnotations(params?: { intent?: string }): Promise<readonly { annotationType?: number }[]>;
}

export interface PruefDokument {
    getPage(nummer: number): Promise<PruefSeite>;
}

/** Rendert eine Seite klein und liefert Anteil + Vorschau. */
export type Rasterer = (seite: PruefSeite, drehung: number) => Promise<{ anteil: number; vorschau?: string }>;

export interface LeerKandidat {
    /** Kennung des Planeintrags. */
    id: string;
    quelle: number;
    grund: LeerGrund;
    anteil: number;
    vorschau?: string;
}

/**
 * Prüft die übergebenen Planeinträge. Text und Anmerkungen werden zuerst
 * gelesen; gerendert wird nur, wer danach noch in Frage kommt — das spart
 * bei einem Textdokument fast die ganze Arbeit.
 *
 * Duplikate (gleiche Quelle) werden nur einmal gemessen.
 */
export async function leereSeitenSuchen(
    dokument: PruefDokument,
    eintraege: readonly { id: string; quelle: number; drehung: number }[],
    rastern: Rasterer,
    optionen: { signal?: AbortSignal; fortschritt?: (erledigt: number, gesamt: number) => void } = {},
): Promise<LeerKandidat[]> {
    const gemessen = new Map<number, { grund: LeerGrund | null; anteil: number; vorschau?: string }>();
    const kandidaten: LeerKandidat[] = [];
    let erledigt = 0;
    for (const e of eintraege) {
        if (optionen.signal?.aborted) throw new DOMException('abgebrochen', 'AbortError');
        let messung = gemessen.get(e.quelle);
        if (!messung) {
            const seite = await dokument.getPage(e.quelle + 1);
            const text = await seite.getTextContent();
            const textZeichen = zeichenZaehlen(text.items);
            const { anmerkungen, formularfelder } = textZeichen > 0
                ? { anmerkungen: 0, formularfelder: 0 }
                : anmerkungenZaehlen(await seite.getAnnotations({ intent: 'display' }));
            if (textZeichen > 0 || anmerkungen > 0 || formularfelder > 0) {
                messung = { grund: null, anteil: 1 };
            } else {
                const r = await rastern(seite, e.drehung);
                messung = {
                    grund: leerGrund({ textZeichen, anmerkungen, formularfelder, anteilNichtWeiss: r.anteil }),
                    anteil: r.anteil,
                    vorschau: r.vorschau,
                };
            }
            gemessen.set(e.quelle, messung);
        }
        if (messung.grund) {
            kandidaten.push({ id: e.id, quelle: e.quelle, grund: messung.grund, anteil: messung.anteil, vorschau: messung.vorschau });
        }
        optionen.fortschritt?.(++erledigt, eintraege.length);
    }
    return kandidaten;
}

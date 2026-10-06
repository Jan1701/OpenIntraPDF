// SPDX-License-Identifier: Apache-2.0
//
// Stempel (Vertrag Etappe 5): die feste Liste, Farben, Maße, das Label und
// das Merken der Wahl. Reine Werte und Funktionen, kein React.
//
// Der Server zeichnet den Stempel (abgerundeter Doppelrahmen, fettes Label,
// bei „Name und Datum“ eine zweite Zeile mit Autor und Datum aus SEINEM
// Wissen). Der Client schickt nur Rect, Farbe und das Feld `stamp`:
// Label — schon großgeschrieben —, `/Name` aus der festen Liste, den
// Haken und die Sprache fürs Datumsformat.

import type { StempelAngabe, StempelName } from './typen';

export type StempelId = 'draft' | 'checked' | 'approved' | 'paid' | 'booked' | 'received' | 'done' | 'confidential';

export const STEMPEL_FARBEN = [
    { id: 'rot', hex: '#c62828' },
    { id: 'gruen', hex: '#2e7d32' },
    { id: 'blau', hex: '#1565c0' },
    { id: 'grau', hex: '#455a64' },
] as const;

type StempelFarbeId = (typeof STEMPEL_FARBEN)[number]['id'];

/** Die acht Stempel in Anzeigereihenfolge; das Label kommt übersetzt aus dem Katalog (`openintrapdf.stempel.label.<id>`). */
export const STEMPEL: readonly { id: StempelId; name: StempelName; farbe: StempelFarbeId }[] = [
    { id: 'draft', name: 'Draft', farbe: 'grau' },
    { id: 'checked', name: 'Checked', farbe: 'gruen' },
    { id: 'approved', name: 'Approved', farbe: 'gruen' },
    { id: 'paid', name: 'Paid', farbe: 'blau' },
    { id: 'booked', name: 'Booked', farbe: 'blau' },
    { id: 'received', name: 'Received', farbe: 'blau' },
    { id: 'done', name: 'Done', farbe: 'gruen' },
    { id: 'confidential', name: 'Confidential', farbe: 'rot' },
];

export const stempelFarbeHex = (id: StempelFarbeId): string => STEMPEL_FARBEN.find(f => f.id === id)!.hex;

/** Höchstlänge des Labels (Server: 1–40 Zeichen). */
export const STEMPEL_HOECHST_ZEICHEN = 40;

/** Höhe eines neuen Stempels in PDF-Punkten. */
export const STEMPEL_HOEHE = 50;

/** Kleiner als das lässt sich ein Stempel nicht ziehen (PDF-Punkte). */
export const STEMPEL_MINDEST = 40;

/** Größte Schrift des Labels in Punkten (Vertrag). */
export const STEMPEL_SCHRIFT_HOECHST = 28;

// Maße des Erscheinungsbilds, wie der Server sie zeichnet: außen 2 pt,
// Abstand 2 pt, innen 0,75 pt — dazu etwas Luft bis zur Schrift.
const RAHMEN = 2 + 2 + 0.75;
const LUFT = 5;

/**
 * Das Label, wie es hinausgeht: eine Zeile, ohne Steuerzeichen, mit
 * `toLocaleUpperCase(sprache)` großgeschrieben, höchstens 40 Zeichen.
 * Leer, wenn nichts Brauchbares übrig bleibt.
 */
export function stempelLabel(text: string, sprache: string): string {
    // Steuerzeichen (auch Zeilenumbrüche) werden zu Leerzeichen; mehrere fallen zusammen.
    const eineZeile = text.replace(/[\p{Cc}\s]+/gu, ' ').trim();
    let gross: string;
    try {
        gross = eineZeile.toLocaleUpperCase(sprache);
    } catch {
        gross = eineZeile.toUpperCase();
    }
    // Nach Codepunkten schneiden, damit kein Zeichen halbiert wird.
    return Array.from(gross).slice(0, STEMPEL_HOECHST_ZEICHEN).join('');
}

/**
 * Breite eines neuen Stempels nach Labellänge, 150–260 pt: Bei 28 pt fetter
 * Helvetica ist ein Großbuchstabe im Mittel gut 17 pt breit; längere Labels
 * bekommen bis zur Höchstbreite mehr Platz, darüber wird die Schrift kleiner.
 */
export function stempelBreite(label: string): number {
    const zeichen = Array.from(label).length;
    return Math.max(150, Math.min(260, Math.round(zeichen * 17.4 + 24)));
}

/**
 * Schriftgrößen der Vorschau in Punkten: das Label so groß, dass es in
 * Breite und Höhe passt (höchstens 28 pt), die zweite Zeile 40 % davon,
 * mindestens 6 pt — die Regel des Vertrags.
 */
export function stempelSchrift(breite: number, hoehe: number, label: string, signed: boolean): { label: number; zeile: number } {
    const innenBreite = Math.max(1, breite - 2 * (RAHMEN + LUFT));
    const innenHoehe = Math.max(1, hoehe - 2 * (RAHMEN + LUFT));
    const zeichen = Math.max(1, Array.from(label).length);
    // Fette Helvetica: Großbuchstaben im Mittel 0,62 em breit; Zeilenhöhe 1,15 em.
    const nachBreite = innenBreite / (zeichen * 0.62);
    const nachHoehe = innenHoehe / (signed ? 1.15 + 0.4 * 1.15 : 1.15);
    const l = Math.max(4, Math.min(STEMPEL_SCHRIFT_HOECHST, nachBreite, nachHoehe));
    return { label: l, zeile: Math.max(6, l * 0.4) };
}

// ---------------------------------------------------------------------
// Die Wahl in der Werkzeugleiste und ihr Merken (pro Person und Browser)
// ---------------------------------------------------------------------

export interface StempelWahl {
    id: StempelId | 'custom';
    /** Was die Person bei „Eigener Text“ getippt hat, so wie getippt. */
    eigenerText: string;
    /** `#rrggbb`, eine der vier Stempelfarben. */
    farbe: string;
    signed: boolean;
}

export const STEMPEL_SPEICHER = 'openintrapdf.stempel';

export function stempelWahlStandard(): StempelWahl {
    return { id: STEMPEL[0].id, eigenerText: '', farbe: stempelFarbeHex(STEMPEL[0].farbe), signed: true };
}

const istStempelId = (id: unknown): id is StempelId | 'custom' => id === 'custom' || STEMPEL.some(s => s.id === id);
const istStempelFarbe = (hex: unknown): hex is string => STEMPEL_FARBEN.some(f => f.hex === hex);

/** Zuletzt gewählter Stempel, Farbe und Haken; Unbrauchbares fällt auf den Standard zurück. */
export function stempelWahlLesen(): StempelWahl {
    const standard = stempelWahlStandard();
    try {
        const roh = localStorage.getItem(STEMPEL_SPEICHER);
        if (!roh) return standard;
        const w = JSON.parse(roh) as Partial<StempelWahl> | null;
        if (!w || typeof w !== 'object') return standard;
        return {
            id: istStempelId(w.id) ? w.id : standard.id,
            eigenerText: typeof w.eigenerText === 'string' ? w.eigenerText.slice(0, STEMPEL_HOECHST_ZEICHEN) : '',
            farbe: istStempelFarbe(w.farbe) ? w.farbe : standard.farbe,
            signed: typeof w.signed === 'boolean' ? w.signed : standard.signed,
        };
    } catch {
        return standard;
    }
}

export function stempelWahlMerken(w: StempelWahl): void {
    try {
        localStorage.setItem(STEMPEL_SPEICHER, JSON.stringify(w));
    } catch {
        // Privates Fenster o. Ä.: Die Wahl gilt dann nur bis zum Schließen.
    }
}

/**
 * Das Feld `stamp` des Befehls aus der Wahl. `katalogLabel` liefert das
 * übersetzte Label eines festen Stempels (schon großgeschrieben; die
 * Großschreibung wird trotzdem angewandt, das ist ohne Wirkung, wenn sie
 * schon stimmt). `null`, wenn bei „Eigener Text“ nichts steht — dann gibt
 * es nichts zu stempeln.
 */
export function stempelAngabe(w: StempelWahl, katalogLabel: (id: StempelId) => string, sprache: string): StempelAngabe | null {
    const lang = sprache.slice(0, 10);
    if (w.id === 'custom') {
        const label = stempelLabel(w.eigenerText, sprache);
        return label ? { label, name: 'Custom', signed: w.signed, lang } : null;
    }
    const s = STEMPEL.find(x => x.id === w.id) ?? STEMPEL[0];
    const label = stempelLabel(katalogLabel(s.id), sprache);
    return label ? { label, name: s.name, signed: w.signed, lang } : null;
}

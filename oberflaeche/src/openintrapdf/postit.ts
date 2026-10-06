// SPDX-License-Identifier: Apache-2.0
//
// Post-it (Vertrag Etappe 5): Farben, Maße und das Merken der Farbwahl.
// Reine Werte und Funktionen, kein React, kein pdf.js.
//
// Im PDF ist der Zettel ein FreeText mit eigenem Erscheinungsbild — Füllung,
// dunklerer Rand, Eselsohr und Zeilenumbruch zeichnet der Server. Hier
// steht nur, was die Vorschau im Entwurf braucht und was der Befehl
// hinausträgt: Rect, Text, Füllfarbe und die Schriftgröße 11.

export const POSTIT_FARBEN = [
    { id: 'gelb', hex: '#fff59d' },
    { id: 'gruen', hex: '#c5e1a5' },
    { id: 'rosa', hex: '#f8bbd0' },
    { id: 'blau', hex: '#b3e5fc' },
    { id: 'orange', hex: '#ffcc80' },
] as const;

/** Breite × Höhe eines neuen Zettels in PDF-Punkten. */
export const POSTIT_GROESSE: readonly [number, number] = [170, 130];

/** Schriftgröße auf dem Zettel — der Server nimmt ohne Angabe dieselbe. */
export const POSTIT_SCHRIFT = 11;

/** Innenabstand des Textes in Punkten, wie im Erscheinungsbild des Servers. */
export const POSTIT_INNENABSTAND = 6;

/** Textfarbe auf dem Zettel (Dunkelgrau, wie beim Server). */
export const POSTIT_TEXTFARBE = '#1f2937';

/** Kleiner als das lässt sich ein Zettel nicht ziehen — er wäre nicht mehr zu greifen (PDF-Punkte). */
export const POSTIT_MINDEST = 40;

/**
 * Um `anteil` dunklere Farbe als CSS — Rand und Eselsohr des Zettels. Die
 * Farbe kommt als r, g, b in 0–1, wie sie im Befehl steht.
 */
export function dunkler([r, g, b]: readonly number[], anteil = 0.25): string {
    const f = 1 - anteil;
    return `rgb(${Math.round(r * f * 255)} ${Math.round(g * f * 255)} ${Math.round(b * f * 255)})`;
}

// ---------------------------------------------------------------------
// Merken der Farbwahl (pro Person und Browser, wie thema.ts)
// ---------------------------------------------------------------------

export const POSTIT_SPEICHER = 'openintrapdf.postit';

const istPostitFarbe = (hex: unknown): hex is (typeof POSTIT_FARBEN)[number]['hex'] =>
    POSTIT_FARBEN.some(f => f.hex === hex);

/** Zuletzt gewählte Zettelfarbe; ohne gültige Angabe Gelb. */
export function postitFarbeLesen(): string {
    try {
        const hex = localStorage.getItem(POSTIT_SPEICHER);
        return istPostitFarbe(hex) ? hex : POSTIT_FARBEN[0].hex;
    } catch {
        return POSTIT_FARBEN[0].hex;
    }
}

export function postitFarbeMerken(hex: string): void {
    try {
        localStorage.setItem(POSTIT_SPEICHER, hex);
    } catch {
        // Privates Fenster o. Ä.: Die Wahl gilt dann nur bis zum Schließen.
    }
}

// SPDX-License-Identifier: Apache-2.0
//
// Anzeige ↔ PDF-Benutzerraum — ausschließlich über die Viewport-
// Transformation von pdf.js.
//
// Konzept Kap. 04: „Keine zweite Handformel ‚Y = Höhe − Mausposition‘ neben
// der Viewertransformation.“ Alles hier ruft `convertToPdfPoint` bzw.
// `convertToViewportPoint` des `PageViewport`s der Seite, der CropBox-
// Versatz, Drehung, Zoom und UserUnit schon enthält. Damit stimmen die
// Koordinaten auf gedrehten Seiten, bei versetzten Boxen und jedem Zoom —
// ohne dass hier ein Sonderfall steht.
//
// Anzeigekoordinaten sind CSS-Pixel relativ zur linken oberen Ecke des
// Seiten-Divs (= Ursprung des Viewports).

import type { AnmerkungsArt, PdfRechteck, StempelAngabe } from './typen';
import type { NeueAnmerkung } from './anmerkungen';
import { POSTIT_GROESSE, POSTIT_SCHRIFT } from './postit';
import { STEMPEL_HOEHE, stempelBreite } from './stempel';

/** Der Ausschnitt von pdf.js `PageViewport`, den dieser Code braucht. */
export interface Viewport {
    convertToPdfPoint(x: number, y: number): number[];
    convertToViewportPoint(x: number, y: number): number[];
    transform: number[];
    width: number;
    height: number;
}

/** CSS-Pixel je PDF-Einheit (Zoom × UserUnit). */
export function massstab(vp: Viewport): number {
    return Math.hypot(vp.transform[0], vp.transform[1]);
}

export function inPdf(vp: Viewport, x: number, y: number): [number, number] {
    const [px, py] = vp.convertToPdfPoint(x, y);
    return [px, py];
}

export function inAnzeige(vp: Viewport, x: number, y: number): [number, number] {
    const [ax, ay] = vp.convertToViewportPoint(x, y);
    return [ax, ay];
}

/** Rechteck aus zwei Anzeigepunkten, normalisiert zu `[llx, lly, urx, ury]`. */
export function rechteckInPdf(vp: Viewport, x1: number, y1: number, x2: number, y2: number): PdfRechteck {
    const a = inPdf(vp, x1, y1);
    const b = inPdf(vp, x2, y2);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export interface AnzeigeBox { links: number; oben: number; breite: number; hoehe: number }

/** Umschließende Anzeigebox eines PDF-Rechtecks (nach Drehung wieder achsenparallel). */
export function rechteckInAnzeige(vp: Viewport, r: PdfRechteck): AnzeigeBox {
    const ecken = [inAnzeige(vp, r[0], r[1]), inAnzeige(vp, r[2], r[1]), inAnzeige(vp, r[2], r[3]), inAnzeige(vp, r[0], r[3])];
    const xs = ecken.map(e => e[0]);
    const ys = ecken.map(e => e[1]);
    const links = Math.min(...xs);
    const oben = Math.min(...ys);
    return { links, oben, breite: Math.max(...xs) - links, hoehe: Math.max(...ys) - oben };
}

/**
 * Ein Quad (8 Zahlen, PDF-Raum) aus einer Anzeigebox — in der Reihenfolge,
 * die Acrobat erwartet: oben links, oben rechts, unten links, unten rechts,
 * jeweils bezogen auf die LESERICHTUNG des Textes, also auf die Anzeige.
 */
export function quadAusAnzeige(vp: Viewport, links: number, oben: number, rechts: number, unten: number): number[] {
    return [
        ...inPdf(vp, links, oben),
        ...inPdf(vp, rechts, oben),
        ...inPdf(vp, links, unten),
        ...inPdf(vp, rechts, unten),
    ];
}

/** Die vier Anzeigepunkte eines Quads: oben links, oben rechts, unten links, unten rechts. */
export function quadInAnzeige(vp: Viewport, q: readonly number[]): [number, number][] {
    return [inAnzeige(vp, q[0], q[1]), inAnzeige(vp, q[2], q[3]), inAnzeige(vp, q[4], q[5]), inAnzeige(vp, q[6], q[7])];
}

/** Umschließendes Rechteck einer flachen Punktliste (x, y, x, y, …), um `rand` vergrößert. */
export function rechteckUmPunkte(punkte: readonly number[], rand = 0): PdfRechteck {
    let llx = Infinity;
    let lly = Infinity;
    let urx = -Infinity;
    let ury = -Infinity;
    for (let i = 0; i + 1 < punkte.length; i += 2) {
        llx = Math.min(llx, punkte[i]);
        urx = Math.max(urx, punkte[i]);
        lly = Math.min(lly, punkte[i + 1]);
        ury = Math.max(ury, punkte[i + 1]);
    }
    return [llx - rand, lly - rand, urx + rand, ury + rand];
}

// Zwei Nachkommastellen reichen für PDF-Einheiten (1/72 Zoll); `|| 0` macht aus -0 eine 0.
const runden = (v: number) => Math.round(v * 100) / 100 || 0;
const gerundet = <T extends number[]>(liste: T): T => liste.map(runden) as T;

// ---------------------------------------------------------------------
// Gesten → Anmerkung
// ---------------------------------------------------------------------

/** Was die Person auf der Seite getan hat, in Anzeigekoordinaten der Seite. */
export type Geste =
    | { art: 'punkt'; x: number; y: number }
    | { art: 'rechteck'; x1: number; y1: number; x2: number; y2: number }
    | { art: 'linie'; x1: number; y1: number; x2: number; y2: number }
    | { art: 'pfad'; punkte: number[] }
    /** Client-Rechtecke einer Textauswahl, schon relativ zur Seite. */
    | { art: 'auswahl'; boxen: { links: number; oben: number; rechts: number; unten: number }[] };

export interface Stil {
    color: [number, number, number];
    width: number;
    font_size: number;
    /** Nur beim Werkzeug „Stempel“: was gestempelt wird. Fehlt es, entsteht kein Stempel. */
    stamp?: StempelAngabe;
}

/** Kantenlänge des Notizsymbols in PDF-Einheiten (Acrobat: 20). */
export const NOTIZ_GROESSE = 20;

/** Kleiner als das ist ein Klick, keine Geste — es entsteht nichts. */
export const MINDEST_GESTE = 4;

/** PDF-Rechteck einer Anzeigebox (links, oben, Breite, Höhe in CSS-Pixeln der Seite), gerundet. */
export function rechteckAusAnzeigeBox(vp: Viewport, b: AnzeigeBox): PdfRechteck {
    return gerundet(rechteckInPdf(vp, b.links, b.oben, b.links + b.breite, b.oben + b.hoehe));
}

/**
 * Ein Kasten von `breite` × `hoehe` PDF-Punkten, dessen linke obere Ecke IN
 * DER ANZEIGE am Klickpunkt liegt — so steht ein Zettel oder Stempel auch
 * auf einer gedrehten Seite aufrecht. Ragt er über die Seite hinaus, rückt
 * er hinein; ist die Seite kleiner als er, bleibt er an ihrem Rand.
 */
export function rechteckAnKlick(vp: Viewport, x: number, y: number, breite: number, hoehe: number): PdfRechteck {
    const m = massstab(vp);
    const b = breite * m;
    const h = hoehe * m;
    const links = Math.max(0, Math.min(x, vp.width - b));
    const oben = Math.max(0, Math.min(y, vp.height - h));
    return rechteckAusAnzeigeBox(vp, { links, oben, breite: b, hoehe: h });
}

/**
 * Baut aus Werkzeug, Geste und Stil den Anmerkungsbefehl ohne `client_id`.
 * `null`, wenn die Geste zu klein oder zum Werkzeug unpassend war.
 */
export function anmerkungAusGeste(
    art: AnmerkungsArt, geste: Geste, vp: Viewport, page: number, stil: Stil,
): Omit<NeueAnmerkung, 'client_id'> | null {
    const basis = { page, kind: art, contents: '', color: stil.color, reply_to: null };
    switch (art) {
        case 'note': {
            if (geste.art !== 'punkt') return null;
            const [x, y] = inPdf(vp, geste.x, geste.y);
            const h = NOTIZ_GROESSE / 2;
            return { ...basis, rect: gerundet([x - h, y - h, x + h, y + h]) };
        }
        case 'sticky': {
            if (geste.art !== 'punkt') return null;
            const rect = rechteckAnKlick(vp, geste.x, geste.y, POSTIT_GROESSE[0], POSTIT_GROESSE[1]);
            return { ...basis, rect, font_size: POSTIT_SCHRIFT };
        }
        case 'stamp': {
            // Ohne Angabe (etwa „Eigener Text“ ohne Text) gibt es nichts zu stempeln.
            if (geste.art !== 'punkt' || !stil.stamp) return null;
            const rect = rechteckAnKlick(vp, geste.x, geste.y, stempelBreite(stil.stamp.label), STEMPEL_HOEHE);
            return { ...basis, rect, stamp: stil.stamp };
        }
        case 'freetext':
        case 'square':
        case 'circle':
        case 'link': {
            if (geste.art !== 'rechteck') return null;
            if (Math.abs(geste.x2 - geste.x1) < MINDEST_GESTE || Math.abs(geste.y2 - geste.y1) < MINDEST_GESTE) return null;
            const rect = gerundet(rechteckInPdf(vp, geste.x1, geste.y1, geste.x2, geste.y2));
            if (art === 'freetext') return { ...basis, rect, font_size: stil.font_size };
            // Ein Link (Etappe 9) hat nur sein Rechteck; das Ziel kommt aus dem Dialog.
            if (art === 'link') return { ...basis, rect };
            return { ...basis, rect, width: stil.width };
        }
        case 'line':
        case 'arrow': {
            if (geste.art !== 'linie') return null;
            if (Math.hypot(geste.x2 - geste.x1, geste.y2 - geste.y1) < MINDEST_GESTE) return null;
            const a = inPdf(vp, geste.x1, geste.y1);
            const b = inPdf(vp, geste.x2, geste.y2);
            const line = gerundet([a[0], a[1], b[0], b[1]] as [number, number, number, number]);
            // Ein Pfeilkopf ragt über die Endpunkte hinaus — der Rahmen muss ihn fassen.
            const rand = art === 'arrow' ? stil.width * 4 + 2 : stil.width + 1;
            return { ...basis, rect: gerundet(rechteckUmPunkte(line, rand)), line, width: stil.width };
        }
        case 'ink': {
            if (geste.art !== 'pfad' || geste.punkte.length < 4) return null;
            const pfad: number[] = [];
            for (let i = 0; i + 1 < geste.punkte.length; i += 2) pfad.push(...inPdf(vp, geste.punkte[i], geste.punkte[i + 1]));
            const punkte = gerundet(pfad);
            return { ...basis, rect: gerundet(rechteckUmPunkte(punkte, stil.width + 1)), paths: [punkte], width: stil.width };
        }
        case 'highlight':
        case 'underline':
        case 'strikeout': {
            if (geste.art !== 'auswahl' || !geste.boxen.length) return null;
            const quads = geste.boxen
                .filter(b => b.rechts - b.links >= 1 && b.unten - b.oben >= 1)
                .map(b => gerundet(quadAusAnzeige(vp, b.links, b.oben, b.rechts, b.unten)));
            if (!quads.length) return null;
            return { ...basis, rect: gerundet(rechteckUmPunkte(quads.flat())), quads };
        }
    }
}

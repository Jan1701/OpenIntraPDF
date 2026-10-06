// SPDX-License-Identifier: Apache-2.0
//
// Anzeige ↔ PDF: geprüft gegen einen Nachbau des pdf.js-`PageViewport`s
// mit DENSELBEN Formeln (Konstruktor, applyTransform, applyInverseTransform
// aus pdfjs-dist 6.3.289). Kein Mock, der die Umrechnung vereinfacht — sonst
// prüfte der Test nur sich selbst.

import { describe, expect, it } from 'vitest';
import {
    anmerkungAusGeste, inAnzeige, inPdf, massstab, quadAusAnzeige, quadInAnzeige, rechteckAusAnzeigeBox, rechteckInAnzeige,
    rechteckInPdf, rechteckUmPunkte,
} from './koordinaten';
import type { Stil, Viewport } from './koordinaten';

/** Nachbau von pdf.js `PageViewport` (display/display_utils.js, 6.3.289). */
export function viewportNachbau(viewBox: number[], scale: number, rotation: number, offsetX = 0, offsetY = 0, userUnit = 1): Viewport {
    const s = scale * userUnit;
    const centerX = (viewBox[2] + viewBox[0]) / 2;
    const centerY = (viewBox[3] + viewBox[1]) / 2;
    let a: number; let b: number; let c: number; let d: number;
    switch (((rotation % 360) + 360) % 360) {
        case 180: [a, b, c, d] = [-1, 0, 0, 1]; break;
        case 90: [a, b, c, d] = [0, 1, 1, 0]; break;
        case 270: [a, b, c, d] = [0, -1, -1, 0]; break;
        default: [a, b, c, d] = [1, 0, 0, -1];
    }
    let ox: number; let oy: number; let width: number; let height: number;
    if (a === 0) {
        ox = Math.abs(centerY - viewBox[1]) * s + offsetX;
        oy = Math.abs(centerX - viewBox[0]) * s + offsetY;
        width = (viewBox[3] - viewBox[1]) * s;
        height = (viewBox[2] - viewBox[0]) * s;
    } else {
        ox = Math.abs(centerX - viewBox[0]) * s + offsetX;
        oy = Math.abs(centerY - viewBox[1]) * s + offsetY;
        width = (viewBox[2] - viewBox[0]) * s;
        height = (viewBox[3] - viewBox[1]) * s;
    }
    const m = [a * s, b * s, c * s, d * s, ox - a * s * centerX - c * s * centerY, oy - b * s * centerX - d * s * centerY];
    return {
        transform: m,
        width,
        height,
        convertToViewportPoint: (x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]],
        convertToPdfPoint: (x, y) => {
            const det = m[0] * m[3] - m[1] * m[2];
            return [(x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / det, (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / det];
        },
    };
}

const nah = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

const stil: Stil = { color: [1, 0, 0], width: 2, font_size: 12 };

describe('Anzeige ↔ PDF über den Viewport', () => {
    // CropBox beginnt nicht bei 0 — genau der Fall, an dem Handformeln scheitern.
    const box = [10, 20, 210, 320];

    it.each([0, 90, 180, 270])('Drehung %i°: hin und zurück ergibt denselben Punkt, Ecken landen richtig', grad => {
        const vp = viewportNachbau(box, 1.5, grad);
        for (const [x, y] of [[10, 20], [210, 320], [57.5, 123.25], [110, 170]]) {
            nah(inPdf(vp, ...inAnzeige(vp, x, y)), [x, y]);
        }
        // Die vier Ecken der Box füllen die Anzeige genau aus.
        const ecken = [inAnzeige(vp, 10, 20), inAnzeige(vp, 210, 20), inAnzeige(vp, 210, 320), inAnzeige(vp, 10, 320)];
        expect(Math.min(...ecken.map(e => e[0]))).toBeCloseTo(0);
        expect(Math.min(...ecken.map(e => e[1]))).toBeCloseTo(0);
        expect(Math.max(...ecken.map(e => e[0]))).toBeCloseTo(vp.width);
        expect(Math.max(...ecken.map(e => e[1]))).toBeCloseTo(vp.height);
        expect(massstab(vp)).toBeCloseTo(1.5);
    });

    it('0°: links oben in der Anzeige ist (llx, ury) im PDF; Zoom skaliert linear', () => {
        const vp = viewportNachbau(box, 2, 0);
        nah(inPdf(vp, 0, 0), [10, 320]);
        nah(inPdf(vp, 400, 600), [210, 20]);
        nah(inAnzeige(vp, 60, 220), [100, 200]);
    });

    it('90°: die Seite liegt quer, die PDF-Achsen sind vertauscht', () => {
        const vp = viewportNachbau(box, 1, 90);
        expect([vp.width, vp.height]).toEqual([300, 200]);
        // Links oben in der Anzeige ist bei 90° die linke UNTERE Ecke des Papiers.
        nah(inPdf(vp, 0, 0), [10, 20]);
        nah(inPdf(vp, 300, 200), [210, 320]);
    });

    it('Rechteck aus zwei Anzeigepunkten ist normalisiert, egal in welche Richtung gezogen wurde', () => {
        for (const grad of [0, 90, 180, 270]) {
            const vp = viewportNachbau(box, 1, grad);
            const a = rechteckInPdf(vp, 20, 30, 80, 90);
            const b = rechteckInPdf(vp, 80, 90, 20, 30);
            expect(a).toEqual(b);
            expect(a[0]).toBeLessThan(a[2]);
            expect(a[1]).toBeLessThan(a[3]);
            // und zurück in die Anzeige: dieselbe Box
            const z = rechteckInAnzeige(vp, a);
            expect([z.links, z.oben, z.breite, z.hoehe].map(v => Math.round(v))).toEqual([20, 30, 60, 60]);
        }
    });

    it('Quad: oben links, oben rechts, unten links, unten rechts — in Leserichtung der Anzeige', () => {
        const vp = viewportNachbau(box, 2, 0);
        const q = quadAusAnzeige(vp, 20, 40, 120, 60);
        // Oben in der Anzeige = größeres y im PDF.
        expect(q[1]).toBeGreaterThan(q[5]);
        expect(q[0]).toBeLessThan(q[2]);
        const zurueck = quadInAnzeige(vp, q);
        nah(zurueck[0], [20, 40]);
        nah(zurueck[1], [120, 40]);
        nah(zurueck[2], [20, 60]);
        nah(zurueck[3], [120, 60]);
    });

    it('rechteckUmPunkte fasst alle Punkte und vergrößert um den Rand', () => {
        expect(rechteckUmPunkte([5, 9, 1, 3, 4, 12], 1)).toEqual([0, 2, 6, 13]);
    });
});

describe('Befehl aus Geste — je Werkzeug die Felder des Vertrags', () => {
    const vp = viewportNachbau([0, 0, 200, 300], 2, 0);

    it('Notiz: 20×20-Rahmen um den Klickpunkt', () => {
        const a = anmerkungAusGeste('note', { art: 'punkt', x: 100, y: 100 }, vp, 3, stil);
        expect(a).toMatchObject({ kind: 'note', page: 3, contents: '', reply_to: null, color: [1, 0, 0] });
        expect(a?.rect).toEqual([40, 240, 60, 260]);
    });

    it('Textfeld, Rechteck, Ellipse: Rahmen aus dem Aufziehen; zu kleine Gesten ergeben nichts', () => {
        // Zoom 2, Seite 300 hoch: Anzeige y 20 → PDF 290, y 60 → PDF 270.
        const t = anmerkungAusGeste('freetext', { art: 'rechteck', x1: 20, y1: 20, x2: 120, y2: 60 }, vp, 0, stil);
        expect(t).toMatchObject({ kind: 'freetext', rect: [10, 270, 60, 290], font_size: 12 });
        expect(t?.width).toBeUndefined();
        const r = anmerkungAusGeste('square', { art: 'rechteck', x1: 120, y1: 60, x2: 20, y2: 20 }, vp, 0, stil);
        expect(r).toMatchObject({ kind: 'square', rect: [10, 270, 60, 290], width: 2 });
        const e = anmerkungAusGeste('circle', { art: 'rechteck', x1: 20, y1: 20, x2: 120, y2: 60 }, vp, 0, stil);
        expect(e).toMatchObject({ kind: 'circle', rect: [10, 270, 60, 290], width: 2 });
        expect(anmerkungAusGeste('square', { art: 'rechteck', x1: 20, y1: 20, x2: 22, y2: 90 }, vp, 0, stil)).toBeNull();
        expect(anmerkungAusGeste('square', { art: 'punkt', x: 1, y: 1 }, vp, 0, stil)).toBeNull();
    });

    it('Linie und Pfeil: `line` mit Endpunkten, der Rahmen fasst beim Pfeil die Spitze', () => {
        const l = anmerkungAusGeste('line', { art: 'linie', x1: 20, y1: 20, x2: 120, y2: 20 }, vp, 1, stil);
        expect(l).toMatchObject({ kind: 'line', line: [10, 290, 60, 290], width: 2 });
        expect(l?.rect).toEqual([7, 287, 63, 293]);
        const p = anmerkungAusGeste('arrow', { art: 'linie', x1: 20, y1: 20, x2: 120, y2: 20 }, vp, 1, stil);
        expect(p).toMatchObject({ kind: 'arrow', line: [10, 290, 60, 290] });
        expect(p?.rect).toEqual([0, 280, 70, 300]);
        expect(anmerkungAusGeste('line', { art: 'linie', x1: 20, y1: 20, x2: 22, y2: 21 }, vp, 1, stil)).toBeNull();
    });

    it('Freihand: ein Strich als flache Punktliste im PDF-Raum', () => {
        const f = anmerkungAusGeste('ink', { art: 'pfad', punkte: [0, 0, 20, 40, 40, 0] }, vp, 2, stil);
        expect(f).toMatchObject({ kind: 'ink', paths: [[0, 300, 10, 280, 20, 300]], width: 2 });
        expect(f?.rect).toEqual([-3, 277, 23, 303]);
        expect(anmerkungAusGeste('ink', { art: 'pfad', punkte: [1, 1] }, vp, 2, stil)).toBeNull();
    });

    it('Hervorheben, Unterstreichen, Durchstreichen: ein Quad je Zeile, Rahmen um alle', () => {
        const boxen = [{ links: 20, oben: 20, rechts: 200, unten: 40 }, { links: 20, oben: 44, rechts: 100, unten: 64 }];
        for (const art of ['highlight', 'underline', 'strikeout'] as const) {
            const a = anmerkungAusGeste(art, { art: 'auswahl', boxen }, vp, 0, stil);
            expect(a?.kind).toBe(art);
            expect(a?.quads).toEqual([
                [10, 290, 100, 290, 10, 280, 100, 280],
                [10, 278, 50, 278, 10, 268, 50, 268],
            ]);
            expect(a?.rect).toEqual([10, 268, 100, 290]);
        }
        expect(anmerkungAusGeste('highlight', { art: 'auswahl', boxen: [] }, vp, 0, stil)).toBeNull();
        expect(anmerkungAusGeste('highlight', { art: 'auswahl', boxen: [{ links: 1, oben: 1, rechts: 1.5, unten: 1.2 }] }, vp, 0, stil)).toBeNull();
    });

    it('auf einer um 90° gedrehten Seite mit versetzter Box stimmen die PDF-Koordinaten trotzdem', () => {
        const gedreht = viewportNachbau([10, 20, 210, 320], 1, 90);
        // Anzeige (0,0) = PDF (10,20): eine Notiz dort sitzt in der linken unteren Papierecke.
        const n = anmerkungAusGeste('note', { art: 'punkt', x: 0, y: 0 }, gedreht, 0, stil);
        expect(n?.rect).toEqual([0, 10, 20, 30]);
        const r = anmerkungAusGeste('square', { art: 'rechteck', x1: 0, y1: 0, x2: 300, y2: 200 }, gedreht, 0, stil);
        expect(r?.rect).toEqual([10, 20, 210, 320]);
    });
});

describe('Post-it und Stempel: Kasten am Klickpunkt, aufrecht in der Anzeige (Etappe 5)', () => {
    // Zoom 2: die Anzeige ist 400 × 600, ein Zettel von 170 × 130 pt also 340 × 260 Bildpunkte.
    const vp = viewportNachbau([0, 0, 200, 300], 2, 0);
    const angabe = { label: 'GEPRÜFT', name: 'Checked' as const, signed: true, lang: 'de' };

    it('Post-it: 170 × 130 pt, linke obere Ecke am Klick, Schrift 11, Füllfarbe aus dem Stil', () => {
        const a = anmerkungAusGeste('sticky', { art: 'punkt', x: 20, y: 40 }, vp, 2, stil);
        expect(a).toMatchObject({ kind: 'sticky', page: 2, font_size: 11, color: [1, 0, 0], contents: '', reply_to: null });
        expect(a?.rect).toEqual([10, 150, 180, 280]);
        expect(a?.stamp).toBeUndefined();
        expect(anmerkungAusGeste('sticky', { art: 'rechteck', x1: 0, y1: 0, x2: 50, y2: 50 }, vp, 2, stil)).toBeNull();
    });

    it('am Rand rückt der Kasten auf die Seite', () => {
        const a = anmerkungAusGeste('sticky', { art: 'punkt', x: 390, y: 590 }, vp, 0, stil);
        expect(a?.rect).toEqual([30, 0, 200, 130]);
    });

    it('Stempel: Breite nach Label (150–260) × 50 pt, das Feld stamp aus dem Stil; ohne Angabe entsteht nichts', () => {
        const a = anmerkungAusGeste('stamp', { art: 'punkt', x: 0, y: 0 }, vp, 1, { ...stil, stamp: angabe });
        expect(a).toMatchObject({ kind: 'stamp', page: 1, stamp: angabe, contents: '', reply_to: null });
        expect(a?.rect).toEqual([0, 250, 150, 300]);
        expect(a?.font_size).toBeUndefined();
        expect(anmerkungAusGeste('stamp', { art: 'punkt', x: 0, y: 0 }, vp, 1, stil)).toBeNull();
        expect(anmerkungAusGeste('stamp', { art: 'rechteck', x1: 0, y1: 0, x2: 50, y2: 50 }, vp, 1, { ...stil, stamp: angabe })).toBeNull();
    });

    it('auf einer um 90° gedrehten Seite steht der Zettel in der Anzeige aufrecht — im PDF sind Breite und Höhe vertauscht', () => {
        const gedreht = viewportNachbau([0, 0, 200, 300], 1, 90);
        const a = anmerkungAusGeste('sticky', { art: 'punkt', x: 0, y: 0 }, gedreht, 0, stil);
        const r = a!.rect;
        expect(r[2] - r[0]).toBeCloseTo(130);
        expect(r[3] - r[1]).toBeCloseTo(170);
        const zurueck = rechteckInAnzeige(gedreht, r);
        expect([zurueck.links, zurueck.oben, Math.round(zurueck.breite), Math.round(zurueck.hoehe)]).toEqual([0, 0, 170, 130]);
    });

    it('rechteckAusAnzeigeBox ist die Umkehr von rechteckInAnzeige — bei jeder Drehung', () => {
        for (const grad of [0, 90, 180, 270]) {
            const v = viewportNachbau([10, 20, 210, 320], 1.5, grad);
            const rect = rechteckAusAnzeigeBox(v, { links: 30, oben: 45, breite: 60, hoehe: 90 });
            const box = rechteckInAnzeige(v, rect);
            expect([box.links, box.oben, box.breite, box.hoehe].map(x => Math.round(x))).toEqual([30, 45, 60, 90]);
        }
    });
});

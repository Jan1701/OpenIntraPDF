// SPDX-License-Identifier: Apache-2.0
//
// „Leere Seiten prüfen“: Wer Text, Anmerkungen oder Formularfelder hat, ist
// nie Kandidat — egal, wie weiß die Seite aussieht.

import { describe, expect, it, vi } from 'vitest';
import {
    anmerkungenZaehlen, leereSeitenSuchen, leerGrund, nichtWeissAnteil, SCHWELLE_FAST_LEER, zeichenZaehlen,
} from './leereSeiten';
import type { PruefDokument, PruefSeite } from './leereSeiten';

describe('Kandidatenregel', () => {
    const leer = { textZeichen: 0, anmerkungen: 0, formularfelder: 0, anteilNichtWeiss: 0 };

    it('ganz weiß, ohne Text und Anmerkungen: Kandidat „kein Inhalt“', () => {
        expect(leerGrund(leer)).toBe('kein_inhalt');
    });

    it('etwas Scanrauschen unter der Schwelle: Kandidat „fast leer“', () => {
        expect(leerGrund({ ...leer, anteilNichtWeiss: SCHWELLE_FAST_LEER / 2 })).toBe('fast_leer');
        expect(leerGrund({ ...leer, anteilNichtWeiss: SCHWELLE_FAST_LEER })).toBeNull();
    });

    it('Text, Anmerkungen oder Formularfelder schließen aus — auch auf weißer Seite', () => {
        expect(leerGrund({ ...leer, textZeichen: 1 })).toBeNull();
        expect(leerGrund({ ...leer, anmerkungen: 1 })).toBeNull();
        expect(leerGrund({ ...leer, formularfelder: 1 })).toBeNull();
    });

    it('zählt nur sichtbare Zeichen; Leerraum allein ist kein Text', () => {
        expect(zeichenZaehlen([{ str: '  ' }, { str: '\n' }, { hasEOL: true }])).toBe(0);
        expect(zeichenZaehlen([{ str: ' A b ' }])).toBe(2);
    });

    it('trennt Formularfelder von übrigen Anmerkungen; Popups zählen nicht doppelt', () => {
        expect(anmerkungenZaehlen([{ annotationType: 20 }, { annotationType: 1 }, { annotationType: 16 }, { annotationType: 2 }]))
            .toEqual({ anmerkungen: 2, formularfelder: 1 });
    });

    it('misst den Anteil nicht weißer Bildpunkte', () => {
        const weiss = new Uint8ClampedArray(4 * 100).fill(255);
        expect(nichtWeissAnteil(weiss, 1)).toBe(0);
        const mitPunkt = weiss.slice();
        mitPunkt[0] = 0;
        expect(nichtWeissAnteil(mitPunkt, 1)).toBeCloseTo(0.01);
        // Knapp unter Weiß (Scanner-Grau 240) zählt nicht.
        expect(nichtWeissAnteil(new Uint8ClampedArray(400).fill(240), 1)).toBe(0);
    });
});

describe('Lauf über das Dokument', () => {
    function dokument(seiten: { text?: string; anmerkungen?: number[] }[]): PruefDokument {
        return {
            getPage: vi.fn(async (n: number): Promise<PruefSeite> => {
                const s = seiten[n - 1];
                return {
                    rotate: 0,
                    getTextContent: async () => ({ items: s.text ? [{ str: s.text }] : [] }),
                    getAnnotations: async () => (s.anmerkungen ?? []).map(annotationType => ({ annotationType })),
                };
            }),
        };
    }

    it('schlägt nur weiße Seiten ohne Text und Anmerkungen vor, mit Grund', async () => {
        const doc = dokument([
            { text: 'Rechnung' },
            {},
            { anmerkungen: [1] }, // Notiz auf leerer Seite
            { anmerkungen: [20] }, // Formularfeld
            {},
        ]);
        const rastern = vi.fn(async () => ({ anteil: 0, vorschau: 'data:,' }));
        const eintraege = [0, 1, 2, 3, 4].map(q => ({ id: `s${q}`, quelle: q, drehung: 0 }));
        const kandidaten = await leereSeitenSuchen(doc, eintraege, rastern);
        expect(kandidaten.map(k => k.id)).toEqual(['s1', 's4']);
        expect(kandidaten[0]).toMatchObject({ grund: 'kein_inhalt', quelle: 1 });
        // Gerendert wird nur, was nach Text und Anmerkungen noch in Frage kommt.
        expect(rastern).toHaveBeenCalledTimes(2);
    });

    it('eine Seite mit Unterschrift (Bildpunkte über der Schwelle) ist kein Kandidat', async () => {
        const doc = dokument([{}, {}]);
        const rastern = vi.fn()
            .mockResolvedValueOnce({ anteil: 0.03 })
            .mockResolvedValueOnce({ anteil: 0.0005 });
        const k = await leereSeitenSuchen(doc, [{ id: 'a', quelle: 0, drehung: 0 }, { id: 'b', quelle: 1, drehung: 0 }], rastern);
        expect(k.map(x => [x.id, x.grund])).toEqual([['b', 'fast_leer']]);
    });

    it('misst Duplikate derselben Quelle nur einmal, schlägt aber jeden Eintrag vor', async () => {
        const doc = dokument([{}]);
        const rastern = vi.fn(async () => ({ anteil: 0 }));
        const k = await leereSeitenSuchen(doc, [{ id: 's0', quelle: 0, drehung: 0 }, { id: 's0~2', quelle: 0, drehung: 90 }], rastern);
        expect(k.map(x => x.id)).toEqual(['s0', 's0~2']);
        expect(rastern).toHaveBeenCalledTimes(1);
    });

    it('lässt sich abbrechen', async () => {
        const abbruch = new AbortController();
        abbruch.abort();
        await expect(leereSeitenSuchen(dokument([{}]), [{ id: 's0', quelle: 0, drehung: 0 }], vi.fn(), { signal: abbruch.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});

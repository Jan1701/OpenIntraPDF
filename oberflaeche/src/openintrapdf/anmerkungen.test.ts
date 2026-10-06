// SPDX-License-Identifier: Apache-2.0
//
// Anmerkungsteil des Entwurfs: Befehle, Antworten, Commit-Rumpf laut Vertrag.

import { describe, expect, it } from 'vitest';
import {
    anmerkungenAnzahl, anmerkungenLeer, anmerkungenUnveraendert, anmerkungenZuBefehl, anmerkungsBefehlAnwenden, ART_NAME,
    entfallendeAnmerkungen, hexZuRgb, naechsteKennung, rgbZuCss,
} from './anmerkungen';
import type { AnmerkungsBefehl, AnmerkungsEntwurf, NeueAnmerkung } from './anmerkungen';
import { entfernen, planErstellen } from './seitenplan';

const notiz = (client_id: string, page = 0, reply_to: string | null = null): NeueAnmerkung => ({
    client_id, page, kind: 'note', rect: [10, 10, 30, 30], contents: 'Hallo', color: [1, 0.84, 0.04], reply_to,
});

function anwenden(e: AnmerkungsEntwurf, ...befehle: AnmerkungsBefehl[]): AnmerkungsEntwurf {
    return befehle.reduce(anmerkungsBefehlAnwenden, e);
}

describe('Kennungen', () => {
    it('vergibt die kleinste freie tmp-N — beim Wiederholen also dieselbe', () => {
        let e = anmerkungenLeer();
        expect(naechsteKennung(e)).toBe('tmp-1');
        e = anwenden(e, { art: 'anmerkungNeu', anmerkung: notiz('tmp-1') }, { art: 'anmerkungNeu', anmerkung: notiz('tmp-2') });
        expect(naechsteKennung(e)).toBe('tmp-3');
        e = anwenden(e, { art: 'anmerkungLoeschen', ziel: 'tmp-1', page: 0 });
        expect(naechsteKennung(e)).toBe('tmp-1');
    });

    it('Farben: Hex → 0–1 wie im Vertrag, und zurück als CSS', () => {
        expect(hexZuRgb('#ff0000')).toEqual([1, 0, 0]);
        expect(hexZuRgb('#1c2733')).toEqual([0.11, 0.153, 0.2]);
        expect(rgbZuCss([1, 0.5, 0])).toBe('rgb(255 128 0)');
    });
});

describe('Antworten', () => {
    it('auf eine Entwurfsanmerkung: reply_to = client_id; Löschen der Ursprungsnotiz nimmt die Antworten mit', () => {
        let e = anwenden(anmerkungenLeer(),
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-1') },
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-2', 0, 'tmp-1') },
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-3', 0, 'tmp-2') },
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-4') },
        );
        expect(e.neue.map(a => a.reply_to)).toEqual([null, 'tmp-1', 'tmp-2', null]);
        e = anwenden(e, { art: 'anmerkungLoeschen', ziel: 'tmp-1', page: 0 });
        expect(e.neue.map(a => a.client_id)).toEqual(['tmp-4']);
    });

    it('auf eine gespeicherte Anmerkung: reply_to = „12R“; wird sie gelöscht, fällt die Entwurfsantwort weg', () => {
        let e = anwenden(anmerkungenLeer(), { art: 'anmerkungNeu', anmerkung: notiz('tmp-1', 2, '12R') });
        expect(e.neue[0].reply_to).toBe('12R');
        e = anwenden(e, { art: 'anmerkungLoeschen', ziel: '12R', page: 2 });
        expect(e.neue).toEqual([]);
        expect(e.geloescht).toEqual({ '12R': { page: 2 } });
        // Antwort auf eine gelöschte oder unbekannte Entwurfsanmerkung gibt es nicht.
        expect(anwenden(e, { art: 'anmerkungNeu', anmerkung: notiz('tmp-1', 2, '12R') })).toBe(e);
        expect(anwenden(e, { art: 'anmerkungNeu', anmerkung: notiz('tmp-1', 2, 'tmp-9') })).toBe(e);
        e = anwenden(e, { art: 'anmerkungBehalten', ziel: '12R' });
        expect(e.geloescht).toEqual({});
    });
});

describe('Text und Status', () => {
    it('Entwurfstext wird direkt geändert; gespeicherter Text landet in `texte` und fällt beim Originaltext wieder heraus', () => {
        let e = anwenden(anmerkungenLeer(), { art: 'anmerkungNeu', anmerkung: notiz('tmp-1') });
        e = anwenden(e, { art: 'anmerkungText', ziel: 'tmp-1', page: 0, contents: 'Neu' });
        expect(e.neue[0].contents).toBe('Neu');
        e = anwenden(e, { art: 'anmerkungText', ziel: '7R', page: 1, contents: 'Geändert', original: 'Alt' });
        expect(e.texte).toEqual({ '7R': { page: 1, contents: 'Geändert' } });
        e = anwenden(e, { art: 'anmerkungText', ziel: '7R', page: 1, contents: 'Alt', original: 'Alt' });
        expect(e.texte).toEqual({});
        expect(anwenden(e, { art: 'anmerkungText', ziel: 'tmp-9', page: 0, contents: 'x' })).toBe(e);
    });

    it('Status: erledigt setzen und zurücknehmen; gleicher Status wie gespeichert = kein Befehl', () => {
        let e = anwenden(anmerkungenLeer(), { art: 'anmerkungStatus', ref: '7R', page: 0, state: 'completed', gespeichert: 'none' });
        expect(e.status).toEqual({ '7R': { page: 0, state: 'completed' } });
        e = anwenden(e, { art: 'anmerkungStatus', ref: '7R', page: 0, state: 'none', gespeichert: 'none' });
        expect(e.status).toEqual({});
        expect(anmerkungenUnveraendert(e)).toBe(true);
        // Ein im PDF erledigter Kommentar wird wieder geöffnet.
        e = anwenden(e, { art: 'anmerkungStatus', ref: '8R', page: 0, state: 'none', gespeichert: 'completed' });
        expect(e.status).toEqual({ '8R': { page: 0, state: 'none' } });
        // Löschen räumt Text und Status derselben Anmerkung ab.
        e = anwenden(e, { art: 'anmerkungText', ziel: '8R', page: 0, contents: 'x', original: 'y' }, { art: 'anmerkungLoeschen', ziel: '8R', page: 0 });
        expect(e.texte).toEqual({});
        expect(e.status).toEqual({});
        expect(anmerkungenAnzahl(e)).toBe(1);
    });
});

describe('Commit-Rumpf', () => {
    it('add/update/delete/state genau wie im Vertrag; `page` überall die Quellseite', () => {
        const e = anwenden(anmerkungenLeer(),
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-1', 2) },
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-2', 2, 'tmp-1') },
            { art: 'anmerkungText', ziel: '12R', page: 0, contents: 'neuer Text', original: 'alt' },
            { art: 'anmerkungLoeschen', ziel: '14R', page: 1 },
            { art: 'anmerkungStatus', ref: '7R', page: 0, state: 'completed', gespeichert: 'none' },
        );
        expect(anmerkungenZuBefehl(e, planErstellen(3))).toEqual({
            add: [notiz('tmp-1', 2), notiz('tmp-2', 2, 'tmp-1')],
            update: [{ ref: '12R', page: 0, contents: 'neuer Text' }],
            delete: [{ ref: '14R', page: 1 }],
            state: [{ ref: '7R', page: 0, state: 'completed' }],
        });
        expect(anmerkungenZuBefehl(anmerkungenLeer(), planErstellen(3))).toBeUndefined();
    });

    it('eine entfernte Seite nimmt ihre Entwurfsanmerkungen mit — die Befehle werden nicht geschickt', () => {
        const e = anwenden(anmerkungenLeer(),
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-1', 1) },
            { art: 'anmerkungNeu', anmerkung: notiz('tmp-2', 2) },
            { art: 'anmerkungLoeschen', ziel: '14R', page: 1 },
        );
        const plan = planErstellen(3);
        expect(entfallendeAnmerkungen(plan, e)).toBe(0);
        expect(entfallendeAnmerkungen(plan, e, ['s1'])).toBe(1);
        const ohneSeite2 = entfernen(plan, ['s1']).plan;
        expect(entfallendeAnmerkungen(ohneSeite2, e)).toBe(1);
        expect(anmerkungenZuBefehl(e, ohneSeite2)).toEqual({ add: [notiz('tmp-2', 2)] });
        // Alles weg → gar kein annotations-Teil.
        expect(anmerkungenZuBefehl(e, entfernen(ohneSeite2, ['s2']).plan)).toBeUndefined();
    });
});

describe('Lage im Entwurf (Etappe 5)', () => {
    const zettel = (client_id: string, page = 0): NeueAnmerkung => ({
        client_id, page, kind: 'sticky', rect: [10, 10, 180, 140], contents: '', color: [1, 0.961, 0.616], reply_to: null, font_size: 11,
    });

    it('anmerkungRect setzt das Rect eines Post-its oder Stempels im Entwurf; Notizen und Gespeichertes bleiben unberührt', () => {
        const e = anwenden(anmerkungenLeer(), { art: 'anmerkungNeu', anmerkung: zettel('tmp-1') }, { art: 'anmerkungNeu', anmerkung: notiz('tmp-2') });
        const bewegt = anwenden(e, { art: 'anmerkungRect', ziel: 'tmp-1', page: 0, rect: [50, 50, 220, 180] });
        expect(bewegt.neue[0].rect).toEqual([50, 50, 220, 180]);
        expect(bewegt.neue[0]).toMatchObject({ kind: 'sticky', font_size: 11 });
        // Dasselbe Rect noch einmal: ohne Wirkung, derselbe Entwurf.
        expect(anwenden(bewegt, { art: 'anmerkungRect', ziel: 'tmp-1', page: 0, rect: [50, 50, 220, 180] })).toBe(bewegt);
        expect(anwenden(e, { art: 'anmerkungRect', ziel: 'tmp-2', page: 0, rect: [0, 0, 1, 1] })).toBe(e);
        expect(anwenden(e, { art: 'anmerkungRect', ziel: '12R', page: 0, rect: [0, 0, 1, 1] })).toBe(e);
        expect(anwenden(e, { art: 'anmerkungRect', ziel: 'tmp-9', page: 0, rect: [0, 0, 1, 1] })).toBe(e);
        expect(anmerkungenAnzahl(bewegt)).toBe(2);
    });

    it('Post-it und Stempel haben in der Kommentarliste eigene Artnamen', () => {
        expect([ART_NAME.sticky, ART_NAME.stamp]).toEqual(['postit', 'stempel']);
    });
});

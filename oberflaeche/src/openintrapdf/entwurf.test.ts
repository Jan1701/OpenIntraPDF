// SPDX-License-Identifier: Apache-2.0
//
// Gemeinsame Historie von Seitenplan und Anmerkungen.

import { describe, expect, it } from 'vitest';
import type { NeueAnmerkung } from './anmerkungen';
import { ausfuehren, istUnveraendert, naechstesVor, naechstesZurueck, rueckgaengig, verlaufStarten, wiederholen } from './entwurf';
import { planErstellen } from './seitenplan';

const ids = (v: ReturnType<typeof verlaufStarten>) => v.stand.plan.map(e => e.id);
const notiz = (client_id: string, page = 0): NeueAnmerkung => ({
    client_id, page, kind: 'note', rect: [0, 0, 20, 20], contents: '', color: [1, 0, 0], reply_to: null,
});

describe('Befehlshistorie', () => {
    it('Rückgängig und Wiederholen stellen genau die Zwischenstände her', () => {
        let v = verlaufStarten(planErstellen(3));
        const start = v.stand;
        v = ausfuehren(v, { art: 'drehen', ids: ['s0'], grad: 90 }).verlauf;
        const gedreht = v.stand;
        v = ausfuehren(v, { art: 'entfernen', ids: ['s2'] }).verlauf;
        const entfernt = v.stand;

        v = rueckgaengig(v);
        expect(v.stand).toEqual(gedreht);
        v = rueckgaengig(v);
        expect(v.stand).toEqual(start);
        expect(rueckgaengig(v)).toBe(v);

        v = wiederholen(v);
        expect(v.stand).toEqual(gedreht);
        v = wiederholen(v);
        expect(v.stand).toEqual(entfernt);
        expect(wiederholen(v)).toBe(v);
    });

    it('ein neuer Schritt verwirft, was zum Wiederholen bereitlag', () => {
        let v = verlaufStarten(planErstellen(3));
        v = ausfuehren(v, { art: 'drehen', ids: ['s0'], grad: 90 }).verlauf;
        v = rueckgaengig(v);
        expect(v.vor).toHaveLength(1);
        v = ausfuehren(v, { art: 'nachHinten', ids: ['s0'] }).verlauf;
        expect(v.vor).toHaveLength(0);
    });

    it('Wiederholen eines Duplikats erzeugt dieselben Kennungen', () => {
        let v = verlaufStarten(planErstellen(2));
        v = ausfuehren(v, { art: 'duplizieren', ids: ['s1'] }).verlauf;
        const erst = ids(v);
        v = wiederholen(rueckgaengig(v));
        expect(ids(v)).toEqual(erst);
    });

    it('Schritte ohne Wirkung oder abgelehnte landen nicht in der Historie', () => {
        const v = verlaufStarten(planErstellen(1));
        const a = ausfuehren(v, { art: 'entfernen', ids: ['s0'] });
        expect(a.ergebnis).toBe('letzteSeite');
        expect(a.verlauf.zurueck).toHaveLength(0);
        const b = ausfuehren(v, { art: 'nachVorn', ids: ['s0'] });
        expect(b.ergebnis).toBe('ohneWirkung');
        expect(b.verlauf).toBe(v);
        const c = ausfuehren(v, { art: 'anmerkungLoeschen', ziel: 'tmp-7', page: 0 });
        expect(c.ergebnis).toBe('ohneWirkung');
        expect(c.verlauf).toBe(v);
    });
});

describe('Seiten- und Anmerkungsbefehle in EINER Historie', () => {
    it('Strg+Z nimmt immer den zuletzt getanen Schritt zurück — gleich welcher Art', () => {
        let v = verlaufStarten(planErstellen(3));
        expect(istUnveraendert(v.stand, 3)).toBe(true);
        v = ausfuehren(v, { art: 'anmerkungNeu', anmerkung: notiz('tmp-1', 1) }).verlauf;
        expect(istUnveraendert(v.stand, 3)).toBe(false);
        v = ausfuehren(v, { art: 'drehen', ids: ['s1'], grad: 90 }).verlauf;
        v = ausfuehren(v, { art: 'anmerkungText', ziel: 'tmp-1', page: 1, contents: 'Bitte prüfen' }).verlauf;
        v = ausfuehren(v, { art: 'entfernen', ids: ['s2'] }).verlauf;
        expect(naechstesZurueck(v)?.art).toBe('entfernen');

        v = rueckgaengig(v);
        expect(v.stand.plan[2].entfernt).toBe(false);
        expect(v.stand.anmerkungen.neue[0].contents).toBe('Bitte prüfen');
        expect(naechstesZurueck(v)?.art).toBe('anmerkungText');

        v = rueckgaengig(v);
        expect(v.stand.anmerkungen.neue[0].contents).toBe('');
        expect(v.stand.plan[1].drehung).toBe(90);

        v = rueckgaengig(v);
        expect(v.stand.plan[1].drehung).toBe(0);
        expect(v.stand.anmerkungen.neue).toHaveLength(1);

        v = rueckgaengig(v);
        expect(istUnveraendert(v.stand, 3)).toBe(true);
        expect(naechstesVor(v)?.art).toBe('anmerkungNeu');

        v = wiederholen(wiederholen(v));
        expect(v.stand.anmerkungen.neue[0].client_id).toBe('tmp-1');
        expect(v.stand.plan[1].drehung).toBe(90);
    });

    it('Tippen verschmilzt zu einem Schritt; Rückgängig nimmt den ganzen Text zurück', () => {
        let v = verlaufStarten(planErstellen(1));
        v = ausfuehren(v, { art: 'anmerkungNeu', anmerkung: notiz('tmp-1') }).verlauf;
        for (const text of ['H', 'Ha', 'Hal', 'Hall', 'Hallo']) {
            v = ausfuehren(v, { art: 'anmerkungText', ziel: 'tmp-1', page: 0, contents: text }).verlauf;
        }
        expect(v.zurueck).toHaveLength(2);
        expect(v.stand.anmerkungen.neue[0].contents).toBe('Hallo');
        v = rueckgaengig(v);
        expect(v.stand.anmerkungen.neue[0].contents).toBe('');
        // Ein anderes Ziel dazwischen trennt die Schritte.
        v = ausfuehren(v, { art: 'anmerkungText', ziel: 'tmp-1', page: 0, contents: 'A' }).verlauf;
        v = ausfuehren(v, { art: 'anmerkungText', ziel: '12R', page: 0, contents: 'B', original: 'x' }).verlauf;
        v = ausfuehren(v, { art: 'anmerkungText', ziel: 'tmp-1', page: 0, contents: 'AB' }).verlauf;
        expect(v.zurueck.map(z => z.befehl.art)).toEqual(['anmerkungNeu', 'anmerkungText', 'anmerkungText', 'anmerkungText']);
    });
});

describe('Eigenschaften im Entwurf (Etappe 8)', () => {
    it('ein Befehl ersetzt die Menge; gleich bleibt ohne Wirkung; Rückgängig nimmt das Übernehmen als einen Schritt zurück', () => {
        let v = verlaufStarten(planErstellen(2));
        expect(istUnveraendert(v.stand, 2)).toBe(true);
        let r = ausfuehren(v, { art: 'eigenschaften', werte: { title: 'Neu', author: '' } });
        expect(r.ergebnis).toBe('ok');
        v = r.verlauf;
        expect(v.stand.eigenschaften).toEqual({ title: 'Neu', author: '' });
        expect(istUnveraendert(v.stand, 2)).toBe(false);
        // Dieselben Werte noch einmal: ohne Wirkung, kein Schritt.
        r = ausfuehren(v, { art: 'eigenschaften', werte: { title: 'Neu', author: '', subject: undefined } });
        expect(r.ergebnis).toBe('ohneWirkung');
        expect(r.verlauf).toBe(v);
        // Andere Menge ersetzt alles.
        v = ausfuehren(v, { art: 'eigenschaften', werte: { keywords: 'k' } }).verlauf;
        expect(v.stand.eigenschaften).toEqual({ keywords: 'k' });
        v = rueckgaengig(v);
        expect(v.stand.eigenschaften).toEqual({ title: 'Neu', author: '' });
        v = rueckgaengig(v);
        expect(v.stand.eigenschaften).toEqual({});
        expect(istUnveraendert(v.stand, 2)).toBe(true);
        v = wiederholen(v);
        expect(v.stand.eigenschaften).toEqual({ title: 'Neu', author: '' });
        expect(naechstesZurueck(v)?.art).toBe('eigenschaften');
    });
});

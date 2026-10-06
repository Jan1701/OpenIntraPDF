// SPDX-License-Identifier: Apache-2.0
//
// Seitenplan des Entwurfs: reine Funktionen, keine Oberfläche.

import { describe, expect, it } from 'vitest';
import {
    befehlAnwenden, drehen, duplizieren, einfuegen, entfernen, istUnveraendert, leereSeiteEinfuegen, LEERE_QUELLE, nachHinten, nachVorn,
    neueNummern, planErstellen, planQuellen, planZuSeiten, verschieben, wiederherstellen,
} from './seitenplan';
import type { Seitenplan } from './seitenplan';

const quellen = (p: Seitenplan) => p.map(e => e.quelle);
const ids = (p: Seitenplan) => p.map(e => e.id);

describe('Seitenplan', () => {
    it('beginnt unverändert: jede Seite einmal, keine Drehung', () => {
        const p = planErstellen(3);
        expect(ids(p)).toEqual(['s0', 's1', 's2']);
        expect(istUnveraendert(p, 3)).toBe(true);
        expect(planZuSeiten(p)).toEqual([
            { source: 0, rotate: 0 }, { source: 1, rotate: 0 }, { source: 2, rotate: 0 },
        ]);
    });

    it('dreht in 90°-Schritten und rechnet über 360° hinaus richtig', () => {
        let p = planErstellen(2);
        p = drehen(p, ['s1'], 90);
        p = drehen(p, ['s1'], 90);
        p = drehen(p, ['s1'], 90);
        p = drehen(p, ['s1'], 90);
        expect(p[1].drehung).toBe(0);
        p = drehen(p, ['s0'], -90);
        expect(p[0].drehung).toBe(270);
        expect(istUnveraendert(p, 2)).toBe(false);
    });

    it('entfernt nur vorgemerkt; der Commit-Plan lässt die Seite weg, Wiederherstellen holt sie zurück', () => {
        let p = entfernen(planErstellen(3), ['s1']).plan;
        expect(p.map(e => e.entfernt)).toEqual([false, true, false]);
        expect(planZuSeiten(p)).toEqual([{ source: 0, rotate: 0 }, { source: 2, rotate: 0 }]);
        expect(neueNummern(p).get('s2')).toBe(2);
        expect(neueNummern(p).has('s1')).toBe(false);
        p = wiederherstellen(p, ['s1']);
        expect(istUnveraendert(p, 3)).toBe(true);
    });

    it('die letzte verbleibende Seite ist nie entfernbar', () => {
        const zwei = entfernen(planErstellen(2), ['s0']).plan;
        const r = entfernen(zwei, ['s1']);
        expect(r.letzteSeite).toBe(true);
        expect(r.plan).toBe(zwei);
        // Alles auf einmal auswählen hilft auch nicht.
        const alle = entfernen(planErstellen(3), ['s0', 's1', 's2']);
        expect(alle.letzteSeite).toBe(true);
        expect(befehlAnwenden(planErstellen(1), { art: 'entfernen', ids: ['s0'] }).ergebnis).toBe('letzteSeite');
    });

    it('verschiebt eine Auswahl als Block vor einen Eintrag oder ans Ende', () => {
        const p = planErstellen(5);
        expect(quellen(verschieben(p, ['s3', 's1'], 's0'))).toEqual([1, 3, 0, 2, 4]);
        expect(quellen(verschieben(p, ['s0'], null))).toEqual([1, 2, 3, 4, 0]);
        // Ziel liegt in der Auswahl: gemeint ist der nächste nicht gewählte Eintrag.
        expect(quellen(verschieben(p, ['s1', 's3'], 's3'))).toEqual([0, 2, 1, 3, 4]);
    });

    it('nach vorn / nach hinten: zusammenhängende Blöcke wandern gemeinsam, am Rand bleibt es stehen', () => {
        const p = planErstellen(4);
        expect(quellen(nachVorn(p, ['s2', 's3']))).toEqual([0, 2, 3, 1]);
        expect(quellen(nachVorn(p, ['s0']))).toEqual([0, 1, 2, 3]);
        expect(quellen(nachHinten(p, ['s0', 's1']))).toEqual([2, 0, 1, 3]);
        expect(quellen(nachHinten(p, ['s3']))).toEqual([0, 1, 2, 3]);
    });

    it('Duplikate bekommen eigene, stabile Kennungen — Umsortieren trifft genau das gemeinte', () => {
        let p = duplizieren(planErstellen(2), ['s0']);
        expect(ids(p)).toEqual(['s0', 's0~2', 's1']);
        p = duplizieren(p, ['s0', 's0~2']);
        expect(new Set(ids(p)).size).toBe(p.length);
        expect(ids(p)).toEqual(['s0', 's0~3', 's0~2', 's0~4', 's1']);
        // Nur die zweite Kopie drehen und ans Ende schieben.
        p = drehen(p, ['s0~2'], 90);
        p = verschieben(p, ['s0~2'], null);
        expect(p[p.length - 1]).toMatchObject({ id: 's0~2', quelle: 0, drehung: 90 });
        expect(p.filter(e => e.quelle === 0 && e.drehung === 90)).toHaveLength(1);
        // Im Befehl steht dieselbe Quelle mehrfach — das ist erlaubt.
        expect(planZuSeiten(p).filter(s => s.source === 0)).toHaveLength(4);
    });

    it('Plan → pages-Befehl: Reihenfolge, Zusatzdrehung, Entfernte fehlen', () => {
        let p = planErstellen(4);
        p = drehen(p, ['s2'], 90);
        p = entfernen(p, ['s1']).plan;
        p = verschieben(p, ['s3'], 's0');
        expect(planZuSeiten(p)).toEqual([
            { source: 3, rotate: 0 },
            { source: 0, rotate: 0 },
            { source: 2, rotate: 90 },
        ]);
    });

    it('leere Seite (Etappe 9): hinter dem Nachbarn, mit Format und Drehung, im Befehl als blank; Duplikat und Entfernen wie jede Seite', () => {
        let p = leereSeiteEinfuegen(planErstellen(3), 's0', { breite: 595, hoehe: 842 }, 90);
        expect(ids(p)).toEqual(['s0', 'leer~2', 's1', 's2']);
        expect(p[1]).toMatchObject({ quelle: LEERE_QUELLE, drehung: 90, entfernt: false, leer: { breite: 595, hoehe: 842 } });
        expect(istUnveraendert(p, 3)).toBe(false);
        expect(neueNummern(p).get('leer~2')).toBe(2);
        expect(planZuSeiten(p)).toEqual([
            { source: 0, rotate: 0 },
            { source: -1, rotate: 90, blank: { width: 595, height: 842 } },
            { source: 1, rotate: 0 },
            { source: 2, rotate: 0 },
        ]);
        // Am Anfang (null) und als Befehl; ein unbekannter Nachbar ändert nichts.
        expect(ids(leereSeiteEinfuegen(p, null, { breite: 100, hoehe: 100 }, 0))).toEqual(['leer~3', 's0', 'leer~2', 's1', 's2']);
        expect(befehlAnwenden(p, { art: 'leereSeite', nach: 'gibtEsNicht', format: { breite: 1, hoehe: 1 }, drehung: 0 }).ergebnis).toBe('ohneWirkung');
        // Duplizieren kopiert das Format, Entfernen und Drehen wirken wie sonst.
        p = duplizieren(p, ['leer~2']);
        expect(p[2]).toMatchObject({ id: 'leer~3', leer: { breite: 595, hoehe: 842 }, drehung: 90 });
        p = drehen(p, ['leer~3'], 90);
        p = entfernen(p, ['leer~2']).plan;
        expect(planZuSeiten(p)).toEqual([
            { source: 0, rotate: 0 },
            { source: -1, rotate: 180, blank: { width: 595, height: 842 } },
            { source: 1, rotate: 0 },
            { source: 2, rotate: 0 },
        ]);
    });

    it('einfügen (Etappe 9): Kopien und fremde Seiten hinter einem Eintrag; Kennungen stabil; sources und pages für den Commit', () => {
        const fremd = (seite: number) => ({ quelle: LEERE_QUELLE, drehung: 0 as const, fremd: { datei: 'f2', name: 'Anhang.pdf', version: 3, seite } });
        let p = einfuegen(planErstellen(3), 's0', [{ quelle: 2, drehung: 90 }, fremd(3), fremd(1)]);
        expect(ids(p)).toEqual(['s0', 's2~2', 'q~2', 'q~3', 's1', 's2']);
        expect(p[1]).toMatchObject({ quelle: 2, drehung: 90, entfernt: false });
        expect(p[2]).toMatchObject({ quelle: LEERE_QUELLE, fremd: { datei: 'f2', seite: 3 } });
        // Dieselbe fremde Seite zweimal und eine zweite Datei: sources je Datei einmal, Seiten aufsteigend ohne Doppelte.
        p = einfuegen(p, null, [fremd(3), { quelle: LEERE_QUELLE, drehung: 0, fremd: { datei: 'f9', name: 'B.pdf', seite: 0 } }]);
        const { sources, stellen } = planQuellen(p);
        expect(sources).toEqual([{ file_id: 'f2', expected_version: 3, pages: [1, 3] }, { file_id: 'f9', pages: [0] }]);
        expect(stellen.get('f2\u00003')).toBe(1);
        expect(stellen.get('f9\u00000')).toBe(2);
        // pages zählt fremde Seiten hinter der Basis (hier 3 Seiten); eine entfernte fremde Seite fällt auch aus sources heraus.
        p = entfernen(p, ['q~3']).plan;
        expect(planZuSeiten(p, 3)).toEqual([
            { source: 3, rotate: 0 }, { source: 4, rotate: 0 }, { source: 0, rotate: 0 }, { source: 2, rotate: 90 }, { source: 3, rotate: 0 },
            { source: 1, rotate: 0 }, { source: 2, rotate: 0 },
        ]);
        expect(planQuellen(p).sources).toEqual([{ file_id: 'f2', expected_version: 3, pages: [3] }, { file_id: 'f9', pages: [0] }]);
        // Leere Liste oder unbekannter Nachbar: keine Wirkung; Wiederholen ergibt dieselben Kennungen.
        expect(einfuegen(p, 's0', [])).toBe(p);
        expect(befehlAnwenden(p, { art: 'einfuegen', nach: 'nix', eintraege: [{ quelle: 0, drehung: 0 }] }).ergebnis).toBe('ohneWirkung');
        const a = befehlAnwenden(planErstellen(2), { art: 'einfuegen', nach: 's1', eintraege: [{ quelle: 0, drehung: 0 }] }).plan;
        const b = befehlAnwenden(planErstellen(2), { art: 'einfuegen', nach: 's1', eintraege: [{ quelle: 0, drehung: 0 }] }).plan;
        expect(ids(a)).toEqual(ids(b));
    });

    it('ein Befehl ohne Wirkung oder ein abgelehnter gibt den alten Plan zurück', () => {
        const p = planErstellen(1);
        expect(befehlAnwenden(p, { art: 'entfernen', ids: ['s0'] })).toEqual({ plan: p, ergebnis: 'letzteSeite' });
        expect(befehlAnwenden(p, { art: 'nachVorn', ids: ['s0'] })).toEqual({ plan: p, ergebnis: 'ohneWirkung' });
    });
});

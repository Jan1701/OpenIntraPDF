// SPDX-License-Identifier: Apache-2.0
//
// Status eines Fadens aus seinen Statusmarken (Etappe 8): die neueste
// zählt — nach `M`, bei gleichem `M` nach der Objektnummer.

import { describe, expect, it } from 'vitest';
import { alsKommentar, fadenStatus, gespeicherterStatus, istStatusmarke } from './kommentare';
import type { Kommentar } from './kommentare';

function marke(id: string, auf: string, state: string, m: string | null, autor = 'Bert'): Kommentar {
    return alsKommentar({ id, annotationType: 1, rect: [0, 0, 1, 1], titleObj: { str: autor }, contentsObj: { str: state }, modificationDate: m, inReplyTo: auf, state }, 1)!;
}

describe('fadenStatus', () => {
    const notiz = alsKommentar({ id: '12R', annotationType: 1, rect: [0, 0, 1, 1], titleObj: { str: 'Anna' }, contentsObj: { str: 'x' }, modificationDate: 'D:20260929100000', inReplyTo: null }, 1)!;

    it('liest Objektnummer und M aus der Anmerkung; eine Antwort mit State ist eine Statusmarke', () => {
        expect(notiz.objNr).toBe(12);
        expect(notiz.geaendert?.getFullYear()).toBe(2026);
        expect(istStatusmarke(notiz)).toBe(false);
        expect(istStatusmarke(marke('20R', '12R', 'Completed', 'D:20260930090000'))).toBe(true);
        expect(fadenStatus([notiz], '12R')).toBeNull();
    });

    it('die Marke mit dem jüngsten M zählt, unabhängig von der Reihenfolge im Dokument', () => {
        const alle = [notiz, marke('20R', '12R', 'Completed', 'D:20260930090000'), marke('18R', '12R', 'None', 'D:20260929120000')];
        expect(fadenStatus(alle, '12R')).toMatchObject({ zustand: 'completed', autor: 'Bert' });
        expect(gespeicherterStatus(alle, '12R')).toBe('completed');
        const umgekehrt = [notiz, marke('25R', '12R', 'None', 'D:20261001090000'), marke('20R', '12R', 'Completed', 'D:20260930090000')];
        expect(fadenStatus(umgekehrt, '12R')?.zustand).toBe('none');
        expect(gespeicherterStatus(umgekehrt, '12R')).toBe('none');
    });

    it('bei gleichem oder fehlendem M entscheidet die Objektnummer', () => {
        const gleich = [notiz, marke('27R', '12R', 'None', 'D:20261002145435'), marke('25R', '12R', 'Completed', 'D:20261002145435')];
        expect(fadenStatus(gleich, '12R')?.zustand).toBe('none');
        const ohne = [notiz, marke('25R', '12R', 'Completed', null), marke('27R', '12R', 'Cancelled', null, 'Dora')];
        expect(fadenStatus(ohne, '12R')).toMatchObject({ zustand: 'cancelled', autor: 'Dora', datum: null });
    });

    it('Acrobat-Zustände werden gelesen, gelten aber für den Entwurf als offen', () => {
        const alle = [notiz, marke('16R', '12R', 'Accepted', 'D:20260928160000', 'Dora')];
        expect(fadenStatus(alle, '12R')?.zustand).toBe('accepted');
        expect(gespeicherterStatus(alle, '12R')).toBe('none');
        expect(fadenStatus([notiz, marke('16R', '12R', 'Rejected', null)], '12R')?.zustand).toBe('rejected');
        expect(fadenStatus([notiz, marke('16R', '12R', 'Unbekannt', null)], '12R')?.zustand).toBe('none');
    });
});

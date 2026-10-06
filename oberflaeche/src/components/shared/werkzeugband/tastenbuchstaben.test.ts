// SPDX-License-Identifier: Apache-2.0
//
// Vergabe der Tastenbuchstaben: Vorgaben zuerst, dann Anfangsbuchstabe,
// dann weitere Buchstaben der Beschriftung, dann A–Z/0–9 — nie doppelt.

import { describe, expect, it } from 'vitest';
import { idZuTaste, tastenVergeben } from './tastenbuchstaben';

describe('tastenVergeben', () => {
    it('Anfangsbuchstaben, bei Doppelung der nächste freie aus der Beschriftung', () => {
        expect(tastenVergeben([
            { id: 'neu', text: 'Neue E-Mail' },
            { id: 'loeschen', text: 'Löschen' },
            { id: 'archivieren', text: 'Archivieren' },
            { id: 'antworten', text: 'Antworten' },
            { id: 'allen', text: 'Allen antworten' },
        ])).toEqual({ neu: 'N', loeschen: 'L', archivieren: 'A', antworten: 'T', allen: 'E' });
    });

    it('Vorgaben gehen vor, auch wenn sie später stehen; doppelte Vorgaben zählen nur beim ersten', () => {
        expect(tastenVergeben([
            { id: 'start', text: 'Start' },
            { id: 'senden', text: 'Senden', taste: 's' },
            { id: 'speichern', text: 'Speichern', taste: 'S' },
        ])).toEqual({ senden: 'S', start: 'T', speichern: 'P' });
    });

    it('Umlaute sind Buchstaben; ohne freien Buchstaben in der Beschriftung kommt A–Z, dann 0–9', () => {
        expect(tastenVergeben([{ id: 'oe', text: 'Öffnen' }])).toEqual({ oe: 'Ö' });
        const viele = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(b => ({ id: b, text: b }));
        const vergeben = tastenVergeben([...viele, { id: 'x1', text: '—' }, { id: 'x2', text: 'A' }]);
        expect(vergeben.x1).toBe('0');
        expect(vergeben.x2).toBe('1');
        expect(new Set(Object.values(vergeben)).size).toBe(Object.keys(vergeben).length);
    });

    it('idZuTaste findet unabhängig von der Schreibung', () => {
        const v = tastenVergeben([{ id: 'oe', text: 'Öffnen' }, { id: 'neu', text: 'Neu' }]);
        expect(idZuTaste(v, 'ö')).toBe('oe');
        expect(idZuTaste(v, 'n')).toBe('neu');
        expect(idZuTaste(v, 'x')).toBeNull();
    });
});

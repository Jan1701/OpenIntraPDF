// SPDX-License-Identifier: Apache-2.0
//
// Stempel (Etappe 5): Label, Maße, Merken der Wahl und das Feld `stamp` des Befehls.

import { afterEach, describe, expect, it } from 'vitest';
import {
    STEMPEL, STEMPEL_SPEICHER, stempelAngabe, stempelBreite, stempelLabel, stempelSchrift, stempelWahlLesen, stempelWahlMerken,
    stempelWahlStandard,
} from './stempel';
import type { StempelId } from './stempel';

const KATALOG: Record<StempelId, string> = {
    draft: 'ENTWURF', checked: 'GEPRÜFT', approved: 'FREIGEGEBEN', paid: 'BEZAHLT',
    booked: 'GEBUCHT', received: 'EINGEGANGEN', done: 'ERLEDIGT', confidential: 'VERTRAULICH',
};
const katalog = (id: StempelId) => KATALOG[id];

describe('Label', () => {
    it('großgeschrieben nach Sprache, eine Zeile, ohne Steuerzeichen, höchstens 40 Zeichen', () => {
        expect(stempelLabel('  kopie ', 'de')).toBe('KOPIE');
        expect(stempelLabel('geprüft\nund\tgebucht', 'de')).toBe('GEPRÜFT UND GEBUCHT');
        expect(stempelLabel('a\u0000b', 'de')).toBe('A B');
        expect(stempelLabel('straße', 'de')).toBe('STRASSE');
        expect(Array.from(stempelLabel('ä'.repeat(50), 'de'))).toHaveLength(40);
        expect(stempelLabel('   ', 'de')).toBe('');
        // Eine unbrauchbare Sprachangabe wirft nicht — dann ohne Gebietsschema.
        expect(stempelLabel('ok', 'kein gültiges tag')).toBe('OK');
    });
});

describe('Maße', () => {
    it('Breite nach Labellänge, 150–260 pt', () => {
        expect(stempelBreite('ENTWURF')).toBe(150);
        expect(stempelBreite('FREIGEGEBEN')).toBe(215);
        expect(stempelBreite('X'.repeat(40))).toBe(260);
    });

    it('Schrift passt in Breite und Höhe, höchstens 28 pt; zweite Zeile 40 %, mindestens 6 pt', () => {
        const gross = stempelSchrift(600, 200, 'OK', true);
        expect(gross.label).toBe(28);
        expect(gross.zeile).toBeCloseTo(11.2);
        const eng = stempelSchrift(260, 50, 'ENTWURF', false);
        expect(eng.label).toBeLessThanOrEqual(28);
        expect(eng.label).toBeGreaterThan(20);
        const lang = stempelSchrift(150, 50, 'X'.repeat(40), true);
        expect(lang.label).toBeLessThan(eng.label);
        expect(lang.zeile).toBe(6);
    });
});

describe('Wahl merken', () => {
    afterEach(() => localStorage.clear());

    it('Standard: der erste Stempel mit seiner Farbe, „Name und Datum“ an', () => {
        expect(stempelWahlLesen()).toEqual({ id: 'draft', eigenerText: '', farbe: '#455a64', signed: true });
    });

    it('gemerkt wird alles; Unbrauchbares fällt auf den Standard zurück', () => {
        stempelWahlMerken({ id: 'custom', eigenerText: 'Kopie', farbe: '#1565c0', signed: false });
        expect(stempelWahlLesen()).toEqual({ id: 'custom', eigenerText: 'Kopie', farbe: '#1565c0', signed: false });
        localStorage.setItem(STEMPEL_SPEICHER, JSON.stringify({ id: 'unsinn', farbe: '#000000', signed: 'ja' }));
        expect(stempelWahlLesen()).toEqual(stempelWahlStandard());
        localStorage.setItem(STEMPEL_SPEICHER, '{kaputt');
        expect(stempelWahlLesen()).toEqual(stempelWahlStandard());
    });
});

describe('Feld `stamp` des Befehls', () => {
    it('fester Stempel: Label aus dem Katalog, /Name aus der Liste, Sprache höchstens 10 Zeichen', () => {
        const wahl = { id: 'checked' as const, eigenerText: '', farbe: '#2e7d32', signed: true };
        expect(stempelAngabe(wahl, katalog, 'de')).toEqual({ label: 'GEPRÜFT', name: 'Checked', signed: true, lang: 'de' });
        expect(stempelAngabe(wahl, katalog, 'de-DE-u-ca-gregory')?.lang).toHaveLength(10);
    });

    it('eigener Text: großgeschrieben, /Name Custom; ohne Text gibt es nichts zu stempeln', () => {
        expect(stempelAngabe({ id: 'custom', eigenerText: 'kopie für die akte', farbe: '#c62828', signed: false }, katalog, 'de'))
            .toEqual({ label: 'KOPIE FÜR DIE AKTE', name: 'Custom', signed: false, lang: 'de' });
        expect(stempelAngabe({ id: 'custom', eigenerText: ' \n ', farbe: '#c62828', signed: true }, katalog, 'de')).toBeNull();
    });

    it('alle acht Stempel tragen einen /Name aus der Liste des Vertrags', () => {
        const erlaubt = ['Approved', 'Draft', 'Confidential', 'Checked', 'Paid', 'Booked', 'Received', 'Done'];
        expect(STEMPEL).toHaveLength(8);
        for (const s of STEMPEL) expect(erlaubt).toContain(s.name);
        expect(new Set(STEMPEL.map(s => s.name)).size).toBe(8);
    });
});

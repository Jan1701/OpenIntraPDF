// SPDX-License-Identifier: Apache-2.0
//
// Post-it (Etappe 5): dunklere Randfarbe und das Merken der Zettelfarbe.

import { afterEach, describe, expect, it } from 'vitest';
import { dunkler, POSTIT_FARBEN, POSTIT_SPEICHER, postitFarbeLesen, postitFarbeMerken } from './postit';

describe('Post-it', () => {
    afterEach(() => localStorage.clear());

    it('Rand und Eselsohr sind um ein Viertel dunkler als die Füllung', () => {
        expect(dunkler([1, 0.961, 0.616])).toBe('rgb(191 184 118)');
        expect(dunkler([1, 1, 1], 0.5)).toBe('rgb(128 128 128)');
    });

    it('fünf Farben, Gelb zuerst; die Wahl bleibt erhalten, Fremdes fällt auf Gelb zurück', () => {
        expect(POSTIT_FARBEN.map(f => f.hex)).toEqual(['#fff59d', '#c5e1a5', '#f8bbd0', '#b3e5fc', '#ffcc80']);
        expect(postitFarbeLesen()).toBe('#fff59d');
        postitFarbeMerken('#b3e5fc');
        expect(postitFarbeLesen()).toBe('#b3e5fc');
        localStorage.setItem(POSTIT_SPEICHER, '#000000');
        expect(postitFarbeLesen()).toBe('#fff59d');
    });
});

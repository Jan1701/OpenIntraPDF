// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { seitenbereichParsen } from './druck';

describe('seitenbereichParsen', () => {
    it('Bereiche, einzelne Seiten, offene Enden; aufsteigend und ohne Doppelte, ab 0', () => {
        expect(seitenbereichParsen('1-3, 5, 8-', 10)).toEqual({ seiten: [0, 1, 2, 4, 7, 8, 9] });
        expect(seitenbereichParsen('5;3;5', 10)).toEqual({ seiten: [2, 4] });
        expect(seitenbereichParsen('-2', 10)).toEqual({ seiten: [0, 1] });
        expect(seitenbereichParsen(' 2 – 3 ', 10)).toEqual({ seiten: [1, 2] });
        expect(seitenbereichParsen('10', 10)).toEqual({ seiten: [9] });
    });

    it('meldet leer, unlesbar und außerhalb mit der Stelle', () => {
        expect(seitenbereichParsen('', 10)).toEqual({ fehler: { art: 'leer' } });
        expect(seitenbereichParsen(' , ', 10)).toEqual({ fehler: { art: 'leer' } });
        expect(seitenbereichParsen('1-3, a', 10)).toEqual({ fehler: { art: 'form', teil: 'a' } });
        expect(seitenbereichParsen('3-1', 10)).toEqual({ fehler: { art: 'form', teil: '3-1' } });
        expect(seitenbereichParsen('1 2', 10)).toEqual({ fehler: { art: 'form', teil: '1 2' } });
        expect(seitenbereichParsen('0', 10)).toEqual({ fehler: { art: 'ausserhalb', seite: 0 } });
        expect(seitenbereichParsen('1-11', 10)).toEqual({ fehler: { art: 'ausserhalb', seite: 11 } });
    });
});

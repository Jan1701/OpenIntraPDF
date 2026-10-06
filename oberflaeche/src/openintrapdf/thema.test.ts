// SPDX-License-Identifier: Apache-2.0
//
// Darstellung des Arbeitsplatzes: Vorgabe des Gastgebers schlägt die eigene Wahl.

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { THEMA_SPEICHER, useThema } from './thema';

afterEach(() => { localStorage.clear(); });

describe('useThema', () => {
    it('ohne Vorgabe gilt die eigene, gespeicherte Wahl', () => {
        localStorage.setItem(THEMA_SPEICHER, 'dunkel');
        const { result } = renderHook(() => useThema());
        expect(result.current).toMatchObject({ wahl: 'dunkel', wirksam: 'dark', vorgegeben: false });
        act(() => result.current.setWahl('hell'));
        expect(result.current.wirksam).toBe('light');
        expect(localStorage.getItem(THEMA_SPEICHER)).toBe('hell');
    });

    it('mit Vorgabe folgt es dem Gastgeber, auch bei Wechsel, und übergeht die eigene Wahl', () => {
        localStorage.setItem(THEMA_SPEICHER, 'dunkel');
        const { result, rerender } = renderHook(({ vorgabe }) => useThema(vorgabe), { initialProps: { vorgabe: 'hell' as 'hell' | 'dunkel' } });
        expect(result.current).toMatchObject({ wahl: 'hell', wirksam: 'light', vorgegeben: true });
        rerender({ vorgabe: 'dunkel' });
        expect(result.current.wirksam).toBe('dark');
    });
});

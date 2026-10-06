// SPDX-License-Identifier: Apache-2.0
//
// Hell / Dunkel / System für die Oberfläche des Arbeitsplatzes.
//
// Das betrifft nur die Programmfläche: Das Papier bleibt weiß, auch im
// dunklen Programm (Konzept Kap. 02).
//
// Gibt der Gastgeber eine Darstellung vor (in OIH dessen eigene Wahl),
// folgt der Arbeitsplatz ihr, auch wenn sie sich bei offenem Dokument
// ändert, und bietet keinen eigenen Schalter an. Ohne Vorgabe (Desktop)
// gilt die eigene Wahl pro Person und Browser (localStorage).
//
// Das Paket liest selbst weder OIH-Klassen noch -Einstellungen, nur Props
// und die Systemvorgabe (`prefers-color-scheme`).

import { useCallback, useEffect, useState } from 'react';

export type ThemaWahl = 'hell' | 'dunkel' | 'system';
export type WirksamesThema = 'light' | 'dark';

export const THEMA_SPEICHER = 'openintrapdf.thema';

function gespeicherteWahl(): ThemaWahl | null {
    try {
        const w = localStorage.getItem(THEMA_SPEICHER);
        return w === 'hell' || w === 'dunkel' || w === 'system' ? w : null;
    } catch {
        return null;
    }
}

function systemDunkel(): boolean {
    try {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
        return false;
    }
}

export function useThema(vorgabe?: 'hell' | 'dunkel') {
    const [eigeneWahl, setWahlIntern] = useState<ThemaWahl>(() => gespeicherteWahl() ?? 'system');
    const [dunkelImSystem, setDunkelImSystem] = useState(systemDunkel);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const abfrage = window.matchMedia('(prefers-color-scheme: dark)');
        const aendern = () => setDunkelImSystem(abfrage.matches);
        abfrage.addEventListener?.('change', aendern);
        return () => abfrage.removeEventListener?.('change', aendern);
    }, []);

    const setWahl = useCallback((neu: ThemaWahl) => {
        setWahlIntern(neu);
        try {
            localStorage.setItem(THEMA_SPEICHER, neu);
        } catch {
            // Privates Fenster o. Ä.: Die Wahl gilt dann nur bis zum Schließen.
        }
    }, []);

    const wahl: ThemaWahl = vorgabe ?? eigeneWahl;
    const wirksam: WirksamesThema = wahl === 'dunkel' || (wahl === 'system' && dunkelImSystem) ? 'dark' : 'light';
    return { wahl, setWahl, wirksam, vorgegeben: vorgabe !== undefined };
}

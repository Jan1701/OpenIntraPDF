// SPDX-License-Identifier: Apache-2.0
//
// Drucken mit Seitenbereich (Etappe 8): die Eingabe „1-3, 5, 8-“ in Seiten
// ab 0 umrechnen — mit Prüfung, die an der Eingabe gemeldet wird. Reine
// Funktion, kein React.

export type BereichFehler =
    | { art: 'leer' }
    | { art: 'form'; teil: string }
    | { art: 'ausserhalb'; seite: number };

/**
 * Seiten ab 0, aufsteigend und ohne Doppelte, aus einer Eingabe wie
 * `1-3, 5, 8-` (Seiten ab 1; „8-“ heißt bis zum Ende, „-3“ ab Anfang).
 */
export function seitenbereichParsen(text: string, seitenzahl: number): { seiten: number[] } | { fehler: BereichFehler } {
    const teile = text.split(/[,;]/).map(t => t.trim()).filter(Boolean);
    if (!teile.length) return { fehler: { art: 'leer' } };
    const gewaehlt = new Set<number>();
    for (const teil of teile) {
        const m = /^(\d*)\s*(-|–)?\s*(\d*)$/.exec(teil);
        if (!m || (!m[1] && !m[3]) || (!m[2] && m[3])) return { fehler: { art: 'form', teil } };
        const von = m[1] ? Number(m[1]) : 1;
        const bis = m[2] ? (m[3] ? Number(m[3]) : seitenzahl) : von;
        for (const s of [von, bis]) {
            if (s < 1 || s > seitenzahl) return { fehler: { art: 'ausserhalb', seite: s } };
        }
        if (bis < von) return { fehler: { art: 'form', teil } };
        for (let s = von; s <= bis; s++) gewaehlt.add(s - 1);
    }
    return { seiten: [...gewaehlt].sort((a, b) => a - b) };
}

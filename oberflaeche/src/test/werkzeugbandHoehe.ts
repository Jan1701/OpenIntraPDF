// SPDX-License-Identifier: Apache-2.0
//
// Höhe eines gerenderten Werkzeugbands aus den gesetzten Tailwind-Klassen.
//
// jsdom rechnet kein Layout; die Höhen des Werkzeugbands sollen aber nicht
// geschätzt, sondern aus dem abgelesen werden, was wirklich gesetzt ist
// (Jan: „aufpassen, dass die Höhe passt und nicht zu viel der Sicht
// wegnimmt“). Dieser Helfer geht den DOM-Baum ab und rechnet nach den
// Regeln, die für das Werkzeugband gelten:
//   - feste Höhe (h-*) vor Inhalt, min-h-* als Untergrenze
//   - Innenabstand (p/py/pt/pb), Rahmen (border, border-y), Außenabstand (m/my/mt/mb)
//   - flex-col: Kinder plus gap übereinander; flex (Zeile): das höchste Kind
//   - Text: eine Zeile in der geerbten Zeilenhöhe (text-xs 16, text-sm 20,
//     leading-4 16, leading-tight 1,25 × Schriftgröße, sonst 1,5 ×)
//   - SVG (lucide): sein height-Attribut; absolute/fixed Elemente zählen nicht
// Gleichartige Klassen am selben Element entscheidet Tailwind 3.4 nach der
// Reihenfolge im erzeugten CSS — für dieselbe Eigenschaft lexikografisch,
// die letzte gewinnt (`h-9 h-8` → h-9); pt vor py vor p. Das ist mit
// `npx tailwindcss` nachgeprüft (03.10.2026).
//
// Angenommen ist ein breites Fenster (≥ 1024 px): `sm:`-Varianten gelten,
// Gruppennamen sind sichtbar; nichts bricht um.

const SKALA: Record<string, number> = {
    '0': 0, px: 1, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10, '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24,
    '7': 28, '8': 32, '9': 36, '10': 40, '11': 44, '12': 48,
};

function px(wert: string): number | null {
    if (wert in SKALA) return SKALA[wert];
    const frei = /^\[(-?[\d.]+)(px|rem)\]$/.exec(wert);
    if (frei) return Number(frei[1]) * (frei[2] === 'rem' ? 16 : 1);
    return null;
}

function klassen(el: Element): string[] {
    return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** Wert der wirksamen Klasse mit diesem Präfix (ohne Varianten), oder `null`. */
function klassenwert(el: Element, praefix: string): number | null {
    const treffer = klassen(el)
        .map(k => {
            const negativ = k.startsWith('-');
            const rest = negativ ? k.slice(1) : k;
            if (!rest.startsWith(`${praefix}-`)) return null;
            const w = px(rest.slice(praefix.length + 1));
            return w === null ? null : { k, w: negativ ? -w : w };
        })
        .filter((x): x is { k: string; w: number } => x !== null)
        .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    return treffer.length ? treffer[treffer.length - 1].w : null;
}

/** Seite oben/unten: pt vor py vor p (Reihenfolge der Tailwind-Plugins). */
function seite(el: Element, art: 'p' | 'm', richtung: 't' | 'b'): number {
    return klassenwert(el, `${art}${richtung}`) ?? klassenwert(el, `${art}y`) ?? klassenwert(el, art) ?? 0;
}

const SCHRIFT: Record<string, { groesse: number; zeile: number }> = {
    'text-xs': { groesse: 12, zeile: 16 }, 'text-sm': { groesse: 14, zeile: 20 }, 'text-base': { groesse: 16, zeile: 24 },
};

function schriftgroesse(el: Element | null): number {
    for (let e = el; e; e = e.parentElement) {
        const k = klassen(e);
        const frei = k.map(x => /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(x)).find(Boolean);
        const benannt = k.filter(x => x in SCHRIFT).sort().pop();
        // Gleichzeitig gesetzt: das lexikografisch letzte gewinnt (text-[13px] < text-sm < text-xs).
        if (benannt) return SCHRIFT[benannt].groesse;
        if (frei) return Number(frei[1]);
    }
    return 16;
}

function zeilenhoehe(el: Element): number {
    for (let e: Element | null = el; e; e = e.parentElement) {
        const k = klassen(e);
        if (k.includes('leading-tight')) return 1.25 * schriftgroesse(el);
        if (k.includes('leading-none')) return schriftgroesse(el);
        const leading = klassenwert(e, 'leading');
        if (leading !== null) return leading;
        const benannt = k.filter(x => x in SCHRIFT).sort().pop();
        if (benannt) return SCHRIFT[benannt].zeile;
    }
    return 1.5 * schriftgroesse(el);
}

function ausgeblendet(el: Element, ohne: readonly string[]): boolean {
    const k = klassen(el);
    if (k.includes('absolute') || k.includes('fixed') || k.includes('sr-only')) return true;
    if (k.includes('hidden') && !k.some(x => /^sm:(inline-block|inline-flex|flex|block|inline)$/.test(x))) return true;
    if ((el as HTMLElement).hidden) return true;
    return ohne.some(c => k.includes(c));
}

const BLOCK = new Set(['div', 'form', 'p', 'section', 'header', 'nav', 'ul', 'ol', 'li']);

/**
 * Äußere Höhe (mit Außenabstand) eines Elements in px.
 * @param ohne Klassen, deren Träger nicht zählen (z. B. `werkzeugband-gruppenname` für schmale Fenster).
 */
export function hoeheAusKlassen(el: Element, ohne: readonly string[] = []): number {
    if (ausgeblendet(el, ohne)) return 0;
    const aussen = seite(el, 'm', 't') + seite(el, 'm', 'b');
    if (el.tagName.toLowerCase() === 'svg') return (Number(el.getAttribute('height')) || 0) + aussen;
    const k = klassen(el);
    const fest = klassenwert(el, 'h');
    const minimum = klassenwert(el, 'min-h') ?? 0;
    const rahmen = k.includes('border') || k.includes('border-y') ? 2 : (k.includes('border-t') ? 1 : 0) + (k.includes('border-b') ? 1 : 0);
    const kinder = Array.from(el.children);
    const text = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
    const zeile = text ? zeilenhoehe(el) : 0;
    let innen: number;
    if (k.includes('flex') || k.includes('inline-flex')) {
        const hoehen = kinder.map(c => hoeheAusKlassen(c, ohne)).filter((_, i) => !ausgeblendet(kinder[i], ohne));
        if (k.includes('flex-col')) {
            const luecke = klassenwert(el, 'gap') ?? klassenwert(el, 'gap-y') ?? 0;
            innen = hoehen.reduce((a, b) => a + b, 0) + Math.max(0, hoehen.length - 1) * luecke + zeile;
        } else {
            innen = Math.max(zeile, ...hoehen, 0);
        }
    } else {
        // Blockkinder stapeln, alles Übrige steht in einer Zeile.
        let bloecke = 0;
        let linie = zeile;
        for (const c of kinder) {
            if (ausgeblendet(c, ohne)) continue;
            if (BLOCK.has(c.tagName.toLowerCase()) && !klassen(c).some(x => x.startsWith('inline'))) bloecke += hoeheAusKlassen(c, ohne);
            else linie = Math.max(linie, hoeheAusKlassen(c, ohne));
        }
        innen = bloecke + linie;
    }
    const inhalt = innen + seite(el, 'p', 't') + seite(el, 'p', 'b') + rahmen;
    return (fest ?? Math.max(minimum, inhalt)) + aussen;
}

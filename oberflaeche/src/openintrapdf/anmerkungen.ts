// SPDX-License-Identifier: Apache-2.0
//
// Der Anmerkungsteil des Entwurfs — reine Funktionen, kein React, kein pdf.js.
//
// Der Entwurf hält neue Anmerkungen (mit Koordinaten im PDF-Benutzerraum der
// Quellseite) und Änderungen an gespeicherten: neuer Text, Löschung,
// Status. Gespeichert wird nie ein PDF, sondern genau diese Befehle
// (`annotations` im Commit, Vertrag Etappe 2). Der Server vergibt Kennung
// und Autor; hier gibt es nur `tmp-N` als Klammer für Antworten innerhalb
// desselben Commits.
//
// Warum Kennungen aus dem Entwurf abgeleitet werden: Beim Wiederholen
// (Redo) muss dieselbe Anmerkung dieselbe `client_id` bekommen, sonst
// zeigte eine wiederholte Antwort ins Leere.

import type { Seitenplan } from './seitenplan';
import type { AnmerkungHinzu, AnmerkungsArt, AnmerkungsBefehle, PdfRechteck } from './typen';

export type NeueAnmerkung = AnmerkungHinzu;

export type Statuswert = 'completed' | 'none';

export interface AnmerkungsEntwurf {
    neue: readonly NeueAnmerkung[];
    /** Neuer Text gespeicherter Anmerkungen, je pdf.js-Kennung (`12R`). */
    texte: Readonly<Record<string, { page: number; contents: string }>>;
    /** Zum Löschen vorgemerkte gespeicherte Anmerkungen. */
    geloescht: Readonly<Record<string, { page: number }>>;
    /** Statusänderungen („erledigt“) gespeicherter Anmerkungen. */
    status: Readonly<Record<string, { page: number; state: Statuswert }>>;
}

export function anmerkungenLeer(): AnmerkungsEntwurf {
    return { neue: [], texte: {}, geloescht: {}, status: {} };
}

export function anmerkungenUnveraendert(e: AnmerkungsEntwurf): boolean {
    return e.neue.length === 0
        && Object.keys(e.texte).length === 0
        && Object.keys(e.geloescht).length === 0
        && Object.keys(e.status).length === 0;
}

/** Wie viele Befehle der Entwurf beim Speichern schickt. */
export function anmerkungenAnzahl(e: AnmerkungsEntwurf): number {
    return e.neue.length + Object.keys(e.texte).length + Object.keys(e.geloescht).length + Object.keys(e.status).length;
}

/** Die kleinste `tmp-N`, die im Entwurf noch nicht vorkommt. */
export function naechsteKennung(e: AnmerkungsEntwurf): string {
    const belegt = new Set(e.neue.map(a => a.client_id));
    let n = 1;
    while (belegt.has(`tmp-${n}`)) n++;
    return `tmp-${n}`;
}

export const istEntwurfsKennung = (kennung: string) => kennung.startsWith('tmp-');

// ---------------------------------------------------------------------
// Farben und Strichstärken der Werkzeuge
// ---------------------------------------------------------------------

export const FARBEN = [
    { id: 'gelb', hex: '#ffd60a' },
    { id: 'gruen', hex: '#34c759' },
    { id: 'blau', hex: '#2f6fe4' },
    { id: 'rot', hex: '#e5484d' },
    { id: 'orange', hex: '#ff9500' },
    { id: 'schwarz', hex: '#1c2733' },
] as const;

export const STAERKEN = [1, 2, 4] as const;

/** `#rrggbb` → r, g, b in 0–1 (drei Nachkommastellen, wie im Vertrag üblich). */
export function hexZuRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16);
    const teil = (v: number) => Math.round((v / 255) * 1000) / 1000;
    return [teil((n >> 16) & 255), teil((n >> 8) & 255), teil(n & 255)];
}

export function rgbZuCss([r, g, b]: readonly number[]): string {
    return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Werkzeuge, die aus einer Textauswahl entstehen (nicht aus einer Geste auf der Fläche). */
export const TEXTMARKIERUNGEN: readonly AnmerkungsArt[] = ['highlight', 'underline', 'strikeout'];

/** Werkzeuge mit Strichstärke. */
export const MIT_STAERKE: readonly AnmerkungsArt[] = ['ink', 'line', 'arrow', 'square', 'circle'];

/** Anzeigename der Art in der Kommentarliste (Schlüssel unter `kommentare.art`). */
export const ART_NAME: Record<AnmerkungsArt, string> = {
    note: 'notiz',
    highlight: 'hervorhebung',
    underline: 'unterstreichung',
    strikeout: 'durchstreichung',
    freetext: 'textfeld',
    ink: 'zeichnung',
    line: 'linie',
    arrow: 'pfeil',
    square: 'rechteck',
    circle: 'kreis',
    sticky: 'postit',
    stamp: 'stempel',
    link: 'link',
};

/** Entwurfsanmerkungen, die sich verschieben und in der Größe ändern lassen (Etappe 5: nur diese). */
export const VERSCHIEBBAR: readonly AnmerkungsArt[] = ['sticky', 'stamp'];

// ---------------------------------------------------------------------
// Befehle
// ---------------------------------------------------------------------

export type AnmerkungsBefehl =
    /** `anmerkung.client_id` vergibt der Aufrufer über `naechsteKennung`. */
    | { art: 'anmerkungNeu'; anmerkung: NeueAnmerkung }
    /**
     * Text ändern. `ziel` ist eine `client_id` oder eine gespeicherte
     * Kennung; bei gespeicherten nimmt `original` die Änderung zurück, wenn
     * der Text wieder dem gespeicherten entspricht.
     */
    | { art: 'anmerkungText'; ziel: string; page: number; contents: string; original?: string }
    /** Eine neue Anmerkung verschwindet samt Antworten; eine gespeicherte wird vorgemerkt. */
    | { art: 'anmerkungLoeschen'; ziel: string; page: number }
    /** Löschvormerkung einer gespeicherten Anmerkung aufheben. */
    | { art: 'anmerkungBehalten'; ziel: string }
    /** `gespeichert` = Status im PDF; entspricht `state` ihm, fällt der Befehl aus dem Entwurf. */
    | { art: 'anmerkungStatus'; ref: string; page: number; state: Statuswert; gespeichert: Statuswert }
    /**
     * Neue Lage und Größe eines Post-its oder Stempels IM ENTWURF (`ziel` ist
     * eine `client_id`). Gespeicherte Anmerkungen verschiebt niemand
     * (Vertrag Etappe 5, „NICHT“); ein Befehl darauf bleibt ohne Wirkung.
     */
    | { art: 'anmerkungRect'; ziel: string; page: number; rect: PdfRechteck };

export function istAnmerkungsBefehl(b: { art: string }): b is AnmerkungsBefehl {
    return b.art.startsWith('anmerkung');
}

const ohne = <T,>(o: Readonly<Record<string, T>>, schluessel: string): Record<string, T> => {
    const { [schluessel]: _weg, ...rest } = o;
    return rest;
};

/** Alle Entwurfsantworten auf `kennung`, auch mittelbare. */
function antwortenAuf(neue: readonly NeueAnmerkung[], kennung: string): Set<string> {
    const weg = new Set<string>([kennung]);
    let gewachsen = true;
    while (gewachsen) {
        gewachsen = false;
        for (const a of neue) {
            if (a.reply_to && weg.has(a.reply_to) && !weg.has(a.client_id)) {
                weg.add(a.client_id);
                gewachsen = true;
            }
        }
    }
    weg.delete(kennung);
    return weg;
}

/** Wendet einen Befehl an; ohne Wirkung kommt derselbe Entwurf zurück. */
export function anmerkungsBefehlAnwenden(e: AnmerkungsEntwurf, b: AnmerkungsBefehl): AnmerkungsEntwurf {
    switch (b.art) {
        case 'anmerkungNeu': {
            if (e.neue.some(a => a.client_id === b.anmerkung.client_id)) return e;
            // Eine Antwort auf eine gelöschte oder unbekannte Entwurfsanmerkung gibt es nicht.
            const ziel = b.anmerkung.reply_to;
            if (ziel && istEntwurfsKennung(ziel) && !e.neue.some(a => a.client_id === ziel)) return e;
            if (ziel && e.geloescht[ziel]) return e;
            return { ...e, neue: [...e.neue, b.anmerkung] };
        }
        case 'anmerkungText': {
            if (istEntwurfsKennung(b.ziel)) {
                const i = e.neue.findIndex(a => a.client_id === b.ziel);
                if (i < 0 || e.neue[i].contents === b.contents) return e;
                const neue = [...e.neue];
                neue[i] = { ...neue[i], contents: b.contents };
                return { ...e, neue };
            }
            if (b.original !== undefined && b.original === b.contents) {
                return b.ziel in e.texte ? { ...e, texte: ohne(e.texte, b.ziel) } : e;
            }
            if (e.texte[b.ziel]?.contents === b.contents) return e;
            return { ...e, texte: { ...e.texte, [b.ziel]: { page: b.page, contents: b.contents } } };
        }
        case 'anmerkungLoeschen': {
            const weg = antwortenAuf(e.neue, b.ziel);
            if (istEntwurfsKennung(b.ziel)) {
                if (!e.neue.some(a => a.client_id === b.ziel)) return e;
                weg.add(b.ziel);
                return { ...e, neue: e.neue.filter(a => !weg.has(a.client_id)) };
            }
            if (e.geloescht[b.ziel]) return e;
            // Textänderung und Status einer gelöschten Anmerkung sind gegenstandslos;
            // Entwurfsantworten darauf würde der Server ablehnen.
            return {
                neue: e.neue.filter(a => !weg.has(a.client_id)),
                texte: ohne(e.texte, b.ziel),
                status: ohne(e.status, b.ziel),
                geloescht: { ...e.geloescht, [b.ziel]: { page: b.page } },
            };
        }
        case 'anmerkungBehalten':
            return e.geloescht[b.ziel] ? { ...e, geloescht: ohne(e.geloescht, b.ziel) } : e;
        case 'anmerkungStatus': {
            if (b.state === b.gespeichert) {
                return b.ref in e.status ? { ...e, status: ohne(e.status, b.ref) } : e;
            }
            if (e.status[b.ref]?.state === b.state) return e;
            return { ...e, status: { ...e.status, [b.ref]: { page: b.page, state: b.state } } };
        }
        case 'anmerkungRect': {
            if (!istEntwurfsKennung(b.ziel)) return e;
            const i = e.neue.findIndex(a => a.client_id === b.ziel);
            if (i < 0 || !VERSCHIEBBAR.includes(e.neue[i].kind)) return e;
            if (e.neue[i].rect.every((v, k) => v === b.rect[k])) return e;
            const neue = [...e.neue];
            neue[i] = { ...neue[i], rect: b.rect };
            return { ...e, neue };
        }
    }
}

/** Wie viele neue Anmerkungen an der Quellseite `quelle` hängen (für den Entfernen-Hinweis). */
export function neueJeQuelle(e: AnmerkungsEntwurf): Map<number, number> {
    const m = new Map<number, number>();
    for (const a of e.neue) m.set(a.page, (m.get(a.page) ?? 0) + 1);
    return m;
}

/**
 * Wie viele neue Anmerkungen beim Speichern entfielen, weil KEIN
 * verbleibender Planeintrag mehr auf ihre Quellseite zeigt. (Ein Duplikat
 * der Seite hielte sie am Leben — Anmerkungen wandern mit der Quelle.)
 * Mit `zusaetzlichEntfernt` lässt sich ein Entfernen vorab durchrechnen.
 */
export function entfallendeAnmerkungen(plan: Seitenplan, e: AnmerkungsEntwurf, zusaetzlichEntfernt: Iterable<string> = []): number {
    const weg = new Set(zusaetzlichEntfernt);
    const bleibt = new Set(plan.filter(s => !s.entfernt && !weg.has(s.id)).map(s => s.quelle));
    return e.neue.filter(a => !bleibt.has(a.page)).length;
}

/**
 * Der `annotations`-Teil des Commit-Befehls.
 *
 * Anmerkungen gehören zur Quellseite und wandern mit ihr; eine im Plan
 * entfernte Seite nimmt ihre Entwurfsanmerkungen mit — die Befehle dazu
 * werden gar nicht erst geschickt. `undefined`, wenn nichts zu tun ist.
 */
export function anmerkungenZuBefehl(e: AnmerkungsEntwurf, plan: Seitenplan): AnmerkungsBefehle | undefined {
    const bleibt = new Set(plan.filter(s => !s.entfernt).map(s => s.quelle));
    const add = e.neue.filter(a => bleibt.has(a.page));
    const update = Object.entries(e.texte).filter(([, v]) => bleibt.has(v.page)).map(([ref, v]) => ({ ref, page: v.page, contents: v.contents }));
    const del = Object.entries(e.geloescht).filter(([, v]) => bleibt.has(v.page)).map(([ref, v]) => ({ ref, page: v.page }));
    const state = Object.entries(e.status).filter(([, v]) => bleibt.has(v.page)).map(([ref, v]) => ({ ref, page: v.page, state: v.state }));
    const befehle: AnmerkungsBefehle = {};
    if (add.length) befehle.add = add;
    if (update.length) befehle.update = update;
    if (del.length) befehle.delete = del;
    if (state.length) befehle.state = state;
    return Object.keys(befehle).length ? befehle : undefined;
}

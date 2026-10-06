// SPDX-License-Identifier: Apache-2.0
//
// Der Seitenplan des Entwurfs — reine Funktionen, kein React, kein pdf.js.
//
// Ein Plan ist die Liste der Seiten, wie sie nach dem Speichern aussehen
// soll: welche Seite der Basisfassung (`quelle`), mit welcher ZUSÄTZLICHEN
// Drehung, und ob sie zum Entfernen vorgemerkt ist. Entfernte Seiten bleiben
// bis zum Speichern im Plan stehen (ausgegraut), damit man sie
// wiederherstellen kann.
//
// Jeder Eintrag hat eine eigene, stabile Kennung. Die Quellnummer reicht
// dafür nicht: Nach „Duplizieren“ steht dieselbe Quelle zweimal im Plan, und
// beim Umsortieren muss klar bleiben, WELCHE der beiden gemeint ist.
//
// Jeder Schritt ist ein benannter Befehl (`PlanBefehl`); die Historie mit
// Rückgängig/Wiederholen liegt in entwurf.ts, gemeinsam mit den
// Anmerkungsbefehlen. Die Kennungen neuer Einträge werden aus dem Plan
// selbst abgeleitet, also beim Wiederholen identisch.

import type { BindeQuelle, CommitSeite } from './typen';

export type Drehung = 0 | 90 | 180 | 270;

/** Format einer neuen leeren Seite in PDF-Punkten (Etappe 9). */
export interface LeerFormat { breite: number; hoehe: number }

/**
 * Eine Seite aus einer ANDEREN Drive-Datei (Etappe 9): Der Server hängt die
 * Datei beim Speichern hinten an die Basis (`sources`), und der Plan nennt
 * sie dort. `seite` zählt ab 0 in der gespeicherten Fassung `version`.
 */
export interface FremdeSeite { datei: string; name: string; version?: number; seite: number }

/** `quelle` eines Eintrags, der keine Seite der Basisfassung ist (leere oder fremde Seite). */
export const LEERE_QUELLE = -1;

export interface PlanEintrag {
    /** Stabile Kennung dieses Eintrags (nicht der Quelle). */
    id: string;
    /** Seite der Basisfassung, ab 0; `LEERE_QUELLE` bei einer leeren Seite. */
    quelle: number;
    /** Zusätzliche Drehung im Uhrzeigersinn; bei einer leeren Seite ihre ganze Drehung. */
    drehung: Drehung;
    /** Zum Entfernen vorgemerkt — gelöscht wird erst beim Speichern. */
    entfernt: boolean;
    /** Eine neue leere Seite (Etappe 9): Format statt Quelle. */
    leer?: LeerFormat;
    /** Eine Seite aus einer anderen Datei (Etappe 9) statt Quelle. */
    fremd?: FremdeSeite;
}

export type Seitenplan = readonly PlanEintrag[];

/** Was ein Eintrag beim Einfügen (Zwischenablage, Datei) mitbringt — alles außer Kennung und Entfernt-Marke. */
export type EinfuegeEintrag = Pick<PlanEintrag, 'quelle' | 'drehung' | 'leer' | 'fremd'>;

/** Der unveränderte Plan: jede Seite einmal, in Originalreihenfolge. */
export function planErstellen(seitenzahl: number): Seitenplan {
    return Array.from({ length: seitenzahl }, (_, i) => ({
        id: `s${i}`, quelle: i, drehung: 0, entfernt: false,
    }));
}

/** Ob der Plan genau dem gespeicherten Dokument entspricht. */
export function istUnveraendert(plan: Seitenplan, seitenzahl: number): boolean {
    return plan.length === seitenzahl
        && plan.every((e, i) => e.quelle === i && e.drehung === 0 && !e.entfernt);
}

/** Die verbleibenden (nicht entfernten) Einträge. */
export function verbleibend(plan: Seitenplan): PlanEintrag[] {
    return plan.filter(e => !e.entfernt);
}

/**
 * Nummer jedes Eintrags im KÜNFTIGEN Dokument (ab 1); entfernte haben keine.
 * Das ist die Zahl, die man in „vor Seite …“ eingibt.
 */
export function neueNummern(plan: Seitenplan): Map<string, number> {
    const nummern = new Map<string, number>();
    let n = 0;
    for (const e of plan) if (!e.entfernt) nummern.set(e.id, ++n);
    return nummern;
}

/**
 * Die fremden Dateien des Plans als `sources` des Commits (Etappe 9): jede
 * Datei einmal, in der Reihenfolge ihres ersten Vorkommens, mit genau den
 * Seiten, die der Plan braucht (aufsteigend, ohne Doppelte). `stellen`
 * nennt je Datei und Seite, an welcher Stelle hinter der Basis sie landet.
 */
export function planQuellen(plan: Seitenplan): { sources: BindeQuelle[]; stellen: Map<string, number> } {
    const dateien = new Map<string, { version?: number; seiten: Set<number> }>();
    for (const e of verbleibend(plan)) {
        if (!e.fremd) continue;
        const d = dateien.get(e.fremd.datei) ?? { version: e.fremd.version, seiten: new Set<number>() };
        d.seiten.add(e.fremd.seite);
        dateien.set(e.fremd.datei, d);
    }
    const sources: BindeQuelle[] = [];
    const stellen = new Map<string, number>();
    let stelle = 0;
    for (const [datei, d] of dateien) {
        const seiten = [...d.seiten].sort((a, b) => a - b);
        const q: BindeQuelle = { file_id: datei, pages: seiten };
        if (d.version !== undefined) q.expected_version = d.version;
        sources.push(q);
        for (const s of seiten) stellen.set(`${datei}\u0000${s}`, stelle++);
    }
    return { sources, stellen };
}

/**
 * Der Seitenplan für den Commit-Befehl: nur Verbleibende, in Reihenfolge.
 * `seitenzahl` ist die der Basisfassung — fremde Seiten zählen dahinter.
 */
export function planZuSeiten(plan: Seitenplan, seitenzahl = 0): CommitSeite[] {
    const { stellen } = planQuellen(plan);
    return verbleibend(plan).map(e => {
        if (e.leer) return { source: LEERE_QUELLE, rotate: e.drehung, blank: { width: e.leer.breite, height: e.leer.hoehe } };
        if (e.fremd) return { source: seitenzahl + (stellen.get(`${e.fremd.datei}\u0000${e.fremd.seite}`) ?? 0), rotate: e.drehung };
        return { source: e.quelle, rotate: e.drehung };
    });
}

const alsMenge = (ids: Iterable<string>) => new Set(ids);

function normalisieren(grad: number): Drehung {
    return (((grad % 360) + 360) % 360) as Drehung;
}

// ---------------------------------------------------------------------
// Einzelne Änderungen
// ---------------------------------------------------------------------

export function drehen(plan: Seitenplan, ids: Iterable<string>, grad: 90 | -90 | 180): Seitenplan {
    const wahl = alsMenge(ids);
    return plan.map(e => (wahl.has(e.id) ? { ...e, drehung: normalisieren(e.drehung + grad) } : e));
}

/**
 * Merkt Einträge zum Entfernen vor.
 *
 * Die letzte verbleibende Seite ist nie entfernbar: Ein PDF ohne Seiten gibt
 * es nicht, und der Server lehnt es ohnehin ab (`pdf.no_pages`). Würde die
 * Auswahl ALLE verbleibenden Seiten treffen, geschieht gar nichts — halb
 * auszuführen wäre überraschender als abzulehnen.
 */
export function entfernen(plan: Seitenplan, ids: Iterable<string>): { plan: Seitenplan; letzteSeite: boolean } {
    const wahl = alsMenge(ids);
    const bleiben = plan.filter(e => !e.entfernt && !wahl.has(e.id)).length;
    if (bleiben === 0) return { plan, letzteSeite: true };
    return { plan: plan.map(e => (wahl.has(e.id) ? { ...e, entfernt: true } : e)), letzteSeite: false };
}

export function wiederherstellen(plan: Seitenplan, ids: Iterable<string>): Seitenplan {
    const wahl = alsMenge(ids);
    return plan.map(e => (wahl.has(e.id) && e.entfernt ? { ...e, entfernt: false } : e));
}

/**
 * Verschiebt die gewählten Einträge als Block vor den Eintrag `vorId`
 * (`null` = ans Ende). Die Reihenfolge innerhalb des Blocks bleibt, wie sie
 * im Plan war — nicht, in welcher Reihenfolge geklickt wurde.
 */
export function verschieben(plan: Seitenplan, ids: Iterable<string>, vorId: string | null): Seitenplan {
    const wahl = alsMenge(ids);
    if (wahl.size === 0) return plan;
    const block = plan.filter(e => wahl.has(e.id));
    const rest = plan.filter(e => !wahl.has(e.id));
    // Liegt das Ziel selbst in der Auswahl, ist der nächste nicht gewählte
    // Eintrag danach gemeint (sonst gäbe es keine Stelle zum Einfügen).
    let ziel = vorId;
    if (ziel !== null && wahl.has(ziel)) {
        const ab = plan.findIndex(e => e.id === ziel);
        ziel = plan.slice(ab).find(e => !wahl.has(e.id))?.id ?? null;
    }
    const stelle = ziel === null ? rest.length : rest.findIndex(e => e.id === ziel);
    const i = stelle < 0 ? rest.length : stelle;
    return [...rest.slice(0, i), ...block, ...rest.slice(i)];
}

/**
 * Jeden gewählten Eintrag um eine Stelle nach vorn. Zusammenhängende Blöcke
 * wandern gemeinsam; ein Block, der schon vorn anstößt, bleibt stehen.
 */
export function nachVorn(plan: Seitenplan, ids: Iterable<string>): Seitenplan {
    const wahl = alsMenge(ids);
    const neu = [...plan];
    for (let i = 1; i < neu.length; i++) {
        if (wahl.has(neu[i].id) && !wahl.has(neu[i - 1].id)) {
            [neu[i - 1], neu[i]] = [neu[i], neu[i - 1]];
        }
    }
    return neu;
}

export function nachHinten(plan: Seitenplan, ids: Iterable<string>): Seitenplan {
    const wahl = alsMenge(ids);
    const neu = [...plan];
    for (let i = neu.length - 2; i >= 0; i--) {
        if (wahl.has(neu[i].id) && !wahl.has(neu[i + 1].id)) {
            [neu[i], neu[i + 1]] = [neu[i + 1], neu[i]];
        }
    }
    return neu;
}

/** Eine Kennung, die im Plan noch nicht vorkommt — aus dem Plan abgeleitet. */
function freieKennung(belegt: Set<string>, basis: string): string {
    let n = 2;
    while (belegt.has(`${basis}~${n}`)) n++;
    return `${basis}~${n}`;
}

/** Die Kennungsbasis eines Eintrags: `s<quelle>`, `leer` oder `q` (fremde Seite). */
const kennungsBasis = (e: EinfuegeEintrag) => (e.leer ? 'leer' : e.fremd ? 'q' : `s${e.quelle}`);

/** Ein neuer Eintrag aus dem, was eingefügt wird; ohne `undefined`-Felder, damit Vergleiche stimmen. */
function neuerEintrag(id: string, e: EinfuegeEintrag): PlanEintrag {
    return { id, quelle: e.quelle, drehung: e.drehung, entfernt: false, ...(e.leer ? { leer: e.leer } : {}), ...(e.fremd ? { fremd: e.fremd } : {}) };
}

/** Setzt hinter jeden gewählten Eintrag eine Kopie (gleiche Quelle, Drehung). */
export function duplizieren(plan: Seitenplan, ids: Iterable<string>): Seitenplan {
    const wahl = alsMenge(ids);
    const belegt = new Set(plan.map(e => e.id));
    const neu: PlanEintrag[] = [];
    for (const e of plan) {
        neu.push(e);
        if (wahl.has(e.id)) {
            // Die Kopie trägt die Kennung ihrer Quelle, nicht die des Eintrags —
            // so bleibt sie kurz und lesbar, auch nach mehrfachem Duplizieren.
            const id = freieKennung(belegt, kennungsBasis(e));
            belegt.add(id);
            neu.push(neuerEintrag(id, e));
        }
    }
    return neu;
}

/**
 * Setzt hinter den Eintrag `nach` (`null` = an den Anfang) neue Einträge
 * (Etappe 9): Kopien aus der Zwischenablage oder Seiten aus einer anderen
 * Datei. Die Kennungen entstehen aus dem Plan, Wiederholen ergibt dieselben.
 */
export function einfuegen(plan: Seitenplan, nach: string | null, eintraege: readonly EinfuegeEintrag[]): Seitenplan {
    if (!eintraege.length) return plan;
    const i = nach === null ? -1 : plan.findIndex(e => e.id === nach);
    if (nach !== null && i < 0) return plan;
    const belegt = new Set(plan.map(e => e.id));
    const neue = eintraege.map(e => {
        const id = freieKennung(belegt, kennungsBasis(e));
        belegt.add(id);
        return neuerEintrag(id, e);
    });
    return [...plan.slice(0, i + 1), ...neue, ...plan.slice(i + 1)];
}

/**
 * Setzt hinter den Eintrag `nach` (`null` = an den Anfang) eine neue leere
 * Seite im Format und mit der Drehung des Nachbarn (Etappe 9). Das Format
 * trägt der Befehl selbst, damit Wiederholen dieselbe Seite ergibt.
 */
export function leereSeiteEinfuegen(plan: Seitenplan, nach: string | null, format: LeerFormat, drehung: Drehung): Seitenplan {
    const belegt = new Set(plan.map(e => e.id));
    const neu: PlanEintrag = { id: freieKennung(belegt, 'leer'), quelle: LEERE_QUELLE, drehung, entfernt: false, leer: format };
    const i = nach === null ? -1 : plan.findIndex(e => e.id === nach);
    if (nach !== null && i < 0) return plan;
    return [...plan.slice(0, i + 1), neu, ...plan.slice(i + 1)];
}

// ---------------------------------------------------------------------
// Befehle
// ---------------------------------------------------------------------

export type PlanBefehl =
    | { art: 'drehen'; ids: string[]; grad: 90 | -90 }
    | { art: 'entfernen'; ids: string[] }
    | { art: 'wiederherstellen'; ids: string[] }
    | { art: 'verschieben'; ids: string[]; vor: string | null }
    | { art: 'nachVorn'; ids: string[] }
    | { art: 'nachHinten'; ids: string[] }
    | { art: 'duplizieren'; ids: string[] }
    /** Leere Seite hinter `nach` (Etappe 9); Format und Drehung des Nachbarn. */
    | { art: 'leereSeite'; nach: string | null; format: LeerFormat; drehung: Drehung }
    /** Einträge hinter `nach` einfügen (Etappe 9): Kopien aus der Zwischenablage oder Seiten aus einer Datei. */
    | { art: 'einfuegen'; nach: string | null; eintraege: EinfuegeEintrag[] };

export type BefehlsErgebnis = 'ok' | 'ohneWirkung' | 'letzteSeite';

const gleicherPlan = (a: Seitenplan, b: Seitenplan) =>
    a.length === b.length && a.every((e, i) => {
        const f = b[i];
        return e.id === f.id && e.quelle === f.quelle && e.drehung === f.drehung && e.entfernt === f.entfernt
            && e.leer?.breite === f.leer?.breite && e.leer?.hoehe === f.leer?.hoehe
            && e.fremd?.datei === f.fremd?.datei && e.fremd?.seite === f.fremd?.seite;
    });

/** Wendet einen Befehl an. Ohne Wirkung (oder abgelehnt) kommt der alte Plan zurück. */
export function befehlAnwenden(plan: Seitenplan, befehl: PlanBefehl): { plan: Seitenplan; ergebnis: BefehlsErgebnis } {
    let neu: Seitenplan;
    switch (befehl.art) {
        case 'drehen': neu = drehen(plan, befehl.ids, befehl.grad); break;
        case 'entfernen': {
            const r = entfernen(plan, befehl.ids);
            if (r.letzteSeite) return { plan, ergebnis: 'letzteSeite' };
            neu = r.plan;
            break;
        }
        case 'wiederherstellen': neu = wiederherstellen(plan, befehl.ids); break;
        case 'verschieben': neu = verschieben(plan, befehl.ids, befehl.vor); break;
        case 'nachVorn': neu = nachVorn(plan, befehl.ids); break;
        case 'nachHinten': neu = nachHinten(plan, befehl.ids); break;
        case 'duplizieren': neu = duplizieren(plan, befehl.ids); break;
        case 'leereSeite': neu = leereSeiteEinfuegen(plan, befehl.nach, befehl.format, befehl.drehung); break;
        case 'einfuegen': neu = einfuegen(plan, befehl.nach, befehl.eintraege); break;
    }
    return gleicherPlan(plan, neu) ? { plan, ergebnis: 'ohneWirkung' } : { plan: neu, ergebnis: 'ok' };
}

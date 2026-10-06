// SPDX-License-Identifier: Apache-2.0
//
// Der Entwurf: Seitenplan UND Anmerkungen, mit EINER Befehlshistorie.
//
// Rückgängig/Wiederholen läuft über benannte Befehle: zurück geht es über
// den gemerkten Stand davor, vor über erneutes Anwenden desselben Befehls.
// Seitenbefehle und Anmerkungsbefehle stehen in derselben Liste, so dass
// Strg+Z immer den zuletzt getanen Schritt zurücknimmt — gleich, ob eine
// Seite gedreht oder eine Notiz gesetzt wurde. (Bis Etappe 1 lag die
// Historie in seitenplan.ts; hier ist sie um die Anmerkungen erweitert.)
//
// Tippen in einer Notiz erzeugt je Änderung einen Textbefehl. Damit die
// Historie nicht aus 200 Buchstaben besteht, verschmilzt ein Textbefehl mit
// einem unmittelbar vorangehenden für dieselbe Anmerkung; Rückgängig nimmt
// dann den ganzen Tippvorgang zurück — wie in jedem Editor.
//
// Eigenschaften (Etappe 8): Titel, Thema, Autor und Stichwörter liegen als
// dritter Teil im Entwurf — nur die Felder, die vom Dokument abweichen; ein
// leerer String heißt „entfernen“. Ein Befehl ersetzt die ganze Menge, so
// nimmt Rückgängig das Übernehmen aus dem Dialog als einen Schritt zurück.

import { anmerkungenLeer, anmerkungenUnveraendert, anmerkungsBefehlAnwenden, istAnmerkungsBefehl } from './anmerkungen';
import type { AnmerkungsBefehl, AnmerkungsEntwurf } from './anmerkungen';
import { befehlAnwenden as planBefehlAnwenden, istUnveraendert as planUnveraendert } from './seitenplan';
import type { BefehlsErgebnis, PlanBefehl, Seitenplan } from './seitenplan';
import type { PdfEigenschaften } from './typen';

/** Die vom Dokument abweichenden Eigenschaften; `''` entfernt den Eintrag. */
export type EigenschaftenEntwurf = Readonly<PdfEigenschaften>;

export interface Entwurf {
    plan: Seitenplan;
    anmerkungen: AnmerkungsEntwurf;
    eigenschaften: EigenschaftenEntwurf;
}

/** Eigenschaften aus dem Dialog übernehmen: `werte` ersetzt die ganze Menge. */
export interface EigenschaftenBefehl { art: 'eigenschaften'; werte: EigenschaftenEntwurf }

export type EntwurfBefehl = PlanBefehl | AnmerkungsBefehl | EigenschaftenBefehl;

const EIGENSCHAFTEN: readonly (keyof PdfEigenschaften)[] = ['title', 'subject', 'author', 'keywords'];

export function eigenschaftenGleich(a: EigenschaftenEntwurf, b: EigenschaftenEntwurf): boolean {
    return EIGENSCHAFTEN.every(k => a[k] === b[k]);
}

export const eigenschaftenUnveraendert = (e: EigenschaftenEntwurf) => EIGENSCHAFTEN.every(k => e[k] === undefined);

/** Ob der Entwurf genau dem gespeicherten Dokument entspricht. */
export function istUnveraendert(e: Entwurf, seitenzahl: number): boolean {
    return planUnveraendert(e.plan, seitenzahl) && anmerkungenUnveraendert(e.anmerkungen) && eigenschaftenUnveraendert(e.eigenschaften);
}

/** Wendet einen Befehl an. Ohne Wirkung (oder abgelehnt) kommt der alte Stand zurück. */
export function befehlAnwenden(e: Entwurf, befehl: EntwurfBefehl): { stand: Entwurf; ergebnis: BefehlsErgebnis } {
    if (befehl.art === 'eigenschaften') {
        // Nur Felder behalten, die gesetzt sind — `undefined` hieße nur „unverändert“.
        const werte: PdfEigenschaften = {};
        for (const k of EIGENSCHAFTEN) if (befehl.werte[k] !== undefined) werte[k] = befehl.werte[k];
        return eigenschaftenGleich(e.eigenschaften, werte)
            ? { stand: e, ergebnis: 'ohneWirkung' }
            : { stand: { ...e, eigenschaften: werte }, ergebnis: 'ok' };
    }
    if (istAnmerkungsBefehl(befehl)) {
        const anmerkungen = anmerkungsBefehlAnwenden(e.anmerkungen, befehl);
        return anmerkungen === e.anmerkungen
            ? { stand: e, ergebnis: 'ohneWirkung' }
            : { stand: { ...e, anmerkungen }, ergebnis: 'ok' };
    }
    const r = planBefehlAnwenden(e.plan, befehl);
    return r.ergebnis === 'ok' ? { stand: { ...e, plan: r.plan }, ergebnis: 'ok' } : { stand: e, ergebnis: r.ergebnis };
}

export interface Verlauf {
    stand: Entwurf;
    /** Ausgeführte Befehle, jeweils mit dem Stand davor. Neueste zuletzt. */
    zurueck: { befehl: EntwurfBefehl; vorher: Entwurf }[];
    /** Zurückgenommene Befehle zum Wiederholen. Nächster zuletzt. */
    vor: EntwurfBefehl[];
}

/** Mehr Schritte hält niemand im Kopf; der Speicher dankt. */
export const VERLAUF_GRENZE = 200;

export function verlaufStarten(plan: Seitenplan, anmerkungen: AnmerkungsEntwurf = anmerkungenLeer()): Verlauf {
    return { stand: { plan, anmerkungen, eigenschaften: {} }, zurueck: [], vor: [] };
}

const verschmilzt = (a: EntwurfBefehl | undefined, b: EntwurfBefehl) =>
    !!a && a.art === 'anmerkungText' && b.art === 'anmerkungText' && a.ziel === b.ziel;

export function ausfuehren(v: Verlauf, befehl: EntwurfBefehl): { verlauf: Verlauf; ergebnis: BefehlsErgebnis } {
    const { stand, ergebnis } = befehlAnwenden(v.stand, befehl);
    if (ergebnis !== 'ok') return { verlauf: v, ergebnis };
    const letzter = v.zurueck[v.zurueck.length - 1];
    const zurueck = verschmilzt(letzter?.befehl, befehl)
        ? [...v.zurueck.slice(0, -1), { befehl, vorher: letzter.vorher }]
        : [...v.zurueck, { befehl, vorher: v.stand }].slice(-VERLAUF_GRENZE);
    // Ein neuer Schritt verwirft, was zum Wiederholen bereitlag — wie überall.
    return { verlauf: { stand, zurueck, vor: [] }, ergebnis };
}

export function rueckgaengig(v: Verlauf): Verlauf {
    const letzter = v.zurueck[v.zurueck.length - 1];
    if (!letzter) return v;
    return { stand: letzter.vorher, zurueck: v.zurueck.slice(0, -1), vor: [...v.vor, letzter.befehl] };
}

export function wiederholen(v: Verlauf): Verlauf {
    const befehl = v.vor[v.vor.length - 1];
    if (!befehl) return v;
    const { stand, ergebnis } = befehlAnwenden(v.stand, befehl);
    if (ergebnis !== 'ok') return { ...v, vor: v.vor.slice(0, -1) };
    return { stand, zurueck: [...v.zurueck, { befehl, vorher: v.stand }], vor: v.vor.slice(0, -1) };
}

/** Der Befehl, den „Rückgängig“ als Nächstes zurücknimmt (für die Beschriftung). */
export const naechstesZurueck = (v: Verlauf): EntwurfBefehl | undefined => v.zurueck[v.zurueck.length - 1]?.befehl;
export const naechstesVor = (v: Verlauf): EntwurfBefehl | undefined => v.vor[v.vor.length - 1];

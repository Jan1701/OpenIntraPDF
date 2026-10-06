// SPDX-License-Identifier: Apache-2.0
//
// Wiederkehrende Klassen der Bedienelemente. Farben kommen ausschließlich
// aus den Tokens in openintrapdf.css (var(--opdf-…)), nie aus den
// Tailwind-Farben von OIH — sonst kippte der Arbeitsplatz mit dem
// OIH-Dunkelmodus statt mit seiner eigenen Wahl.

const basis = 'inline-flex items-center justify-center gap-2 rounded-md text-sm transition-colors '
    + 'disabled:opacity-45 disabled:cursor-not-allowed';

/** Unauffälliger Knopf mit Beschriftung. */
export const knopf = `${basis} h-9 px-3 text-[var(--opdf-text)] hover:bg-[var(--opdf-weich)]`;

/** Knopf nur mit Symbol (Beschriftung per aria-label/title). */
export const symbolKnopf = `${basis} h-9 w-9 shrink-0 text-[var(--opdf-text)] hover:bg-[var(--opdf-weich)]`;

/** Hauptaktion. */
export const hauptKnopf = `${basis} h-9 px-3 font-semibold bg-[var(--opdf-akzent)] text-[var(--opdf-auf-akzent)] hover:brightness-110`;

/** Umrandeter Nebenknopf. */
export const rahmenKnopf = `${basis} h-9 px-3 border border-[var(--opdf-linie)] bg-[var(--opdf-paneel)] text-[var(--opdf-text)] hover:bg-[var(--opdf-weich)]`;

/** Gefährliche Aktion (Verluste annehmen). */
export const warnKnopf = `${basis} h-9 px-3 font-semibold bg-[var(--opdf-fehler)] text-[var(--opdf-paneel)] hover:brightness-110`;

/** Kleine graue Zusatzzeile. */
export const leise = 'text-xs text-[var(--opdf-gedaempft)]';

/** Überschrift eines Abschnitts in einer Seitenleiste. */
export const abschnitt = 'text-[11px] font-bold uppercase tracking-wider text-[var(--opdf-gedaempft)]';

/** Eingabefeld. */
export const eingabe = 'h-9 rounded-md border border-[var(--opdf-linie)] bg-[var(--opdf-app)] px-2 text-sm '
    + 'text-[var(--opdf-text)] placeholder:text-[var(--opdf-gedaempft)]';

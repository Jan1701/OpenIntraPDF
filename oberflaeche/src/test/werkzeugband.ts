// SPDX-License-Identifier: Apache-2.0
//
// Griffe für Tests am Werkzeugband des PDF-Arbeitsplatzes (Etappe 7).
//
// Die Seitenleiste links hat ebenfalls Reiter („Seiten“, „Lesezeichen“,
// „Suche“) — darum laufen alle Zugriffe über den Bereich „Werkzeugband“, sonst
// träfe `getByRole('tab', { name: 'Seiten' })` zwei Elemente.

import { fireEvent, screen, within } from '@testing-library/react';

/** Das Werkzeugband als Ganzes. */
export const werkzeugband = () => screen.getByRole('region', { name: 'Werkzeugband' });

/** Ein Reiter des Werkzeugbands; `null`, wenn es ihn in dieser Lage nicht gibt. */
export const reiter = (name: string) => within(werkzeugband()).queryByRole('tab', { name });

/** Die Namen aller Reiter in Reihenfolge (ohne das Datei-Menü). */
export const reiterNamen = () => within(werkzeugband()).getAllByRole('tab').map(r => r.textContent ?? '');

/** Einen Reiter wählen. */
export function reiterWaehlen(name: string) {
    fireEvent.click(within(werkzeugband()).getByRole('tab', { name }));
}

/** Das Band des gewählten Reiters. */
export const band = () => within(werkzeugband()).getByRole('tabpanel');

/** Ein Knopf im Band. */
export const bandKnopf = (name: string | RegExp) => within(band()).getByRole('button', { name });

/** Reiter wählen und einen Knopf im Band drücken. */
export function bandDruecken(reiterName: string, knopf: string) {
    reiterWaehlen(reiterName);
    fireEvent.click(bandKnopf(knopf));
}

/** Das Datei-Menü öffnen und seine Einträge liefern. */
export function dateiMenue() {
    fireEvent.click(within(werkzeugband()).getByRole('button', { name: 'Datei' }));
    return within(werkzeugband()).getByRole('menu');
}

/** Das Arbeitsfach rechts mit der genannten Gruppe. */
export const fach = (name: string) => screen.getByRole('region', { name });

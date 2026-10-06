// SPDX-License-Identifier: Apache-2.0
//
// Eine Seite klein rendern und messen, wie viel davon nicht weiß ist — für
// „Leere Seiten prüfen“. Getrennt von leereSeiten.ts, damit die Regel ohne
// Leinwand (Testumgebung) prüfbar bleibt.

import { nichtWeissAnteil } from './leereSeiten';
import type { PruefSeite, Rasterer } from './leereSeiten';

interface RenderSeite extends PruefSeite {
    getViewport(p: { scale: number; rotation?: number }): { width: number; height: number };
    render(p: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<unknown> };
}

/** Maßstab wie im alten Betrachter: klein genug für Tempo, groß genug für Stempel. */
const MASSSTAB = 0.35;

export const leinwandRastern: Rasterer = async (seite, drehung) => {
    const s = seite as RenderSeite;
    const blick = s.getViewport({ scale: MASSSTAB, rotation: (s.rotate + drehung) % 360 });
    const leinwand = document.createElement('canvas');
    leinwand.width = Math.max(1, Math.floor(blick.width));
    leinwand.height = Math.max(1, Math.floor(blick.height));
    // pdf.js füllt den Seitengrund selbst weiß; transparente Stellen gibt es nicht.
    await s.render({ canvas: leinwand, viewport: blick }).promise;
    const ctx = leinwand.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { anteil: 1 };
    const anteil = nichtWeissAnteil(ctx.getImageData(0, 0, leinwand.width, leinwand.height).data);
    const vorschau = leinwand.toDataURL('image/png');
    leinwand.width = 0;
    leinwand.height = 0;
    return { anteil, vorschau };
};

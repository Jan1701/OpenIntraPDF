// SPDX-License-Identifier: Apache-2.0
//
// Seiten für die Texterkennung rastern — mit pdf.js, das der Arbeitsplatz
// ohnehin mitbringt (Vertrag Etappe 6: kein Poppler). Gerastert wird in
// der Auflösung, die der OIH-Dienst mit pdftoppm nutzt (der Auftrag nennt
// sie), als Graustufen-PNG, im ANGEZEIGTEN Seitenraum: CropBox und
// /Rotate angewandt, so wie pdf.js die Seite auch zeigt. Tesseract liefert
// dann Lagen, die 72/dpi-mal in Punkte umgerechnet genau dort liegen, wo
// dokument.TextebeneBauen sie erwartet.

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjsLaden } from '../openintrapdf/pdfjsLaden';

/** Rastert eine Seite (ab 0) eines geladenen Dokuments als PNG, Base64. */
export interface Rasterer {
    laden(daten: ArrayBuffer): Promise<void>;
    rastern(seite: number, dpi: number): Promise<string>;
    schliessen(): void;
}

/** Bytes als Base64, stückweise — `btoa` auf Megabytes kippt sonst um. */
export function alsBase64(bytes: Uint8Array): string {
    let s = '';
    const schritt = 0x8000;
    for (let i = 0; i < bytes.length; i += schritt) {
        s += String.fromCharCode(...bytes.subarray(i, i + schritt));
    }
    return btoa(s);
}

/** Farbe → Graustufe (Luminanz), wie `pdftoppm -gray`. */
export function grauMachen(daten: Uint8ClampedArray): void {
    for (let i = 0; i < daten.length; i += 4) {
        const y = Math.round(0.299 * daten[i] + 0.587 * daten[i + 1] + 0.114 * daten[i + 2]);
        daten[i] = y;
        daten[i + 1] = y;
        daten[i + 2] = y;
        daten[i + 3] = 255;
    }
}

export function pdfjsRasterer(): Rasterer {
    let aufgabe: PDFDocumentLoadingTask | null = null;
    let dokument: PDFDocumentProxy | null = null;
    return {
        async laden(daten) {
            const { pdfjs, dokumentOptionen } = await pdfjsLaden();
            aufgabe = pdfjs.getDocument({ data: new Uint8Array(daten), ...dokumentOptionen, enableXfa: false });
            dokument = await aufgabe.promise;
        },
        async rastern(seite, dpi) {
            if (!dokument) throw new Error('kein Dokument');
            const s = await dokument.getPage(seite + 1);
            const blick = s.getViewport({ scale: dpi / 72 });
            const leinwand = document.createElement('canvas');
            leinwand.width = Math.max(1, Math.round(blick.width));
            leinwand.height = Math.max(1, Math.round(blick.height));
            await s.render({ canvas: leinwand, viewport: blick }).promise;
            const ctx = leinwand.getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('keine Leinwand');
            const bild = ctx.getImageData(0, 0, leinwand.width, leinwand.height);
            grauMachen(bild.data);
            ctx.putImageData(bild, 0, 0);
            const blob = await new Promise<Blob | null>(fertig => leinwand.toBlob(fertig, 'image/png'));
            leinwand.width = 0;
            leinwand.height = 0;
            s.cleanup();
            if (!blob) throw new Error('kein PNG');
            return alsBase64(new Uint8Array(await blob.arrayBuffer()));
        },
        schliessen() {
            // Die Ladeaufgabe raeumt Dokument und Worker auf.
            void aufgabe?.destroy();
            aufgabe = null;
            dokument = null;
        },
    };
}

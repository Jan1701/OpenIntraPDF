// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Schwarz-Weiß-Scans brauchen die Hilfsdateien von pdf.js (07.10.2026):
// Ein Ricoh-Scan (CCITT Gruppe 4) erschien im Drive als leere Seite, weil
// pdf.js 6 CCITT-, JBIG2- und JPEG-2000-Bilder nur noch über WebAssembly
// entschlüsselt und `wasmUrl` fehlte („JBig2 failed to initialize“).
//
// Die Probe testdata/ccitt-scan-probe.pdf ist erfunden: 1200 × 900 Pixel,
// weiß, ein Balken 1001 × 61 und ein Block 301 × 101 schwarz (8,46 %),
// mit Pillow als CCITT Gruppe 4 (K -1) gespeichert:
//
//   from PIL import Image, ImageDraw
//   im = Image.new("1", (1200, 900), 1); d = ImageDraw.Draw(im)
//   d.rectangle([100, 100, 1100, 160], fill=0); d.rectangle([100, 700, 400, 800], fill=0)
//   im.save("ccitt-scan-probe.pdf", resolution=150)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfjsHilfen } from './pdfjsLaden';

const probe = fileURLToPath(new URL('./testdata/ccitt-scan-probe.pdf', import.meta.url));
const wasm = fileURLToPath(new URL('../../node_modules/pdfjs-dist/wasm/', import.meta.url));

/** Anteil schwarzer Pixel des einzigen Bilds auf Seite 1, null ohne Bild. */
async function schwarzanteil(optionen: Record<string, unknown>): Promise<number | null> {
    const aufgabe = getDocument({
        data: new Uint8Array(readFileSync(probe)), isOffscreenCanvasSupported: false, verbosity: 0, ...optionen,
    });
    const dokument = await aufgabe.promise;
    try {
        const seite = await dokument.getPage(1);
        const ops = await seite.getOperatorList();
        const i = ops.fnArray.indexOf(OPS.paintImageXObject);
        expect(i).toBeGreaterThanOrEqual(0);
        const id = ops.argsArray[i][0] as string;
        // Das Bild kommt nach der Operatorliste aus dem Worker: warten, bis
        // es da ist (null heißt: pdf.js konnte es nicht entschlüsseln).
        const bild = await new Promise<{ data?: Uint8ClampedArray } | null>(fertig => {
            seite.objs.get(id, (wert: unknown) => fertig(wert as { data?: Uint8ClampedArray } | null));
        });
        if (!bild?.data) return null;
        let gesetzt = 0;
        for (const b of bild.data) {
            let x = b;
            while (x) { gesetzt += x & 1; x >>= 1; }
        }
        const anteil = (100 * gesetzt) / (bild.data.length * 8);
        // Ob 1 Schwarz oder Weiß heißt, legt pdf.js fest -- gezählt wird die kleinere Seite.
        return Math.min(anteil, 100 - anteil);
    } finally {
        await aufgabe.destroy();
    }
}

describe('Schwarz-Weiß-Scan (CCITT Gruppe 4) in pdf.js', () => {
    it('ohne die Hilfsdateien fehlt das Bild -- so erschien der Scan als leere Seite', async () => {
        expect(await schwarzanteil({})).toBeNull();
    });

    it('mit wasmUrl wird es entschlüsselt, der schwarze Anteil stimmt', async () => {
        const anteil = await schwarzanteil({ wasmUrl: wasm });
        expect(anteil).not.toBeNull();
        expect(anteil!).toBeGreaterThan(7.5);
        expect(anteil!).toBeLessThan(9.5);
    });
});

describe('pdfjsHilfen', () => {
    it('liefert Ordneradressen relativ zur Seite, mit Schrägstrich am Ende', () => {
        expect(pdfjsHilfen('https://oih.example.org/')).toEqual({
            wasmUrl: 'https://oih.example.org/pdfjs/wasm/',
            cMapUrl: 'https://oih.example.org/pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'https://oih.example.org/pdfjs/standard_fonts/',
            iccUrl: 'https://oih.example.org/pdfjs/iccs/',
        });
        // Desktop-App: Asset-Server der App, Seite unter einem Unterpfad.
        expect(pdfjsHilfen('wails://wails/index.html').wasmUrl).toBe('wails://wails/pdfjs/wasm/');
    });
});

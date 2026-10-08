// SPDX-License-Identifier: Apache-2.0
//
// Die Hilfsdateien von pdf.js unter `pdfjs/…` ausliefern — im Hub wie in
// der Desktop-App (vite.config.ts, vite.desktop.config.ts).
//
// ⚠️ Ohne sie fehlen Seiteninhalte, ohne Fehlermeldung in der Oberfläche
// (07.10.2026, work): pdf.js 6 entschlüsselt CCITT-Fax- und JBIG2-Bilder
// (Schwarz-Weiß-Scans der Kopierer) und JPEG 2000 nur noch über
// WebAssembly-Module. Ohne `wasmUrl` meldet der Worker nur „Unable to
// decode image … JBig2 failed to initialize“ und lässt das Bild weg — ein
// Ricoh-Scan erschien als leere Seite. Dazu die Schriftzuordnungen (cmaps:
// asiatische und andere vordefinierte Kodierungen), die Ersatzschriften für
// nicht eingebettete Standardschriften (standard_fonts) und die Farbprofile
// (iccs). Welche Adressen pdf.js bekommt, steht in pdfjsLaden.ts.
//
// Nicht dabei: quickjs-eval (470 KB) — das ist die Ablaufumgebung für
// JavaScript in PDFs, und das führt OpenIntraPDF bewusst nicht aus.
//
//   Bau:          jede Datei als Asset unter pdfjs/<ordner>/<datei>
//   Entwicklung:  dieselben Adressen aus node_modules (Middleware)
//
// Die Lizenztexte der Module (LICENSE_JBIG2, LICENSE_OPENJPEG, LICENSE_QCMS
// und die pdf.js-Fassungen) gehen mit nach pdfjs/wasm/.

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

export const PDFJS_ORDNER = ['wasm', 'cmaps', 'standard_fonts', 'iccs'] as const;

/**
 * Bibliotheken in den WebAssembly-Modulen von pdfjs-dist mit eigener Lizenz.
 * Der Lizenzdialog der Desktop-App nennt sie neben pdf.js
 * (vite.desktop.config.ts, drittanbieterListe → lizenzverzeichnis).
 */
export const PDFJS_WASM_BIBLIOTHEKEN = [
    { name: 'PDFium JBIG2/CCITT-Decoder (pdfjs-dist/wasm)', license: 'BSD-3-Clause', datei: 'LICENSE_JBIG2' },
    { name: 'OpenJPEG (pdfjs-dist/wasm)', license: 'BSD-2-Clause', datei: 'LICENSE_OPENJPEG' },
    { name: 'qcms (pdfjs-dist/wasm)', license: 'MIT', datei: 'LICENSE_QCMS' },
] as const;

const AUSGELASSEN = /^quickjs-eval\./;

function dateienVon(wurzel: string): { ordner: string; datei: string; voll: string }[] {
    const aus: { ordner: string; datei: string; voll: string }[] = [];
    for (const ordner of PDFJS_ORDNER) {
        const verzeichnis = path.join(wurzel, ordner);
        for (const datei of fs.readdirSync(verzeichnis).sort()) {
            const voll = path.join(verzeichnis, datei);
            if (AUSGELASSEN.test(datei) || !fs.statSync(voll).isFile()) continue;
            aus.push({ ordner, datei, voll });
        }
    }
    return aus;
}

const ARTEN: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.js': 'text/javascript',
    '.bcmap': 'application/octet-stream',
    '.pfb': 'application/octet-stream',
    '.ttf': 'font/ttf',
    '.icc': 'application/vnd.iccprofile',
};

export function pdfjsDateien(): Plugin {
    const wurzel = path.resolve(__dirname, 'node_modules/pdfjs-dist');
    return {
        name: 'oih-pdfjs-dateien',
        generateBundle() {
            const dateien = dateienVon(wurzel);
            if (!dateien.some(d => d.datei === 'jbig2.wasm') || !dateien.some(d => d.datei === 'openjpeg.wasm')) {
                this.error('pdfjs-dist ohne wasm/jbig2.wasm oder wasm/openjpeg.wasm — Scans blieben leer');
            }
            for (const d of dateien) {
                this.emitFile({ type: 'asset', fileName: `pdfjs/${d.ordner}/${d.datei}`, source: fs.readFileSync(d.voll) });
            }
        },
        configureServer(server) {
            server.middlewares.use('/pdfjs/', (anfrage, antwort, weiter) => {
                const teile = (anfrage.url ?? '').split('?')[0].replace(/^\/+/, '').split('/');
                const [ordner, datei] = teile;
                if (teile.length !== 2 || !(PDFJS_ORDNER as readonly string[]).includes(ordner)
                    || !datei || datei.includes('..') || AUSGELASSEN.test(datei)) {
                    weiter();
                    return;
                }
                const voll = path.join(wurzel, ordner, datei);
                if (!fs.existsSync(voll)) {
                    weiter();
                    return;
                }
                antwort.setHeader('Content-Type', ARTEN[path.extname(datei)] ?? 'application/octet-stream');
                fs.createReadStream(voll).pipe(antwort);
            });
        },
    };
}

// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Die Content-Security-Policy der Schreibtisch-App (desktop.html, #253) und
// die Voraussetzung, auf der sie ruht: pdf.js kommt ohne eval aus.
//
// Ob die App unter dieser Richtlinie läuft, prüft dieser Test nicht. Das
// wurde am 03.10.2026 in einem WKWebView unter wails://wails/ geprüft —
// Seite mit eingebetteter Schrift, Bild, Notizsymbol und Miniatur, keine
// einzige Verletzung; ohne 'unsafe-inline' bei style-src oder ohne data:
// bei img-src meldete dieselbe Probe Verletzungen und zeichnete nichts.
// Hier wird festgehalten, dass niemand die Richtlinie still aufweicht:
// Jede Änderung muss dieser Test und der Kommentar in desktop.html
// mitmachen.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../desktop.html', import.meta.url)), 'utf8');

const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi;

/** Die Richtlinie als Direktive → Quellen. */
function richtlinie(): Record<string, string[]> {
    const treffer = [...html.matchAll(CSP_META)];
    expect(treffer, 'genau eine CSP in desktop.html').toHaveLength(1);
    const aus: Record<string, string[]> = {};
    for (const teil of treffer[0][1].split(';')) {
        const [name, ...quellen] = teil.trim().split(/\s+/);
        if (name) aus[name] = quellen;
    }
    return aus;
}

describe('CSP der Schreibtisch-App (desktop.html)', () => {
    it('steht vor dem ersten Skript', () => {
        richtlinie();
        const meta = html.search(CSP_META);
        expect(meta).toBeGreaterThan(-1);
        expect(meta).toBeLessThan(html.indexOf('<script'));
    });

    it('Skripte nur von der App selbst: kein eval, kein Inline-Skript, kein Netz', () => {
        const r = richtlinie();
        expect(r['default-src']).toEqual(["'self'"]);
        expect(r['script-src']).toEqual(["'self'"]);
        expect(r['connect-src']).toEqual(["'self'"]);
        expect(r['object-src']).toEqual(["'none'"]);
        expect(r['base-uri']).toEqual(["'none'"]);
        for (const [name, quellen] of Object.entries(r)) {
            for (const q of quellen) {
                expect(q, `${name}: ${q}`).not.toMatch(/unsafe-eval|^\*$|^https?:|^wss?:/);
            }
        }
    });

    it('geht nur dort über self hinaus, wo desktop.html es begründet', () => {
        expect(richtlinie()).toEqual({
            'default-src': ["'self'"],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
            'worker-src': ["'self'", 'blob:'],
            'media-src': ["'self'", 'blob:'],
            'connect-src': ["'self'"],
            'object-src': ["'none'"],
            'base-uri': ["'none'"],
            'form-action': ["'none'"],
        });
    });
});

describe('pdf.js kommt ohne eval aus', () => {
    // Was die App bündelt: die Bibliothek, ihren Worker und den Viewer.
    const dateien = ['build/pdf.mjs', 'build/pdf.worker.min.mjs', 'web/pdf_viewer.mjs'];
    const lesen = (datei: string) =>
        readFileSync(fileURLToPath(new URL(`../../node_modules/pdfjs-dist/${datei}`, import.meta.url)), 'utf8');

    it.each(dateien)('%s ruft weder eval noch new Function', datei => {
        const code = lesen(datei);
        expect(code).not.toMatch(/\beval\s*\(/);
        expect(code).not.toMatch(/\bnew\s+Function\s*\(/);
    });

    it.each(dateien)('%s kennt die Option isEvalSupported nicht (mehr)', datei => {
        // Taucht sie mit einer anderen pdf.js-Fassung wieder auf, gehört
        // `isEvalSupported: false` an jedes getDocument (PdfArbeitsplatz.tsx,
        // desktop/rastern.ts) — die CSP fängt eval nur im Hauptfaden ab.
        expect(lesen(datei)).not.toContain('isEvalSupported');
    });
});

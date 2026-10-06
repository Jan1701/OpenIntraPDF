// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Was der Go-Adapter als Eigenschaften schreibt (Etappe 8), liest pdf.js:
// Info-Woerterbuch (getMetadata().info) und XMP (getMetadata().metadata).
// Die Probe testdata/eigenschaften-probe.pdf erzeugt
// openintrapdf/dokument/eigenschaften_test.go (TestEigenschaftenProbeSchreiben
// mit OIH_PROBE_ZIEL) aus korpus.PDFA() mit Titel, Thema, Autor und
// Stichwoertern — Umlaute, Gedankenstrich, & und < inklusive.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eigenschaftenLesen } from './eigenschaften';

// pdf.js laedt unter Node beim Import immer @napi-rs/canvas. Dessen musl-Fassung (CI-Abbild
// node:22-alpine) braucht AVX2; die CI-VM hat das CPU-Modell „QEMU Virtual CPU“ ohne AVX2,
// und der Test-Worker stirbt mit „Illegal instruction“ (CI-Laeufe 73/74, 02.10.2026). Dort wird
// uebersprungen, ohne pdf.js zu laden -- der Import allein ist schon der Absturz.
// Dauerhafte Abhilfe: CPU-Typ der VM auf „host“ stellen.
const ohneAvx2 = process.platform === 'linux' && process.arch === 'x64'
    && !/\bavx2\b/.test(readFileSync('/proc/cpuinfo', 'utf8'));
const { getDocument } = ohneAvx2
    ? { getDocument: undefined as never }
    : await import('pdfjs-dist/legacy/build/pdf.mjs');

const probe = fileURLToPath(new URL('./testdata/eigenschaften-probe.pdf', import.meta.url));

describe.skipIf(ohneAvx2)('Eigenschaften aus dem Go-Adapter in pdf.js', () => {
    it('getMetadata liefert Info-Woerterbuch und XMP mit denselben Werten; eigenschaftenLesen zeigt sie', async () => {
        const daten = new Uint8Array(readFileSync(probe));
        const aufgabe = getDocument({ data: daten });
        const dokument = await aufgabe.promise;
        try {
            const meta = await dokument.getMetadata();
            const info = meta.info as Record<string, unknown>;
            expect(info.Title).toBe('Angebot Küche – Müller & Söhne');
            expect(info.Subject).toBe('Rechnung 00123 <geprüft>');
            expect(info.Author).toBe('Erika Musterfrau');
            expect(info.Keywords).toBe('Rechnung; Küche; 2026');
            expect(String(info.Producer)).toMatch(/^pdfcpu/);
            // XMP: pdf.js liest dc:title, dc:description, dc:creator und pdf:Keywords.
            const xmp = meta.metadata;
            expect(xmp).not.toBeNull();
            expect(xmp!.get('dc:title')).toBe('Angebot Küche – Müller & Söhne');
            expect(xmp!.get('dc:description')).toBe('Rechnung 00123 <geprüft>');
            expect(xmp!.get('dc:creator')).toEqual(['Erika Musterfrau']);
            expect(xmp!.get('pdf:keywords')).toBe('Rechnung; Küche; 2026');
            // Die PDF/A-Kennung aus der Quelle ist noch da.
            expect(xmp!.get('pdfaid:part')).toBe('2');
            // Und der Dialog des Arbeitsplatzes sieht dasselbe.
            const werte = await eigenschaftenLesen(dokument as unknown as Parameters<typeof eigenschaftenLesen>[0]);
            expect(werte).toMatchObject({ titel: 'Angebot Küche – Müller & Söhne', thema: 'Rechnung 00123 <geprüft>', autor: 'Erika Musterfrau', stichwoerter: 'Rechnung; Küche; 2026', seiten: 1 });
        } finally {
            await aufgabe.destroy();
        }
    });
});

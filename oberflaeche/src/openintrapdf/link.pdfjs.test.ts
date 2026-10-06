// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Links des Go-Adapters (Etappe 9, Abschnitt 4) in pdf.js: getAnnotations
// liefert sie als Link mit `url` (Web-Adresse, mailto) bzw. `dest`
// (Zielseite), und linksSammeln liest sie so, wie die Leseansicht sie
// umrandet. Die Probe testdata/link-probe.pdf erzeugt
// openintrapdf/dokument/link_test.go (TestLinkProbeSchreiben mit
// OIH_PROBE_ZIEL): Web-Link und mailto auf Seite 1, Zielseiten-Link auf
// Seite 3 nach Seite 2.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { linksSammeln, TYP_LINK } from './kommentare';

const probe = fileURLToPath(new URL('./testdata/link-probe.pdf', import.meta.url));

describe('Links aus dem Go-Adapter in pdf.js', () => {
    it('getAnnotations zeigt url bzw. dest; linksSammeln liefert Seite, Rechteck und Ziel', async () => {
        const aufgabe = getDocument({ data: new Uint8Array(readFileSync(probe)) });
        const dokument = await aufgabe.promise;
        try {
            const seite1 = await (await dokument.getPage(1)).getAnnotations();
            const links1 = seite1.filter(a => a.annotationType === TYP_LINK);
            expect(links1).toHaveLength(2);
            expect(links1[0].url).toBe('https://example.org/angebot?nr=00123&x=(a)');
            expect(links1[1].url).toBe('mailto:vertrieb@example.org');
            // Kein sichtbarer Rahmen.
            expect(links1[0].borderStyle?.width ?? 0).toBe(0);
            const seite3 = await (await dokument.getPage(3)).getAnnotations();
            const links3 = seite3.filter(a => a.annotationType === TYP_LINK);
            expect(links3).toHaveLength(1);
            expect(links3[0].url).toBeUndefined();
            expect(links3[0].dest).toBeTruthy();
            // Das Ziel ist Seite 2 (Index 1).
            const ziel = await dokument.getPageIndex(links3[0].dest[0]);
            expect(ziel).toBe(1);

            const alle = await linksSammeln(dokument as unknown as Parameters<typeof linksSammeln>[0]);
            expect(alle.map(l => [l.page, l.url ?? (l.dest ? 'dest' : '-')])).toEqual([
                [0, 'https://example.org/angebot?nr=00123&x=(a)'], [0, 'mailto:vertrieb@example.org'], [2, 'dest'],
            ]);
            expect(alle[0].rect).toEqual([72, 700, 300, 720]);
            expect(alle[0].id).toMatch(/^\d+R$/);
        } finally {
            await aufgabe.destroy();
        }
    });
});

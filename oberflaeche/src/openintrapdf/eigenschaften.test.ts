// SPDX-License-Identifier: Apache-2.0
//
// Eigenschaften aus einer pdf.js-Attrappe lesen: Metadaten, Seitenzahl,
// Größe der ersten Seite, Dateigröße — und was fehlt, bleibt leer.

import { describe, expect, it } from 'vitest';
import { eigenschaftenLesen, groesseText, ptZuMm } from './eigenschaften';

describe('eigenschaftenLesen', () => {
    it('liest Titel, Autor, Thema, Stichwörter, Ersteller, Produzent, Version, Daten, Seiten, Seitengröße und Dateigröße', async () => {
        const dokument = {
            numPages: 12,
            getMetadata: async () => ({
                info: {
                    Title: ' Angebot 2026 ', Author: 'Anna Muster', Subject: 'Küche', Keywords: 'Angebot, Küche', Creator: 'Writer',
                    Producer: 'OpenIntraPDF', PDFFormatVersion: '1.7', CreationDate: 'D:20260929140800+02\'00\'', ModDate: 'D:20261001090000Z',
                },
            }),
            getPage: async () => ({ view: [0, 0, 595.28, 841.89] }),
        };
        const e = await eigenschaftenLesen(dokument, 123456);
        expect(e).toMatchObject({
            titel: 'Angebot 2026', autor: 'Anna Muster', thema: 'Küche', stichwoerter: 'Angebot, Küche', ersteller: 'Writer',
            produzent: 'OpenIntraPDF', pdfVersion: '1.7', seiten: 12, dateigroesse: 123456,
        });
        expect(e.erstellt?.toISOString()).toBe('2026-09-29T12:08:00.000Z');
        expect(e.geaendert?.toISOString()).toBe('2026-10-01T09:00:00.000Z');
        expect(e.ersteSeite).toEqual({ breitePt: 595.28, hoehePt: 841.89 });
        expect(ptZuMm(e.ersteSeite!.breitePt)).toBeCloseTo(210, 1);
        expect(ptZuMm(e.ersteSeite!.hoehePt)).toBeCloseTo(297, 1);
    });

    it('ohne Metadaten, ohne Seite und ohne Dateigröße bleiben die Felder leer — die Seitenzahl bleibt', async () => {
        const dokument = {
            numPages: 2,
            getMetadata: async () => { throw new Error('kaputt'); },
            getPage: async () => ({}),
        };
        const e = await eigenschaftenLesen(dokument);
        expect(e).toEqual({
            titel: undefined, autor: undefined, thema: undefined, stichwoerter: undefined, ersteller: undefined, produzent: undefined,
            pdfVersion: undefined, erstellt: null, geaendert: null, seiten: 2, ersteSeite: null, dateigroesse: undefined,
        });
    });

    it('eine CropBox mit Versatz ergibt trotzdem Breite und Höhe; Nicht-Text wird nicht als Titel genommen', async () => {
        const dokument = {
            numPages: 1,
            getMetadata: async () => ({ info: { Title: 42, Author: '' } }),
            getPage: async () => ({ view: [20, 30, 320, 430] }),
        };
        const e = await eigenschaftenLesen(dokument);
        expect(e.titel).toBeUndefined();
        expect(e.autor).toBeUndefined();
        expect(e.ersteSeite).toEqual({ breitePt: 300, hoehePt: 400 });
    });
});

describe('groesseText', () => {
    it('Bytes, KB, MB, GB in der Sprache', () => {
        expect(groesseText(512, 'de')).toBe('512 Bytes');
        expect(groesseText(12_595, 'de')).toBe('12,3 KB');
        expect(groesseText(5_033_165, 'en')).toBe('4.8 MB');
        expect(groesseText(3 * 1024 ** 3, 'de')).toBe('3 GB');
    });
});

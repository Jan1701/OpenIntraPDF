// SPDX-License-Identifier: Apache-2.0
//
// Dateien binden, reine Funktionen: Seitenbereich (ab 0), Rumpf des
// Befehls, Merkmale aus der Info, Einordnung von 412 und 422.

import { describe, expect, it } from 'vitest';
import { bereichLesen, bindeBefehl, bindeFehlerEinordnen, merkmale } from './binden';
import type { Quelle } from './binden';
import { PdfHostFehler } from './typen';
import type { PdfInfo } from './typen';

const quelle = (ueber: Partial<Quelle> = {}): Quelle => ({
    key: 'q1', id: 'f1', name: 'A.pdf', version: 3, seitenzahl: 5,
    signiert: false, formular: false, passwort: false, laedt: false, fehler: null, bereichText: '', ...ueber,
});
const ziel = { drive_id: '', folder_id: null, name: 'Gebunden.pdf' };

describe('bereichLesen', () => {
    it('leer = alle Seiten; „1-3, 5“ ab 0, sortiert, ohne Doppelte', () => {
        expect(bereichLesen({ bereichText: '', seitenzahl: 5 })).toBeNull();
        expect(bereichLesen({ bereichText: ' 1-3, 5 ', seitenzahl: 5 })).toEqual([0, 1, 2, 4]);
        expect(bereichLesen({ bereichText: '5;2-3;2', seitenzahl: 5 })).toEqual([1, 2, 4]);
    });

    it('meldet Unlesbares und Seiten außerhalb der Datei', () => {
        expect(bereichLesen({ bereichText: 'a', seitenzahl: 5 })).toBe('ungueltig');
        expect(bereichLesen({ bereichText: '0', seitenzahl: 5 })).toBe('ungueltig');
        expect(bereichLesen({ bereichText: '6', seitenzahl: 5 })).toBe('ungueltig');
        expect(bereichLesen({ bereichText: '3-1', seitenzahl: 5 })).toBe('ungueltig');
    });

    it('ohne bekannte Seitenzahl prüft erst der Server die Grenze', () => {
        expect(bereichLesen({ bereichText: '7-9', seitenzahl: undefined })).toEqual([6, 7, 8]);
    });
});

describe('bindeBefehl', () => {
    it('baut die Quellen in Reihenfolge; `pages` nur mit Bereich, `expected_version` nur wenn bekannt', () => {
        const g = bindeBefehl([
            quelle(),
            quelle({ key: 'q2', id: 'f2', version: undefined, bereichText: '2-3' }),
        ], ziel, true);
        expect(g).toEqual({
            befehl: {
                sources: [{ file_id: 'f1', expected_version: 3 }, { file_id: 'f2', pages: [1, 2] }],
                destination: ziel,
                bookmarks_per_source: true,
            },
        });
    });

    it('nennt den ersten Grund, der das Binden verhindert', () => {
        expect(bindeBefehl([], ziel, true)).toEqual({ fehler: 'keineQuellen' });
        expect(bindeBefehl(Array.from({ length: 21 }, (_, i) => quelle({ key: `q${i}` })), ziel, true)).toEqual({ fehler: 'zuViele' });
        expect(bindeBefehl([quelle({ laedt: true })], ziel, true)).toEqual({ fehler: 'laedt' });
        expect(bindeBefehl([quelle({ fehler: 'nichtLesbar' })], ziel, true)).toEqual({ fehler: 'nichtLesbar' });
        expect(bindeBefehl([quelle({ passwort: true })], ziel, true)).toEqual({ fehler: 'passwort' });
        expect(bindeBefehl([quelle({ bereichText: '9' })], ziel, false)).toEqual({ fehler: 'bereich' });
    });
});

describe('merkmale', () => {
    it('liest Fassung, Seiten, Signatur, Formular und Passwort aus der Info', () => {
        const info: PdfInfo = {
            file_id: 'f1', name: 'A.pdf', version: 7, sha256: 'x', access: 'view',
            inspection: { pages: 4, signed: true, form_fields: 2 },
            capabilities: { merge: { state: 'requires_password', reason: 'user_password' } },
        };
        expect(merkmale(info)).toEqual({ version: 7, seitenzahl: 4, signiert: true, formular: true, passwort: true });
        expect(merkmale({ ...info, inspection: undefined, capabilities: undefined }))
            .toEqual({ version: 7, seitenzahl: undefined, signiert: false, formular: false, passwort: false });
    });
});

describe('bindeFehlerEinordnen', () => {
    const befehl = { sources: [{ file_id: 'f1' }], destination: ziel, bookmarks_per_source: true };

    it('412 nennt die geänderte Quelle und ihre Fassung', () => {
        const f = new PdfHostFehler(412, 'pdf.version_conflict', { file_id: 'f2', current_version: 4 });
        expect(bindeFehlerEinordnen(f, befehl)).toEqual({ art: 'konflikt', fileId: 'f2', aktuelleVersion: 4 });
    });

    it('422 preservation_failed trägt Bericht, Klassen und den Rumpf für die Bestätigung', () => {
        const f = new PdfHostFehler(422, 'pdf.preservation_failed', { losses: ['bookmarks'], report: { bookmarks_before: 2, bookmarks_after: 0 } });
        expect(bindeFehlerEinordnen(f, befehl)).toEqual({
            art: 'verlust', bericht: { bookmarks_before: 2, bookmarks_after: 0 }, klassen: ['bookmarks'], befehl,
        });
    });

    it('Netz und 5xx sind wiederholbar, 404/403/409 nicht; andere Codes tragen den Satz des Servers', () => {
        expect(bindeFehlerEinordnen(new PdfHostFehler(0, 'network'), befehl)).toMatchObject({ art: 'fehlgeschlagen', grund: 'netz', wiederholbar: true });
        expect(bindeFehlerEinordnen(new PdfHostFehler(503, 'x'), befehl)).toMatchObject({ grund: 'server', wiederholbar: true });
        expect(bindeFehlerEinordnen(new PdfHostFehler(404, 'drive.not_found'), befehl)).toMatchObject({ grund: 'nichtLesbar', wiederholbar: false });
        expect(bindeFehlerEinordnen(new PdfHostFehler(403, 'auth.permission_denied'), befehl)).toMatchObject({ grund: 'recht', wiederholbar: false });
        expect(bindeFehlerEinordnen(new PdfHostFehler(409, 'pdf.idempotency_mismatch'), befehl)).toMatchObject({ grund: 'schluessel', wiederholbar: false });
        expect(bindeFehlerEinordnen(new PdfHostFehler(413, 'pdf.too_many_sources', { max: 20 }, 'Zu viele Dokumente'), befehl))
            .toEqual({ art: 'fehlgeschlagen', grund: 'sonst', wiederholbar: false, meldung: 'Zu viele Dokumente' });
        expect(bindeFehlerEinordnen(new PdfHostFehler(422, 'pdf.form_collision', {}, 'Felder kollidieren'), befehl))
            .toMatchObject({ grund: 'sonst', meldung: 'Felder kollidieren' });
    });
});

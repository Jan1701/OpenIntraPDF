// SPDX-License-Identifier: Apache-2.0
//
// Speicherlogik ohne Oberfläche: Schlüssel je Vorgang, Einordnung der Fehler.

import { describe, expect, it } from 'vitest';
import { fehlerEinordnen, verlustKlassen, Vorgaenge } from './speichern';
import { PdfHostFehler } from './typen';
import type { CommitBefehl } from './typen';

const befehl = (drehung: 0 | 90 = 0): CommitBefehl => ({
    expected_version: 12,
    expected_sha256: 'abc',
    pages: [{ source: 0, rotate: drehung }],
    destination: { kind: 'new_version' },
});

describe('Vorgaenge', () => {
    it('derselbe Rumpf bekommt denselben Schlüssel, solange der Vorgang offen ist', () => {
        let n = 0;
        const v = new Vorgaenge(() => `k${++n}`);
        expect(v.schluesselFuer(befehl())).toBe('k1');
        expect(v.schluesselFuer(befehl())).toBe('k1');
    });

    it('ein anderer Rumpf bekommt einen neuen Schlüssel (sonst 409 idempotency_mismatch)', () => {
        let n = 0;
        const v = new Vorgaenge(() => `k${++n}`);
        v.schluesselFuer(befehl());
        expect(v.schluesselFuer(befehl(90))).toBe('k2');
        expect(v.schluesselFuer({ ...befehl(90), accept_losses: ['bookmarks'] })).toBe('k3');
    });

    it('nach Abschluss bekommt auch derselbe Rumpf einen neuen Schlüssel', () => {
        let n = 0;
        const v = new Vorgaenge(() => `k${++n}`);
        v.schluesselFuer(befehl());
        v.abschliessen();
        expect(v.schluesselFuer(befehl())).toBe('k2');
    });
});

describe('fehlerEinordnen', () => {
    it('412 ist ein Konflikt mit aktueller Fassung', () => {
        expect(fehlerEinordnen(new PdfHostFehler(412, 'pdf.version_conflict', { current_version: 14 }), befehl()))
            .toEqual({ art: 'konflikt', aktuelleVersion: 14 });
    });

    it('Netz weg und 5xx sind wiederholbar, 403 und 422 nicht', () => {
        expect(fehlerEinordnen(new PdfHostFehler(0, 'network'), befehl())).toMatchObject({ art: 'fehlgeschlagen', wiederholbar: true, grund: 'netz' });
        expect(fehlerEinordnen(new PdfHostFehler(503, 'error.internal'), befehl())).toMatchObject({ wiederholbar: true, grund: 'server' });
        expect(fehlerEinordnen(new PdfHostFehler(403, 'auth.permission_denied'), befehl())).toMatchObject({ wiederholbar: false, grund: 'recht' });
        expect(fehlerEinordnen(new PdfHostFehler(422, 'pdf.no_pages'), befehl())).toMatchObject({ wiederholbar: false, grund: 'sonst' });
        expect(fehlerEinordnen(new PdfHostFehler(422, 'pdf.signed_original'), befehl())).toMatchObject({ grund: 'signiert' });
    });

    it('422 preservation_failed verlangt eine Bestätigung mit den verlorenen Klassen', () => {
        const f = new PdfHostFehler(422, 'pdf.preservation_failed', {
            report: { bookmarks_before: 4, bookmarks_after: 1, attachments_before: 1, attachments_after: 1 },
        });
        expect(fehlerEinordnen(f, befehl())).toMatchObject({ art: 'verlust', klassen: ['bookmarks'] });
    });
});

describe('verlustKlassen', () => {
    it('nimmt die Liste des Servers, wenn er eine schickt', () => {
        expect(verlustKlassen({}, { losses: ['attachments'] })).toEqual(['attachments']);
    });

    it('schließt sonst aus den Zählern vorher/nachher', () => {
        expect(verlustKlassen({ form_fields_before: 3, form_fields_after: 0, bookmarks_before: 2, bookmarks_after: 2 }))
            .toEqual(['form_fields']);
    });
});

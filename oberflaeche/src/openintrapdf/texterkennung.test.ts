// SPDX-License-Identifier: Apache-2.0
//
// Auswahlregeln, Fehlereinordnung und Wiederfinden — ohne React.

import { describe, expect, it } from 'vitest';
import { auftragWiederfinden, auswahlBereinigen, standardAuswahl, startFehlerEinordnen, waehlbar } from './texterkennung';
import { PdfHostFehler } from './typen';
import type { PdfAuftrag, SeitenArten } from './typen';

const arten: SeitenArten = {
    version: 12,
    pages: [
        { page: 0, kind: 'text', chars: 1200, image_ratio: 0 },
        { page: 1, kind: 'scan', chars: 0, image_ratio: 0.95 },
        { page: 2, kind: 'gemischt', chars: 80, image_ratio: 0.6 },
        { page: 3, kind: 'leer', chars: 0, image_ratio: 0.7 },
        { page: 4, kind: 'leer', chars: 0, image_ratio: 0.01 },
    ],
};

describe('Auswahlregeln', () => {
    it('Seiten mit Text (text, gemischt) sind nie wählbar', () => {
        expect(arten.pages.map(waehlbar)).toEqual([false, true, false, true, true]);
    });

    it('Standard: Scans und leere Seiten mit Bildanteil ≥ 0,5 — leere ohne Bild bleiben wählbar, aber ab', () => {
        expect([...standardAuswahl(arten)].sort()).toEqual([1, 3]);
    });

    it('bereinigen wirft heraus, was nicht wählbar ist', () => {
        expect([...auswahlBereinigen(new Set([0, 1, 2, 4, 9]), arten)].sort()).toEqual([1, 4]);
    });
});

describe('Fehler beim Start', () => {
    const f = (status: number, code: string, params: Record<string, unknown> = {}) => startFehlerEinordnen(new PdfHostFehler(status, code, params));

    it('ordnet die Codes des Vertrags ein', () => {
        expect(f(412, 'pdf.version_conflict', { current_version: 13 })).toEqual({ grund: 'konflikt', wiederholbar: false });
        expect(f(422, 'pdf.ocr_page_has_text', { pages: [0, 2] })).toEqual({ grund: 'seitenMitText', seiten: [0, 2], wiederholbar: false });
        expect(f(429, 'pdf.too_many_jobs')).toEqual({ grund: 'zuViele', wiederholbar: true });
        expect(f(503, 'pdf.ocr_unavailable')).toEqual({ grund: 'dienst', wiederholbar: true });
        expect(f(0, 'network')).toEqual({ grund: 'netz', wiederholbar: true });
        expect(f(403, 'auth.permission_denied')).toEqual({ grund: 'recht', wiederholbar: false });
        expect(f(422, 'pdf.unsupported')).toMatchObject({ grund: 'sonst', wiederholbar: false });
    });

    it('unbrauchbare Seitenangaben fallen weg', () => {
        expect(f(422, 'pdf.ocr_page_has_text', { pages: ['x', -1, 3] }).seiten).toEqual([3]);
        expect(f(422, 'pdf.ocr_page_has_text').seiten).toEqual([]);
    });
});

describe('Wiederfinden', () => {
    const a = (id: string, state: PdfAuftrag['state'], mehr: Partial<PdfAuftrag> = {}): PdfAuftrag => ({ id, kind: 'ocr', state, ...mehr });
    const basis = { version: 12, sha256: 'abc' };

    it('laufende vor fertigen; abgebrochene und fehlgeschlagene nie', () => {
        const liste = [a('f', 'succeeded'), a('x', 'cancelled'), a('e', 'failed'), a('r', 'running')];
        expect(auftragWiederfinden(liste, basis, new Set())?.id).toBe('r');
        expect(auftragWiederfinden(liste.filter(x => x.id !== 'r'), basis, new Set())?.id).toBe('f');
        expect(auftragWiederfinden([a('x', 'cancelled'), a('e', 'failed')], basis, new Set())).toBeNull();
    });

    it('lässt aus, was in dieser Sitzung erledigt wurde, zu einer anderen Fassung gehört oder schon die aktuelle Fassung ist', () => {
        expect(auftragWiederfinden([a('f', 'succeeded')], basis, new Set(['f']))).toBeNull();
        expect(auftragWiederfinden([a('f', 'succeeded', { base_version: 11 })], basis, new Set())).toBeNull();
        expect(auftragWiederfinden([a('f', 'succeeded', { base_version: 12 })], basis, new Set())?.id).toBe('f');
        expect(auftragWiederfinden([a('f', 'succeeded', { result: { sha256: 'ABC' } })], basis, new Set())).toBeNull();
        expect(auftragWiederfinden([a('f', 'succeeded', { result: { sha256: 'def' } })], basis, new Set())?.id).toBe('f');
    });

    it('nur OCR-Aufträge', () => {
        expect(auftragWiederfinden([{ id: 'x', kind: 'export', state: 'running' }], basis, new Set())).toBeNull();
    });
});

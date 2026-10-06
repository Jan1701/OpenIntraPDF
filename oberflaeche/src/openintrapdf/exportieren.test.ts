// SPDX-License-Identifier: Apache-2.0
//
// Seitenbereich, Zahldeutung, Modell-Leser, Warnungen, Fehler — ohne React.

import { describe, expect, it } from 'vitest';
import { exportFehlerEinordnen, mitEndung, modellLesen, seitenbereichLesen, seitenOhneText, tabellenAus, warnungLesen, zahlDeuten } from './exportieren';
import { auftragWiederfinden } from './auftrag';
import { PdfHostFehler } from './typen';
import type { PdfAuftrag } from './typen';

describe('seitenbereichLesen', () => {
    it('leer = alle Seiten (null)', () => {
        expect(seitenbereichLesen('', 5)).toBeNull();
        expect(seitenbereichLesen('   ', 5)).toBeNull();
    });

    it('„1-3, 5“ → Seiten ab 0, sortiert, ohne Doppelte', () => {
        expect(seitenbereichLesen('1-3, 5', 5)).toEqual([0, 1, 2, 4]);
        expect(seitenbereichLesen('5;2;2-3', 5)).toEqual([1, 2, 4]);
        expect(seitenbereichLesen('2–4', 5)).toEqual([1, 2, 3]);
    });

    it('außerhalb, rückwärts oder Buchstaben sind ungültig', () => {
        expect(seitenbereichLesen('0', 5)).toBe('ungueltig');
        expect(seitenbereichLesen('6', 5)).toBe('ungueltig');
        expect(seitenbereichLesen('3-1', 5)).toBe('ungueltig');
        expect(seitenbereichLesen('a', 5)).toBe('ungueltig');
        expect(seitenbereichLesen('1-', 5)).toBe('ungueltig');
    });
});

describe('zahlDeuten', () => {
    it('deutsch: Tausenderpunkt fällt, Komma bleibt Komma', () => {
        expect(zahlDeuten('1.234,56', 'de')).toBe('1234,56');
        expect(zahlDeuten('-12,5', 'de')).toBe('-12,5');
        expect(zahlDeuten('42', 'de')).toBe('42');
    });

    it('englisch: Tausenderkomma fällt, Punkt bleibt', () => {
        expect(zahlDeuten('1,234.56', 'en')).toBe('1234.56');
        expect(zahlDeuten('1.234,56', 'en')).toBeNull();
    });

    it('führende Nullen gehen sichtbar verloren; Text ist keine Zahl', () => {
        expect(zahlDeuten('00123', 'de')).toBe('123');
        expect(zahlDeuten('12.3.4', 'de')).toBeNull();
        expect(zahlDeuten('abc', 'de')).toBeNull();
        expect(zahlDeuten('03/04/2026', 'en')).toBeNull();
    });
});

describe('modellLesen (Draht: Go-Paket export, englische Namen, Seiten ab 0)', () => {
    it('liest Seiten, Absätze und Tabellen mit Vorschlag; fehlende Felder werden leer', () => {
        const m = modellLesen({
            heuristics_version: 1,
            source: { sha256: 'abc', pages: [0, 1] },
            warnings: [{ code: 'repeated_header_footer', pages: [0, 1] }],
            pages: [
                {
                    page: 0, width: 595, height: 842, source: 'text_layer', image_ratio: 0.1,
                    blocks: [
                        { type: 'heading', level: 1, text: 'Rechnung', source: 'text_layer', bbox: [50, 50, 300, 70] },
                        { type: 'paragraph', lines: ['Sehr geehrte', 'Damen'], source: 'ocr', uncertain: true, bbox: [0, 0, 0, 0] },
                        { type: 'paragraph', text: 'Seite 1 von 2', repeated: true, bbox: [50, 800, 200, 810] },
                        {
                            type: 'table', bbox: [50, 100, 500, 200],
                            table: {
                                index: 0, pages: [0], cols: 2, header_rows: 1, column_types: ['text', 'number'],
                                rows: [
                                    [{ text: 'Artikel', source: 'text_layer', confidence: -1, bbox: [0, 0, 0, 0] }, { text: 'Preis', confidence: -1 }],
                                    [{ text: '00123', confidence: -1 }, { text: '1.234,56', source: 'ocr', confidence: 40 }],
                                ],
                            },
                        },
                    ],
                },
                { page: 1, source: 'none', blocks: [] },
            ],
        });
        expect(m.warnungen).toEqual([{ code: 'repeated_header_footer', pages: [0, 1] }]);
        expect(m.seiten.map(s => [s.nr, s.quelle])).toEqual([[1, 'textebene'], [2, 'leer']]);
        const [u, a, w, tab] = m.seiten[0].bloecke;
        expect(u).toEqual({ typ: 'absatz', art: 'ueberschrift', ebene: 1, text: 'Rechnung', quelle: 'textebene', unsicher: false, wiederholt: false, lage: [50, 50, 300, 70] });
        expect(a).toMatchObject({ typ: 'absatz', art: 'absatz', text: 'Sehr geehrte Damen', quelle: 'ocr', unsicher: true, lage: null });
        expect(w).toMatchObject({ typ: 'absatz', wiederholt: true });
        expect(tab).toMatchObject({ typ: 'tabelle', index: 0, spalten: 2, kopfzeilen: 1, typvorschlag: ['text', 'number'], lage: [50, 100, 500, 200] });
        expect((tab as { zeilen: unknown[][] }).zeilen[1]).toEqual([{ text: '00123' }, { text: '1.234,56', konf: 40 }]);
        expect(tabellenAus(m)).toHaveLength(1);
        expect(tabellenAus(m)[0].seite).toBe(1);
        expect(seitenOhneText(m)).toEqual([2]);
    });

    it('kurze Zeilen werden auf die Spaltenzahl aufgefüllt, Typvorschlag ebenso', () => {
        const m = modellLesen({ pages: [{ page: 2, blocks: [{ type: 'table', table: { index: 3, cols: 3, rows: [[{ text: 'a' }]], column_types: ['date'] } }] }] });
        expect(m.seiten[0].nr).toBe(3);
        const t = m.seiten[0].bloecke[0];
        expect(t.typ).toBe('tabelle');
        if (t.typ !== 'tabelle') return;
        expect(t.zeilen[0].map(z => z.text)).toEqual(['a', '', '']);
        expect(t.typvorschlag).toEqual(['date', 'text', 'text']);
        expect(t.index).toBe(3);
        expect(t.lage).toBeNull();
    });

    it('Unbrauchbares ergibt ein leeres Modell', () => {
        expect(modellLesen(null)).toEqual({ warnungen: [], seiten: [] });
        expect(modellLesen('x')).toEqual({ warnungen: [], seiten: [] });
    });
});

describe('warnungLesen', () => {
    it('Objekt mit Code, Anzahl, Seiten und Detail — oder ein nackter Code', () => {
        expect(warnungLesen('images_not_exported')).toEqual({ code: 'images_not_exported' });
        expect(warnungLesen({ code: 'images_not_exported', count: 3 })).toEqual({ code: 'images_not_exported', count: 3 });
        expect(warnungLesen({ code: 'tables_not_merged', pages: [1, 2], detail: 'columns' })).toEqual({ code: 'tables_not_merged', pages: [1, 2], detail: 'columns' });
    });
});

describe('mitEndung', () => {
    it('hängt die Endung an, wenn sie fehlt — ohne Rücksicht auf Groß/Klein', () => {
        expect(mitEndung('Rechnung', 'docx')).toBe('Rechnung.docx');
        expect(mitEndung('Rechnung.DOCX ', 'docx')).toBe('Rechnung.DOCX');
        expect(mitEndung('Rechnung.pdf', 'xlsx')).toBe('Rechnung.pdf.xlsx');
    });
});

describe('exportFehlerEinordnen', () => {
    it('Netz und Server sind wiederholbar, Recht und Weg nicht, 409 heißt nicht fertig', () => {
        expect(exportFehlerEinordnen(new PdfHostFehler(0, 'network'))).toMatchObject({ grund: 'netz', wiederholbar: true });
        expect(exportFehlerEinordnen(new PdfHostFehler(503, 'x'))).toMatchObject({ grund: 'server', wiederholbar: true });
        expect(exportFehlerEinordnen(new PdfHostFehler(403, 'x'))).toMatchObject({ grund: 'recht', wiederholbar: false });
        expect(exportFehlerEinordnen(new PdfHostFehler(404, 'pdf.job_not_found'))).toMatchObject({ grund: 'weg', wiederholbar: false });
        expect(exportFehlerEinordnen(new PdfHostFehler(409, 'pdf.job_not_ready'))).toMatchObject({ grund: 'nichtFertig', wiederholbar: true });
        expect(exportFehlerEinordnen(new PdfHostFehler(413, 'pdf.export_too_large', {}, 'Zu groß'))).toEqual({ grund: 'sonst', wiederholbar: false, meldung: 'Zu groß' });
    });
});

describe('auftragWiederfinden nach Art', () => {
    const a = (id: string, kind: PdfAuftrag['kind'], state: PdfAuftrag['state']): PdfAuftrag => ({ id, kind, state });

    it('nimmt nur Aufträge der gewünschten Art', () => {
        const liste = [a('o', 'ocr', 'running'), a('x', 'analyse', 'succeeded')];
        expect(auftragWiederfinden(liste, {}, new Set(), 'analyse')?.id).toBe('x');
        expect(auftragWiederfinden(liste, {}, new Set())?.id).toBe('o');
        expect(auftragWiederfinden(liste, {}, new Set(['x']), 'analyse')).toBeNull();
    });
});

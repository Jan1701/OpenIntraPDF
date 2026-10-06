// SPDX-License-Identifier: Apache-2.0
//
// Exportieren (Etappe 4) im Arbeitsplatz: Gruppe, Analyse → Vorschau →
// Export für Writer und Tabelle, Typwahl und Kopfzeilen im Befehl, CSV mit
// genau einer Tabelle, Abbruch, Wiederfinden, Entwurf sperrt nicht.
// Gastgeber und pdf.js sind gemockt, die Daten erfunden. Seit Etappe 7
// öffnet der Knopf „Exportieren“ im Reiter Werkzeuge des Werkzeugbands das
// Werkzeug im Arbeitsfach.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { band, dateiMenue, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { FLAG } from './rechte';
import { PdfHostFehler } from './typen';
import type { AnalyseBefehl, ExportBefehl, PdfAuftrag, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
// Der Abfragetakt von zwei Sekunden wäre im Test nur Wartezeit.
vi.mock('./exportieren', async (orig) => {
    const m = await orig<typeof import('./exportieren')>();
    return { ...m, useExport: (o: Parameters<typeof m.useExport>[0]) => m.useExport({ ...o, abfrageMs: 5 }) };
});
vi.mock('./texterkennung', async (orig) => {
    const m = await orig<typeof import('./texterkennung')>();
    return { ...m, useTexterkennung: (o: Parameters<typeof m.useTexterkennung>[0]) => m.useTexterkennung({ ...o, abfrageMs: 5 }) };
});
const zuStelle = vi.fn();
interface LeseMock { sichtbar: boolean; dokument: { kennung: string }; steuerung: MutableRefObject<unknown> }
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, dokument, steuerung }: LeseMock) => {
        useEffect(() => {
            steuerung.current = { suchen: vi.fn(), sucheBeenden: vi.fn(), zuSeite: vi.fn(), blaettern: vi.fn(), zoom: vi.fn(), zuStelle, trefferJeSeite: () => [] };
            return () => { steuerung.current = null; };
        }, [steuerung, dokument]);
        return <div data-testid="leseansicht" hidden={!sichtbar} data-dokument={dokument.kennung} />;
    },
}));

function seite(n: number) {
    return {
        rotate: 0,
        // Anzeige (oben links) → Benutzerraum (unten links) einer 842 pt hohen Seite.
        getViewport: () => ({ width: 595, height: 842, convertToPdfPoint: (x: number, y: number) => [x, 842 - y] }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
/** Die Rechte, die pdf.js meldet — je Test gesetzt; null = keine Verschlüsselung. */
let rechteFlags: number[] | null = null;
afterEach(() => { rechteFlags = null; });
const original = { kennung: 'original', numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null, getPermissions: async () => rechteFlags };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(original), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1 },
    },
    viewer: {},
    viewerStil: '',
};

function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
        inspection: { pages: 3, annotations: 0 },
        capabilities: { pages: { state: 'available' }, export: { state: 'available' } },
        ...ueber,
    };
}

// So liefert es der Server (Go-Paket export, `Dokument`): englische Namen, Seiten ab 0.
const modellRoh = {
    heuristics_version: 1,
    source: { sha256: 'abc', pages: [0, 1] },
    warnings: [{ code: 'repeated_header_footer', pages: [0, 1] }],
    pages: [
        {
            page: 0, width: 595, height: 842, source: 'text_layer', image_ratio: 0.2, continues_table: false,
            blocks: [
                { type: 'heading', level: 1, text: 'Rechnung 00123', source: 'text_layer', bbox: [50, 50, 300, 70] },
                { type: 'paragraph', text: 'Sehr geehrte Damen und Herren', source: 'ocr', uncertain: true, bbox: [50, 90, 500, 120] },
                { type: 'list', level: 1, text: 'Erster Punkt', source: 'text_layer', bbox: [0, 0, 0, 0] },
                {
                    type: 'table', bbox: [50, 200, 500, 300],
                    table: {
                        index: 0, pages: [0], cols: 3, header_rows: 1, column_types: ['text', 'number', 'date'],
                        rows: [
                            [{ text: 'Artikel', confidence: -1 }, { text: 'Preis', confidence: -1 }, { text: 'Datum', confidence: -1 }],
                            [{ text: '00123', confidence: -1 }, { text: '1.234,56', confidence: -1 }, { text: '03.04.2026', confidence: -1 }],
                            [{ text: '00124', confidence: -1 }, { text: '99,00', source: 'ocr', confidence: 30 }, { text: '04.04.2026', confidence: -1 }],
                        ],
                    },
                },
            ],
        },
        {
            page: 1, source: 'text_layer',
            blocks: [{ type: 'table', bbox: [0, 0, 0, 0], table: { index: 1, pages: [1], cols: 2, header_rows: 0, column_types: ['text', 'text'], rows: [[{ text: 'a', confidence: -1 }, { text: 'b', confidence: -1 }]] } }],
        },
        { page: 2, source: 'none', blocks: [] },
    ],
};

const auftrag = (state: PdfAuftrag['state'], mehr: Partial<PdfAuftrag> = {}): PdfAuftrag => ({ id: 'a1', kind: 'analyse', state, ...mehr });
const fertig = auftrag('succeeded', {
    progress: { done: 2, total: 2 },
    result: {
        sha256: 'modell',
        meta: {
            pages: 2, paragraphs: 1, headings: 1, lists: 1,
            tables: [{ index: 0, page: 0, rows: 3, cols: 3 }, { index: 1, page: 1, rows: 1, cols: 2 }],
            ocr_pages: [0], low_confidence: [0], warnings: [{ code: 'images_not_exported', count: 1, pages: [0] }],
        },
    },
    expires_at: '2026-09-30T10:00:00Z',
});

type Mock = ReturnType<typeof vi.fn>;
type Gast = PdfHost & Record<'laden' | 'speichern' | 'zielWaehlen' | 'analyseStarten' | 'auftraege' | 'auftrag' | 'auftragAbbrechen' | 'modellLaden' | 'exportieren' | 'ocrStarten', Mock>;

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()): Gast {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        speichern: vi.fn(),
        zielWaehlen: vi.fn(async (anfrage: { name: string }) => ({ drive_id: '', folder_id: null, name: anfrage.name.replace(/^Angebot/, 'Kopie') })),
        analyseStarten: vi.fn(async () => auftrag('queued', { progress: { done: 0, total: 2 } })),
        auftraege: vi.fn(async () => []),
        auftrag: vi.fn(async () => fertig),
        auftragAbbrechen: vi.fn(async () => undefined),
        modellLaden: vi.fn(async () => modellRoh),
        exportieren: vi.fn(async (_id: string, b: ExportBefehl) => ({ file_id: 'f9', name: b.destination.name, size: 1234, warnings: [{ code: 'csv_formula_guarded', count: 2 }] })),
        ocrStarten: vi.fn(),
        seitenarten: vi.fn(async () => ({ version: 12, pages: [] })),
        ...ueber,
    } as Gast;
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => {
    cleanup();
    zuStelle.mockClear();
});

async function oeffnen(h: PdfHost) {
    const onExportiert = vi.fn();
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} onExportiert={onExportiert} />);
    await screen.findByTestId('leseansicht');
    return { onExportiert };
}

/** Der Knopf „Exportieren“ im Reiter Werkzeuge des Werkzeugbands — `null`, wenn es ihn (oder den Reiter) nicht gibt. */
function exportKnopf() {
    if (reiter('Werkzeuge')) reiterWaehlen('Werkzeuge');
    return screen.queryByRole('button', { name: 'Exportieren' });
}

async function gruppeOeffnen() {
    await screen.findByTestId('leseansicht');
    reiterWaehlen('Werkzeuge');
    fireEvent.click(screen.getByRole('button', { name: 'Exportieren' }));
    return screen.findByRole('button', { name: 'Analysieren' });
}

const gruppe = () => screen.getByRole('region', { name: 'Exportieren' });

async function analysieren(ziel: 'writer' | 'tabelle' = 'writer', seiten = '') {
    await gruppeOeffnen();
    if (ziel === 'tabelle') fireEvent.click(screen.getByRole('radio', { name: /^Tabelle/ }));
    if (seiten) fireEvent.change(screen.getByRole('textbox', { name: 'Seiten' }), { target: { value: seiten } });
    fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
    // Die Analyse braucht im Prueflauf unter Last laenger als die
    // Vorgabe von einer Sekunde (01.10.2026: zwei Tabellenfaelle rot).
    return screen.findByRole('button', { name: 'Exportieren …' }, { timeout: 4000 });
}

describe('Sichtbarkeit der Gruppe', () => {
    it('Wiki (Gastgeber ohne die Methoden): keine Gruppe, auch wenn der Server Export meldet', async () => {
        await oeffnen(gastgeber({ analyseStarten: undefined, modellLaden: undefined, exportieren: undefined, speichern: undefined, zielWaehlen: undefined }));
        expect(exportKnopf()).toBeNull();
    });

    it('ohne capabilities.export (älterer Server): keine Gruppe', async () => {
        await oeffnen(gastgeber({}, info({ capabilities: { pages: { state: 'available' } } })));
        expect(exportKnopf()).toBeNull();
    });

    it('requires_worker: die Gruppe erklärt den Grund statt Knöpfe zu zeigen', async () => {
        const h = gastgeber({}, info({ capabilities: { pages: { state: 'available' }, export: { state: 'requires_worker', reason: 'no_worker' } } }));
        await oeffnen(h);
        reiterWaehlen('Werkzeuge');
        fireEvent.click(screen.getByRole('button', { name: 'Exportieren' }));
        expect(await screen.findByText(/fehlt der Baustein für die Texterkennung, und diese Datei hat keine Textebene/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Analysieren' })).toBeNull();
        expect(h.auftraege).not.toHaveBeenCalled();
    });

    it('Lesen genügt: mit Recht view gibt es die Gruppe, aber kein Bearbeiten', async () => {
        await oeffnen(gastgeber({}, info({ access: 'view' })));
        await gruppeOeffnen();
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        expect(screen.getByText('Exportiert wird die gespeicherte Fassung 12.')).toBeInTheDocument();
    });
});

describe('Writer', () => {
    it('Seiten und Ziel → Analyse läuft → Vorschau mit Blöcken, Warnungen und Sprung → Export als ODT', async () => {
        const h = gastgeber();
        let stand: PdfAuftrag = auftrag('running', { progress: { done: 1, total: 2 } });
        h.auftrag.mockImplementation(async () => stand);
        const { onExportiert } = await oeffnen(h);
        await gruppeOeffnen();
        expect(screen.getByRole('radio', { name: /^Writer-Dokument/ })).toBeChecked();
        fireEvent.change(screen.getByRole('textbox', { name: 'Seiten' }), { target: { value: '1-2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));

        await waitFor(() => expect(h.analyseStarten).toHaveBeenCalledTimes(1));
        const [befehl, schluessel] = h.analyseStarten.mock.calls[0] as [AnalyseBefehl, string];
        expect(befehl).toEqual({ kind: 'analyse', expected_version: 12, options: { pages: [0, 1], languages: 'deu+eng' } });
        expect(schluessel).toMatch(/^[0-9a-f-]{36}$/);
        expect(await screen.findByText('Seite 1 von 2')).toBeInTheDocument();
        expect(screen.getByText('Analyse läuft')).toBeInTheDocument();
        // Der Export sperrt nichts: Bearbeiten bleibt möglich.
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();

        stand = fertig;
        expect(await screen.findByRole('button', { name: 'Exportieren …' })).toBeEnabled();
        expect(h.modellLaden).toHaveBeenCalledWith('a1');
        const g = gruppe();
        expect(within(g).getByText('2 Seiten · 1 Absatz · 1 Überschrift · 1 Liste · 2 Tabellen')).toBeInTheDocument();
        // Seiten ohne Textebene und ohne Dienst sind benannt.
        expect(within(g).getByText(/Seite 3 hat weder Textebene noch erkannten Text/)).toBeInTheDocument();
        // Blöcke in Lesereihenfolge mit Art; unsichere Stellen markiert.
        const bloecke = within(g).getAllByRole('button', { name: /^Zur Stelle auf Seite/ });
        expect(bloecke).toHaveLength(5);
        expect(bloecke[0]).toHaveTextContent('Überschrift');
        expect(bloecke[0]).toHaveTextContent('Rechnung 00123');
        expect(bloecke[1]).toHaveTextContent('Absatz');
        expect(bloecke[1]).toHaveTextContent('unsicher');
        expect(bloecke[2]).toHaveTextContent('Liste');
        expect(bloecke[3]).toHaveTextContent('Tabelle 1 · 3 Zeilen × 3 Spalten');
        expect(bloecke[4]).toHaveTextContent('Seite 2');
        // Warnungen immer sichtbar.
        expect(within(g).getByText('Bilder werden nicht übernommen (1 Seite mit Bildern).')).toBeInTheDocument();
        expect(within(g).getByText(/Seite 1 wurde per Texterkennung gelesen/)).toBeInTheDocument();
        expect(within(g).getByText(/Unsichere Texterkennung auf Seite 1/)).toBeInTheDocument();
        expect(within(g).getByText(/Wiederkehrende Kopf- und Fußzeilen/)).toBeInTheDocument();
        // Klick springt zur Stelle: Lage oben links → Benutzerraum.
        fireEvent.click(bloecke[0]);
        await waitFor(() => expect(zuStelle).toHaveBeenCalledWith(1, [50, 772, 300, 792]));
        fireEvent.click(bloecke[2]);
        await waitFor(() => expect(zuStelle).toHaveBeenCalledWith(1, undefined));

        // Format, Ziel, Export.
        const format = within(g).getByRole('combobox', { name: 'Format' });
        expect(within(format).getAllByRole('option').map(o => o.textContent)).toEqual(['Word · DOCX', 'Writer · ODT']);
        fireEvent.change(format, { target: { value: 'odt' } });
        fireEvent.click(within(g).getByRole('button', { name: 'Exportieren …' }));
        await waitFor(() => expect(h.exportieren).toHaveBeenCalledTimes(1));
        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'exportieren', name: 'Angebot.odt' });
        const [id, rumpf, s2] = h.exportieren.mock.calls[0] as [string, ExportBefehl, string];
        expect(id).toBe('a1');
        expect(s2).toMatch(/^[0-9a-f-]{36}$/);
        expect(rumpf).toEqual({
            format: 'odt',
            // Im Writer bleibt jede Zelle Text — dort hat niemand einen Typ gewählt.
            tables: [
                { index: 0, include: true, header_rows: 1, column_types: ['text', 'text', 'text'] },
                { index: 1, include: true, header_rows: 0, column_types: ['text', 'text'] },
            ],
            number_locale: 'de',
            destination: { drive_id: '', folder_id: null, name: 'Kopie.odt' },
        });
        expect((await screen.findAllByText('Exportiert als Kopie.odt.')).length).toBeGreaterThan(0);
        expect(within(g).getByText(/2 Zellen begannen mit/)).toBeInTheDocument();
        expect(onExportiert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kopie.odt' }));
        // Das PDF bleibt: kein Neuladen, Zustand unverändert.
        expect(h.laden).toHaveBeenCalledTimes(1);
        expect(screen.getAllByText('Unverändert').length).toBeGreaterThan(0);
    });

    it('Abbrechen des Ziel-Dialogs exportiert nichts', async () => {
        const h = gastgeber();
        h.zielWaehlen.mockResolvedValueOnce(null);
        await oeffnen(h);
        await analysieren();
        fireEvent.click(within(gruppe()).getByRole('button', { name: 'Exportieren …' }));
        await waitFor(() => expect(h.zielWaehlen).toHaveBeenCalledTimes(1));
        expect(h.exportieren).not.toHaveBeenCalled();
    });

    it('ungültiger Seitenbereich: Hinweis, kein Start', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.change(screen.getByRole('textbox', { name: 'Seiten' }), { target: { value: '2-9' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Seitenangabe nicht lesbar');
        expect(screen.getByRole('button', { name: 'Analysieren' })).toBeDisabled();
    });
});

describe('Tabelle', { timeout: 15000 }, () => {
    it('Raster mit Rohwerten, Vorschlag vorausgewählt, Zahlhinweis de/en; Typ, Kopfzeilen und Übernehmen landen im Befehl', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await analysieren('tabelle');
        const g = gruppe();
        const t1 = within(g).getByRole('region', { name: 'Tabelle 1' });
        // Rohwerte bleiben sichtbar; die Kopfzeile ist markiert.
        expect(within(t1).getByText('1.234,56')).toBeInTheDocument();
        expect(within(t1).getByText('00123')).toBeInTheDocument();
        expect(within(t1).getByText('99,00')).toHaveAttribute('title', 'Unsicher erkannt – bitte nachlesen.');
        expect(within(t1).getByRole('combobox', { name: 'Typ Spalte 1, Tabelle 1' })).toHaveValue('text');
        expect(within(t1).getByRole('combobox', { name: 'Typ Spalte 2, Tabelle 1' })).toHaveValue('number');
        expect(within(t1).getByRole('combobox', { name: 'Typ Spalte 3, Tabelle 1' })).toHaveValue('date');
        expect(within(t1).getByRole('combobox', { name: 'Kopfzeilen Tabelle 1' })).toHaveValue('1');
        // Zahlhinweis am ersten Wert unter der Kopfzeile, umschaltbar.
        expect(within(t1).getByText('1.234,56 → 1234,56')).toBeInTheDocument();
        fireEvent.click(within(g).getByRole('button', { name: 'Englisch (1,234.56)' }));
        expect(within(t1).getByText('„1.234,56“ wird nicht als Zahl gelesen.')).toBeInTheDocument();
        fireEvent.click(within(g).getByRole('button', { name: 'Deutsch (1.234,56)' }));

        fireEvent.change(within(t1).getByRole('combobox', { name: 'Typ Spalte 3, Tabelle 1' }), { target: { value: 'text' } });
        fireEvent.change(within(t1).getByRole('combobox', { name: 'Kopfzeilen Tabelle 1' }), { target: { value: '2' } });
        fireEvent.click(within(g).getByRole('checkbox', { name: 'Tabelle 2 übernehmen' }));

        const format = within(g).getByRole('combobox', { name: 'Format' });
        expect(within(format).getAllByRole('option').map(o => o.textContent)).toEqual(['Tabelle · XLSX', 'Tabelle · CSV']);
        fireEvent.click(within(g).getByRole('button', { name: 'Exportieren …' }));
        await waitFor(() => expect(h.exportieren).toHaveBeenCalledTimes(1));
        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'exportieren', name: 'Angebot.xlsx' });
        expect(h.exportieren.mock.calls[0][1]).toEqual({
            format: 'xlsx',
            tables: [
                { index: 0, include: true, header_rows: 2, column_types: ['text', 'number', 'text'] },
                { index: 1, include: false, header_rows: 0, column_types: ['text', 'text'] },
            ],
            number_locale: 'de',
            destination: { drive_id: '', folder_id: null, name: 'Kopie.xlsx' },
        });
    });

    it('CSV verlangt genau eine Tabelle: Auswahl bei mehreren, Trennzeichen im Befehl', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await analysieren('tabelle');
        const g = gruppe();
        fireEvent.change(within(g).getByRole('combobox', { name: 'Format' }), { target: { value: 'csv' } });
        expect(within(g).getByRole('button', { name: 'Exportieren …' })).toBeDisabled();
        expect(within(g).getByRole('alert')).toHaveTextContent('Eine CSV-Datei enthält genau eine Tabelle');
        fireEvent.change(within(g).getByRole('combobox', { name: 'Tabelle für die CSV-Datei' }), { target: { value: '1' } });
        fireEvent.change(within(g).getByRole('combobox', { name: 'Trennzeichen' }), { target: { value: ',' } });
        expect(within(g).getByRole('button', { name: 'Exportieren …' })).toBeEnabled();
        fireEvent.click(within(g).getByRole('button', { name: 'Exportieren …' }));
        await waitFor(() => expect(h.exportieren).toHaveBeenCalledTimes(1));
        const rumpf = h.exportieren.mock.calls[0][1] as ExportBefehl;
        expect(rumpf.format).toBe('csv');
        expect(rumpf.csv).toEqual({ delimiter: ',', table: 1 });
        expect(rumpf.destination.name).toBe('Kopie.csv');

        // Nur eine übernommen: keine Auswahl nötig, sie ist die eine.
        fireEvent.click(within(g).getByRole('checkbox', { name: 'Tabelle 2 übernehmen' }));
        expect(within(g).queryByRole('combobox', { name: 'Tabelle für die CSV-Datei' })).toBeNull();
        expect(within(g).getByRole('button', { name: 'Exportieren …' })).toBeEnabled();
        // Keine übernommen: Hinweis, kein Export.
        fireEvent.click(within(g).getByRole('checkbox', { name: 'Tabelle 1 übernehmen' }));
        expect(within(g).getByRole('alert')).toHaveTextContent('Keine Tabelle übernommen');
        expect(within(g).getByRole('button', { name: 'Exportieren …' })).toBeDisabled();
    });

    it('ohne erkannte Tabelle: Hinweis statt Raster', async () => {
        const h = gastgeber();
        h.modellLaden.mockResolvedValue({ pages: [{ page: 0, blocks: [{ type: 'paragraph', text: 'nur Text' }] }] });
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('radio', { name: /^Tabelle/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        expect(await screen.findByText(/Es wurde keine Tabelle erkannt/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Exportieren …' })).toBeDisabled();
    });
});

describe('Fehler beim Export', () => {
    it('413 zeigt den Satz des Servers; ein Netzfehler bietet „Erneut versuchen“ mit demselben Schlüssel', async () => {
        const h = gastgeber();
        h.exportieren
            .mockRejectedValueOnce(new PdfHostFehler(413, 'pdf.export_too_large', {}, 'Der Export ist zu groß.'))
            .mockRejectedValueOnce(new PdfHostFehler(0, 'network'))
            .mockResolvedValueOnce({ file_id: 'f9', name: 'Kopie.docx' });
        await oeffnen(h);
        await analysieren();
        const g = gruppe();
        fireEvent.click(within(g).getByRole('button', { name: 'Exportieren …' }));
        expect(await within(g).findByRole('alert')).toHaveTextContent('Der Export ist fehlgeschlagen. Der Export ist zu groß.');
        expect(within(g).queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();

        fireEvent.click(within(g).getByRole('button', { name: 'Exportieren …' }));
        expect(await within(g).findByText(/Keine Verbindung zum Server/)).toBeInTheDocument();
        fireEvent.click(within(g).getByRole('button', { name: 'Erneut versuchen' }));
        await waitFor(() => expect(h.exportieren).toHaveBeenCalledTimes(3));
        expect(h.exportieren.mock.calls[2][2]).toBe(h.exportieren.mock.calls[1][2]);
        expect(h.exportieren.mock.calls[1][2]).not.toBe(h.exportieren.mock.calls[0][2]);
        expect((await screen.findAllByText('Exportiert als Kopie.docx.')).length).toBeGreaterThan(0);
    });
});

describe('Ablauf des Auftrags', () => {
    it('Abbrechen beendet die Analyse und die Abfrage', async () => {
        const h = gastgeber();
        h.auftrag.mockResolvedValue(auftrag('running', { progress: { done: 0, total: 3 } }));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        expect(await screen.findByText('Seite 0 von 3')).toBeInTheDocument();
        await waitFor(() => expect(h.auftrag).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
        await waitFor(() => expect(h.auftragAbbrechen).toHaveBeenCalledWith('a1'));
        expect(await screen.findByText('Analyse abgebrochen. Es wurde nichts angelegt.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Analysieren' })).toBeEnabled();
        const abfragen = h.auftrag.mock.calls.length;
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(h.auftrag.mock.calls.length).toBe(abfragen);
    });

    it('fehlgeschlagen: Grund und „Neue Analyse“', async () => {
        const h = gastgeber();
        h.auftrag.mockResolvedValue(auftrag('failed', { error: 'pdf.job_failed' }));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        expect(await screen.findByText(/Die Analyse ist fehlgeschlagen/)).toBeInTheDocument();
        expect(screen.getByText(/Grund: pdf.job_failed/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Neue Analyse' }));
        expect(await screen.findByRole('button', { name: 'Analysieren' })).toBeInTheDocument();
    });

    it('429 beim Start: Hinweis, Auswahl bleibt', async () => {
        const h = gastgeber();
        h.analyseStarten.mockRejectedValueOnce(new PdfHostFehler(429, 'pdf.too_many_jobs'));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('radio', { name: /^Tabelle/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        expect(await screen.findByText(/schon drei offene Aufträge/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^Tabelle/ })).toBeChecked();
        expect(screen.getByRole('button', { name: 'Analysieren' })).toBeEnabled();
    });
});

describe('Wiederfinden nach Neuöffnen', () => {
    it('eine laufende Analyse wird aufgegriffen; ein OCR-Auftrag gehört nicht hierher', async () => {
        const h = gastgeber({}, info({ capabilities: { pages: { state: 'available' }, export: { state: 'available' }, ocr: { state: 'available' } } }));
        h.auftraege.mockResolvedValue([
            { id: 'o1', kind: 'ocr', state: 'running', progress: { done: 0, total: 1 } },
            auftrag('running', { progress: { done: 1, total: 3 } }),
        ]);
        await oeffnen(h);
        const g = await screen.findByRole('region', { name: 'Exportieren' });
        expect(within(g).getByText('Seite 1 von 3')).toBeInTheDocument();
        expect(within(g).getByText(/Analyse aus einer früheren Sitzung wurde wiedergefunden/)).toBeInTheDocument();
        expect(h.auftraege).toHaveBeenCalledWith('f1');
        await waitFor(() => expect(h.auftrag).toHaveBeenCalledWith('a1'));
    });

    it('eine fertige Analyse zeigt gleich die Vorschau; eine zu einer anderen Fassung nicht', async () => {
        const h = gastgeber();
        h.auftraege.mockResolvedValue([auftrag('succeeded', { id: 'alt', base_version: 11 }), { ...fertig, base_version: 12 }]);
        await oeffnen(h);
        expect(await screen.findByRole('button', { name: 'Exportieren …' })).toBeInTheDocument();
        expect(h.modellLaden).toHaveBeenCalledWith('a1');
        expect(h.modellLaden).not.toHaveBeenCalledWith('alt');
    });
});

describe('Entwurf und Export', () => {
    it('ein offener Entwurf sperrt den Export nicht, wird aber genannt', async () => {
        const h = gastgeber();
        await oeffnen(h);
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        fireEvent.click((await screen.findAllByRole('option'))[0]);
        fireEvent.click(within(band()).getByRole('button', { name: '90° rechts' }));
        await screen.findAllByText('Änderungen im Entwurf');
        await gruppeOeffnen();
        expect(screen.getByText(/Exportiert wird die gespeicherte Fassung 12\. Ihr offener Entwurf ist darin nicht enthalten/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        await waitFor(() => expect(h.analyseStarten).toHaveBeenCalledTimes(1));
        expect(screen.queryByText('Entwurf zuerst speichern oder verwerfen')).toBeNull();
        expect(h.speichern).not.toHaveBeenCalled();
        expect(await screen.findByRole('button', { name: 'Exportieren …' })).toBeEnabled();
        expect(screen.getAllByText('Änderungen im Entwurf').length).toBeGreaterThan(0);
    });
});

describe('Rechte-Bits einer geschützten PDF (Kopier-Bit beim Anlegen)', () => {
    it('422 pdf.permission_restricted beim Start: klare Meldung zum Rechte-Kennwort, die Auswahl bleibt', async () => {
        const h = gastgeber();
        h.analyseStarten.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.permission_restricted', { restricted: ['copy'] }));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        expect(await screen.findByText(/Text kopieren ist in dieser PDF ohne Rechte-Kennwort nicht erlaubt/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Analysieren' })).toBeEnabled();
        const [befehl] = h.analyseStarten.mock.calls[0] as [AnalyseBefehl, string];
        expect(befehl.owner_password).toBeUndefined();
    });

    it('ist das Rechte-Kennwort für die Sitzung bekannt, geht es beim Anlegen als owner_password mit', async () => {
        rechteFlags = [FLAG.PRINT, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS, FLAG.FILL_INTERACTIVE_FORMS]; // kein Kopieren
        const h = gastgeber({ rechteKennwortPruefen: vi.fn(async () => undefined) });
        await oeffnen(h);
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'rechte-456' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechte-Kennwort eingeben …' })).toBeNull());
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        await waitFor(() => expect(h.analyseStarten).toHaveBeenCalledTimes(1));
        const [befehl] = h.analyseStarten.mock.calls[0] as [AnalyseBefehl, string];
        expect(befehl.owner_password).toBe('rechte-456');
        expect(befehl.options).toEqual({ pages: null, languages: 'deu+eng' });
    });
});

describe('Rechte-Kennwort beim Auftragsstart abgelehnt', () => {
    it('422 pdf.wrong_password: die Sitzung verwirft das Kennwort, die Sperren gelten wieder, die Meldung sagt wie es neu geht', async () => {
        rechteFlags = [FLAG.PRINT, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS, FLAG.FILL_INTERACTIVE_FORMS]; // kein Kopieren
        const h = gastgeber({ rechteKennwortPruefen: vi.fn(async () => undefined) });
        h.analyseStarten.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.wrong_password'));
        await oeffnen(h);
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'veraltet-1' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechte-Kennwort eingeben …' })).toBeNull());
        expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' })).toBeNull();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        const meldung = await screen.findByText(/Der Server hat das Rechte-Kennwort nicht angenommen/);
        expect(meldung).toHaveTextContent('Datei → Rechte-Kennwort eingeben');
        // Die Sperren gelten wieder: der Eintrag ist zurück, der nächste Start geht ohne Kennwort.
        await waitFor(() => expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' })).toBeInTheDocument());
        fireEvent.keyDown(document.body, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Analysieren' }));
        await waitFor(() => expect(h.analyseStarten).toHaveBeenCalledTimes(2));
        expect((h.analyseStarten.mock.calls[0][0] as AnalyseBefehl).owner_password).toBe('veraltet-1');
        expect((h.analyseStarten.mock.calls[1][0] as AnalyseBefehl).owner_password).toBeUndefined();
    });
});

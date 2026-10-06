// SPDX-License-Identifier: Apache-2.0
//
// Text erkennen (Etappe 3) im Arbeitsplatz: Gruppe, Auswahl, Ablauf,
// Abbrechen, Wiederfinden, Vorschau, Veröffentlichen, Ausschluss mit dem
// Entwurf. Gastgeber und pdf.js sind gemockt, die Daten erfunden.
// Seit Etappe 7 öffnet der Knopf „Texterkennung“ im Reiter Werkzeuge des
// Werkzeugbands das Werkzeug im Arbeitsfach.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { band, dateiMenue, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { FLAG } from './rechte';
import { PdfHostFehler } from './typen';
import type { CommitBefehl, OcrBefehl, PdfAuftrag, PdfHost, PdfInfo, SeitenArten } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
// Der Abfragetakt von zwei Sekunden wäre im Test nur Wartezeit.
vi.mock('./texterkennung', async (orig) => {
    const m = await orig<typeof import('./texterkennung')>();
    return { ...m, useTexterkennung: (o: Parameters<typeof m.useTexterkennung>[0]) => m.useTexterkennung({ ...o, abfrageMs: 5 }) };
});
// Die Leseansicht zeigt, WELCHES Dokument sie bekommt, und meldet Suchaufrufe.
const suchen = vi.fn();
interface LeseMock {
    sichtbar: boolean;
    dokument: { kennung: string };
    steuerung: MutableRefObject<unknown>;
    anmerkungen?: unknown;
}
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, dokument, steuerung, anmerkungen }: LeseMock) => {
        useEffect(() => {
            steuerung.current = { suchen, sucheBeenden: vi.fn(), zuSeite: vi.fn(), blaettern: vi.fn(), zoom: vi.fn(), trefferJeSeite: () => [] };
            return () => { steuerung.current = null; };
        }, [steuerung, dokument]);
        return <div data-testid="leseansicht" hidden={!sichtbar} data-dokument={dokument.kennung} data-kommentieren={anmerkungen ? 'ja' : 'nein'} />;
    },
}));

function seite(n: number) {
    return {
        rotate: 0,
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
/** Die Rechte, die pdf.js meldet — je Test gesetzt; null = keine Verschlüsselung. */
let rechteFlags: number[] | null = null;
afterEach(() => { rechteFlags = null; });
const original = { kennung: 'original', numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null, getPermissions: async () => rechteFlags };
const ergebnis = { kennung: 'vorschau', numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null, getPermissions: async () => null };
const ERGEBNIS_BYTES = 16;

const bibliothek = {
    pdfjs: {
        // Das Ergebnis-PDF ist an seiner Länge zu erkennen.
        getDocument: vi.fn(({ data }: { data: Uint8Array }) => ({
            promise: Promise.resolve(data.length === ERGEBNIS_BYTES ? ergebnis : original),
            destroy: vi.fn(async () => undefined),
            onPassword: null,
        })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1 },
    },
    viewer: {},
    viewerStil: '',
};

function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Scan.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
        inspection: { pages: 3, annotations: 0 },
        capabilities: { pages: { state: 'available' }, annotations: { state: 'available' }, ocr: { state: 'available' } },
        ...ueber,
    };
}

const arten: SeitenArten = {
    version: 12,
    pages: [
        { page: 0, kind: 'text', chars: 900, image_ratio: 0 },
        { page: 1, kind: 'scan', chars: 0, image_ratio: 0.98 },
        { page: 2, kind: 'leer', chars: 0, image_ratio: 0.02 },
    ],
};

const auftrag = (state: PdfAuftrag['state'], mehr: Partial<PdfAuftrag> = {}): PdfAuftrag => ({ id: 'j1', kind: 'ocr', state, ...mehr });
const fertig = auftrag('succeeded', {
    progress: { done: 1, total: 1 },
    result: { sha256: 'neu', meta: { pages_recognized: [1], pages_skipped: [], low_confidence_pages: [], words: 42 } },
    expires_at: '2026-09-30T10:00:00Z',
});

type Mock = ReturnType<typeof vi.fn>;
type Gast = PdfHost & Record<'speichern' | 'seitenarten' | 'ocrStarten' | 'auftraege' | 'auftrag' | 'auftragAbbrechen' | 'ergebnisLaden' | 'auftragVeroeffentlichen' | 'laden', Mock>;

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()): Gast {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        speichern: vi.fn(),
        zielWaehlen: vi.fn(async () => ({ drive_id: '', folder_id: null, name: 'Kopie' })),
        seitenarten: vi.fn(async () => arten),
        ocrStarten: vi.fn(async () => auftrag('queued', { progress: { done: 0, total: 1 } })),
        auftraege: vi.fn(async () => []),
        auftrag: vi.fn(async () => auftrag('running', { progress: { done: 0, total: 1 } })),
        auftragAbbrechen: vi.fn(async () => undefined),
        ergebnisLaden: vi.fn(async () => new ArrayBuffer(ERGEBNIS_BYTES)),
        auftragVeroeffentlichen: vi.fn(),
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
    suchen.mockClear();
});

const leseansicht = () => screen.getByTestId('leseansicht');

async function oeffnen(h: PdfHost) {
    const onClose = vi.fn();
    const onGespeichert = vi.fn();
    render(<PdfArbeitsplatz host={h} name="Scan.pdf" onClose={onClose} onGespeichert={onGespeichert} />);
    await screen.findByTestId('leseansicht');
    return { onClose, onGespeichert };
}

/** Der Knopf „Texterkennung“ im Reiter Werkzeuge des Werkzeugbands — `null`, wenn es ihn (oder den Reiter) nicht gibt. */
function ocrKnopf() {
    if (reiter('Werkzeuge')) reiterWaehlen('Werkzeuge');
    return screen.queryByRole('button', { name: 'Texterkennung' });
}

async function gruppeOeffnen() {
    await screen.findByTestId('leseansicht');
    reiterWaehlen('Werkzeuge');
    fireEvent.click(screen.getByRole('button', { name: 'Texterkennung' }));
    return screen.findByRole('checkbox', { name: 'Seite 2' });
}

describe('Sichtbarkeit der Gruppe', () => {
    it('Wiki (Gastgeber ohne ocrStarten): keine Gruppe, auch wenn der Server OCR meldet', async () => {
        await oeffnen(gastgeber({ ocrStarten: undefined, speichern: undefined, zielWaehlen: undefined }));
        expect(ocrKnopf()).toBeNull();
        expect(screen.queryByText(/Text erkennen/)).toBeNull();
    });

    it('Recht comment oder ohne capabilities.ocr: keine Gruppe', async () => {
        await oeffnen(gastgeber({}, info({ access: 'comment' })));
        expect(ocrKnopf()).toBeNull();
        cleanup();
        await oeffnen(gastgeber({}, info({ capabilities: { pages: { state: 'available' } } })));
        expect(ocrKnopf()).toBeNull();
    });

    it('requires_worker: die Gruppe erklärt, was fehlt, statt Knöpfe zu zeigen', async () => {
        const h = gastgeber({}, info({ capabilities: { pages: { state: 'available' }, ocr: { state: 'requires_worker', reason: 'no_worker' } } }));
        await oeffnen(h);
        reiterWaehlen('Werkzeuge');
        fireEvent.click(screen.getByRole('button', { name: 'Texterkennung' }));
        expect(await screen.findByText(/fehlt der Baustein für die Texterkennung/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Erkennung starten' })).toBeNull();
        expect(h.seitenarten).not.toHaveBeenCalled();
        // Lesen und Bearbeiten gehen weiter.
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
    });
});

describe('Auswahl', () => {
    it('Seitenarten mit Art; Standard = Seiten ohne Text mit Bild; Textseiten gesperrt mit Grund', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await gruppeOeffnen();
        expect(h.seitenarten).toHaveBeenCalledTimes(1);
        const s1 = screen.getByRole('checkbox', { name: 'Seite 1' });
        const s2 = screen.getByRole('checkbox', { name: 'Seite 2' });
        const s3 = screen.getByRole('checkbox', { name: 'Seite 3' });
        expect(s1).toBeDisabled();
        expect(s1).not.toBeChecked();
        expect(screen.getByText('Hat schon Text – wird nicht belegt.')).toBeInTheDocument();
        expect(s2).toBeEnabled();
        expect(s2).toBeChecked();
        expect(s3).toBeEnabled();
        expect(s3).not.toBeChecked();
        expect(screen.getByText('Seite 1 · Text')).toBeInTheDocument();
        expect(screen.getByText('Seite 2 · Scan')).toBeInTheDocument();
        expect(screen.getByText('Seite 3 · Leer')).toBeInTheDocument();
        expect(screen.getByText('1 Seite gewählt')).toBeInTheDocument();

        fireEvent.click(s3);
        expect(screen.getByText('2 Seiten gewählt')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
        expect(screen.getByRole('button', { name: 'Erkennung starten' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Seiten ohne Text wählen' }));
        expect(s2).toBeChecked();
        expect(s3).not.toBeChecked();
    });

    it('429 beim Start: verständlicher Hinweis, Auswahl bleibt', async () => {
        const h = gastgeber();
        h.ocrStarten.mockRejectedValueOnce(new PdfHostFehler(429, 'pdf.too_many_jobs'));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        expect(await screen.findByText(/schon drei offene Aufträge/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Seite 2' })).toBeChecked();
        expect(screen.getByRole('button', { name: 'Erkennung starten' })).toBeEnabled();
    });

    it('422 Seite hat Text: die Seite fliegt aus der Auswahl und wird gesperrt', async () => {
        const h = gastgeber();
        h.ocrStarten.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.ocr_page_has_text', { pages: [1] }));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        expect(await screen.findByText(/Seite 2 hat inzwischen Text/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Seite 2' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Erkennung starten' })).toBeDisabled();
    });
});

describe('Ablauf', () => {
    it('starten → Fortschritt → fertig → Vorschau mit Suche → als neue Fassung veröffentlichen', async () => {
        const h = gastgeber();
        let stand: PdfAuftrag = auftrag('running', { progress: { done: 1, total: 2 } });
        h.auftrag.mockImplementation(async () => stand);
        h.auftragVeroeffentlichen.mockResolvedValue({ file_id: 'f1', version: 13, sha256: 'neu', name: 'Scan.pdf' });
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Seite 3' }));
        fireEvent.change(screen.getByLabelText('Sprache'), { target: { value: 'deu' } });
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));

        await waitFor(() => expect(h.ocrStarten).toHaveBeenCalledTimes(1));
        const [befehl, schluessel] = h.ocrStarten.mock.calls[0] as [OcrBefehl, string];
        expect(befehl).toEqual({ kind: 'ocr', expected_version: 12, options: { pages: [1, 2], languages: 'deu' } });
        expect(schluessel).toMatch(/^[0-9a-f-]{36}$/);

        expect(await screen.findByText('Seite 1 von 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeEnabled();
        // Solange es läuft: Seiten- und Kommentarwerkzeuge gesperrt, mit Grund.
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        expect(screen.getAllByText(/ruhen Seiten- und Kommentarwerkzeuge/).length).toBeGreaterThan(0);
        expect(reiter('Seiten')).toBeDisabled();
        expect(reiter('Kommentieren')).toBeDisabled();
        expect(leseansicht().dataset.kommentieren).toBe('nein');

        stand = auftrag('running', { progress: { done: 2, total: 2 } });
        expect(await screen.findByText('Seite 2 von 2')).toBeInTheDocument();
        stand = { ...fertig, result: { ...fertig.result, meta: { pages_recognized: [1], pages_skipped: [{ page: 2, reason: 'page_sideways' }], low_confidence_pages: [1], words: 42 } } };

        // Vorschau: das Ergebnis in der Leseansicht, deutlich gekennzeichnet.
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('vorschau'));
        expect(h.ergebnisLaden).toHaveBeenCalledWith('j1');
        expect(screen.getAllByText('Vorschau – noch nicht gespeichert').length).toBeGreaterThan(1);
        expect(screen.getByText('1 Seite erkannt · 42 Wörter')).toBeInTheDocument();
        expect(screen.getByText(/Unsichere Erkennung auf Seite 2/)).toBeInTheDocument();
        expect(screen.getByText(/Seite 3 liegt quer und wurde übersprungen/)).toBeInTheDocument();
        // Suche läuft auf dem Vorschaudokument.
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'f', ctrlKey: true });
        fireEvent.change(await screen.findByLabelText('Im Dokument suchen'), { target: { value: 'Rechnung' } });
        expect(suchen).toHaveBeenCalledWith('Rechnung', 'neu', { caseSensitive: false, entireWord: false });

        // Veröffentlichen: Route des Auftrags, neue Fassung, danach neu geladen.
        h.laden.mockResolvedValue({ daten: new ArrayBuffer(8), version: 13, sha256: 'neu', info: info({ version: 13, sha256: 'neu' }) });
        const gruppe = screen.getByRole('region', { name: 'Text erkennen' });
        fireEvent.click(within(gruppe).getByRole('button', { name: 'Als neue Fassung speichern' }));
        await waitFor(() => expect(h.auftragVeroeffentlichen).toHaveBeenCalledTimes(1));
        const [id, rumpf, s2] = h.auftragVeroeffentlichen.mock.calls[0] as [string, unknown, string];
        expect(id).toBe('j1');
        expect(rumpf).toEqual({ destination: { kind: 'new_version' } });
        expect(s2).toMatch(/^[0-9a-f-]{36}$/);
        expect(h.speichern).not.toHaveBeenCalled();
        expect((await screen.findAllByText('Gespeichert als Fassung 13')).length).toBeGreaterThan(0);
        await waitFor(() => expect(h.laden).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('original'));
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
        // Der veröffentlichte Auftrag wird nach dem Neuladen nicht wieder aufgegriffen.
        h.auftraege.mockResolvedValue([fertig]);
        await waitFor(() => expect(h.auftraege).toHaveBeenCalledTimes(2));
        await act(async () => { await new Promise(r => setTimeout(r, 20)); });
        expect(leseansicht().dataset.dokument).toBe('original');
    });

    it('„Als neue Datei …“ fragt das Ziel ab und schickt new_file; signiert nur als neue Datei', async () => {
        const h = gastgeber({}, info({ inspection: { pages: 3, signed: true }, capabilities: { pages: { state: 'blocked_by_document', reason: 'signed_original' }, ocr: { state: 'available' } } }));
        h.auftrag.mockResolvedValue(fertig);
        h.auftragVeroeffentlichen.mockResolvedValue({ file_id: 'f2', version: 1, sha256: 'x', name: 'Kopie.pdf' });
        const { onGespeichert } = await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('vorschau'));
        const gruppe = screen.getByRole('region', { name: 'Text erkennen' });
        expect(within(gruppe).queryByRole('button', { name: 'Als neue Fassung speichern' })).toBeNull();
        fireEvent.click(within(gruppe).getByRole('button', { name: 'Als neue Datei …' }));
        await waitFor(() => expect(h.auftragVeroeffentlichen).toHaveBeenCalledTimes(1));
        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'neue_datei', name: 'Scan (durchsuchbar).pdf' });
        expect(h.auftragVeroeffentlichen.mock.calls[0][1]).toEqual({ destination: { kind: 'new_file', drive_id: '', folder_id: null, name: 'Kopie.pdf' } });
        expect((await screen.findAllByText('Als neue Datei gespeichert: Kopie.pdf')).length).toBeGreaterThan(0);
        expect(onGespeichert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kopie.pdf' }), 'new_file');
        // Das Original bleibt; kein zweites Laden.
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('original'));
        expect(h.laden).toHaveBeenCalledTimes(1);
    });

    it('412 beim Veröffentlichen: Konflikt-Hinweis, „Als neue Datei speichern“ wird angeboten, Vorschau bleibt', async () => {
        const h = gastgeber();
        h.auftrag.mockResolvedValue(fertig);
        h.auftragVeroeffentlichen.mockRejectedValueOnce(new PdfHostFehler(412, 'pdf.version_conflict', { current_version: 14 }));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('vorschau'));
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 's', ctrlKey: true });
        expect((await screen.findAllByText('Datei wurde inzwischen geändert')).length).toBeGreaterThan(0);
        expect(screen.getByText(/Aktuell ist Fassung 14/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Als neue Datei speichern' })).toBeInTheDocument();
        expect(leseansicht().dataset.dokument).toBe('vorschau');
    });

    it('Verwerfen: zurück zum Original, Werkzeuge frei, Abbruch an den Server', async () => {
        const h = gastgeber();
        h.auftrag.mockResolvedValue(fertig);
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('vorschau'));
        fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('original'));
        // Einmal in der Gruppe, einmal als Ansage für Screenreader.
        expect((await screen.findAllByText('Ergebnis verworfen. Das Original ist unverändert.')).length).toBeGreaterThan(0);
        expect(h.auftragAbbrechen).toHaveBeenCalledWith('j1');
        expect(h.auftragVeroeffentlichen).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
    });

    it('nichts erkannt: Grund lesbar, kein Speichern, nur Verwerfen', async () => {
        const h = gastgeber();
        h.auftrag.mockResolvedValue({ ...fertig, result: { sha256: 'neu', meta: { pages_recognized: [], pages_skipped: [{ page: 1, reason: 'no_text_found' }], low_confidence_pages: [], words: 0 } } });
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        // Erst, wenn die Vorschau steht -- vorher gibt es die Kopfzeilen-
        // Knoepfe noch nicht, und der Test sagte nichts (wackelte unter Last).
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('vorschau'));
        expect(await screen.findByText(/kein Text erkannt/)).toBeInTheDocument();
        expect(screen.getByText(/übersprungen \(kein Text gefunden\)/)).toBeInTheDocument();
        // Kein Speicherknopf ist bedienbar -- in der Gruppe gibt es keinen,
        // die der Kopfzeile sind gesperrt.
        for (const knopf of screen.queryAllByRole('button', { name: /Als neue (Fassung|Datei)/ })) expect(knopf).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeEnabled();
    });

    it('Abbrechen beendet den Auftrag und die Abfrage', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        expect(await screen.findByText('Seite 0 von 1')).toBeInTheDocument();
        await waitFor(() => expect(h.auftrag).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
        await waitFor(() => expect(h.auftragAbbrechen).toHaveBeenCalledWith('j1'));
        expect(await screen.findByText('Erkennung abgebrochen. Es wurde nichts gespeichert.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Erkennung starten' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
        const abfragen = h.auftrag.mock.calls.length;
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(h.auftrag.mock.calls.length).toBe(abfragen);
    });

    it('fehlgeschlagen: Grund und Weg zurück zur Auswahl', async () => {
        const h = gastgeber();
        h.auftrag.mockResolvedValue(auftrag('failed', { error: 'pdf.job_failed' }));
        await oeffnen(h);
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        expect(await screen.findByText(/Die Erkennung ist fehlgeschlagen/)).toBeInTheDocument();
        expect(screen.getByText(/Grund: pdf.job_failed/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Auswahl' }));
        expect(await screen.findByRole('button', { name: 'Erkennung starten' })).toBeInTheDocument();
    });
});

describe('Wiederfinden nach Neuöffnen', () => {
    it('ein laufender Auftrag wird aufgegriffen: Gruppe offen, Fortschritt, weiter abgefragt', async () => {
        const h = gastgeber();
        h.auftraege.mockResolvedValue([auftrag('running', { progress: { done: 1, total: 3 } })]);
        // Die Nachfrage (alle 5 ms) liefert denselben Stand: Sonst wechselt die
        // Anzeige unter CI-Last, bevor der Test hinsieht (CI-Lauf 112, 05.10.2026).
        h.auftrag.mockResolvedValue(auftrag('running', { progress: { done: 1, total: 3 } }));
        await oeffnen(h);
        // Der Fortschritt steht je nach Takt an einer oder an zwei Stellen
        // (Gruppe und Statuszeile) -- findAll statt find (05.10.2026, lokal 2/3 rot).
        expect((await screen.findAllByText('Seite 1 von 3')).length).toBeGreaterThan(0);
        expect(h.auftraege).toHaveBeenCalledWith('f1');
        expect(await screen.findByText(/aus einer früheren Sitzung wurde wiedergefunden/)).toBeInTheDocument();
        await waitFor(() => expect(h.auftrag).toHaveBeenCalledWith('j1'));
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
    });

    it('ein fertiger Auftrag wird als Vorschau gezeigt; einer zur aktuellen Fassung nicht', async () => {
        const h = gastgeber();
        h.auftraege.mockResolvedValue([auftrag('succeeded', { id: 'alt', result: { sha256: 'ABC' } }), fertig]);
        await oeffnen(h);
        await waitFor(() => expect(leseansicht().dataset.dokument).toBe('vorschau'));
        expect(h.ergebnisLaden).toHaveBeenCalledWith('j1');
        expect(screen.getAllByText('Vorschau – noch nicht gespeichert').length).toBeGreaterThan(0);
    });
});

describe('Ausschluss mit dem Entwurf', () => {
    async function seiteDrehen() {
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        fireEvent.click((await screen.findAllByRole('option'))[0]);
        fireEvent.click(within(band()).getByRole('button', { name: '90° rechts' }));
        await screen.findAllByText('Änderungen im Entwurf');
    }

    it('Starten mit offenem Entwurf fragt nach; „Erst speichern“ speichert, startet aber nicht', async () => {
        const h = gastgeber();
        h.speichern.mockResolvedValue({ file_id: 'f1', version: 13, sha256: 'def', name: 'Scan.pdf' });
        await oeffnen(h);
        await seiteDrehen();
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        expect(await screen.findByText('Entwurf zuerst speichern oder verwerfen')).toBeInTheDocument();
        expect(h.ocrStarten).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Erst speichern' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        expect((h.speichern.mock.calls[0][0] as CommitBefehl).pages?.[0]).toEqual({ source: 0, rotate: 90 });
        expect(h.ocrStarten).not.toHaveBeenCalled();
    });

    it('„Entwurf verwerfen und starten“ setzt den Entwurf zurück und startet', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await seiteDrehen();
        await gruppeOeffnen();
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Entwurf verwerfen und starten' }));
        await waitFor(() => expect(h.ocrStarten).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('Seite 0 von 1')).toBeInTheDocument();
        expect(h.speichern).not.toHaveBeenCalled();
        expect(screen.queryByText('Änderungen im Entwurf')).toBeNull();
    });
});

describe('Rechte-Bits einer geschützten PDF (Ändern-Bit beim Anlegen)', () => {
    it('422 pdf.permission_restricted beim Start: klare Meldung zum Rechte-Kennwort, die Auswahl bleibt', async () => {
        const h = gastgeber();
        h.ocrStarten.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.permission_restricted', { restricted: ['modify'] }));
        await oeffnen(h);
        const seite2 = await gruppeOeffnen();
        if (!(seite2 as HTMLInputElement).checked) fireEvent.click(seite2);
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        expect(await screen.findByText(/Bearbeiten ist in dieser PDF ohne Rechte-Kennwort nicht erlaubt/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Erkennung starten' })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: 'Seite 2' })).toBeChecked();
        const [befehl] = h.ocrStarten.mock.calls[0] as [OcrBefehl, string];
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
        const seite2 = await gruppeOeffnen();
        if (!(seite2 as HTMLInputElement).checked) fireEvent.click(seite2);
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        await waitFor(() => expect(h.ocrStarten).toHaveBeenCalledTimes(1));
        const [befehl] = h.ocrStarten.mock.calls[0] as [OcrBefehl, string];
        expect(befehl.owner_password).toBe('rechte-456');
        expect(befehl.kind).toBe('ocr');
    });
});

describe('Rechte-Kennwort beim Auftragsstart abgelehnt', () => {
    it('422 pdf.wrong_password: die Sitzung verwirft das Kennwort, die Sperren gelten wieder', async () => {
        rechteFlags = [FLAG.PRINT, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS, FLAG.FILL_INTERACTIVE_FORMS]; // kein Kopieren
        const h = gastgeber({ rechteKennwortPruefen: vi.fn(async () => undefined) });
        h.ocrStarten.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.wrong_password'));
        await oeffnen(h);
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'veraltet-1' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechte-Kennwort eingeben …' })).toBeNull());
        fireEvent.keyDown(document.body, { key: 'Escape' });
        const seite2 = await gruppeOeffnen();
        if (!(seite2 as HTMLInputElement).checked) fireEvent.click(seite2);
        fireEvent.click(screen.getByRole('button', { name: 'Erkennung starten' }));
        const meldung = await screen.findByText(/Der Server hat das Rechte-Kennwort nicht angenommen/);
        expect(meldung).toHaveTextContent('Datei → Rechte-Kennwort eingeben');
        await waitFor(() => expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' })).toBeInTheDocument());
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect((h.ocrStarten.mock.calls[0][0] as OcrBefehl).owner_password).toBe('veraltet-1');
    });
});

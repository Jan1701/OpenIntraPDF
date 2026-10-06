// SPDX-License-Identifier: Apache-2.0
//
// Drucken mit Seitenbereich (Etappe 8, Abschnitt 5): Der Druckknopf öffnet
// den Dialog; alle Seiten mit Anmerkungen gehen den heutigen Weg
// (host.drucken), sonst baut host.druckfassung die Teil-PDF, die im
// Browser im versteckten Rahmen (pdfDrucken) oder über host.bytesDrucken
// (Desktop) gedruckt wird. Ohne druckfassung nur „alle Seiten“;
// Schnelldruck nur mit host.schnelldruck. Gastgeber und pdf.js gemockt.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bandKnopf, dateiMenue, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { pdfDrucken } from './hilfen';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { PdfHostFehler } from './typen';
import type { PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./Leseansicht', () => ({ Leseansicht: ({ sichtbar }: { sichtbar: boolean }) => <div data-testid="leseansicht" hidden={!sichtbar} /> }));
// Der versteckte Rahmen druckt in jsdom nicht; hier zählt nur, dass er die Bytes bekommt.
vi.mock('./hilfen', async importOriginal => ({ ...(await importOriginal<typeof import('./hilfen')>()), pdfDrucken: vi.fn(async () => undefined) }));

function seite(n: number) {
    return {
        rotate: 0,
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
const dokument = { numPages: 5, getPage: async (n: number) => seite(n), getOutline: async () => null };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(dokument), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1, DISABLE: 0 },
    },
    viewer: {},
    viewerStil: '',
};

function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
        inspection: { pages: 5 },
        capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } },
        ...ueber,
    };
}

const teil = new TextEncoder().encode('%PDF-1.7 Teil').buffer;

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()) {
    const h = {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        druckfassung: vi.fn(async () => teil),
        speichern: vi.fn(),
        zielWaehlen: vi.fn(async () => null),
        ...ueber,
    };
    return h as PdfHost & typeof h;
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => {
    cleanup();
    vi.mocked(pdfDrucken).mockClear();
});

async function oeffnen(h: PdfHost) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
}

async function druckdialog() {
    fireEvent.click(screen.getByRole('button', { name: 'Drucken' }));
    return screen.findByRole('dialog', { name: 'Drucken' });
}

describe('Drucken mit Seitenbereich (Etappe 8, Abschnitt 5)', () => {
    it('Vorgabe alle Seiten mit Anmerkungen: der heutige Weg des Gastgebers', async () => {
        const h = gastgeber();
        await oeffnen(h);
        const dialog = await druckdialog();
        expect(within(dialog).getByRole('radio', { name: 'Alle Seiten' })).toBeChecked();
        expect(within(dialog).getByRole('checkbox', { name: 'Mit Anmerkungen' })).toBeChecked();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.drucken).toHaveBeenCalledTimes(1));
        expect(h.druckfassung).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull();
    });

    it('aktuelle Seite, Seitenbereich mit Prüfung und ohne Anmerkungen: Druckfassung des Gastgebers, gedruckt im versteckten Rahmen', async () => {
        const h = gastgeber();
        await oeffnen(h);
        let dialog = await druckdialog();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Aktuelle Seite (1)' }));
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Mit Anmerkungen' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.druckfassung).toHaveBeenCalledWith({ pages: [0], annotations: false, expected_version: 12 }));
        await waitFor(() => expect(pdfDrucken).toHaveBeenCalledTimes(1));
        const blob = vi.mocked(pdfDrucken).mock.calls[0][0] as Blob;
        expect(blob.size).toBe(teil.byteLength);
        expect(blob.type).toBe('application/pdf');
        expect(h.drucken).not.toHaveBeenCalled();

        dialog = await druckdialog();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Seitenbereich' }));
        const feld = within(dialog).getByRole('textbox', { name: 'Seitenbereich' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Bitte einen Seitenbereich eingeben.');
        fireEvent.change(feld, { target: { value: '1-2, 9' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Seite 9 gibt es nicht – das Dokument hat 5 Seiten.');
        expect(feld).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(feld, { target: { value: '1-2, 4-' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.druckfassung).toHaveBeenLastCalledWith({ pages: [0, 1, 3, 4], annotations: true, expected_version: 12 }));
        await waitFor(() => expect(pdfDrucken).toHaveBeenCalledTimes(2));
    });

    it('alle Seiten ohne Anmerkungen gehen über die Druckfassung; ein Fehler steht in der Hinweiszeile', async () => {
        const h = gastgeber({ druckfassung: vi.fn(async () => { throw new PdfHostFehler(503, 'error.internal'); }) });
        await oeffnen(h);
        const dialog = await druckdialog();
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Mit Anmerkungen' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.druckfassung).toHaveBeenCalledWith({ pages: [0, 1, 2, 3, 4], annotations: false, expected_version: 12 }));
        expect(await screen.findByText('Die Druckfassung ließ sich nicht erstellen.')).toBeInTheDocument();
        expect(pdfDrucken).not.toHaveBeenCalled();
    });

    it('Auswahl aus dem Seitenraster erscheint im Bearbeiten mit gewählten Seiten', async () => {
        const h = gastgeber();
        await oeffnen(h);
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        const kacheln = await screen.findAllByRole('option');
        fireEvent.click(kacheln[1]);
        fireEvent.click(kacheln[3], { ctrlKey: true });
        const dialog = await druckdialog();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Auswahl aus dem Seitenraster (2 Seiten)' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.druckfassung).toHaveBeenCalledWith({ pages: [1, 3], annotations: true, expected_version: 12 }));
    });

    it('Desktop: die Bytes gehen an host.bytesDrucken; Schnelldruck im Datei-Menü nur mit host.schnelldruck', async () => {
        const bytesDrucken = vi.fn(async (_bytes: ArrayBuffer, _name: string) => undefined);
        const schnelldruck = vi.fn(async () => undefined);
        const h = gastgeber({ bytesDrucken, schnelldruck, herunterladen: undefined });
        await oeffnen(h);
        const dialog = await druckdialog();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Aktuelle Seite (1)' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(bytesDrucken).toHaveBeenCalledTimes(1));
        expect(bytesDrucken.mock.calls[0][1]).toBe('Angebot – Drucken.pdf');
        expect(pdfDrucken).not.toHaveBeenCalled();
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Schnelldruck' }));
        await waitFor(() => expect(schnelldruck).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull();
    });

    it('ohne druckfassung (Wiki) nur alle Seiten mit Anmerkungen; kein Schnelldruck im Browser', async () => {
        const h = gastgeber({ druckfassung: undefined, speichern: undefined, zielWaehlen: undefined });
        await oeffnen(h);
        expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Schnelldruck' })).toBeNull();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        const dialog = await druckdialog();
        expect(within(dialog).getByRole('radio', { name: 'Alle Seiten' })).toBeEnabled();
        expect(within(dialog).getByRole('radio', { name: 'Aktuelle Seite (1)' })).toBeDisabled();
        expect(within(dialog).getByRole('radio', { name: 'Seitenbereich' })).toBeDisabled();
        expect(within(dialog).getByRole('checkbox', { name: 'Mit Anmerkungen' })).toBeDisabled();
        expect(within(dialog).getByText('Dieser Gastgeber druckt nur alle Seiten mit Anmerkungen.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.drucken).toHaveBeenCalledTimes(1));
    });

    it('der Druckknopf im Band Datei öffnet denselben Dialog; Abbrechen druckt nichts', async () => {
        const h = gastgeber();
        await oeffnen(h);
        reiterWaehlen('Start');
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Drucken' }));
        const dialog = await screen.findByRole('dialog', { name: 'Drucken' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
        expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull();
        expect(h.drucken).not.toHaveBeenCalled();
        expect(bandKnopf('Suchen')).toBeInTheDocument();
    });
});

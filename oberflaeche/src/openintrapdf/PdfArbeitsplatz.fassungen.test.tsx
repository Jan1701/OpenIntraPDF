// SPDX-License-Identifier: Apache-2.0
//
// Fassungen im Editor (Etappe 8, Abschnitt 3): Liste im Arbeitsfach über
// Datei → Fassungen, eine Fassung nur ansehen (gelber Hinweis, Speichern/
// Kommentieren/Seiten aus, Zurück), Wiederherstellen mit Rückfrage. Ein
// Gastgeber ohne die Fähigkeiten (Wiki, Desktop) hat den Eintrag nicht.
// Gastgeber und pdf.js sind gemockt, die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bandKnopf, dateiMenue, fach, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { PdfFassung, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
interface LeseMock { sichtbar: boolean; dokument: { numPages: number }; anmerkungen?: unknown }
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, dokument, anmerkungen }: LeseMock) => (
        <div data-testid="leseansicht" hidden={!sichtbar} data-seiten={dokument.numPages} data-kommentieren={anmerkungen ? 'ja' : 'nein'} />
    ),
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
const dokument = { numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null };
/** Die angesehene Fassung hat nur zwei Seiten — so erkennt der Test, was die Leseansicht zeigt. */
const fassungDokument = { numPages: 2, getPage: async (n: number) => seite(n), getOutline: async () => null };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn((o: { data: Uint8Array }) => ({
            promise: Promise.resolve(o.data.byteLength === 2 ? fassungDokument : dokument),
            destroy: vi.fn(async () => undefined), onPassword: null,
        })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1, DISABLE: 0 },
    },
    viewer: {},
    viewerStil: '',
};

function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
        inspection: { pages: 3 },
        capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } },
        ...ueber,
    };
}

const fassungen: PdfFassung[] = [
    { version: 11, size: 900, created_at: '2026-09-30T09:00:00Z', created_by: 'Anna Muster' },
    { version: 10, size: 2048, created_at: '2026-09-29T14:08:00Z' },
];

function gastgeber(dateiInfo: PdfInfo = info(), ueber: Partial<PdfHost> = {}) {
    const h = {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        speichern: vi.fn(),
        zielWaehlen: vi.fn(async () => null),
        fassungen: vi.fn(async () => fassungen),
        fassungLaden: vi.fn(async () => new ArrayBuffer(2)),
        fassungWiederherstellen: vi.fn(async () => ({ version: 13 })),
        ...ueber,
    };
    return h as PdfHost & typeof h;
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => cleanup());

const datum = (iso: string) => new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const leseansicht = () => screen.getByTestId('leseansicht');

async function oeffnen(h: PdfHost) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
}

async function fassungenOeffnen(h: PdfHost) {
    await oeffnen(h);
    fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Fassungen' }));
    const f = fach('Fassungen');
    await within(f).findByText('Fassung 11');
    return f;
}

describe('Fassungen (Etappe 8, Abschnitt 3)', () => {
    it('Datei → Fassungen zeigt die Liste mit Nummer, Datum, Person und Größe; die aktuelle steht darüber', async () => {
        const h = gastgeber();
        const f = await fassungenOeffnen(h);
        expect(h.fassungen).toHaveBeenCalledTimes(1);
        expect(within(f).getByText('Fassung 12 – aktuell')).toBeInTheDocument();
        expect(within(f).getByText(`${datum('2026-09-30T09:00:00Z')} · Anna Muster · 900 Bytes`)).toBeInTheDocument();
        expect(within(f).getByText('Fassung 10')).toBeInTheDocument();
        expect(within(f).getByText(`${datum('2026-09-29T14:08:00Z')} · 2 KB`)).toBeInTheDocument();
        expect(within(f).getAllByRole('button', { name: 'Ansehen' })).toHaveLength(2);
    });

    it('ohne die Fähigkeiten des Gastgebers (Wiki, Desktop) gibt es den Eintrag nicht', async () => {
        await oeffnen(gastgeber(info(), { fassungen: undefined }));
        expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Fassungen' })).toBeNull();
        cleanup();
        await oeffnen(gastgeber(info(), { fassungLaden: undefined }));
        expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Fassungen' })).toBeNull();
    });

    it('Ansehen lädt die Fassung nur lesend: gelber Hinweis, Speichern/Kommentieren/Seiten aus; Zurück zur aktuellen', async () => {
        const h = gastgeber();
        const f = await fassungenOeffnen(h);
        // Vorher: kommentieren und bearbeiten möglich.
        expect(leseansicht().dataset.seiten).toBe('3');
        expect(leseansicht().dataset.kommentieren).toBe('ja');
        expect(reiter('Seiten')).toBeEnabled();

        fireEvent.click(within(f).getAllByRole('button', { name: 'Ansehen' })[0]);
        expect(h.fassungLaden).toHaveBeenCalledWith(11);
        const hinweis = await screen.findByText(`Fassung 11 vom ${datum('2026-09-30T09:00:00Z')} – nur ansehen`);
        expect(hinweis).toBeInTheDocument();
        await waitFor(() => expect(leseansicht().dataset.seiten).toBe('2'));
        expect(leseansicht().dataset.kommentieren).toBe('nein');
        expect(screen.getByRole('button', { name: /Als neue Fassung speichern/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        expect(reiter('Seiten')).toBeDisabled();
        expect(reiter('Kommentieren')).toBeDisabled();
        expect(reiter('Kommentieren')).toHaveAttribute('title', 'Sie sehen eine frühere Fassung. Speichern, Kommentieren und Seiten sind dabei aus.');
        // Strg+S tut nichts.
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 's', ctrlKey: true });
        expect(h.speichern).not.toHaveBeenCalled();
        // In der Liste steht die Fassung als angesehen; Zurück beendet das Ansehen.
        expect(within(fach('Fassungen')).getByRole('button', { name: 'Zurück zur aktuellen' })).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Zurück zur aktuellen' })[0]);
        // Hinweis und Zurück-Knöpfe sind weg (die Ansage für Screenreader bleibt im sr-only-Bereich).
        expect(screen.queryByRole('button', { name: 'Zurück zur aktuellen' })).toBeNull();
        await waitFor(() => expect(leseansicht().dataset.seiten).toBe('3'));
        expect(leseansicht().dataset.kommentieren).toBe('ja');
        expect(reiter('Seiten')).toBeEnabled();
    });

    it('Wiederherstellen: Rückfrage im Dialog, dann die Restore-Route, danach wird neu geladen', async () => {
        const h = gastgeber();
        const f = await fassungenOeffnen(h);
        fireEvent.click(within(f).getAllByRole('button', { name: 'Diese Fassung wiederherstellen' })[1]);
        const dialog = await screen.findByRole('dialog', { name: 'Fassung wiederherstellen' });
        expect(within(dialog).getByText(/Fassung 10 wird als neue Fassung übernommen/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
        expect(h.fassungWiederherstellen).not.toHaveBeenCalled();

        fireEvent.click(within(f).getAllByRole('button', { name: 'Diese Fassung wiederherstellen' })[1]);
        (h.laden as ReturnType<typeof vi.fn>).mockResolvedValue({
            daten: new ArrayBuffer(8), version: 13, sha256: 'def', info: info({ version: 13, sha256: 'def' }),
        });
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Fassung wiederherstellen' })).getByRole('button', { name: 'Wiederherstellen' }));
        await waitFor(() => expect(h.fassungWiederherstellen).toHaveBeenCalledWith(10));
        await waitFor(() => expect(h.laden).toHaveBeenCalledTimes(2));
        await screen.findByText('Fassung 13 · 3 Seiten');
    });

    it('ein offener Entwurf blockiert das Wiederherstellen mit Hinweis; mit Kommentarrecht wird es nicht angeboten', async () => {
        const h = gastgeber();
        await oeffnen(h);
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        fireEvent.click((await screen.findAllByRole('option'))[0]);
        fireEvent.click(bandKnopf('90° rechts'));
        await screen.findAllByText('Änderungen im Entwurf');
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Fassungen' }));
        const f = fach('Fassungen');
        await within(f).findByText('Fassung 11');
        for (const b of within(f).getAllByRole('button', { name: 'Diese Fassung wiederherstellen' })) expect(b).toBeDisabled();
        expect(within(f).getByText('Ein offener Entwurf blockiert das Wiederherstellen. Speichern oder verwerfen Sie ihn zuerst.')).toBeInTheDocument();
        cleanup();

        const k = gastgeber(info({ access: 'comment' }));
        const fk = await fassungenOeffnen(k);
        expect(within(fk).queryByRole('button', { name: 'Diese Fassung wiederherstellen' })).toBeNull();
        expect(within(fk).getAllByRole('button', { name: 'Ansehen' })).toHaveLength(2);
        reiterWaehlen('Kommentieren');
        expect(bandKnopf('Notiz')).toBeEnabled();
    });
});

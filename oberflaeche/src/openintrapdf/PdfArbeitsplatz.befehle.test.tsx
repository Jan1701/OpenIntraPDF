// SPDX-License-Identifier: Apache-2.0
//
// Befehle von außen (Etappe 6): Ein Gastgeber mit nativem Menü löst über
// die `befehle`-Referenz dieselben Abläufe aus wie Knöpfe und Tasten.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { dateiMenue } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { PdfArbeitsplatzBefehle } from './PdfArbeitsplatz';
import type { PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./Leseansicht', () => ({ Leseansicht: () => <div data-testid="leseansicht" /> }));

function seite(n: number) {
    return {
        rotate: 0,
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
const dokument = { numPages: 2, getPage: async (n: number) => seite(n), getOutline: async () => null };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(dokument), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1 },
    },
    viewer: {},
    viewerStil: '',
};

const info: PdfInfo = {
    file_id: 'f1', name: 'Probe.pdf', version: 1, sha256: 'abc', size: 1000, access: 'edit',
    inspection: { pages: 2 },
    capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } },
};

function gastgeber(): PdfHost & { drucken: ReturnType<typeof vi.fn>; herunterladen: ReturnType<typeof vi.fn>; speichern: ReturnType<typeof vi.fn> } {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: 1, sha256: 'abc', info })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        speichern: vi.fn(async () => ({ file_id: 'f1', version: 2, sha256: 'def', name: 'Probe.pdf' })),
        zielWaehlen: vi.fn(async () => null),
    };
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => cleanup());

describe('PdfArbeitsplatz: Befehle von außen', () => {
    it('drucken, kopie und schließen laufen über den Gastgeber; speichern tut ohne Entwurf nichts', async () => {
        const host = gastgeber();
        const onClose = vi.fn();
        const befehle = createRef<PdfArbeitsplatzBefehle>();
        render(<PdfArbeitsplatz host={host} name="Probe.pdf" onClose={onClose} befehle={befehle} />);
        await waitFor(() => expect(screen.getByTestId('leseansicht')).toBeInTheDocument());
        await waitFor(() => expect(befehle.current).not.toBeNull());

        await act(async () => { befehle.current!.drucken(); });
        // Seit Etappe 8 öffnet Drucken den Dialog; die Vorgabe geht den Weg des Gastgebers.
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Drucken' })).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(host.drucken).toHaveBeenCalledTimes(1));

        await act(async () => { befehle.current!.kopie(); });
        await waitFor(() => expect(host.herunterladen).toHaveBeenCalledTimes(1));

        await act(async () => { befehle.current!.speichern(); });
        expect(host.speichern).not.toHaveBeenCalled();

        await act(async () => { befehle.current!.schliessen(); });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ohne host.herunterladen kein Knopf, und kopie bleibt still (Desktop, Jan 01.10.2026)', async () => {
        const host = gastgeber();
        delete (host as Partial<PdfHost>).herunterladen;
        const befehle = createRef<PdfArbeitsplatzBefehle>();
        render(<PdfArbeitsplatz host={host} name="Probe.pdf" onClose={vi.fn()} befehle={befehle} />);
        await waitFor(() => expect(screen.getByTestId('leseansicht')).toBeInTheDocument());
        // Herunterladen steht seit Etappe 7 im Datei-Menü, Drucken im Schnellbereich.
        expect(within(dateiMenue()).queryByRole('menuitem', { name: 'Herunterladen' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Drucken' })).toBeInTheDocument();
        await waitFor(() => expect(befehle.current).not.toBeNull());
        await act(async () => { befehle.current!.kopie(); });
    });

    it('mit host.herunterladen steht der Knopf da (Drive)', async () => {
        render(<PdfArbeitsplatz host={gastgeber()} name="Probe.pdf" onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('leseansicht')).toBeInTheDocument());
        expect(within(dateiMenue()).getByRole('menuitem', { name: 'Herunterladen' })).toBeInTheDocument();
    });

    it('drucken ohne host.drucken bleibt still', async () => {
        const host = gastgeber();
        delete (host as Partial<PdfHost>).drucken;
        const befehle = createRef<PdfArbeitsplatzBefehle>();
        render(<PdfArbeitsplatz host={host} name="Probe.pdf" onClose={() => undefined} befehle={befehle} />);
        await waitFor(() => expect(befehle.current).not.toBeNull());
        await act(async () => { befehle.current!.drucken(); });
        expect(host.herunterladen).not.toHaveBeenCalled();
    });
});

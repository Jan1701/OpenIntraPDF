// SPDX-License-Identifier: Apache-2.0
//
// Höhe des Werkzeugbands im PDF-Arbeitsplatz, gemessen über die gesetzten Klassen
// (test/werkzeugbandHoehe.ts): Klassisch muss es so hoch bleiben wie vor dem
// Umbau auf den gemeinsamen Baustein (Oktober 2026) — dieselbe Messung am
// alten Stand ergab dieselben Zahlen. Einzeilig spart es Platz.
// Gastgeber und pdf.js sind gemockt, die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { reiterWaehlen, werkzeugband } from '../test/werkzeugband';
import { hoeheAusKlassen } from '../test/werkzeugbandHoehe';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ steuerung }: { steuerung: { current: unknown } }) => {
        steuerung.current = { suchen: vi.fn(), sucheBeenden: vi.fn(), zuSeite: vi.fn(), blaettern: vi.fn(), zoom: vi.fn(), trefferJeSeite: () => [] };
        return <div data-testid="leseansicht" />;
    },
}));

const seite = () => ({
    rotate: 0,
    view: [0, 0, 595.28, 841.89],
    getViewport: () => ({ width: 100, height: 141 }),
    render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
    getTextContent: async () => ({ items: [] }),
    getAnnotations: async () => [],
});
const dokument = { numPages: 3, getPage: async () => seite(), getOutline: async () => null, getMetadata: async () => ({ info: {} }) };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(dokument), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1, DISABLE: 0 },
    },
    viewer: {},
    viewerStil: '',
};

const info: PdfInfo = {
    file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
    inspection: { pages: 3, annotations: 0 },
    capabilities: {
        pages: { state: 'available' }, annotations: { state: 'available' }, ocr: { state: 'available' },
        export: { state: 'available' }, merge: { state: 'available' },
    },
};

function drive(): PdfHost {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: 12, sha256: 'abc', info })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        speichern: vi.fn(),
        extrahieren: vi.fn(),
        zielWaehlen: vi.fn(async () => ({ drive_id: '', folder_id: null, name: 'Kopie' })),
        seitenarten: vi.fn(async () => ({ version: 12, pages: [] })),
        ocrStarten: vi.fn(),
        auftraege: vi.fn(async () => []),
        auftrag: vi.fn(),
        auftragAbbrechen: vi.fn(),
        ergebnisLaden: vi.fn(),
        auftragVeroeffentlichen: vi.fn(),
        analyseStarten: vi.fn(),
        modellLaden: vi.fn(),
        exportieren: vi.fn(),
        binden: vi.fn(),
        dateienWaehlen: vi.fn(async () => []),
        quelleInfo: vi.fn(),
    };
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

const reiterzeile = () => werkzeugband().firstElementChild!;
const band = () => within(werkzeugband()).getByRole('tabpanel');

describe('Höhe des PDF-Werkzeugbands', () => {
    it('klassisch wie vor dem Umbau: Reiterzeile 40 px (Speichern/Drucken sind h-9), Band 90–92 px, zusammen 140 px', async () => {
        render(<PdfArbeitsplatz host={drive()} name="Angebot.pdf" onClose={vi.fn()} />);
        await screen.findByTestId('leseansicht');
        expect(hoeheAusKlassen(reiterzeile())).toBe(40);
        const hoehen: Record<string, number> = {};
        for (const name of ['Start', 'Kommentieren', 'Einfügen', 'Werkzeuge', 'Ansicht', 'Seiten']) {
            reiterWaehlen(name);
            hoehen[name] = hoeheAusKlassen(band());
        }
        // 4 + 12 + Knöpfe + 18: zwei kleine übereinander 58 px, nur große 56 px.
        expect(hoehen).toEqual({ Start: 92, Kommentieren: 90, Einfügen: 90, Werkzeuge: 90, Ansicht: 92, Seiten: 92 });
        reiterWaehlen('Start');
        expect(hoeheAusKlassen(werkzeugband())).toBe(140);
        expect(hoeheAusKlassen(werkzeugband(), ['werkzeugband-gruppenname', 'opdf-band-name'])).toBe(122);
    });

    it('eingeklappt nur die Reiterzeile: 48 px', async () => {
        render(<PdfArbeitsplatz host={drive()} name="Angebot.pdf" onClose={vi.fn()} />);
        await screen.findByTestId('leseansicht');
        fireEvent.doubleClick(within(werkzeugband()).getByRole('tab', { name: 'Start' }));
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        expect(hoeheAusKlassen(werkzeugband())).toBe(48);
    });
});

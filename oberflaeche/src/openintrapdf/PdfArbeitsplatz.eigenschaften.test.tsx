// SPDX-License-Identifier: Apache-2.0
//
// Eigenschaften bearbeiten (Etappe 8, Abschnitt 4): Im Modus Bearbeiten
// mit edit sind Titel, Thema, Autor und Stichwörter Eingabefelder;
// Übernehmen legt nur die Abweichungen in den Entwurf (leer = entfernen),
// Rückgängig gilt, Speichern schickt `properties`. Im Lesen, mit comment
// oder view nur Anzeige. Gastgeber und pdf.js sind gemockt.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dateiMenue } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { eigenschaftenAbweichung } from './EigenschaftenDialog';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { CommitBefehl, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./Leseansicht', () => ({ Leseansicht: ({ sichtbar }: { sichtbar: boolean }) => <div data-testid="leseansicht" hidden={!sichtbar} /> }));

function seite(n: number) {
    return {
        rotate: 0,
        view: [0, 0, 595.28, 841.89],
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
const dokument = {
    numPages: 2,
    getPage: async (n: number) => seite(n),
    getOutline: async () => null,
    getMetadata: async () => ({ info: { Title: 'Angebot Küche', Author: 'Anna Muster', Keywords: 'Küche', Producer: 'pdfcpu' } }),
};
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
        inspection: { pages: 2 },
        capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } },
        ...ueber,
    };
}

function gastgeber(dateiInfo: PdfInfo = info()): PdfHost & { speichern: ReturnType<typeof vi.fn> } {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        speichern: vi.fn(async () => ({ file_id: 'f1', version: 13, sha256: 'def', name: 'Angebot.pdf' })),
        zielWaehlen: vi.fn(async () => null),
    } as PdfHost & { speichern: ReturnType<typeof vi.fn> };
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => cleanup());

const wurzel = () => screen.getByRole('dialog', { name: /OpenIntraPDF/ });

async function oeffnen(h: PdfHost, bearbeiten: boolean) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
    if (bearbeiten) {
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        await screen.findAllByRole('option');
    }
}

async function dialogOeffnen() {
    fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Eigenschaften' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eigenschaften' });
    // Erst wenn die Werte aus pdf.js da sind, stehen Zeilen und Felder.
    await within(dialog).findByText('2 Seiten');
    return dialog;
}

describe('eigenschaftenAbweichung', () => {
    it('nur Abweichungen vom Dokument, getrimmt; leer heißt entfernen; gleich fehlt', () => {
        const dok = { titel: 'Alt', autor: 'Anna', thema: undefined, stichwoerter: 'k', erstellt: null, geaendert: null, seiten: 1, ersteSeite: null };
        expect(eigenschaftenAbweichung(dok, { title: ' Alt ', subject: '', author: '', keywords: 'k' })).toEqual({ author: '' });
        expect(eigenschaftenAbweichung(dok, { title: 'Neu', subject: 'Thema', author: 'Anna', keywords: 'k' })).toEqual({ title: 'Neu', subject: 'Thema' });
        expect(eigenschaftenAbweichung(dok, { title: 'Alt', subject: '', author: 'Anna', keywords: 'k' })).toEqual({});
    });
});

describe('Eigenschaften bearbeiten (Etappe 8, Abschnitt 4)', () => {
    it('im Bearbeiten mit edit: Felder vorbelegt, Übernehmen legt die Abweichungen in den Entwurf, Rückgängig gilt, Speichern schickt properties', async () => {
        const h = gastgeber();
        await oeffnen(h, true);
        let dialog = await dialogOeffnen();
        const titel = within(dialog).getByRole('textbox', { name: 'Titel' });
        expect(titel).toHaveValue('Angebot Küche');
        expect(within(dialog).getByRole('textbox', { name: 'Autor' })).toHaveValue('Anna Muster');
        expect(within(dialog).getByRole('textbox', { name: 'Thema' })).toHaveValue('');
        expect(within(dialog).getByRole('textbox', { name: 'Stichwörter' })).toHaveValue('Küche');
        expect(titel).toHaveAttribute('maxlength', '1000');

        fireEvent.change(titel, { target: { value: '  Angebot Küche 2026 ' } });
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Autor' }), { target: { value: '' } });
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Thema' }), { target: { value: 'Rechnung 00123' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
        expect(within(dialog).getByText('Eigenschaften in den Entwurf übernommen.')).toBeInTheDocument();
        expect(within(dialog).getByText('Titel (Entwurf)')).toBeInTheDocument();
        expect(within(dialog).getByText('Autor (Entwurf)')).toBeInTheDocument();
        expect(within(dialog).queryByText('Stichwörter (Entwurf)')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);

        // Rückgängig nimmt das Übernehmen als einen Schritt zurück; Wiederholen holt es.
        fireEvent.keyDown(wurzel(), { key: 'z', ctrlKey: true });
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
        fireEvent.keyDown(wurzel(), { key: 'z', ctrlKey: true, shiftKey: true });
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);
        // Der Dialog zeigt den Entwurf wieder — die Felder tragen die Marke „(Entwurf)“.
        dialog = await dialogOeffnen();
        expect(within(dialog).getByRole('textbox', { name: 'Titel (Entwurf)' })).toHaveValue('Angebot Küche 2026');
        expect(within(dialog).getByRole('textbox', { name: 'Autor (Entwurf)' })).toHaveValue('');
        expect(within(dialog).getByRole('textbox', { name: 'Stichwörter' })).toHaveValue('Küche');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));

        fireEvent.keyDown(wurzel(), { key: 's', ctrlKey: true });
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.properties).toEqual({ title: 'Angebot Küche 2026', subject: 'Rechnung 00123', author: '' });
        expect(befehl).not.toHaveProperty('pages');
        expect(befehl).not.toHaveProperty('annotations');
    });

    it('Steuerzeichen werden abgewiesen; ohne Änderung „Nichts geändert“', async () => {
        const h = gastgeber();
        await oeffnen(h, true);
        const dialog = await dialogOeffnen();
        // Ein Tabulator — Zeilenumbrüche nimmt ein Textfeld gar nicht erst an.
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Thema' }), { target: { value: 'Spalte 1\tSpalte 2' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Thema: Keine Zeilenumbrüche oder Steuerzeichen');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Thema' }), { target: { value: '' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
        expect(within(dialog).getByText('Nichts geändert.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
    });

    it('im Lesen nur Anzeige mit Hinweis; mit comment oder view keine Felder', async () => {
        await oeffnen(gastgeber(), false);
        let dialog = await dialogOeffnen();
        expect(within(dialog).queryByRole('textbox')).toBeNull();
        expect(within(dialog).getByText('Titel')).toBeInTheDocument();
        expect(within(dialog).getByText(/Zum Bearbeiten in den Modus „Bearbeiten“ wechseln/)).toBeInTheDocument();
        cleanup();

        await oeffnen(gastgeber(info({ access: 'comment' })), false);
        dialog = await dialogOeffnen();
        expect(within(dialog).queryByRole('textbox')).toBeNull();
        expect(within(dialog).queryByText(/Zum Bearbeiten/)).toBeNull();
        expect(within(dialog).getByText('Nur Anzeige.')).toBeInTheDocument();
    });
});

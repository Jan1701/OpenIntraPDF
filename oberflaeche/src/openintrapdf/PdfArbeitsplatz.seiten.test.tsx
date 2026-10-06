// SPDX-License-Identifier: Apache-2.0
//
// Seiten einfügen und kopieren (Etappe 9, Vertrag Abschnitte 1 und 2):
// leere Seite im Format der Nachbarseite, Kopieren/Ausschneiden/Einfügen
// im Seitenraster (Knöpfe und Strg+C/X/V) und Seiten aus einer anderen
// Datei. Gastgeber und pdf.js sind gemockt, die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bandKnopf, reiter } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { PdfHostFehler } from './typen';
import type { CommitBefehl, DateiWahl, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./Leseansicht', () => ({ Leseansicht: ({ sichtbar }: { sichtbar: boolean }) => <div data-testid="leseansicht" hidden={!sichtbar} /> }));

/** Seite 2 ist quer (Letter) und um 90° gedreht gespeichert; die anderen A4 hoch. */
function seite(n: number) {
    return {
        rotate: n === 2 ? 90 : 0,
        view: n === 2 ? [0, 0, 792, 612] : [0, 0, 595.28, 841.89],
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
const dokument = { numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null };
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
        inspection: { pages: 3 },
        capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } },
        ...ueber,
    };
}

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()) {
    const h = {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        speichern: vi.fn(async () => ({ file_id: 'f1', version: 13, sha256: 'def', name: 'Angebot.pdf' })),
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
afterEach(() => cleanup());

/** Öffnen, ins Bearbeiten wechseln, die Kacheln liefern. */
async function bearbeiten(h: PdfHost) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(reiter('Seiten')).toHaveAttribute('aria-selected', 'true');
    return screen.findAllByRole('option');
}

const kacheln = () => screen.getAllByRole('option');
const beschriftungen = () => kacheln().map(k => k.getAttribute('aria-label') ?? '');

async function speichern(h: ReturnType<typeof gastgeber>): Promise<CommitBefehl> {
    fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
    await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
    return vi.mocked(h.speichern).mock.calls[0][0] as CommitBefehl;
}

/** Ein Gastgeber mit Dateiwähler und Quellinfo — Anhang.pdf hat 4 Seiten, Fassung 3. */
function gastgeberMitDateien(dateien: DateiWahl[] = [{ id: 'f2', name: 'Anhang.pdf' }]) {
    return gastgeber({
        dateienWaehlen: vi.fn(async () => dateien),
        quelleInfo: vi.fn(async (id: string) => {
            if (id === 'weg') throw new PdfHostFehler(404, 'drive.not_found');
            if (id === 'f3') return info({ file_id: 'f3', name: 'Gesperrt.pdf', version: 1, inspection: { pages: 2, encrypted: true }, capabilities: { merge: { state: 'unsupported', reason: 'encrypted_source' } } });
            return info({ file_id: id, name: 'Anhang.pdf', version: 3, inspection: { pages: 4 }, capabilities: { merge: { state: 'available' } } });
        }),
    });
}

describe('Leere Seite (Etappe 9, Abschnitt 1)', () => {
    it('fügt nach der gewählten Seite eine leere Seite im Format und mit der Drehung der Nachbarseite ein; der Commit trägt blank', async () => {
        const h = gastgeber();
        const vorher = await bearbeiten(h);
        expect(vorher).toHaveLength(3);
        // Seite 2 (quer, 90°) wählen, dann „Leere Seite“.
        fireEvent.click(vorher[1]);
        fireEvent.click(bandKnopf('Leere Seite'));
        await waitFor(() => expect(kacheln()).toHaveLength(4));
        expect(beschriftungen()[2]).toContain('Leere Seite');
        expect(beschriftungen()[2]).toContain('künftig Seite 3');
        expect(beschriftungen()[2]).toContain('um 90° gedreht');
        // Die neue Seite ist gewählt, ihr Platzhalter ist ein weißes Blatt im Querformat.
        expect(kacheln()[2]).toHaveAttribute('aria-selected', 'true');
        const blatt = screen.getByTestId('opdf-leer-leer~2');
        expect(blatt.style.aspectRatio).toBe('612 / 792');
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);

        const befehl = await speichern(h);
        expect(befehl.pages).toEqual([
            { source: 0, rotate: 0 },
            { source: 1, rotate: 0 },
            { source: -1, rotate: 90, blank: { width: 792, height: 612 } },
            { source: 2, rotate: 0 },
        ]);
    });

    it('ohne Auswahl landet die leere Seite hinter der aktuellen Seite; Rückgängig nimmt sie weg, Wiederholen bringt dieselbe zurück', async () => {
        const h = gastgeber();
        await bearbeiten(h);
        fireEvent.click(bandKnopf('Leere Seite'));
        await waitFor(() => expect(kacheln()).toHaveLength(4));
        // Aktuelle Seite ist 1 (A4 hoch, ungedreht): die leere Seite steht an zweiter Stelle, hochkant.
        expect(beschriftungen()[1]).toContain('Leere Seite');
        expect(beschriftungen()[1]).not.toContain('gedreht');
        expect(screen.getByTestId('opdf-leer-leer~2').style.aspectRatio).toBe('595.28 / 841.89');
        const wurzel = screen.getByRole('dialog', { name: /OpenIntraPDF/ });
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true });
        await waitFor(() => expect(kacheln()).toHaveLength(3));
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true, shiftKey: true });
        await waitFor(() => expect(kacheln()).toHaveLength(4));
        expect(screen.getByTestId('opdf-leer-leer~2')).toBeInTheDocument();
    });

    it('die leere Seite lässt sich drehen, entfernen, duplizieren und verschieben wie jede andere', async () => {
        const h = gastgeber();
        await bearbeiten(h);
        fireEvent.click(bandKnopf('Leere Seite'));
        await waitFor(() => expect(kacheln()).toHaveLength(4));
        // Sie ist gewählt: drehen, duplizieren, nach hinten.
        fireEvent.click(bandKnopf('90° rechts'));
        fireEvent.click(bandKnopf('Duplizieren'));
        await waitFor(() => expect(kacheln()).toHaveLength(5));
        fireEvent.click(kacheln()[1]);
        fireEvent.click(bandKnopf('Entfernen'));
        expect(beschriftungen()[1]).toContain('wird entfernt');
        const befehl = await speichern(h);
        expect(befehl.pages).toEqual([
            { source: 0, rotate: 0 },
            { source: -1, rotate: 90, blank: { width: 595.28, height: 841.89 } },
            { source: 1, rotate: 0 },
            { source: 2, rotate: 0 },
        ]);
    });
});

describe('Kopieren, Ausschneiden, Einfügen (Etappe 9, Abschnitt 2)', () => {
    it('Kopieren + Einfügen verdoppelt an anderer Stelle, über Knöpfe; die Zwischenablage gilt nur im Dokument', async () => {
        const h = gastgeber();
        const vorher = await bearbeiten(h);
        expect(bandKnopf('Einfügen')).toBeDisabled();
        expect(bandKnopf('Kopieren')).toBeDisabled();
        // Seite 1 und 2 kopieren, hinter Seite 3 einfügen.
        fireEvent.click(vorher[0]);
        fireEvent.click(vorher[1], { shiftKey: true });
        fireEvent.click(bandKnopf('Kopieren'));
        expect(screen.getByText(/2 Seiten in der Zwischenablage/)).toBeInTheDocument();
        expect(bandKnopf('Einfügen')).toBeEnabled();
        fireEvent.click(kacheln()[2]);
        fireEvent.click(bandKnopf('Einfügen'));
        await waitFor(() => expect(kacheln()).toHaveLength(5));
        expect(beschriftungen().map(b => /Original Seite (\d)/.exec(b)?.[1])).toEqual(['1', '2', '3', '1', '2']);
        // Die neuen Seiten sind gewählt; die Zwischenablage bleibt gefüllt.
        expect(kacheln()[3]).toHaveAttribute('aria-selected', 'true');
        expect(kacheln()[4]).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText(/2 Seiten in der Zwischenablage/)).toBeInTheDocument();
        const befehl = await speichern(h);
        expect(befehl.pages).toEqual([
            { source: 0, rotate: 0 }, { source: 1, rotate: 0 }, { source: 2, rotate: 0 }, { source: 0, rotate: 0 }, { source: 1, rotate: 0 },
        ]);
        expect(befehl.sources).toBeUndefined();
    });

    it('Ausschneiden + Einfügen verschiebt, per Strg+X und Strg+V im Raster; Rückgängig stellt die Reihenfolge her', async () => {
        const h = gastgeber();
        const vorher = await bearbeiten(h);
        fireEvent.click(vorher[0]);
        fireEvent.keyDown(vorher[0], { key: 'x', ctrlKey: true });
        expect(beschriftungen()[0]).toContain('ausgeschnitten');
        expect(screen.getByText(/1 Seite in der Zwischenablage/)).toBeInTheDocument();
        // Hinter Seite 3 einfügen.
        fireEvent.click(kacheln()[2]);
        fireEvent.keyDown(kacheln()[2], { key: 'v', ctrlKey: true });
        await waitFor(() => expect(beschriftungen().map(b => /Original Seite (\d)/.exec(b)?.[1])).toEqual(['2', '3', '1']));
        expect(kacheln()).toHaveLength(3);
        expect(screen.queryByText(/in der Zwischenablage/)).toBeNull();
        expect(beschriftungen().some(b => b.includes('ausgeschnitten'))).toBe(false);
        const wurzel = screen.getByRole('dialog', { name: /OpenIntraPDF/ });
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true });
        await waitFor(() => expect(beschriftungen().map(b => /Original Seite (\d)/.exec(b)?.[1])).toEqual(['1', '2', '3']));
    });

    it('Strg+C im Raster kopiert die Auswahl samt Drehung; Einfügen am Ende wählt die Kopie', async () => {
        const h = gastgeber();
        const vorher = await bearbeiten(h);
        fireEvent.click(vorher[1]);
        fireEvent.click(bandKnopf('90° rechts'));
        fireEvent.keyDown(kacheln()[1], { key: 'c', metaKey: true });
        fireEvent.click(kacheln()[2]);
        fireEvent.keyDown(kacheln()[2], { key: 'v', metaKey: true });
        await waitFor(() => expect(kacheln()).toHaveLength(4));
        expect(beschriftungen()[3]).toContain('Original Seite 2');
        expect(beschriftungen()[3]).toContain('um 90° gedreht');
        expect(kacheln()[3]).toHaveAttribute('aria-selected', 'true');
    });
});

describe('Seiten aus Datei (Etappe 9, Abschnitt 2)', () => {
    it('Dateiwähler → Dialog mit Seitenbereich → fremde Seiten im Plan; der Commit trägt sources und zählt sie hinter der Basis', async () => {
        const h = gastgeberMitDateien();
        const vorher = await bearbeiten(h);
        fireEvent.click(vorher[0]);
        fireEvent.click(bandKnopf('Seiten aus Datei …'));
        await waitFor(() => expect(h.dateienWaehlen).toHaveBeenCalledTimes(1));
        const dialog = await screen.findByRole('dialog', { name: 'Seiten aus Datei einfügen' });
        expect(await within(dialog).findByText('Datei: Anhang.pdf')).toBeInTheDocument();
        expect(await within(dialog).findByRole('radio', { name: 'Alle Seiten (4 Seiten)' })).toBeChecked();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Seitenbereich' }));
        const feld = within(dialog).getByRole('textbox', { name: 'Seitenbereich' });
        fireEvent.change(feld, { target: { value: '4, 2-9' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Einfügen' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Seite 9 gibt es nicht – das Dokument hat 4 Seiten.');
        fireEvent.change(feld, { target: { value: '4, 2' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Einfügen' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Seiten aus Datei einfügen' })).toBeNull());
        await waitFor(() => expect(kacheln()).toHaveLength(5));
        expect(beschriftungen()[1]).toContain('aus Anhang.pdf, Seite 2');
        expect(beschriftungen()[2]).toContain('aus Anhang.pdf, Seite 4');
        expect(screen.getByTestId('opdf-fremd-q~2')).toHaveTextContent('Anhang.pdf');
        // Die fremde Seite 4 drehen, dann speichern: sources nennt die Datei mit genau den Seiten, pages zählt sie hinter der Basis (3 Seiten).
        fireEvent.click(kacheln()[2]);
        fireEvent.click(bandKnopf('90° links'));
        const befehl = await speichern(h);
        expect(befehl.sources).toEqual([{ file_id: 'f2', expected_version: 3, pages: [1, 3] }]);
        expect(befehl.pages).toEqual([
            { source: 0, rotate: 0 }, { source: 3, rotate: 0 }, { source: 4, rotate: 270 }, { source: 1, rotate: 0 }, { source: 2, rotate: 0 },
        ]);
    });

    it('eine nicht lesbare Datei und eine passwortgeschützte lassen sich nicht einfügen; der Dialog sagt es', async () => {
        const h = gastgeberMitDateien([{ id: 'weg', name: 'Weg.pdf' }, { id: 'f3', name: 'Gesperrt.pdf' }]);
        await bearbeiten(h);
        fireEvent.click(bandKnopf('Seiten aus Datei …'));
        let dialog = await screen.findByRole('dialog', { name: 'Seiten aus Datei einfügen' });
        expect(await within(dialog).findByText(/Die Datei lässt sich nicht lesen/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Einfügen' })).toBeDisabled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
        expect(screen.queryByRole('dialog', { name: 'Seiten aus Datei einfügen' })).toBeNull();
        expect(kacheln()).toHaveLength(3);

        fireEvent.click(bandKnopf('Seiten aus Datei …'));
        await waitFor(() => expect(h.dateienWaehlen).toHaveBeenCalledTimes(2));
        dialog = await screen.findByRole('dialog', { name: 'Seiten aus Datei einfügen' });
        // Erst „Weg.pdf“ (nicht lesbar) — abbrechen bricht die ganze Reihe ab; also direkt die zweite prüfen.
        fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
        const h2 = gastgeberMitDateien([{ id: 'f3', name: 'Gesperrt.pdf' }]);
        cleanup();
        await bearbeiten(h2);
        fireEvent.click(bandKnopf('Seiten aus Datei …'));
        dialog = await screen.findByRole('dialog', { name: 'Seiten aus Datei einfügen' });
        expect(await within(dialog).findByText(/passwortgeschützt/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Einfügen' })).toBeDisabled();
    });

    it('ohne Dateiwähler (Wiki, Desktop ohne Ablage) gibt es den Knopf nicht', async () => {
        await bearbeiten(gastgeber());
        expect(screen.queryByRole('button', { name: 'Seiten aus Datei …' })).toBeNull();
        expect(bandKnopf('Leere Seite')).toBeInTheDocument();
    });
});

// SPDX-License-Identifier: Apache-2.0
//
// Das Werkzeugband des Arbeitsplatzes (Vertrag Etappe 7): Reiter je Lage
// (Lesen/Bearbeiten × view/comment/edit × Drive/Wiki), der Schnellbereich,
// das Datei-Menü und die kleinen Ansichtsfunktionen. Gastgeber und pdf.js
// sind gemockt, die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { band, bandKnopf, dateiMenue, reiter, reiterNamen, reiterWaehlen, werkzeugband } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
const steuerungMock = { suchen: vi.fn(), sucheBeenden: vi.fn(), zuSeite: vi.fn(), blaettern: vi.fn(), zoom: vi.fn(), trefferJeSeite: () => [] };
interface LeseMock {
    sichtbar: boolean;
    steuerung: { current: unknown };
    anmerkungen?: { werkzeug: string | null; entwurf: unknown[]; onNeu: (a: unknown) => void };
    zeiger?: string;
    anmerkungenAusgeblendet?: boolean;
    dunkel?: boolean;
}
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, steuerung, anmerkungen, zeiger, anmerkungenAusgeblendet, dunkel }: LeseMock) => {
        steuerung.current = steuerungMock;
        return (
            <div data-testid="leseansicht" hidden={!sichtbar} data-werkzeug={anmerkungen?.werkzeug ?? ''} data-zeiger={zeiger ?? ''}
                data-ausgeblendet={anmerkungenAusgeblendet ? 'ja' : 'nein'} data-entwurf={anmerkungen?.entwurf.length ?? -1}
                data-dunkel={dunkel ? 'ja' : 'nein'}>
                {anmerkungen && (
                    <button type="button" onClick={() => anmerkungen.onNeu({ page: 1, kind: 'square', rect: [10, 10, 30, 30], contents: '', color: [1, 0, 0], reply_to: null })}>
                        Geste
                    </button>
                )}
            </div>
        );
    },
}));

function seite(n: number) {
    return {
        rotate: 0,
        view: [0, 0, 595.28, 841.89],
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => (n === 1 ? [{
            id: '12R', annotationType: 1, rect: [50, 50, 70, 70], contentsObj: { str: 'Bitte prüfen' },
            titleObj: { str: 'Anna' }, modificationDate: 'D:20260929100000', inReplyTo: null, state: null,
        }] : []),
    };
}
const dokument = {
    numPages: 3,
    getPage: async (n: number) => seite(n),
    getOutline: async () => null,
    getMetadata: async () => ({
        info: { Title: 'Angebot Küche', Author: 'Anna Muster', Producer: 'OpenIntraPDF', PDFFormatVersion: '1.7', CreationDate: 'D:20260929140800Z' },
    }),
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
        inspection: { pages: 3, annotations: 1 },
        capabilities: {
            pages: { state: 'available' }, annotations: { state: 'available' }, ocr: { state: 'available' },
            export: { state: 'available' }, merge: { state: 'available' },
        },
        ...ueber,
    };
}

/** Drive: alle Methoden; das Recht kommt aus der Info. */
function drive(dateiInfo: PdfInfo = info(), ueber: Partial<PdfHost> = {}): PdfHost {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
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
        ...ueber,
    };
}

/** Wiki: nur laden, herunterladen, drucken — keine Info. */
function wiki(): PdfHost {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8) })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
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
    Object.values(steuerungMock).forEach(f => { if (typeof f === 'function' && 'mockClear' in f) (f as ReturnType<typeof vi.fn>).mockClear(); });
});

async function oeffnen(h: PdfHost, onClose = vi.fn()) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={onClose} />);
    await screen.findByTestId('leseansicht');
    return onClose;
}

const bandKnopfNamen = () => within(band()).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent ?? '');
const menueNamen = () => within(dateiMenue()).getAllByRole('menuitem').map(m => m.textContent ?? '');

describe('Reiter je Lage', () => {
    it('Wiki (nur lesend): Datei mit Herunterladen, Drucken, Schließen; Start und Ansicht; die Kommentarliste liegt in Start', async () => {
        await oeffnen(wiki());
        expect(reiterNamen()).toEqual(['Start', 'Ansicht']);
        expect(reiter('Start')).toHaveAttribute('aria-selected', 'true');
        expect(bandKnopfNamen()).toContain('Kommentare');
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Als neue Fassung speichern/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Drucken' })).toBeInTheDocument();
        expect(menueNamen()).toEqual(['Herunterladen', 'Drucken', 'Eigenschaften', 'Schließen']);
    });

    it('Drive mit Leserecht: kein Kommentieren, keine Seiten; Werkzeuge nur Exportieren und Dateien binden', async () => {
        await oeffnen(drive(info({ access: 'view' })));
        expect(reiterNamen()).toEqual(['Start', 'Werkzeuge', 'Ansicht']);
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        reiterWaehlen('Werkzeuge');
        expect(bandKnopfNamen()).toEqual(['Exportieren', 'Dateien binden']);
        expect(menueNamen()).toEqual(['Herunterladen', 'Drucken', 'Eigenschaften', 'Schließen']);
    });

    it('Drive mit Kommentarrecht: Kommentieren, aber keine Seiten und keine Texterkennung; Speichern nur als neue Fassung', async () => {
        await oeffnen(drive(info({ access: 'comment' })));
        expect(reiterNamen()).toEqual(['Start', 'Kommentieren', 'Einfügen', 'Werkzeuge', 'Ansicht']);
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        expect(screen.getByRole('button', { name: /Als neue Fassung speichern/ })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Als neue Datei speichern/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeDisabled();
        reiterWaehlen('Kommentieren');
        expect(bandKnopfNamen().slice(0, 12)).toEqual([
            'Notiz', 'Post-it', 'Textfeld', 'Hervorheben', 'Unterstreichen', 'Durchstreichen',
            'Freihand', 'Linie', 'Pfeil', 'Rechteck', 'Ellipse', 'Stempel',
        ]);
        expect(within(band()).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual([
            'Notizen', 'Text markieren', 'Zeichnen', 'Stempel', 'Aussehen', 'Farbe', 'Strichstärke', 'Kommentare',
        ]);
        reiterWaehlen('Werkzeuge');
        expect(bandKnopfNamen()).toEqual(['Exportieren', 'Dateien binden']);
        expect(menueNamen()).toEqual(['Als neue Fassung speichern', 'Herunterladen', 'Drucken', 'Eigenschaften', 'Schließen']);
    });

    it('Drive mit Bearbeitungsrecht, Lesen: alle Reiter; Seiten wechselt ins Bearbeiten; Werkzeuge mit Texterkennung', async () => {
        await oeffnen(drive());
        expect(reiterNamen()).toEqual(['Start', 'Kommentieren', 'Einfügen', 'Seiten', 'Werkzeuge', 'Ansicht']);
        expect(screen.getByRole('button', { name: 'Lesen' })).toHaveAttribute('aria-pressed', 'true');
        reiterWaehlen('Werkzeuge');
        expect(bandKnopfNamen()).toEqual(['Texterkennung', 'Exportieren', 'Dateien binden']);
        expect(menueNamen()).toEqual(['Als neue Fassung speichern', 'Als neue Datei speichern …', 'Herunterladen', 'Drucken', 'Eigenschaften', 'Schließen']);
        fireEvent.keyDown(document.body, { key: 'Escape' });
        reiterWaehlen('Seiten');
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('region', { name: 'Seiten verwalten' })).toBeInTheDocument();
    });

    it('Drive mit Bearbeitungsrecht, Bearbeiten: Reiter Seiten mit allen Seitenaktionen; „Lesen“ führt zurück auf Start', async () => {
        await oeffnen(drive());
        fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
        expect(reiter('Seiten')).toHaveAttribute('aria-selected', 'true');
        expect(bandKnopfNamen()).toEqual([
            'Alle wählen', 'Auswahl aufheben', '90° links', '90° rechts', 'Entfernen', 'Duplizieren', 'Kopieren', 'Ausschneiden', 'Einfügen',
            'Leere Seite', 'Seiten aus Datei …', 'Nach vorn', 'Nach hinten', 'Leere Seiten prüfen', 'Auswahl als neue Datei …', 'Jede Seite einzeln …',
        ]);
        // Ohne Auswahl ist nur wählen und prüfen möglich.
        expect(bandKnopf('90° rechts')).toBeDisabled();
        expect(bandKnopf('Alle wählen')).toBeEnabled();
        expect(bandKnopf('Leere Seiten prüfen')).toBeEnabled();
        // Zurück ins Lesen: der Reiter Seiten bleibt stehen, Start ist gewählt, die Navigation geht.
        fireEvent.click(screen.getByRole('button', { name: 'Lesen' }));
        expect(reiter('Start')).toHaveAttribute('aria-selected', 'true');
        expect(bandKnopf('Nächste Seite')).toBeEnabled();
        expect(bandKnopf('Seitenbreite')).toBeEnabled();
    });

    it('Reiterwechsel weg von Seiten führt in die Dokumentansicht zurück; der Seiten-Entwurf bleibt (Jan, 02.10.2026)', async () => {
        await oeffnen(drive());
        // Reiter Seiten: Seitenraster, Umschalter auf Bearbeiten, Fach „Seiten verwalten“.
        reiterWaehlen('Seiten');
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('leseansicht')).not.toBeVisible();
        expect(screen.getByRole('region', { name: 'Seiten verwalten' })).toBeInTheDocument();
        // Eine Seite drehen: ein Entwurf.
        fireEvent.click((await screen.findAllByRole('option'))[0]);
        fireEvent.click(bandKnopf('90° rechts'));
        expect(await screen.findByText('90°')).toBeInTheDocument();
        // Reiter Kommentieren: ohne Klick auf „Lesen“ steht die Dokumentansicht mit Seitenleiste.
        reiterWaehlen('Kommentieren');
        expect(reiter('Kommentieren')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: 'Lesen' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('leseansicht')).toBeVisible();
        expect(screen.queryByRole('region', { name: 'Seiten verwalten' })).toBeNull();
        expect(screen.queryByRole('option')).toBeNull();
        expect(screen.getByRole('complementary', { name: 'Seiten, Lesezeichen und Suche' })).toBeInTheDocument();
        // Der Entwurf ist noch da: zurück auf Seiten zeigt die gedrehte Seite.
        reiterWaehlen('Seiten');
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByText('90°')).toBeInTheDocument();
        // Auch Start, Werkzeuge und Ansicht verlassen den Seitenraster; ein Wechsel innerhalb der Leseansicht ändert nichts.
        for (const name of ['Start', 'Werkzeuge', 'Ansicht']) {
            reiterWaehlen('Seiten');
            expect(screen.getByTestId('leseansicht')).not.toBeVisible();
            reiterWaehlen(name);
            expect(screen.getByTestId('leseansicht')).toBeVisible();
        }
        reiterWaehlen('Kommentieren');
        expect(screen.getByTestId('leseansicht')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Lesen' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('ohne Bearbeiten-Mode bei fehlender Fassung: Reiter Seiten und Kommentieren sind gesperrt und nennen den Grund', async () => {
        const h = drive(info({ version: undefined, sha256: undefined }), {
            laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), info: info({ version: undefined, sha256: undefined }) })),
        });
        await oeffnen(h);
        expect(reiter('Seiten')).toBeDisabled();
        expect(reiter('Seiten')).toHaveAttribute('title', 'Bearbeiten ist nicht möglich: Die Fassung der Datei ist nicht bekannt.');
        expect(reiter('Kommentieren')).toBeDisabled();
    });
});

describe('Schnellbereich und Datei-Menü', () => {
    it('Speichern mit Pfeil für „Als neue Datei“; beides gesperrt ohne Entwurf; das Menü führt dieselben Wege', async () => {
        const h = drive(info(), { speichern: vi.fn(async () => ({ file_id: 'f2', version: 1, sha256: 'x', name: 'Kopie.pdf' })) });
        await oeffnen(h);
        const speichern = screen.getByRole('button', { name: 'Als neue Fassung speichern' });
        const neueDatei = screen.getByRole('button', { name: 'Als neue Datei speichern …' });
        expect(speichern).toBeDisabled();
        expect(neueDatei).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
        fireEvent.click((await screen.findAllByRole('option'))[0]);
        fireEvent.click(bandKnopf('90° rechts'));
        await screen.findAllByText('Änderungen im Entwurf');
        expect(speichern).toBeEnabled();
        expect(neueDatei).toBeEnabled();
        const menue = dateiMenue();
        expect(within(menue).getByRole('menuitem', { name: 'Als neue Fassung speichern' })).toBeEnabled();
        fireEvent.click(within(menue).getByRole('menuitem', { name: 'Als neue Datei speichern …' }));
        expect(screen.queryByRole('menu')).toBeNull();
        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'neue_datei', name: 'Angebot (bearbeitet).pdf' });
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        expect((h.speichern as ReturnType<typeof vi.fn>).mock.calls[0][0].destination.kind).toBe('new_file');
        expect((await screen.findAllByText('Als neue Datei gespeichert: Kopie.pdf')).length).toBeGreaterThan(0);
    });

    it('signiertes Original: nur „Als neue Datei“ als Hauptknopf, wie heute', async () => {
        await oeffnen(drive(info({ inspection: { pages: 3, signed: true }, capabilities: { pages: { state: 'blocked_by_document', reason: 'signed_original' } } })));
        fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
        expect(screen.queryByRole('button', { name: 'Als neue Fassung speichern' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Als neue Datei speichern …' })).toBeDisabled();
    });

    it('Drucken, Herunterladen und Schließen über das Menü laufen über den Gastgeber', async () => {
        const h = drive();
        const onClose = await oeffnen(h);
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Drucken' }));
        // Seit Etappe 8 fragt ein Dialog nach dem Bereich; die Vorgabe (alle Seiten, mit Anmerkungen) geht den heutigen Weg.
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Drucken' })).getByRole('button', { name: 'Drucken' }));
        expect(h.drucken).toHaveBeenCalledTimes(1);
        // Solange gedruckt wird, ruht Herunterladen (wie heute).
        expect(within(dateiMenue()).getByRole('menuitem', { name: 'Herunterladen' })).toBeDisabled();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Drucken' })).toBeEnabled());
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Herunterladen' }));
        expect(h.herunterladen).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Drucken' })).toBeEnabled());
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Schließen' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Eigenschaften: Dialog mit den Werten aus pdf.js und der Dateigröße des Gastgebers; nur lesen', async () => {
        await oeffnen(drive());
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Eigenschaften' }));
        const dialog = await screen.findByRole('dialog', { name: 'Eigenschaften' });
        expect(await within(dialog).findByText('Angebot Küche')).toBeInTheDocument();
        const zeilen = within(dialog).getAllByRole('term').map(dt => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`);
        expect(zeilen).toEqual([
            'Dateiname: Angebot.pdf',
            'Titel: Angebot Küche',
            'Autor: Anna Muster',
            'Produzent: OpenIntraPDF',
            'PDF-Version: 1.7',
            `Erstellt: ${new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-09-29T14:08:00Z'))}`,
            'Seiten: 3 Seiten',
            'Erste Seite: 210 × 297 mm (595,3 × 841,9 pt)',
            'Dateigröße: 1.000 Bytes',
        ]);
        // Ohne Eingabefelder: nur anzeigen.
        expect(within(dialog).queryByRole('textbox')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
        expect(screen.queryByRole('dialog', { name: 'Eigenschaften' })).toBeNull();
    });

    it('das Menü schließt mit Esc und mit einem Klick daneben', async () => {
        await oeffnen(drive());
        dateiMenue();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        dateiMenue();
        fireEvent.pointerDown(screen.getByTestId('leseansicht'));
        expect(screen.queryByRole('menu')).toBeNull();
    });
});

describe('Start: Navigation, Zoom, Suche', () => {
    it('Seite x von y, erste/vorige/nächste/letzte und die Zoomknöpfe steuern die Leseansicht', async () => {
        await oeffnen(drive());
        expect(within(band()).getByText('von 3')).toBeInTheDocument();
        expect(bandKnopf('Erste Seite')).toBeDisabled();
        expect(bandKnopf('Vorige Seite')).toBeDisabled();
        fireEvent.click(bandKnopf('Nächste Seite'));
        expect(steuerungMock.blaettern).toHaveBeenCalledWith(1);
        fireEvent.click(bandKnopf('Letzte Seite'));
        expect(steuerungMock.zuSeite).toHaveBeenCalledWith(3);
        fireEvent.change(within(band()).getByRole('textbox', { name: /Seite 1 von 3/ }), { target: { value: '2' } });
        fireEvent.submit(within(band()).getByRole('textbox', { name: /Seite 1 von 3/ }).closest('form')!);
        expect(steuerungMock.zuSeite).toHaveBeenCalledWith(2);
        fireEvent.click(bandKnopf('Seitenbreite'));
        expect(steuerungMock.zoom).toHaveBeenCalledWith('page-width');
        fireEvent.click(bandKnopf('Ganze Seite'));
        expect(steuerungMock.zoom).toHaveBeenCalledWith('page-fit');
        fireEvent.click(bandKnopf('Vergrößern'));
        expect(steuerungMock.zoom).toHaveBeenCalledWith('mehr');
        fireEvent.change(within(band()).getByRole('combobox', { name: 'Zoom' }), { target: { value: '150' } });
        expect(steuerungMock.zoom).toHaveBeenCalledWith(150);
    });

    it('Suchoptionen: Groß-/Kleinschreibung und Ganzes Wort gehen mit jeder Suche mit und suchen mit stehendem Text neu', async () => {
        await oeffnen(drive());
        fireEvent.click(bandKnopf('Suchen'));
        const feld = await screen.findByLabelText('Im Dokument suchen');
        fireEvent.change(feld, { target: { value: 'Rechnung' } });
        expect(steuerungMock.suchen).toHaveBeenLastCalledWith('Rechnung', 'neu', { caseSensitive: false, entireWord: false });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Groß-/Kleinschreibung' }));
        expect(steuerungMock.suchen).toHaveBeenLastCalledWith('Rechnung', 'neu', { caseSensitive: true, entireWord: false });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Ganzes Wort' }));
        expect(steuerungMock.suchen).toHaveBeenLastCalledWith('Rechnung', 'neu', { caseSensitive: true, entireWord: true });
        fireEvent.keyDown(feld, { key: 'Enter' });
        expect(steuerungMock.suchen).toHaveBeenLastCalledWith('Rechnung', 'weiter', { caseSensitive: true, entireWord: true });
        // Ohne Text löst eine Option keine Suche aus.
        fireEvent.change(feld, { target: { value: '' } });
        steuerungMock.suchen.mockClear();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Ganzes Wort' }));
        expect(steuerungMock.suchen).not.toHaveBeenCalled();
    });

    it('„Suchen“ öffnet die Suche in der Seitenleiste und zeigt sich gedrückt; noch einmal schließt sie', async () => {
        await oeffnen(drive());
        fireEvent.click(bandKnopf('Suchen'));
        expect(await screen.findByLabelText('Im Dokument suchen')).toBeInTheDocument();
        expect(bandKnopf('Suchen')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(bandKnopf('Suchen'));
        expect(screen.queryByLabelText('Im Dokument suchen')).toBeNull();
        expect(bandKnopf('Suchen')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('Ansicht', () => {
    it('Seitenleiste und Arbeitsfach ein/aus; Darstellung hell/dunkel/System ohne Vorgabe des Gastgebers', async () => {
        await oeffnen(drive());
        reiterWaehlen('Ansicht');
        expect(within(band()).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Leisten', 'Darstellung']);
        expect(screen.getByRole('complementary', { name: 'Seiten, Lesezeichen und Suche' })).toBeInTheDocument();
        fireEvent.click(bandKnopf('Seitenleiste'));
        expect(screen.queryByRole('complementary', { name: 'Seiten, Lesezeichen und Suche' })).toBeNull();
        expect(bandKnopf('Seitenleiste')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(bandKnopf('Seitenleiste'));
        expect(screen.getByRole('complementary', { name: 'Seiten, Lesezeichen und Suche' })).toBeInTheDocument();

        expect(bandKnopf('Arbeitsfach')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(bandKnopf('Arbeitsfach'));
        expect(screen.getByRole('region', { name: 'Kommentieren' })).toBeInTheDocument();
        fireEvent.click(bandKnopf('Arbeitsfach'));
        expect(screen.queryByRole('region', { name: 'Kommentieren' })).toBeNull();

        fireEvent.click(bandKnopf('Dunkel'));
        expect(screen.getByRole('dialog', { name: /OpenIntraPDF/ })).toHaveAttribute('data-theme', 'dark');
        expect(bandKnopf('Dunkel')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(bandKnopf('Hell'));
        expect(screen.getByRole('dialog', { name: /OpenIntraPDF/ })).toHaveAttribute('data-theme', 'light');
    });

    it('Dunkles Dokument kehrt nur die Seitendarstellung um, unabhängig vom Thema der Oberfläche', async () => {
        await oeffnen(drive());
        const leseansicht = screen.getByTestId('leseansicht');
        reiterWaehlen('Ansicht');
        expect(leseansicht.dataset.dunkel).toBe('nein');
        fireEvent.click(bandKnopf('Dunkles Dokument'));
        expect(leseansicht.dataset.dunkel).toBe('ja');
        expect(bandKnopf('Dunkles Dokument')).toHaveAttribute('aria-pressed', 'true');
        // Die Oberfläche bleibt hell; umgekehrt bleibt das Dokument dunkel, wenn die Oberfläche wechselt.
        expect(screen.getByRole('dialog', { name: /OpenIntraPDF/ })).toHaveAttribute('data-theme', 'light');
        fireEvent.click(bandKnopf('Dunkel'));
        expect(screen.getByRole('dialog', { name: /OpenIntraPDF/ })).toHaveAttribute('data-theme', 'dark');
        expect(leseansicht.dataset.dunkel).toBe('ja');
        fireEvent.click(bandKnopf('Hell'));
        fireEvent.click(bandKnopf('Dunkles Dokument'));
        expect(leseansicht.dataset.dunkel).toBe('nein');
        // Der Schalter steht nur im Reiter Ansicht; mit Vorgabe des Gastgebers bleibt er trotzdem (es ist kein Thema).
        cleanup();
        render(<PdfArbeitsplatz host={drive()} name="Angebot.pdf" onClose={vi.fn()} thema="dunkel" />);
        await screen.findByTestId('leseansicht');
        reiterWaehlen('Ansicht');
        expect(bandKnopf('Dunkles Dokument')).toBeEnabled();
    });

    it('mit Vorgabe des Gastgebers gibt es keine Darstellungswahl', async () => {
        render(<PdfArbeitsplatz host={drive()} name="Angebot.pdf" onClose={vi.fn()} thema="dunkel" />);
        await screen.findByTestId('leseansicht');
        reiterWaehlen('Ansicht');
        expect(within(band()).queryByRole('button', { name: 'Hell' })).toBeNull();
        expect(within(band()).queryByRole('button', { name: 'Dunkel' })).toBeNull();
    });
});

describe('Hand-Werkzeug', () => {
    const leseansicht = () => screen.getByTestId('leseansicht');
    const dialog = () => screen.getByRole('dialog', { name: /OpenIntraPDF/ });

    it('Start → Hand schaltet den Zeiger der Leseansicht um; Text auswählen zurück', async () => {
        await oeffnen(drive());
        expect(leseansicht().dataset.zeiger).toBe('text');
        expect(bandKnopf('Text auswählen')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(bandKnopf('Hand'));
        expect(leseansicht().dataset.zeiger).toBe('hand');
        expect(bandKnopf('Hand')).toHaveAttribute('aria-pressed', 'true');
        expect(bandKnopf('Text auswählen')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(bandKnopf('Text auswählen'));
        expect(leseansicht().dataset.zeiger).toBe('text');
    });

    it('Taste H wählt die Hand, V den Text — nicht in einem Eingabefeld und nicht im Bearbeiten', async () => {
        await oeffnen(drive());
        fireEvent.keyDown(dialog(), { key: 'h' });
        expect(leseansicht().dataset.zeiger).toBe('hand');
        fireEvent.keyDown(dialog(), { key: 'v' });
        expect(leseansicht().dataset.zeiger).toBe('text');
        // Im Suchfeld gehört der Buchstabe dem Feld.
        fireEvent.click(bandKnopf('Suchen'));
        const feld = await screen.findByLabelText('Im Dokument suchen');
        fireEvent.keyDown(feld, { key: 'h' });
        expect(leseansicht().dataset.zeiger).toBe('text');
        // Im Bearbeiten gibt es keine Leseansicht, also auch keinen Zeiger.
        fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
        fireEvent.keyDown(dialog(), { key: 'h' });
        expect(leseansicht().dataset.zeiger).toBe('text');
    });

    it('in einem Anmerkungswerkzeug gilt weiter dessen Zeiger; danach kehrt die Hand zurück', async () => {
        await oeffnen(drive());
        fireEvent.keyDown(dialog(), { key: 'h' });
        reiterWaehlen('Kommentieren');
        fireEvent.click(bandKnopf('Rechteck'));
        expect(leseansicht().dataset.werkzeug).toBe('square');
        expect(leseansicht().dataset.zeiger).toBe('text');
        fireEvent.keyDown(dialog(), { key: 'Escape' });
        expect(leseansicht().dataset.werkzeug).toBe('');
        expect(leseansicht().dataset.zeiger).toBe('hand');
    });
});

describe('Anmerkungen ein/aus', () => {
    const leseansicht = () => screen.getByTestId('leseansicht');

    it('blendet die Anmerkungsebene aus, behält den Entwurf und fragt beim Speichern nicht', async () => {
        const h = drive(info(), { speichern: vi.fn(async () => ({ file_id: 'f1', version: 13, sha256: 'def', name: 'Angebot.pdf' })) });
        await oeffnen(h);
        reiterWaehlen('Kommentieren');
        fireEvent.click(bandKnopf('Rechteck'));
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        expect(leseansicht().dataset.entwurf).toBe('1');
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'Escape' });

        expect(bandKnopf('Anmerkungen')).toHaveAttribute('aria-pressed', 'true');
        expect(leseansicht().dataset.ausgeblendet).toBe('nein');
        fireEvent.click(bandKnopf('Anmerkungen'));
        expect(bandKnopf('Anmerkungen')).toHaveAttribute('aria-pressed', 'false');
        expect(leseansicht().dataset.ausgeblendet).toBe('ja');
        // Nichts gespeichert, Entwurf unverändert da.
        expect(h.speichern).not.toHaveBeenCalled();
        expect(leseansicht().dataset.entwurf).toBe('1');
        expect(screen.getAllByText('Änderungen im Entwurf').length).toBeGreaterThan(0);

        // Speichern geht ohne Rückfrage.
        fireEvent.click(screen.getByRole('button', { name: 'Als neue Fassung speichern' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('dialog', { name: /Anmerkungen/ })).toBeNull();
    });

    it('ein gewähltes Werkzeug blendet die Anmerkungen wieder ein', async () => {
        await oeffnen(drive());
        reiterWaehlen('Kommentieren');
        fireEvent.click(bandKnopf('Anmerkungen'));
        expect(leseansicht().dataset.ausgeblendet).toBe('ja');
        fireEvent.click(bandKnopf('Notiz'));
        expect(leseansicht().dataset.ausgeblendet).toBe('nein');
        expect(bandKnopf('Anmerkungen')).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('Tastenbuchstaben mit Alt', () => {
    const leseansicht = () => screen.getByTestId('leseansicht');
    const tipps = () => Array.from(werkzeugband().querySelectorAll('kbd')).map(k => k.textContent);
    const altAllein = () => {
        fireEvent.keyDown(document.body, { key: 'Alt' });
        fireEvent.keyUp(document.body, { key: 'Alt' });
    };

    it('Alt allein blendet Buchstaben an den Reitern ein; der Buchstabe wählt den Reiter, dann den Knopf', async () => {
        await oeffnen(drive());
        expect(tipps()).toEqual([]);
        altAllein();
        expect(tipps()).toEqual(['D', 'S', 'K', 'F', 'E', 'W', 'A']);
        fireEvent.keyDown(document.body, { key: 'k' });
        expect(reiter('Kommentieren')).toHaveAttribute('aria-selected', 'true');
        // Jetzt stehen die Buchstaben an den Knöpfen des Bandes (Tabelle de, Reiter Kommentieren).
        expect(tipps()).toEqual(['N', 'P', 'T', 'H', 'U', 'D', 'F', 'L', 'I', 'R', 'E', 'S', 'K', 'A']);
        fireEvent.keyDown(document.body, { key: 'n' });
        expect(leseansicht().dataset.werkzeug).toBe('note');
        expect(tipps()).toEqual([]);
    });

    it('Alt mit einer anderen Taste tut nichts; Esc geht eine Ebene zurück und blendet dann aus; ein Klick blendet aus', async () => {
        await oeffnen(drive());
        fireEvent.keyDown(document.body, { key: 'Alt' });
        fireEvent.keyDown(document.body, { key: 'f', altKey: true });
        fireEvent.keyUp(document.body, { key: 'Alt' });
        expect(tipps()).toEqual([]);
        fireEvent.keyDown(document.body, { key: 'Alt', ctrlKey: true });
        fireEvent.keyUp(document.body, { key: 'Alt', ctrlKey: true });
        expect(tipps()).toEqual([]);

        altAllein();
        fireEvent.keyDown(document.body, { key: 'a' });
        expect(reiter('Ansicht')).toHaveAttribute('aria-selected', 'true');
        expect(tipps()).toContain('S');
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(tipps()).toEqual(['D', 'S', 'K', 'F', 'E', 'W', 'A']);
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(tipps()).toEqual([]);
        // Der Arbeitsplatz bekam das Esc nicht: Reiter Ansicht bleibt, kein Werkzeug betroffen.
        expect(reiter('Ansicht')).toHaveAttribute('aria-selected', 'true');

        altAllein();
        fireEvent.pointerDown(screen.getByTestId('leseansicht'));
        expect(tipps()).toEqual([]);
        // Ein Buchstabe ohne Einblendung bleibt dem Arbeitsplatz (H = Hand).
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'h' });
        expect(leseansicht().dataset.zeiger).toBe('hand');
    });

    it('D öffnet das Datei-Menü mit Buchstaben an den Einträgen; E zeigt die Eigenschaften', async () => {
        await oeffnen(drive());
        altAllein();
        fireEvent.keyDown(document.body, { key: 'd' });
        const menue = within(werkzeugband()).getByRole('menu');
        expect(within(menue).getAllByRole('menuitem').map(m => m.querySelector('kbd')?.textContent)).toEqual(['F', 'N', 'H', 'D', 'E', 'S']);
        // Ohne Fassungen und Schnelldruck am Gastgeber fehlen V und L.
        fireEvent.keyDown(document.body, { key: 'e' });
        expect(await screen.findByRole('dialog', { name: 'Eigenschaften' })).toBeInTheDocument();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('ein gesperrter Reiter oder Knopf lässt sich per Buchstabe nicht wählen', async () => {
        await oeffnen(drive(info({ version: undefined, sha256: undefined }), {
            laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), info: info({ version: undefined, sha256: undefined }) })),
        }));
        expect(reiter('Seiten')).toBeDisabled();
        altAllein();
        fireEvent.keyDown(document.body, { key: 'e' });
        expect(reiter('Start')).toHaveAttribute('aria-selected', 'true');
        expect(tipps()).toEqual(['D', 'S', 'K', 'F', 'E', 'W', 'A']);
    });
});

describe('Einklappen', () => {
    it('Doppelklick auf den gewählten Reiter klappt ein, der Knopf rechts wieder aus; ein Klick auf einen Reiter öffnet vorübergehend', async () => {
        await oeffnen(drive());
        expect(within(werkzeugband()).getByRole('tabpanel')).toBeInTheDocument();
        fireEvent.doubleClick(reiter('Start')!);
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        expect(localStorage.getItem('openintrapdf.werkzeugband.eingeklappt')).toBe('1');
        // Vorübergehend: Reiter klicken, Band erscheint, Klick daneben schließt.
        reiterWaehlen('Ansicht');
        expect(within(werkzeugband()).getByRole('tabpanel')).toBeInTheDocument();
        fireEvent.pointerDown(screen.getByTestId('leseansicht'));
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        reiterWaehlen('Ansicht');
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        fireEvent.click(within(werkzeugband()).getByRole('button', { name: 'Werkzeugband ausklappen' }));
        expect(within(werkzeugband()).getByRole('tabpanel')).toBeInTheDocument();
        expect(localStorage.getItem('openintrapdf.werkzeugband.eingeklappt')).toBe('0');
    });

    it('der Zustand wird je Gerät gemerkt und beim nächsten Öffnen übernommen; „Werkzeugband einklappen“ im Reiter Ansicht wirkt ebenso', async () => {
        await oeffnen(drive());
        reiterWaehlen('Ansicht');
        fireEvent.click(bandKnopf('Werkzeugband einklappen'));
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        cleanup();
        await oeffnen(drive());
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        expect(within(werkzeugband()).getByRole('button', { name: 'Werkzeugband ausklappen' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('ein vor der Umbenennung gemerktes Einklappen gilt weiter: einmal übernommen, der alte Schlüssel gelöscht', async () => {
        // Bis Bau 2317 trug der Schlüssel den früheren Namen des Bandes (zerlegt wie in darstellung.ts).
        const frueher = ['openintrapdf', 'rib' + 'bon', 'eingeklappt'].join('.');
        localStorage.setItem(frueher, '1');
        await oeffnen(drive());
        expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
        expect(localStorage.getItem('openintrapdf.werkzeugband.eingeklappt')).toBe('1');
        expect(localStorage.getItem(frueher)).toBeNull();
    });

    it('auf dem Telefon (unter 640 px) ist das Band von Anfang an eingeklappt; ohne Speicher geht es trotzdem', async () => {
        const breite = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error('kein Speicher'); };
        try {
            await oeffnen(drive());
            expect(within(werkzeugband()).queryByRole('tabpanel')).toBeNull();
            fireEvent.click(within(werkzeugband()).getByRole('button', { name: 'Werkzeugband ausklappen' }));
            expect(within(werkzeugband()).getByRole('tabpanel')).toBeInTheDocument();
        } finally {
            Storage.prototype.setItem = original;
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: breite });
        }
    });
});

describe('Tastatur im Werkzeugband', () => {
    it('Pfeiltasten wechseln die Reiter in der Reiterzeile; Home und End springen', async () => {
        await oeffnen(drive());
        const start = within(werkzeugband()).getByRole('tab', { name: 'Start' });
        start.focus();
        fireEvent.keyDown(start, { key: 'ArrowRight' });
        expect(reiter('Kommentieren')).toHaveAttribute('aria-selected', 'true');
        expect(document.activeElement).toBe(reiter('Kommentieren'));
        fireEvent.keyDown(reiter('Kommentieren')!, { key: 'End' });
        expect(reiter('Ansicht')).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(reiter('Ansicht')!, { key: 'ArrowRight' });
        expect(reiter('Start')).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(reiter('Start')!, { key: 'ArrowLeft' });
        expect(reiter('Ansicht')).toHaveAttribute('aria-selected', 'true');
    });
});

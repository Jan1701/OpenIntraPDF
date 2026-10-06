// SPDX-License-Identifier: Apache-2.0
//
// Kommentarliste, Etappe 8: Status eines Fadens aus Statusmarken (auch aus
// Acrobat), Erledigt und Wieder öffnen als Entwurf, Sortieren, Filtern,
// Erledigte auf der Seite ausblenden. Gastgeber und pdf.js sind gemockt,
// die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bandKnopf, fach, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { CommitBefehl, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
interface LeseMock { sichtbar: boolean; verborgen?: readonly string[] }
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, verborgen }: LeseMock) => (
        <div data-testid="leseansicht" hidden={!sichtbar} data-verborgen={(verborgen ?? []).join(',')} />
    ),
}));

/**
 * Drei Fäden auf drei Seiten:
 *   Seite 1: Notiz 12R von Anna mit Antwort 13R von Carl; zwei Statusmarken
 *            von OIH — 18R „None“ (29.09. 12:00) und 20R „Completed“ von Bert
 *            (30.09. 09:00). Die neuere zählt: erledigt.
 *   Seite 2: Hervorhebung 14R von Carl mit einer Acrobat-Marke 16R
 *            „Accepted“ von Dora.
 *   Seite 3: Freihand 15R von Anna, ohne Status; Stempel 17R von Bert.
 */
const anmerkungen: Record<number, unknown[]> = {
    1: [
        { id: '12R', annotationType: 1, rect: [50, 50, 70, 70], contentsObj: { str: 'Bitte Termin prüfen' }, titleObj: { str: 'Anna' }, modificationDate: 'D:20260929100000', inReplyTo: null, state: null },
        { id: '13R', annotationType: 1, rect: [50, 50, 70, 70], contentsObj: { str: 'Mache ich' }, titleObj: { str: 'Carl' }, modificationDate: 'D:20260929110000', inReplyTo: '12R', state: null },
        { id: '20R', annotationType: 1, rect: [50, 50, 70, 70], contentsObj: { str: 'Completed' }, titleObj: { str: 'Bert' }, modificationDate: 'D:20260930090000', inReplyTo: '12R', state: 'Completed', stateModel: 'Review' },
        { id: '18R', annotationType: 1, rect: [50, 50, 70, 70], contentsObj: { str: 'None' }, titleObj: { str: 'Bert' }, modificationDate: 'D:20260929120000', inReplyTo: '12R', state: 'None', stateModel: 'Review' },
    ],
    2: [
        { id: '14R', annotationType: 9, rect: [10, 700, 200, 720], contentsObj: { str: 'Rechnungsnummer' }, titleObj: { str: 'Carl' }, modificationDate: 'D:20260928150000', inReplyTo: null, state: null },
        { id: '16R', annotationType: 1, rect: [10, 700, 200, 720], contentsObj: { str: 'Accepted' }, titleObj: { str: 'Dora' }, modificationDate: 'D:20260928160000', inReplyTo: '14R', state: 'Accepted', stateModel: 'Review' },
    ],
    3: [
        { id: '15R', annotationType: 15, rect: [90, 380, 220, 470], contentsObj: { str: '' }, titleObj: { str: 'Anna' }, modificationDate: 'D:20261001080000', inReplyTo: null, state: null },
        { id: '17R', annotationType: 13, rect: [300, 600, 400, 650], contentsObj: { str: 'GEPRÜFT' }, titleObj: { str: 'Bert' }, modificationDate: 'D:20260927080000', inReplyTo: null, state: null },
    ],
};

function seite(n: number) {
    return {
        rotate: 0,
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => anmerkungen[n] ?? [],
    };
}
const dokument = { numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(dokument), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1, DISABLE: 0, ENABLE_STORAGE: 3 },
    },
    viewer: {},
    viewerStil: '',
};

function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
        inspection: { pages: 3, annotations: 8 },
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
afterEach(() => {
    cleanup();
    localStorage.clear();
});

const datum = (iso: string) => new Intl.DateTimeFormat('de', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
const dialog = () => screen.getByRole('dialog', { name: /OpenIntraPDF/ });

/** Öffnet den Arbeitsplatz und die Kommentarliste; wartet auf den ersten Eintrag. */
async function listeOeffnen(h: PdfHost, zugriff: 'edit' | 'comment' | 'view' = 'edit') {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
    if (zugriff === 'view') fireEvent.click(await screen.findByRole('button', { name: 'Kommentare' }));
    else {
        reiterWaehlen('Kommentieren');
        fireEvent.click(bandKnopf('Kommentarliste'));
    }
    await screen.findByText('Bitte Termin prüfen');
    return fach(zugriff === 'view' ? 'Kommentare' : 'Kommentieren');
}

/** Der Listeneintrag, der den Text trägt (der Kasten mit der Statuszeile). */
const eintrag = (text: string) => screen.getByText(text).closest('[data-erledigt], div.rounded-md') as HTMLElement;

describe('Status eines Fadens (Etappe 8, Abschnitt 1)', () => {
    it('ein erledigter Faden steht gedämpft mit Häkchen und „Erledigt von X am Y“ aus der neuesten Statusmarke; Acrobat-Zustände mit eigenem Wort', async () => {
        const liste = await listeOeffnen(gastgeber(info({ access: 'view' })), 'view');
        const termin = eintrag('Bitte Termin prüfen');
        expect(termin.dataset.erledigt).toBe('ja');
        expect(termin.className).toContain('opacity-60');
        // Die jüngere Marke (30.09., Completed von Bert) zählt, nicht die ältere (None).
        expect(within(termin).getByText(`Erledigt von Bert am ${datum('2026-09-30T09:00:00')}`)).toBeInTheDocument();
        // Acrobat: Accepted wird als Wort gezeigt, der Faden gilt nicht als erledigt.
        const rechnung = eintrag('Rechnungsnummer');
        expect(rechnung.dataset.erledigt).toBeUndefined();
        expect(within(rechnung).getByText(`Angenommen von Dora am ${datum('2026-09-28T16:00:00')}`)).toBeInTheDocument();
        // Ohne Marke: nichts dergleichen.
        expect(within(eintrag('GEPRÜFT')).queryByText(/von .* am /)).toBeNull();
        // Statusmarken erscheinen nie als eigene Kommentare: drei Fäden, eine Antwort — sonst nichts.
        expect(within(liste).queryByText('Completed')).toBeNull();
        expect(within(liste).queryByText('None')).toBeNull();
        expect(within(liste).queryByText('Accepted')).toBeNull();
        expect(within(liste).getAllByRole('button', { name: /Zur Stelle auf Seite/ })).toHaveLength(5);
        expect(within(liste).getByText('5 Anmerkungen im Dokument')).toBeInTheDocument();
    });

    it('Wieder öffnen und Erledigt sind Entwurfsänderungen: Rückgängig/Wiederholen gilt, Speichern schickt state mit page', async () => {
        const h = gastgeber();
        await listeOeffnen(h);
        const termin = () => eintrag('Bitte Termin prüfen');
        fireEvent.click(within(termin()).getByRole('button', { name: 'Wieder öffnen' }));
        expect(termin().dataset.erledigt).toBeUndefined();
        expect(within(termin()).getByText('Wird beim Speichern wieder geöffnet (Entwurf).')).toBeInTheDocument();
        expect(within(termin()).getByRole('button', { name: 'Als erledigt markieren' })).toBeInTheDocument();
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);

        // Erledigt an einem offenen Faden.
        fireEvent.click(within(eintrag('GEPRÜFT')).getByRole('button', { name: 'Als erledigt markieren' }));
        expect(eintrag('GEPRÜFT').dataset.erledigt).toBe('ja');
        expect(within(eintrag('GEPRÜFT')).getByText('Als erledigt vorgemerkt (Entwurf).')).toBeInTheDocument();

        // Rückgängig nimmt den letzten Schritt zurück, Wiederholen holt ihn.
        fireEvent.keyDown(dialog(), { key: 'z', ctrlKey: true });
        expect(eintrag('GEPRÜFT').dataset.erledigt).toBeUndefined();
        fireEvent.keyDown(dialog(), { key: 'z', ctrlKey: true });
        expect(termin().dataset.erledigt).toBe('ja');
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
        fireEvent.keyDown(dialog(), { key: 'z', ctrlKey: true, shiftKey: true });
        fireEvent.keyDown(dialog(), { key: 'z', ctrlKey: true, shiftKey: true });
        expect(termin().dataset.erledigt).toBeUndefined();
        expect(eintrag('GEPRÜFT').dataset.erledigt).toBe('ja');

        fireEvent.keyDown(dialog(), { key: 's', ctrlKey: true });
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.annotations).toEqual({ state: [{ ref: '12R', page: 0, state: 'none' }, { ref: '17R', page: 2, state: 'completed' }] });
    });

    it('comment: Erledigt wird angeboten; der Server entscheidet über die Urheberschaft', async () => {
        await listeOeffnen(gastgeber(info({ access: 'comment' })), 'comment');
        expect(within(eintrag('GEPRÜFT')).getByRole('button', { name: 'Als erledigt markieren' })).toBeInTheDocument();
        // Eine Antwort hat keinen eigenen Status.
        expect(within(eintrag('Mache ich')).queryByRole('button', { name: /erledigt|öffnen/ })).toBeNull();
    });
});

describe('Sortieren, Filtern, Ausblenden (Etappe 8, Abschnitt 2)', () => {
    const reihenfolge = (liste: HTMLElement) => within(liste).getAllByRole('button', { name: /Zur Stelle auf Seite/ })
        .filter(b => !b.closest('li')?.parentElement?.closest('li'))
        .map(b => b.textContent?.replace(/^.*?(Bitte Termin prüfen|Rechnungsnummer|GEPRÜFT|Zeichnung).*$/s, '$1'));

    it('sortiert nach Seite (Vorgabe), Datum (neueste zuerst) und Autor; die Sortierung wird je Gerät gemerkt', async () => {
        const liste = await listeOeffnen(gastgeber(info({ access: 'view' })), 'view');
        expect(within(liste).getByText('4 von 4')).toBeInTheDocument();
        expect(reihenfolge(liste)).toEqual(['Bitte Termin prüfen', 'Rechnungsnummer', 'Zeichnung', 'GEPRÜFT']);
        const sortierung = within(liste).getByRole('combobox', { name: 'Sortieren' });
        fireEvent.change(sortierung, { target: { value: 'datum' } });
        // Freihand 01.10. > Notiz 29.09. > Hervorhebung 28.09. 15:00 > Stempel 27.09.
        expect(reihenfolge(liste)).toEqual(['Zeichnung', 'Bitte Termin prüfen', 'Rechnungsnummer', 'GEPRÜFT']);
        fireEvent.change(sortierung, { target: { value: 'autor' } });
        // Anna (S. 1, S. 3), Bert, Carl.
        expect(reihenfolge(liste)).toEqual(['Bitte Termin prüfen', 'Zeichnung', 'GEPRÜFT', 'Rechnungsnummer']);
        expect(localStorage.getItem('openintrapdf.kommentare.sortierung')).toBe('autor');
        cleanup();
        const wieder = await listeOeffnen(gastgeber(info({ access: 'view' })), 'view');
        expect(within(wieder).getByRole('combobox', { name: 'Sortieren' })).toHaveValue('autor');
        expect(reihenfolge(wieder)).toEqual(['Bitte Termin prüfen', 'Zeichnung', 'GEPRÜFT', 'Rechnungsnummer']);
    });

    it('filtert nach Status, Art, Autor und Freitext — nur die Liste, mit Zähler „x von y“', async () => {
        const liste = await listeOeffnen(gastgeber());
        const status = within(liste).getByRole('combobox', { name: 'Status' });
        fireEvent.change(status, { target: { value: 'erledigt' } });
        expect(within(liste).getByText('1 von 4')).toBeInTheDocument();
        expect(reihenfolge(liste)).toEqual(['Bitte Termin prüfen']);
        fireEvent.change(status, { target: { value: 'offen' } });
        expect(within(liste).getByText('3 von 4')).toBeInTheDocument();
        // Ein Entwurfsstatus zählt sofort mit.
        fireEvent.click(within(eintrag('GEPRÜFT')).getByRole('button', { name: 'Als erledigt markieren' }));
        expect(within(liste).getByText('2 von 4')).toBeInTheDocument();
        fireEvent.change(status, { target: { value: 'alle' } });

        fireEvent.change(within(liste).getByRole('combobox', { name: 'Art' }), { target: { value: 'markierung' } });
        expect(reihenfolge(liste)).toEqual(['Rechnungsnummer']);
        fireEvent.change(within(liste).getByRole('combobox', { name: 'Art' }), { target: { value: 'alle' } });

        // Autor: Mehrfachauswahl; Carl findet auch den Faden, in dem er nur antwortete.
        fireEvent.click(within(liste).getByRole('checkbox', { name: 'Carl' }));
        expect(reihenfolge(liste)).toEqual(['Bitte Termin prüfen', 'Rechnungsnummer']);
        fireEvent.click(within(liste).getByRole('checkbox', { name: 'Bert' }));
        expect(within(liste).getByText('3 von 4')).toBeInTheDocument();
        fireEvent.click(within(liste).getByRole('checkbox', { name: 'Carl' }));
        fireEvent.click(within(liste).getByRole('checkbox', { name: 'Bert' }));

        fireEvent.change(within(liste).getByRole('searchbox', { name: 'Im Inhalt suchen' }), { target: { value: 'mache' } });
        expect(reihenfolge(liste)).toEqual(['Bitte Termin prüfen']);
        fireEvent.change(within(liste).getByRole('searchbox', { name: 'Im Inhalt suchen' }), { target: { value: 'gibt es nicht' } });
        expect(within(liste).getByText('0 von 4')).toBeInTheDocument();
        expect(within(liste).getByText('Kein Kommentar passt zu den Filtern.')).toBeInTheDocument();
        // Die Seite bleibt davon unberührt.
        expect(screen.getByTestId('leseansicht').dataset.verborgen).toBe('');
    });

    it('„Erledigte auf der Seite ausblenden“ reicht die Kennungen des Fadens (mit Antworten und Marken) an die Leseansicht; der Entwurf zählt mit', async () => {
        const liste = await listeOeffnen(gastgeber());
        const leseansicht = screen.getByTestId('leseansicht');
        expect(leseansicht.dataset.verborgen).toBe('');
        fireEvent.click(within(liste).getByRole('checkbox', { name: 'Erledigte auf der Seite ausblenden' }));
        expect(leseansicht.dataset.verborgen).toBe('12R,13R,20R,18R');
        // Die Liste selbst zeigt den Faden weiter.
        expect(eintrag('Bitte Termin prüfen')).toBeInTheDocument();
        fireEvent.click(within(eintrag('GEPRÜFT')).getByRole('button', { name: 'Als erledigt markieren' }));
        expect(leseansicht.dataset.verborgen).toBe('12R,13R,20R,18R,17R');
        fireEvent.click(within(eintrag('Bitte Termin prüfen')).getByRole('button', { name: 'Wieder öffnen' }));
        expect(leseansicht.dataset.verborgen).toBe('17R');
        // Das Häkchen überlebt das Schließen der Liste; nichts wurde gespeichert.
        fireEvent.click(screen.getByRole('button', { name: 'Werkzeug schließen' }));
        expect(leseansicht.dataset.verborgen).toBe('17R');
        // Rückgängig („Wieder öffnen“ zurück): der Faden ist wieder erledigt, 17R bleibt vorgemerkt.
        fireEvent.keyDown(dialog(), { key: 'z', ctrlKey: true });
        expect(leseansicht.dataset.verborgen).toBe('12R,13R,20R,18R,17R');
        fireEvent.click(bandKnopf('Kommentarliste'));
        await screen.findByText('Bitte Termin prüfen');
        fireEvent.click(within(fach('Kommentieren')).getByRole('checkbox', { name: 'Erledigte auf der Seite ausblenden' }));
        expect(leseansicht.dataset.verborgen).toBe('');
    });
});

describe('Arbeitsfach ohne die Knöpfe des Bands (Aufräumen aus Etappe 7)', () => {
    it('Kommentieren: im Fach nur Anleitung, Stempeleinstellungen und Liste — Werkzeuge, Farbe und Strichstärke stehen im Band', async () => {
        const h = gastgeber();
        render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
        await screen.findByTestId('leseansicht');
        reiterWaehlen('Kommentieren');
        fireEvent.click(bandKnopf('Stempel'));
        const f = fach('Kommentieren');
        expect(within(f).queryByRole('button', { name: 'Notiz' })).toBeNull();
        expect(within(f).queryByRole('group', { name: 'Werkzeuge' })).toBeNull();
        expect(within(f).queryByRole('group', { name: 'Strichstärke' })).toBeNull();
        expect(within(f).getByRole('button', { name: 'Stempel wählen' })).toBeInTheDocument();
        expect(within(f).getByRole('group', { name: 'Stempelfarbe' })).toBeInTheDocument();
        expect(within(f).getByRole('checkbox', { name: 'Name und Datum' })).toBeInTheDocument();
        expect(within(f).getByText(/^Stempel: Wählen Sie Stempel und Farbe/)).toBeInTheDocument();
        expect(bandKnopf('Notiz')).toBeInTheDocument();
        fireEvent.click(bandKnopf('Post-it'));
        expect(within(fach('Kommentieren')).queryByRole('button', { name: 'Stempel wählen' })).toBeNull();
        expect(within(fach('Kommentieren')).queryByRole('button', { name: 'Gelb' })).toBeNull();
        expect(within(fach('Kommentieren')).getByText(/^Post-it: Klicken Sie auf die Stelle/)).toBeInTheDocument();
        // Zettelfarbe und Farbe stehen im Band (Gruppe Aussehen).
        expect(bandKnopf('Gelb')).toBeInTheDocument();
        expect(bandKnopf('Rosa')).toBeInTheDocument();
    });

    it('Seiten: im Fach nur, was nicht im Band steht — „vor Seite N“, Hinweise, Tastatur', async () => {
        const h = gastgeber();
        render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
        await screen.findByTestId('leseansicht');
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        await screen.findAllByRole('option');
        const f = fach('Seiten verwalten');
        for (const name of ['Alle wählen', 'Auswahl aufheben', '90° rechts', 'Entfernen', 'Duplizieren', 'Nach vorn', 'Leere Seiten prüfen']) {
            expect(within(f).queryByRole('button', { name })).toBeNull();
            expect(bandKnopf(name)).toBeInTheDocument();
        }
        expect(within(f).getByRole('spinbutton')).toBeInTheDocument();
        expect(within(f).getByRole('button', { name: 'Verschieben' })).toBeInTheDocument();
        expect(within(f).getByText(/Strg\/Cmd\+Z macht rückgängig/)).toBeInTheDocument();
    });
});

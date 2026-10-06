// SPDX-License-Identifier: Apache-2.0
//
// Dateien binden im Arbeitsplatz: Gruppe nur mit passendem Gastgeber, die
// geöffnete Datei als erste Quelle, Hinzufügen über den Wähler, Warnungen
// vor dem Binden, Reihenfolge per Knopf, Seitenbereiche, Zielname, Befehl
// mit Idempotency-Key, 412 und 422 mit Bestätigung, Wiederholung.
// Gastgeber und pdf.js sind gemockt, die Daten erfunden. Seit Etappe 7
// öffnet der Knopf „Dateien binden“ im Reiter Werkzeuge des Werkzeugbands das
// Werkzeug im Arbeitsfach.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { band, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { PdfHostFehler } from './typen';
import type { BindeBefehl, PdfHost, PdfInfo, ZielAnfrage } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar }: { sichtbar: boolean }) => <div data-testid="leseansicht" hidden={!sichtbar} />,
}));

const dokument = { numPages: 3, getPage: async () => new Promise(() => undefined), getOutline: async () => null };
const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(dokument), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1 },
    },
    viewer: {},
    viewerStil: '',
};

/** Die geöffnete Datei: Leserecht genügt. */
function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'view',
        inspection: { pages: 3, annotations: 0 },
        capabilities: { pages: { state: 'read_only' }, merge: { state: 'available' } },
        ...ueber,
    };
}

const infos: Record<string, PdfInfo> = {
    f1: info(),
    f2: { file_id: 'f2', name: 'Anhang.pdf', version: 3, sha256: 'x', access: 'view', inspection: { pages: 2, signed: true }, capabilities: { merge: { state: 'available' } } },
    f3: { file_id: 'f3', name: 'Formular.pdf', version: 1, sha256: 'y', access: 'view', inspection: { pages: 5, forms: true, form_fields: 4 }, capabilities: { merge: { state: 'available' } } },
    f4: { file_id: 'f4', name: 'Geheim.pdf', version: 2, sha256: 'z', access: 'view', inspection: { pages: 1, encrypted: true }, capabilities: { merge: { state: 'requires_password', reason: 'user_password' } } },
};

type Mock = ReturnType<typeof vi.fn>;
type Gast = PdfHost & Record<'laden' | 'zielWaehlen' | 'dateienWaehlen' | 'quelleInfo' | 'binden', Mock>;

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()): Gast {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        zielWaehlen: vi.fn(async (a: ZielAnfrage) => ({ drive_id: '', folder_id: 'ordner-7', name: a.name })),
        dateienWaehlen: vi.fn(async () => [{ id: 'f2', name: 'Anhang.pdf' }, { id: 'f3', name: 'Formular.pdf' }]),
        quelleInfo: vi.fn(async (id: string) => {
            const i = infos[id];
            if (!i) throw new PdfHostFehler(404, 'drive.not_found');
            return i;
        }),
        binden: vi.fn(async (b: BindeBefehl) => ({ file_id: 'f9', name: b.destination.name, version: 1, report: { warnings: ['signed_source'] } })),
        ...ueber,
    } as Gast;
}

beforeAll(async () => {
    await spracheDeutsch();
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => cleanup());

async function oeffnen(h: PdfHost) {
    const onGebunden = vi.fn();
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} onGebunden={onGebunden} />);
    await screen.findByTestId('leseansicht');
    return { onGebunden };
}

/** Der Knopf „Dateien binden“ im Reiter Werkzeuge des Werkzeugbands — `null`, wenn es ihn (oder den Reiter) nicht gibt. */
function navKnopf() {
    if (reiter('Werkzeuge')) reiterWaehlen('Werkzeuge');
    return screen.queryByRole('button', { name: 'Dateien binden' });
}
const gruppe = () => screen.getByRole('region', { name: 'Dateien binden' });
const quellenListe = () => within(gruppe()).getByRole('list', { name: 'Quellen' });
const eintraege = () => within(quellenListe()).getAllByRole('listitem').map(li => li.getAttribute('aria-label'));

async function gruppeOeffnen(h: PdfHost) {
    const r = await oeffnen(h);
    reiterWaehlen('Werkzeuge');
    fireEvent.click(screen.getByRole('button', { name: 'Dateien binden' }));
    await screen.findByRole('button', { name: 'Binden …' });
    return r;
}

/** „PDF hinzufügen …“ und warten, bis die Infos beider Quellen da sind. */
async function zweiHinzufuegen() {
    fireEvent.click(screen.getByRole('button', { name: 'PDF hinzufügen …' }));
    await screen.findByText('2 Seiten');
    await screen.findByText('5 Seiten');
}

describe('Sichtbarkeit der Gruppe', () => {
    it('Wiki (Gastgeber ohne binden und dateienWaehlen): keine Gruppe', async () => {
        await oeffnen(gastgeber({ binden: undefined, dateienWaehlen: undefined, quelleInfo: undefined }));
        expect(navKnopf()).toBeNull();
    });

    it('ohne Info der geöffneten Datei (Route fehlt): keine Gruppe, denn die erste Quelle wäre unbekannt', async () => {
        const h = gastgeber({ laden: vi.fn(async () => ({ daten: new ArrayBuffer(8) })) });
        await oeffnen(h);
        expect(navKnopf()).toBeNull();
    });

    it('Lesen genügt: mit Recht view gibt es die Gruppe, die geöffnete Datei ist die erste Quelle und bleibt', async () => {
        await gruppeOeffnen(gastgeber());
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        expect(eintraege()).toEqual(['1. Angebot.pdf']);
        expect(within(gruppe()).getByText('3 Seiten')).toBeInTheDocument();
        expect(within(gruppe()).getByText('Gebunden wird die gespeicherte Fassung 12 dieser Datei.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Angebot.pdf entfernen' })).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Name der neuen Datei' })).toHaveValue('Angebot (gebunden).pdf');
    });
});

describe('Quellen', () => {
    it('„PDF hinzufügen …“ fragt den Gastgeber, holt die Merkmale je Quelle und warnt VOR dem Binden', async () => {
        const h = gastgeber({}, info({ inspection: { pages: 3, forms: true, form_fields: 1 } }));
        await gruppeOeffnen(h);
        await zweiHinzufuegen();
        expect(h.dateienWaehlen).toHaveBeenCalledTimes(1);
        expect(h.quelleInfo.mock.calls.map(c => c[0])).toEqual(['f2', 'f3']);
        expect(eintraege()).toEqual(['1. Angebot.pdf', '2. Anhang.pdf', '3. Formular.pdf']);
        expect(within(gruppe()).getByText('Signiert')).toBeInTheDocument();
        expect(within(gruppe()).getAllByText('Formularfelder')).toHaveLength(2);
        // Signatur: gilt nicht für das Ergebnis. Formular: nur ein Hinweis, der Server entscheidet.
        expect(screen.getByText(/Anhang\.pdf ist signiert\. Die Signatur gilt nicht für das Ergebnis/)).toBeInTheDocument();
        expect(screen.getByText(/Mehrere Quellen enthalten Formularfelder/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeEnabled();
    });

    it('eine passwortgeschützte Quelle sperrt das Binden mit Grund; Entfernen gibt es frei', async () => {
        const h = gastgeber({ dateienWaehlen: vi.fn(async () => [{ id: 'f4', name: 'Geheim.pdf' }]) });
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'PDF hinzufügen …' }));
        expect(await screen.findByText('Passwortgeschützt')).toBeInTheDocument();
        expect(screen.getByText(/Geheim\.pdf ist passwortgeschützt und lässt sich nicht binden/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Geheim.pdf entfernen' }));
        expect(eintraege()).toEqual(['1. Angebot.pdf']);
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeEnabled();
    });

    it('eine nicht lesbare Quelle (404) wird als solche gezeigt und sperrt', async () => {
        const h = gastgeber({ dateienWaehlen: vi.fn(async () => [{ id: 'weg', name: 'Weg.pdf' }]) });
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'PDF hinzufügen …' }));
        expect(await screen.findByText(/Nicht lesbar/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeDisabled();
        expect(screen.getByText('Eine Quelle ist nicht lesbar – entfernen Sie sie oder laden Sie die Quellen neu.')).toBeInTheDocument();
    });

    it('Reihenfolge per Knopf: nach oben/unten, Grenzen sind gesperrt, der Zielname folgt der ersten Quelle', async () => {
        await gruppeOeffnen(gastgeber());
        await zweiHinzufuegen();
        expect(screen.getByRole('button', { name: 'Angebot.pdf nach oben' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Formular.pdf nach unten' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Anhang.pdf nach oben' }));
        expect(eintraege()).toEqual(['1. Anhang.pdf', '2. Angebot.pdf', '3. Formular.pdf']);
        expect(screen.getByRole('textbox', { name: 'Name der neuen Datei' })).toHaveValue('Anhang (gebunden).pdf');
        fireEvent.click(screen.getByRole('button', { name: 'Angebot.pdf nach unten' }));
        expect(eintraege()).toEqual(['1. Anhang.pdf', '2. Formular.pdf', '3. Angebot.pdf']);
        expect(screen.getByRole('button', { name: 'Angebot.pdf nach unten' })).toBeDisabled();
        // Ein eigener Name bleibt, auch wenn die Reihenfolge sich wieder ändert.
        fireEvent.change(screen.getByRole('textbox', { name: 'Name der neuen Datei' }), { target: { value: 'Mappe.pdf' } });
        fireEvent.click(screen.getByRole('button', { name: 'Angebot.pdf nach oben' }));
        expect(screen.getByRole('textbox', { name: 'Name der neuen Datei' })).toHaveValue('Mappe.pdf');
    });

    it('ein ungültiger Seitenbereich wird verständlich angezeigt und sperrt das Binden', async () => {
        await gruppeOeffnen(gastgeber());
        const feld = screen.getByRole('textbox', { name: 'Seiten von Angebot.pdf' });
        fireEvent.change(feld, { target: { value: '2-9' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Seitenangabe nicht lesbar. Erlaubt sind Nummern und Bereiche wie „1-3, 5“ innerhalb der Datei (3 Seiten).');
        expect(feld).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeDisabled();
        fireEvent.change(feld, { target: { value: '1, 3' } });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeEnabled();
    });
});

describe('Binden', () => {
    it('schickt Quellen in Reihenfolge mit Fassung und Seiten ab 0, Ziel aus dem Dialog, Lesezeichen an; Erfolg mit Namen', async () => {
        const h = gastgeber();
        const { onGebunden } = await gruppeOeffnen(h);
        await zweiHinzufuegen();
        fireEvent.click(screen.getByRole('button', { name: 'Anhang.pdf nach oben' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Seiten von Formular.pdf' }), { target: { value: '1-2, 5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        expect(await within(gruppe()).findByText('Neue Datei angelegt: Anhang (gebunden).pdf')).toBeInTheDocument();

        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'binden', name: 'Anhang (gebunden).pdf' });
        const [befehl, schluessel] = h.binden.mock.calls[0] as [BindeBefehl, string];
        expect(befehl).toEqual({
            sources: [
                { file_id: 'f2', expected_version: 3 },
                { file_id: 'f1', expected_version: 12 },
                { file_id: 'f3', expected_version: 1, pages: [0, 1, 4] },
            ],
            destination: { drive_id: '', folder_id: 'ordner-7', name: 'Anhang (gebunden).pdf' },
            bookmarks_per_source: true,
        });
        expect(schluessel).toMatch(/^[0-9a-f-]{36}$/);
        // Der Bericht der Antwort wird gezeigt.
        expect(screen.getByText(/Eine Quelle war signiert; die neue Datei trägt die Signatur nicht\./)).toBeInTheDocument();
        expect(onGebunden).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'f9', name: 'Anhang (gebunden).pdf' }));
    });

    it('„Lesezeichen je Quelle“ abgeschaltet und eigener Name ohne Endung: `.pdf` wird ergänzt', async () => {
        const h = gastgeber();
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('checkbox', { name: /Lesezeichen je Quelle/ }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Name der neuen Datei' }), { target: { value: 'Mappe' } });
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        await within(gruppe()).findByText('Neue Datei angelegt: Mappe.pdf');
        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'binden', name: 'Mappe.pdf' });
        expect((h.binden.mock.calls[0] as [BindeBefehl])[0].bookmarks_per_source).toBe(false);
    });

    it('Abbruch im Zieldialog schickt nichts', async () => {
        const h = gastgeber({ zielWaehlen: vi.fn(async () => null) });
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        await waitFor(() => expect(h.zielWaehlen).toHaveBeenCalled());
        expect(h.binden).not.toHaveBeenCalled();
    });

    it('412 nennt die geänderte Quelle und bietet „Quellen neu laden“, was die Merkmale neu holt', async () => {
        const h = gastgeber();
        h.binden.mockRejectedValueOnce(new PdfHostFehler(412, 'pdf.version_conflict', { file_id: 'f2', current_version: 4 }));
        await gruppeOeffnen(h);
        await zweiHinzufuegen();
        h.quelleInfo.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Anhang.pdf wurde inzwischen geändert (jetzt Fassung 4).');
        fireEvent.click(screen.getByRole('button', { name: 'Quellen neu laden' }));
        await waitFor(() => expect(h.quelleInfo.mock.calls.map(c => c[0])).toEqual(['f1', 'f2', 'f3']));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeEnabled();
    });

    it('422 preservation_failed: Bericht, erst nach Bestätigung mit accept_losses — und einem neuen Schlüssel', async () => {
        const h = gastgeber();
        h.binden.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.preservation_failed', {
            losses: ['bookmarks'], report: { bookmarks_before: 2, bookmarks_after: 0 },
        }));
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        const dialog = await screen.findByRole('dialog', { name: 'Beim Binden ginge etwas verloren' });
        expect(within(dialog).getByText('Lesezeichen')).toBeInTheDocument();
        expect(within(dialog).getByText('2')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Verluste annehmen und binden' }));
        await within(gruppe()).findByText('Neue Datei angelegt: Angebot (gebunden).pdf');
        const [[erster, k1], [zweiter, k2]] = h.binden.mock.calls as [BindeBefehl, string][];
        expect(erster.accept_losses).toBeUndefined();
        expect(zweiter.accept_losses).toEqual(['bookmarks']);
        expect(zweiter.sources).toEqual(erster.sources);
        expect(k2).not.toBe(k1);
    });

    it('422 abbrechen: nichts wird noch einmal gesendet, die Liste bleibt', async () => {
        const h = gastgeber();
        h.binden.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.preservation_failed', { losses: ['attachments'], report: {} }));
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        const dialog = await screen.findByRole('dialog', { name: 'Beim Binden ginge etwas verloren' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Beim Binden ginge etwas verloren' })).toBeNull());
        expect(h.binden).toHaveBeenCalledTimes(1);
        expect(eintraege()).toEqual(['1. Angebot.pdf']);
    });

    it('Netzfehler: „Erneut versuchen“ schickt denselben Schlüssel; ein geänderter Rumpf bekommt einen neuen', async () => {
        const h = gastgeber();
        h.binden.mockRejectedValueOnce(new PdfHostFehler(0, 'network'));
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung zum Server. Versuchen Sie es noch einmal – dabei entsteht keine doppelte Datei.');
        fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
        await within(gruppe()).findByText('Neue Datei angelegt: Angebot (gebunden).pdf');
        // Anderer Rumpf (ohne Lesezeichen) → neuer Vorgang, neuer Schlüssel.
        fireEvent.click(screen.getByRole('checkbox', { name: /Lesezeichen je Quelle/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        await waitFor(() => expect(h.binden).toHaveBeenCalledTimes(3));
        const schluessel = h.binden.mock.calls.map(c => c[1]);
        expect(schluessel[0]).toBe(schluessel[1]);
        expect(schluessel[2]).not.toBe(schluessel[1]);
    });

    it('der Satz des Servers (fehler.pdf.*) erscheint bei einer Ablehnung, etwa Formularkollision', async () => {
        const h = gastgeber();
        h.binden.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.form_collision', {}, 'Beim Binden würden gleichnamige Formularfelder zusammenfallen.'));
        await gruppeOeffnen(h);
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Binden fehlgeschlagen. Der Server hat das Binden abgelehnt. Beim Binden würden gleichnamige Formularfelder zusammenfallen.');
        expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
    });
});

describe('Entwurf', () => {
    it('ein offener Seitenentwurf blockiert das Binden nicht — die Gruppe sagt, dass er nicht enthalten ist', async () => {
        const h = gastgeber({ speichern: vi.fn() }, info({ access: 'edit', capabilities: { pages: { state: 'available' }, merge: { state: 'available' } } }));
        await oeffnen(h);
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        const kacheln = await screen.findAllByRole('option');
        fireEvent.click(kacheln[0]);
        fireEvent.click(within(band()).getByRole('button', { name: '90° rechts' }));
        await screen.findAllByText('Änderungen im Entwurf');
        reiterWaehlen('Werkzeuge');
        fireEvent.click(screen.getByRole('button', { name: 'Dateien binden' }));
        expect(await screen.findByText(/Gebunden wird die gespeicherte Fassung 12 dieser Datei\. Ihr offener Entwurf ist darin nicht enthalten/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Binden …' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Binden …' }));
        await within(gruppe()).findByText('Neue Datei angelegt: Angebot (gebunden).pdf');
        expect((h.binden.mock.calls[0] as [BindeBefehl])[0].sources).toEqual([{ file_id: 'f1', expected_version: 12 }]);
        expect(h.speichern).not.toHaveBeenCalled();
    });
});

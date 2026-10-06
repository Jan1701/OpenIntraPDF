// SPDX-License-Identifier: Apache-2.0
//
// Kennwortschutz (Etappe 9, Vertrag Abschnitt 3): „Geschützt herunterladen“
// über host.geschuetzt, „Kennwort entfernen“ als Commit mit decrypt, die
// Sperren aus den Rechten der PDF (pdf.js getPermissions) und das
// Rechte-Kennwort, das sie für die Sitzung aufhebt. Gastgeber und pdf.js
// sind gemockt, die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bandKnopf, dateiMenue, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { dateiAnbieten } from './hilfen';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { FLAG } from './rechte';
import { PdfHostFehler } from './typen';
import type { CommitBefehl, DruckBefehl, PdfHost, PdfInfo, SchutzBefehl } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
vi.mock('./hilfen', async importOriginal => ({ ...(await importOriginal<typeof import('./hilfen')>()), dateiAnbieten: vi.fn() }));
interface LeseMock { sichtbar: boolean; zeiger?: string; textAuswahlGesperrt?: boolean }
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, zeiger, textAuswahlGesperrt }: LeseMock) => (
        <div data-testid="leseansicht" hidden={!sichtbar} data-zeiger={zeiger ?? ''} data-kopieren={textAuswahlGesperrt ? 'gesperrt' : 'frei'} />
    ),
}));

function seite(n: number) {
    return {
        rotate: 0,
        view: [0, 0, 595, 842],
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => [],
    };
}
/** Die Rechte, die pdf.js meldet — je Test gesetzt; null = keine Verschlüsselung. */
let rechteFlags: number[] | null = null;
const dokument = { numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null, getPermissions: async () => rechteFlags };
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

const kopie = new TextEncoder().encode('%PDF-1.7 geschuetzt').buffer;

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()) {
    const h = {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        geschuetzt: vi.fn(async (_b: SchutzBefehl) => kopie),
        rechteKennwortPruefen: vi.fn(async (_k: string) => undefined),
        druckfassung: vi.fn(async (_b: DruckBefehl) => kopie),
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
afterEach(() => {
    cleanup();
    rechteFlags = null;
    vi.mocked(dateiAnbieten).mockClear();
});

async function oeffnen(h: PdfHost) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
}

const menueEintrag = (name: string) => within(dateiMenue()).queryByRole('menuitem', { name });

describe('Geschützt herunterladen (Etappe 9, Abschnitt 3)', () => {
    it('Dialog aus dem Datei-Menü: Kennwörter, Rechte, Prüfung; der Gastgeber liefert die Kopie, sie wird angeboten', async () => {
        const h = gastgeber();
        await oeffnen(h);
        fireEvent.click(menueEintrag('Geschützt herunterladen …')!);
        const dialog = await screen.findByRole('dialog', { name: 'Geschützt herunterladen' });
        const oeffnenFeld = within(dialog).getByLabelText(/Öffnen-Kennwort/);
        const rechteFeld = within(dialog).getByLabelText(/^Rechte-Kennwort/);
        // Ohne Kennwort geht nichts; ein kurzes auch nicht.
        fireEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Bitte mindestens ein Kennwort angeben.');
        fireEvent.change(rechteFeld, { target: { value: 'kurz' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('mindestens 6 Zeichen');
        expect(h.geschuetzt).not.toHaveBeenCalled();
        // Kopieren und Ändern verbieten, beide Kennwörter setzen.
        fireEvent.change(oeffnenFeld, { target: { value: 'oeffnen-123' } });
        fireEvent.change(rechteFeld, { target: { value: 'rechte-456' } });
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Text und Bilder kopieren' }));
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Ändern (Seiten, Inhalt)' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));
        await waitFor(() => expect(h.geschuetzt).toHaveBeenCalledWith({
            user_password: 'oeffnen-123', owner_password: 'rechte-456',
            permissions: { print: true, copy: false, modify: false, annotate: true, fill: true }, expected_version: 12,
        }));
        await waitFor(() => expect(dateiAnbieten).toHaveBeenCalledTimes(1));
        const [blob, name] = vi.mocked(dateiAnbieten).mock.calls[0];
        expect(blob.size).toBe(kopie.byteLength);
        expect(name).toBe('Angebot – geschützt.pdf');
        expect(screen.queryByRole('dialog', { name: 'Geschützt herunterladen' })).toBeNull();
        // Nichts gespeichert, kein Entwurf.
        expect(h.speichern).not.toHaveBeenCalled();
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
    });

    it('nur das Öffnen-Kennwort gilt zugleich als Rechte-Kennwort; eingeschränkte Rechte verlangen ein eigenes', async () => {
        const h = gastgeber();
        await oeffnen(h);
        fireEvent.click(menueEintrag('Geschützt herunterladen …')!);
        const dialog = await screen.findByRole('dialog', { name: 'Geschützt herunterladen' });
        fireEvent.change(within(dialog).getByLabelText(/Öffnen-Kennwort/), { target: { value: 'oeffnen-123' } });
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Drucken' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('braucht die Kopie ein Rechte-Kennwort');
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Drucken' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));
        await waitFor(() => expect(h.geschuetzt).toHaveBeenCalledWith({
            user_password: 'oeffnen-123', owner_password: 'oeffnen-123',
            permissions: { print: true, copy: true, modify: true, annotate: true, fill: true }, expected_version: 12,
        }));
    });

    it('ein Fehler des Gastgebers steht in der Hinweiszeile; ohne host.geschuetzt gibt es den Eintrag nicht', async () => {
        const h = gastgeber({ geschuetzt: vi.fn(async () => { throw new PdfHostFehler(422, 'pdf.unsupported'); }) });
        await oeffnen(h);
        fireEvent.click(menueEintrag('Geschützt herunterladen …')!);
        const dialog = await screen.findByRole('dialog', { name: 'Geschützt herunterladen' });
        fireEvent.change(within(dialog).getByLabelText(/^Rechte-Kennwort/), { target: { value: 'rechte-456' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));
        expect(await screen.findByText('Die geschützte Kopie ließ sich nicht erstellen.')).toBeInTheDocument();
        expect(dateiAnbieten).not.toHaveBeenCalled();
        cleanup();
        await oeffnen(gastgeber({ geschuetzt: undefined }));
        expect(menueEintrag('Geschützt herunterladen …')).toBeNull();
    });
});

describe('Kennwort entfernen (Etappe 9, Abschnitt 3)', () => {
    it('mit edit an einer verschlüsselten Datei: Dialog, dann Commit mit decrypt; das Kennwort steht sonst nirgends', async () => {
        const h = gastgeber({}, info({ inspection: { pages: 3, encrypted: true }, capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } } }));
        await oeffnen(h);
        fireEvent.click(menueEintrag('Kennwort entfernen')!);
        const dialog = await screen.findByRole('dialog', { name: 'Kennwort entfernen' });
        expect(within(dialog).getByRole('button', { name: 'Kennwort entfernen und speichern' })).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'geheim-123' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Kennwort entfernen und speichern' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const befehl = vi.mocked(h.speichern).mock.calls[0][0] as CommitBefehl;
        expect(befehl).toEqual({ expected_version: 12, expected_sha256: 'abc', destination: { kind: 'new_version' }, decrypt: { password: 'geheim-123' } });
        expect((await screen.findAllByText('Gespeichert als Fassung 13')).length).toBeGreaterThan(0);
        await waitFor(() => expect(h.laden).toHaveBeenCalledTimes(2));
    });

    it('ist das Rechte-Kennwort für die Sitzung bekannt, geht es als owner_password mit (#248: nur es nimmt den Schutz)', async () => {
        rechteFlags = [FLAG.PRINT];
        const h = gastgeber({}, info({ inspection: { pages: 3, encrypted: true } }));
        await oeffnen(h);
        fireEvent.click(menueEintrag('Rechte-Kennwort eingeben …')!);
        const rechte = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(rechte).getByLabelText('Passwort'), { target: { value: 'rechte-456' } });
        fireEvent.click(within(rechte).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechte-Kennwort eingeben …' })).toBeNull());
        fireEvent.click(menueEintrag('Kennwort entfernen')!);
        const dialog = await screen.findByRole('dialog', { name: 'Kennwort entfernen' });
        expect(within(dialog).getByText(/Rechte-Kennwort der Datei/)).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'oeffnen-123' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Kennwort entfernen und speichern' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const befehl = vi.mocked(h.speichern).mock.calls[0][0] as CommitBefehl;
        expect(befehl.decrypt).toEqual({ password: 'oeffnen-123' });
        expect(befehl.owner_password).toBe('rechte-456');
    });

    it('ohne edit oder ohne Verschlüsselung gibt es den Eintrag nicht', async () => {
        await oeffnen(gastgeber({}, info({ access: 'comment', inspection: { pages: 3, encrypted: true } })));
        expect(menueEintrag('Kennwort entfernen')).toBeNull();
        cleanup();
        await oeffnen(gastgeber());
        expect(menueEintrag('Kennwort entfernen')).toBeNull();
    });
});

describe('Rechte-Kennwort erst nach Prüfung am Gastgeber (#247)', () => {
    it('ein abgelehntes Kennwort hebt nichts auf: der Dialog bleibt mit Fehler offen; das richtige danach schon', async () => {
        rechteFlags = [FLAG.PRINT];
        const h = gastgeber();
        vi.mocked(h.rechteKennwortPruefen).mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.wrong_password'));
        await oeffnen(h);
        expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        fireEvent.click(menueEintrag('Rechte-Kennwort eingeben …')!);
        const dialog = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'falsch-789' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Das Kennwort stimmt nicht.');
        expect(h.rechteKennwortPruefen).toHaveBeenCalledWith('falsch-789');
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        expect(screen.getByTestId('leseansicht').dataset.kopieren).toBe('gesperrt');
        expect(reiter('Kommentieren')).toBeDisabled();
        // Ein zweiter Fehler (Netz) steht ebenfalls im Dialog.
        vi.mocked(h.rechteKennwortPruefen).mockRejectedValueOnce(new PdfHostFehler(0, 'network'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        expect(await within(dialog).findByText('Das Rechte-Kennwort ließ sich nicht prüfen.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        // Das richtige Kennwort: bestätigt, Dialog zu, Sperren weg.
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'rechte-456' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechte-Kennwort eingeben …' })).toBeNull());
        expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
        expect(screen.getByTestId('leseansicht').dataset.kopieren).toBe('frei');
        expect(h.rechteKennwortPruefen).toHaveBeenCalledTimes(3);
    });

    it('ohne rechteKennwortPruefen des Gastgebers gibt es den Eintrag nicht — Sperren fallen nur geprüft', async () => {
        rechteFlags = [FLAG.PRINT];
        await oeffnen(gastgeber({ rechteKennwortPruefen: undefined }));
        expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        expect(menueEintrag('Rechte-Kennwort eingeben …')).toBeNull();
    });

    it('Drucken einer PDF ohne Druckrecht: nach dem Rechte-Kennwort geht die Druckfassung mit owner_password zum Gastgeber', async () => {
        rechteFlags = [FLAG.COPY, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS, FLAG.FILL_INTERACTIVE_FORMS];
        const h = gastgeber();
        await oeffnen(h);
        expect(screen.getByRole('button', { name: 'Drucken' })).toBeDisabled();
        fireEvent.click(menueEintrag('Rechte-Kennwort eingeben …')!);
        const dialog = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'rechte-456' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Drucken' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Drucken' }));
        const druck = await screen.findByRole('dialog', { name: 'Drucken' });
        fireEvent.click(within(druck).getByRole('radio', { name: 'Aktuelle Seite (1)' }));
        fireEvent.click(within(druck).getByRole('button', { name: 'Drucken' }));
        await waitFor(() => expect(h.druckfassung).toHaveBeenCalledWith({ pages: [0], annotations: true, expected_version: 12, owner_password: 'rechte-456' }));
        const befehl = vi.mocked(h.druckfassung).mock.calls[0][0];
        expect(befehl.password).toBeUndefined();
    });
});

describe('Rechte einer fremd geschützten PDF (Etappe 9, Abschnitt 3)', () => {
    it('nur Drucken erlaubt: Bearbeiten, Kommentieren und Text auswählen sind gesperrt mit Grund; Drucken bleibt', async () => {
        rechteFlags = [FLAG.PRINT];
        const h = gastgeber();
        await oeffnen(h);
        const bearbeiten = await screen.findByRole('button', { name: 'Bearbeiten' });
        expect(bearbeiten).toBeDisabled();
        expect(bearbeiten).toHaveAttribute('title', expect.stringContaining('ohne Rechte-Kennwort'));
        expect(reiter('Seiten')).toBeDisabled();
        expect(reiter('Kommentieren')).toBeDisabled();
        expect(reiter('Kommentieren')).toHaveAttribute('title', expect.stringContaining('Kommentieren ist in dieser PDF'));
        // Drucken geht; Text auswählen nicht — die Hand ist gesetzt, die Textebene gesperrt.
        expect(screen.getByRole('button', { name: 'Drucken' })).toBeEnabled();
        reiterWaehlen('Start');
        expect(bandKnopf('Text auswählen')).toBeDisabled();
        expect(bandKnopf('Text auswählen')).toHaveAttribute('title', expect.stringContaining('Text kopieren'));
        expect(screen.getByTestId('leseansicht').dataset.zeiger).toBe('hand');
        expect(screen.getByTestId('leseansicht').dataset.kopieren).toBe('gesperrt');
        // Die Taste V bleibt ohne Wirkung.
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'v' });
        expect(screen.getByTestId('leseansicht').dataset.zeiger).toBe('hand');
    });

    it('kein Drucken erlaubt: der Druckknopf ist gesperrt und nennt den Grund; alles erlaubt: keine Sperre, kein Eintrag', async () => {
        rechteFlags = [FLAG.COPY, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS, FLAG.FILL_INTERACTIVE_FORMS];
        await oeffnen(gastgeber());
        const drucken = screen.getByRole('button', { name: 'Drucken' });
        expect(drucken).toBeDisabled();
        expect(drucken).toHaveAttribute('title', expect.stringContaining('Drucken ist in dieser PDF'));
        const menue = dateiMenue();
        expect(within(menue).getByRole('menuitem', { name: 'Drucken' })).toBeDisabled();
        expect(within(menue).getByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
        cleanup();
        rechteFlags = [FLAG.PRINT, FLAG.COPY, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS, FLAG.FILL_INTERACTIVE_FORMS, FLAG.ASSEMBLE, FLAG.PRINT_HIGH_QUALITY, FLAG.COPY_FOR_ACCESSIBILITY];
        await oeffnen(gastgeber());
        expect(screen.getByRole('button', { name: 'Drucken' })).toBeEnabled();
        expect(menueEintrag('Rechte-Kennwort eingeben …')).toBeNull();
    });

    it('„Rechte-Kennwort eingeben“ hebt die Sperren auf; der Commit trägt owner_password; lehnt der Server ab, gelten sie wieder', async () => {
        rechteFlags = [FLAG.PRINT];
        const h = gastgeber();
        vi.mocked(h.speichern).mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.permission_restricted', { restricted: ['modify'] }));
        await oeffnen(h);
        expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
        fireEvent.click(menueEintrag('Rechte-Kennwort eingeben …')!);
        const dialog = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'rechte-456' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled());
        // Erst der Gastgeber (#247), dann die Sperren.
        expect(h.rechteKennwortPruefen).toHaveBeenCalledWith('rechte-456');
        expect(screen.getByTestId('leseansicht').dataset.kopieren).toBe('frei');
        expect(reiter('Kommentieren')).toBeEnabled();
        expect(menueEintrag('Rechte-Kennwort eingeben …')).toBeNull();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        // Eine Seite drehen und speichern: owner_password geht mit — und nur dorthin.
        fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
        fireEvent.click((await screen.findAllByRole('option'))[0]);
        fireEvent.click(bandKnopf('90° rechts'));
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const befehl = vi.mocked(h.speichern).mock.calls[0][0] as CommitBefehl;
        expect(befehl.owner_password).toBe('rechte-456');
        expect(befehl.password).toBeUndefined();
        expect(befehl.pages?.[0]).toEqual({ source: 0, rotate: 90 });
        // Der Server lehnte ab: Sperren wieder da (zurück in die Leseansicht), der Entwurf bleibt im Speicher.
        expect((await screen.findAllByText('Speichern fehlgeschlagen')).length).toBeGreaterThan(0);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled());
        expect(screen.queryByText('90°')).toBeNull();
        fireEvent.click(within(dateiMenue()).getByRole('menuitem', { name: 'Rechte-Kennwort eingeben …' }));
        const nochmal = await screen.findByRole('dialog', { name: 'Rechte-Kennwort eingeben …' });
        fireEvent.change(within(nochmal).getByLabelText('Passwort'), { target: { value: 'rechte-456' } });
        fireEvent.click(within(nochmal).getByRole('button', { name: 'Sperren aufheben' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeEnabled());
        expect(await screen.findByText('90°')).toBeInTheDocument();
    });
});

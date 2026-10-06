// SPDX-License-Identifier: Apache-2.0
//
// Links (Etappe 9, Vertrag Abschnitt 4): der Reiter „Einfügen“ mit der
// Gruppe Links (nur mit Kommentar- oder Bearbeitungsrecht), das Werkzeug,
// der Dialog mit Web-Adresse oder Zielseite, der Befehl im Commit und das
// Löschen gespeicherter wie neuer Links über die Umrandung. Gastgeber und
// pdf.js sind gemockt, die Daten erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bandKnopf, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import type { LinkEintrag } from './kommentare';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import type { CommitBefehl, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
// Die Leseansicht spielt die Geste ein und zeigt die Links, die sie bekommt,
// als Knöpfe — ein Klick darauf ist der Klick auf die Umrandung.
interface LeseMock {
    sichtbar: boolean;
    anmerkungen?: {
        werkzeug: string | null;
        entwurf: { client_id: string; kind: string; page: number; rect: number[]; uri?: string; page_target?: number }[];
        onNeu: (a: unknown) => void;
        links?: { gespeichert: LinkEintrag[]; geloescht: Set<string>; onKlick: (id: string, page: number, ziel: string) => void; zielText: (l: object) => string };
    };
}
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, anmerkungen }: LeseMock) => (
        <div data-testid="leseansicht" hidden={!sichtbar} data-werkzeug={anmerkungen?.werkzeug ?? ''} data-entwurf={anmerkungen?.entwurf.length ?? -1}>
            {anmerkungen && (
                <button type="button" onClick={() => anmerkungen.onNeu({ page: 1, kind: anmerkungen.werkzeug ?? 'note', rect: [10, 10, 110, 30], contents: '', color: [0, 0, 1], reply_to: null })}>
                    Geste
                </button>
            )}
            {anmerkungen?.werkzeug === 'link' && anmerkungen.links && [
                ...anmerkungen.links.gespeichert.filter(l => !anmerkungen.links!.geloescht.has(l.id)).map(l => ({ id: l.id, page: l.page, ziel: anmerkungen.links!.zielText(l) })),
                ...anmerkungen.entwurf.filter(a => a.kind === 'link').map(a => ({ id: a.client_id, page: a.page, ziel: anmerkungen.links!.zielText(a) })),
            ].map(k => (
                <button key={k.id} type="button" data-testid={`link-${k.id}`} onClick={() => anmerkungen.links!.onKlick(k.id, k.page, k.ziel)}>{k.ziel}</button>
            ))}
        </div>
    ),
}));

/** Seite 2 trägt einen gespeicherten Web-Link (Kennung 20R), Seite 3 einen mit Ziel im Dokument (21R). */
function seite(n: number) {
    return {
        rotate: 0,
        view: [0, 0, 595, 842],
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => (n === 2
            ? [{ id: '20R', annotationType: 2, rect: [50, 50, 150, 70], url: 'https://example.org/alt' }]
            : n === 3 ? [{ id: '21R', annotationType: 2, rect: [50, 90, 150, 110], dest: [{ num: 5, gen: 0 }, { name: 'Fit' }] }] : []),
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

async function oeffnen(h: PdfHost) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={vi.fn()} />);
    await screen.findByTestId('leseansicht');
}
const leseansicht = () => screen.getByTestId('leseansicht');

async function linkWerkzeug() {
    reiterWaehlen('Einfügen');
    fireEvent.click(bandKnopf('Link'));
    await waitFor(() => expect(leseansicht().dataset.werkzeug).toBe('link'));
}

async function speichern(h: ReturnType<typeof gastgeber>): Promise<CommitBefehl> {
    fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
    await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
    return vi.mocked(h.speichern).mock.calls[0][0] as CommitBefehl;
}

describe('Reiter Einfügen (Etappe 9, Abschnitt 4)', () => {
    it('erscheint mit Kommentar- und Bearbeitungsrecht neben Kommentieren; nicht mit Leserecht, nicht im Wiki', async () => {
        await oeffnen(gastgeber({}, info({ access: 'comment' })));
        expect(reiter('Einfügen')).toBeInTheDocument();
        reiterWaehlen('Einfügen');
        expect(bandKnopf('Link')).toBeEnabled();
        cleanup();
        await oeffnen(gastgeber({}, info({ access: 'view' })));
        expect(reiter('Einfügen')).toBeNull();
        cleanup();
        await oeffnen(gastgeber({ speichern: undefined, zielWaehlen: undefined }));
        expect(reiter('Einfügen')).toBeNull();
    });
});

describe('Link anlegen (Etappe 9, Abschnitt 4)', () => {
    it('Rechteck aufziehen → Dialog: nur http, https, mailto; der Commit trägt kind link mit uri', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        await oeffnen(h);
        await linkWerkzeug();
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        const dialog = await screen.findByRole('dialog', { name: 'Link anlegen' });
        const feld = within(dialog).getByRole('textbox', { name: 'Web-Adresse' });
        for (const schlecht of ['javascript:alert(1)', 'example.org', 'file:///etc/passwd', '']) {
            fireEvent.change(feld, { target: { value: schlecht } });
            fireEvent.click(within(dialog).getByRole('button', { name: 'Link anlegen' }));
            expect(within(dialog).getByRole('alert')).toHaveTextContent('Nur vollständige http-, https- und mailto-Adressen');
        }
        expect(leseansicht().dataset.entwurf).toBe('0');
        fireEvent.change(feld, { target: { value: 'https://example.org/neu' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Link anlegen' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link anlegen' })).toBeNull());
        expect(leseansicht().dataset.entwurf).toBe('1');
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);
        // Das Werkzeug bleibt gewählt; der neue Link ist als Umrandung da, nicht in der Kommentarliste.
        expect(leseansicht().dataset.werkzeug).toBe('link');
        expect(screen.getByTestId('link-tmp-1')).toHaveTextContent('Web-Adresse: https://example.org/neu');
        const befehl = await speichern(h);
        expect(befehl.pages).toBeUndefined();
        expect(befehl.annotations).toEqual({
            add: [{ client_id: 'tmp-1', page: 1, kind: 'link', rect: [10, 10, 110, 30], contents: '', color: [0, 0, 1], reply_to: null, uri: 'https://example.org/neu' }],
        });
    });

    it('Ziel im Dokument: Seite n (ab 1) wird als page_target (ab 0) geschickt; Abbrechen legt nichts an', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await linkWerkzeug();
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        let dialog = await screen.findByRole('dialog', { name: 'Link anlegen' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
        expect(screen.queryByRole('dialog', { name: 'Link anlegen' })).toBeNull();
        expect(leseansicht().dataset.entwurf).toBe('0');

        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        dialog = await screen.findByRole('dialog', { name: 'Link anlegen' });
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Seite im Dokument' }));
        const seiteFeld = within(dialog).getByRole('textbox', { name: 'Seite (1–3)' });
        fireEvent.change(seiteFeld, { target: { value: '7' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Link anlegen' }));
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Seite 7 gibt es nicht – das Dokument hat 3 Seiten.');
        fireEvent.change(seiteFeld, { target: { value: '3' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Link anlegen' }));
        await waitFor(() => expect(leseansicht().dataset.entwurf).toBe('1'));
        expect(screen.getByTestId('link-tmp-1')).toHaveTextContent('Ziel: Seite 3');
        const befehl = await speichern(h);
        expect(befehl.annotations?.add?.[0]).toMatchObject({ kind: 'link', page_target: 2 });
        expect(befehl.annotations?.add?.[0]).not.toHaveProperty('uri');
    });
});

describe('Links löschen (Etappe 9, Abschnitt 4)', () => {
    it('mit dem Link-Werkzeug zeigt die Leseansicht die gespeicherten Links; ein Klick öffnet das Löschen; der Commit trägt delete', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        await oeffnen(h);
        expect(screen.queryByTestId('link-20R')).toBeNull();
        await linkWerkzeug();
        const alt = await screen.findByTestId('link-20R');
        expect(alt).toHaveTextContent('Web-Adresse: https://example.org/alt');
        expect(screen.getByTestId('link-21R')).toHaveTextContent('Ziel im Dokument');
        fireEvent.click(alt);
        const dialog = await screen.findByRole('dialog', { name: 'Link' });
        expect(within(dialog).getByText('Web-Adresse: https://example.org/alt')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Link löschen' }));
        await waitFor(() => expect(screen.queryByTestId('link-20R')).toBeNull());
        expect(screen.getByTestId('link-21R')).toBeInTheDocument();
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);
        const befehl = await speichern(h);
        expect(befehl.annotations).toEqual({ delete: [{ ref: '20R', page: 1 }] });
    });

    it('ein neuer Link verschwindet beim Löschen sofort; Rückgängig bringt ihn zurück', async () => {
        const h = gastgeber();
        await oeffnen(h);
        await linkWerkzeug();
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        const dialog = await screen.findByRole('dialog', { name: 'Link anlegen' });
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Web-Adresse' }), { target: { value: 'mailto:info@example.org' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Link anlegen' }));
        const neu = await screen.findByTestId('link-tmp-1');
        fireEvent.click(neu);
        const loeschen = await screen.findByRole('dialog', { name: 'Link' });
        expect(within(loeschen).getByText(/\(Entwurf\)/)).toBeInTheDocument();
        fireEvent.click(within(loeschen).getByRole('button', { name: 'Link löschen' }));
        await waitFor(() => expect(leseansicht().dataset.entwurf).toBe('0'));
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'z', ctrlKey: true });
        await waitFor(() => expect(leseansicht().dataset.entwurf).toBe('1'));
        expect(screen.getByTestId('link-tmp-1')).toBeInTheDocument();
    });
});

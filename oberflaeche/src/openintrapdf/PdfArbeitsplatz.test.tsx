// SPDX-License-Identifier: Apache-2.0
//
// Arbeitsplatz mit gemocktem Gastgeber und gemocktem pdf.js.
//
// jsdom kann kein Canvas; geprüft werden Bedienelemente und Abläufe, nicht
// das Rendern. Die Leseansicht (pdf.js PDFViewer) ist durch einen Platzhalter
// ersetzt. Alle Daten sind erfunden.
//
// Seit Etappe 7 führt der Weg zu den Werkzeugen über das Werkzeugband: Reiter
// wählen, Knopf im Band drücken. Das Arbeitsfach rechts zeigt die
// unveränderten Werkzeuggruppen; wo Band und Fach denselben Knopf tragen,
// sagt der Test, welchen er meint.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { band, bandKnopf, fach, reiter, reiterWaehlen } from '../test/werkzeugband';
import { spracheDeutsch } from '../test/sprache';
import { PdfArbeitsplatz } from './PdfArbeitsplatz';
import { PdfHostFehler } from './typen';
import type { CommitBefehl, PdfHost, PdfInfo } from './typen';

vi.mock('./pdfjsLaden', () => ({
    pdfjsLaden: vi.fn(async () => bibliothek),
    viewerStilEinhaengen: () => () => undefined,
}));
// Die Leseansicht (pdf.js) ist ein Platzhalter. Er zeigt, ob und welches
// Werkzeug er bekommt, und ein Knopf „Geste“ spielt eine Geste des
// Werkzeugs auf Seite 2 (Quellseite 1) ein — die Umrechnung selbst prüft
// koordinaten.test.ts gegen die pdf.js-Formeln.
interface LeseMock {
    sichtbar: boolean;
    anmerkungen?: {
        werkzeug: string | null;
        entwurf: unknown[];
        stil: { color: number[]; stamp?: unknown };
        unterschrift?: string;
        onNeu: (a: unknown) => void;
    };
}
vi.mock('./Leseansicht', () => ({
    Leseansicht: ({ sichtbar, anmerkungen }: LeseMock) => (
        <div data-testid="leseansicht" hidden={!sichtbar} data-werkzeug={anmerkungen?.werkzeug ?? ''} data-entwurf={anmerkungen?.entwurf.length ?? -1}
            data-unterschrift={anmerkungen?.unterschrift ?? ''}>
            {anmerkungen && (
                <button type="button" onClick={() => {
                    const w = anmerkungen.werkzeug ?? 'note';
                    // Wie die echte Ebene: Post-it und Stempel nehmen Farbe (und Stempelangabe)
                    // aus dem Stil; ein Stempel ohne Angabe ergibt nichts.
                    if (w === 'stamp' && !anmerkungen.stil.stamp) return;
                    const eigen = w === 'sticky' || w === 'stamp';
                    anmerkungen.onNeu({
                        page: 1, kind: w, rect: [10, 10, 30, 30], contents: '', color: eigen ? anmerkungen.stil.color : [1, 0, 0], reply_to: null,
                        ...(w === 'stamp' ? { stamp: anmerkungen.stil.stamp } : {}),
                    });
                }}>
                    Geste
                </button>
            )}
        </div>
    ),
}));

/** Seite 1 trägt eine gespeicherte Notiz von „Anna“ (Kennung 12R). */
function seite(n: number) {
    return {
        rotate: 0,
        getViewport: () => ({ width: 100, height: 141 }),
        render: () => ({ promise: Promise.resolve(), cancel() { /* nichts */ } }),
        getTextContent: async () => ({ items: [{ str: `Seite ${n}` }] }),
        getAnnotations: async () => (n === 1 ? [{
            id: '12R', annotationType: 1, rect: [50, 50, 70, 70], contentsObj: { str: 'Bitte Termin prüfen' },
            titleObj: { str: 'Anna' }, modificationDate: 'D:20260929100000', inReplyTo: null, state: null,
        }] : []),
    };
}

const dokument = { numPages: 3, getPage: async (n: number) => seite(n), getOutline: async () => null };

const bibliothek = {
    pdfjs: {
        getDocument: vi.fn(() => ({ promise: Promise.resolve(dokument), destroy: vi.fn(async () => undefined), onPassword: null })),
        PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
        AnnotationMode: { ENABLE: 1 },
    },
    viewer: {},
    viewerStil: '',
    dokumentOptionen: {
        wasmUrl: 'https://probe.example/pdfjs/wasm/', cMapUrl: 'https://probe.example/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: 'https://probe.example/pdfjs/standard_fonts/', iccUrl: 'https://probe.example/pdfjs/iccs/',
    },
};

function info(ueber: Partial<PdfInfo> = {}): PdfInfo {
    return {
        file_id: 'f1', name: 'Angebot.pdf', version: 12, sha256: 'abc', size: 1000, access: 'edit',
        inspection: { pages: 3, annotations: 1 },
        capabilities: { pages: { state: 'available' }, annotations: { state: 'available' } },
        ...ueber,
    };
}

function gastgeber(ueber: Partial<PdfHost> = {}, dateiInfo: PdfInfo = info()): PdfHost & { speichern: ReturnType<typeof vi.fn> } {
    return {
        laden: vi.fn(async () => ({ daten: new ArrayBuffer(8), version: dateiInfo.version, sha256: dateiInfo.sha256, info: dateiInfo })),
        herunterladen: vi.fn(async () => undefined),
        drucken: vi.fn(async () => undefined),
        speichern: vi.fn(),
        zielWaehlen: vi.fn(async () => ({ drive_id: '', folder_id: null, name: 'Kopie' })),
        ...ueber,
    } as PdfHost & { speichern: ReturnType<typeof vi.fn> };
}

beforeAll(async () => {
    await spracheDeutsch();
    // jsdom zeichnet nicht; die Miniaturen bekommen ein leeres Bild.
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => cleanup());

async function oeffnen(h: PdfHost, onClose = vi.fn()) {
    render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={onClose} />);
    await screen.findByTestId('leseansicht');
    return onClose;
}

/** Bearbeiten einschalten (Reiter Seiten), erste Seite wählen, im Band nach rechts drehen. */
async function ersteSeiteDrehen(h: PdfHost) {
    await oeffnen(h);
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(reiter('Seiten')).toHaveAttribute('aria-selected', 'true');
    const kacheln = await screen.findAllByRole('option');
    expect(kacheln).toHaveLength(3);
    fireEvent.click(kacheln[0]);
    fireEvent.click(bandKnopf('90° rechts'));
    await screen.findAllByText('Änderungen im Entwurf');
}

const gespeichert = { file_id: 'f1', version: 13, sha256: 'def', name: 'Angebot.pdf' };

describe('XFA-Formular und Hilfsdateien von pdf.js (2345)', () => {
    it('lädt mit enableXfa und den Hilfsdateien und sagt, dass das Formular nur angezeigt wird', async () => {
        bibliothek.pdfjs.getDocument.mockClear();
        await oeffnen(gastgeber({}, info({ inspection: { pages: 1, xfa: true } })));
        const optionen = (bibliothek.pdfjs.getDocument.mock.calls as unknown as [Record<string, unknown>][])[0][0];
        expect(optionen.enableXfa).toBe(true);
        expect(optionen.wasmUrl).toBe('https://probe.example/pdfjs/wasm/');
        expect(optionen.cMapUrl).toBe('https://probe.example/pdfjs/cmaps/');
        expect(optionen.standardFontDataUrl).toBe('https://probe.example/pdfjs/standard_fonts/');
        expect(await screen.findByText(/XFA-Formular \(Adobe LiveCycle\): OpenIntraPDF zeigt es an/)).toBeInTheDocument();
    });

    it('ohne XFA kein Hinweis', async () => {
        await oeffnen(gastgeber());
        expect(screen.queryByText(/XFA-Formular/)).toBeNull();
    });
});

describe('Lesen', () => {
    it('ein Gastgeber ohne speichern hat keinen Bearbeiten-Modus', async () => {
        const h = gastgeber({ speichern: undefined, zielWaehlen: undefined, extrahieren: undefined });
        await oeffnen(h);
        expect(await screen.findByText('Nur lesen – das Original bleibt unverändert')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        expect(reiter('Seiten')).toBeNull();
    });

    it('mit Leserecht (access view) gibt es keinen Bearbeiten-Knopf, auch wenn der Gastgeber speichern könnte', async () => {
        await oeffnen(gastgeber({}, info({ access: 'view' })));
        await screen.findByText(/Nur Leserecht/);
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    });

    it('zeigt „Seite x von y“ und die Kopfdaten', async () => {
        await oeffnen(gastgeber());
        expect(screen.getByText('von 3')).toBeInTheDocument();
        expect(screen.getByText('Fassung 12 · 3 Seiten')).toBeInTheDocument();
    });

    it('Schließen ohne Entwurf schließt sofort', async () => {
        const onClose = await oeffnen(gastgeber());
        fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('Seiten verwalten', () => {
    it('Drehen landet im Entwurf; Rückgängig und Wiederholen per Tastatur', async () => {
        const h = gastgeber();
        await ersteSeiteDrehen(h);
        expect(screen.getByText('90°')).toBeInTheDocument();
        const wurzel = screen.getByRole('dialog', { name: /OpenIntraPDF/ });
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true });
        expect(screen.queryByText('90°')).toBeNull();
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true, shiftKey: true });
        expect(screen.getByText('90°')).toBeInTheDocument();
    });

    it('die letzte Seite lässt sich nicht entfernen', async () => {
        await oeffnen(gastgeber());
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        await screen.findAllByRole('option');
        fireEvent.click(bandKnopf('Alle wählen'));
        fireEvent.click(bandKnopf('Entfernen'));
        expect((await screen.findAllByText(/die letzte Seite lässt sich nicht entfernen/)).length).toBeGreaterThan(0);
        expect(screen.queryByText('wird entfernt')).toBeNull();
    });

    it('Schließen mit Entwurf fragt nach: Speichern, Verwerfen, Weiter bearbeiten', async () => {
        const onClose = vi.fn();
        // Die Desktop-App lässt damit ein wartendes zweites Dokument fallen (Review 07.10.2026).
        const onSchliessenAbgebrochen = vi.fn();
        // Drive hält damit das Verlassen der Seite an (useBlocker, 07.10.2026).
        const onEntwurf = vi.fn();
        const h = gastgeber();
        render(<PdfArbeitsplatz host={h} name="Angebot.pdf" onClose={onClose} onSchliessenAbgebrochen={onSchliessenAbgebrochen} onEntwurf={onEntwurf} />);
        await screen.findByTestId('leseansicht');
        expect(onEntwurf).toHaveBeenLastCalledWith(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
        fireEvent.click((await screen.findAllByRole('option'))[1]);
        fireEvent.click(bandKnopf('90° links'));
        await waitFor(() => expect(onEntwurf).toHaveBeenLastCalledWith(true));
        fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
        expect(await screen.findByText('Ungespeicherte Änderungen')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
        expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull();
        expect(onSchliessenAbgebrochen).toHaveBeenCalledTimes(1);
        // Esc bricht genauso ab.
        fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
        fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }), { key: 'Escape' });
        await waitFor(() => expect(onSchliessenAbgebrochen).toHaveBeenCalledTimes(2));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
        expect(onClose).toHaveBeenCalled();
        expect(onSchliessenAbgebrochen).toHaveBeenCalledTimes(2);
    });
});

describe('Speichern', () => {
    it('Erfolg: Befehl laut Vertrag, „Gespeichert als Fassung N“, Dokument neu geladen', async () => {
        const h = gastgeber();
        h.speichern.mockResolvedValue(gespeichert);
        await ersteSeiteDrehen(h);
        (h.laden as ReturnType<typeof vi.fn>).mockResolvedValue({
            daten: new ArrayBuffer(8), version: 13, sha256: 'def', info: info({ version: 13, sha256: 'def' }),
        });
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl, schluessel] = h.speichern.mock.calls[0] as [CommitBefehl, string];
        expect(befehl).toEqual({
            expected_version: 12,
            expected_sha256: 'abc',
            pages: [{ source: 0, rotate: 90 }, { source: 1, rotate: 0 }, { source: 2, rotate: 0 }],
            destination: { kind: 'new_version' },
        });
        expect(schluessel).toMatch(/^[0-9a-f-]{36}$/);
        expect((await screen.findAllByText('Gespeichert als Fassung 13')).length).toBeGreaterThan(0);
        await waitFor(() => expect(h.laden).toHaveBeenCalledTimes(2));
        await screen.findByText('Fassung 13 · 3 Seiten');
    });

    it('412: „Datei wurde inzwischen geändert“, der Entwurf bleibt, „Als neue Datei speichern“ wird angeboten', async () => {
        const h = gastgeber();
        h.speichern.mockRejectedValueOnce(new PdfHostFehler(412, 'pdf.version_conflict', { current_version: 14 }));
        await ersteSeiteDrehen(h);
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        expect((await screen.findAllByText('Datei wurde inzwischen geändert')).length).toBeGreaterThan(0);
        expect(screen.getByText(/Aktuell ist Fassung 14/)).toBeInTheDocument();
        // Entwurf ist noch da, nichts wurde neu geladen.
        expect(screen.getByText('90°')).toBeInTheDocument();
        expect(h.laden).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Neu laden (Entwurf verwerfen)' })).toBeInTheDocument();

        h.speichern.mockResolvedValueOnce({ ...gespeichert, file_id: 'f2', version: 1, name: 'Kopie.pdf' });
        fireEvent.click(screen.getByRole('button', { name: 'Als neue Datei speichern' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(2));
        const [erster, s1] = h.speichern.mock.calls[0] as [CommitBefehl, string];
        const [zweiter, s2] = h.speichern.mock.calls[1] as [CommitBefehl, string];
        expect(h.zielWaehlen).toHaveBeenCalledWith({ zweck: 'neue_datei', name: 'Angebot (bearbeitet).pdf' });
        expect(zweiter.destination).toEqual({ kind: 'new_file', drive_id: '', folder_id: null, name: 'Kopie.pdf' });
        expect(zweiter.pages).toEqual(erster.pages);
        expect(s2).not.toBe(s1);
        expect((await screen.findAllByText('Als neue Datei gespeichert: Kopie.pdf')).length).toBeGreaterThan(0);
    });

    it('Netzfehler: „Erneut versuchen“ schickt denselben Idempotency-Key', async () => {
        const h = gastgeber();
        h.speichern
            .mockRejectedValueOnce(new PdfHostFehler(0, 'network'))
            .mockRejectedValueOnce(new PdfHostFehler(503, 'error.internal'))
            .mockResolvedValueOnce(gespeichert);
        await ersteSeiteDrehen(h);
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        expect((await screen.findAllByText('Speichern fehlgeschlagen')).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(2));
        await screen.findByRole('button', { name: 'Erneut versuchen' });
        // Auch ein erneuter Klick auf Speichern ist derselbe Vorgang.
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(3));
        const schluessel = h.speichern.mock.calls.map(c => c[1]);
        expect(new Set(schluessel).size).toBe(1);
        expect(h.speichern.mock.calls[2][0]).toEqual(h.speichern.mock.calls[0][0]);
    });

    it('422 preservation_failed: Bericht, erst nach Bestätigung mit accept_losses', async () => {
        const h = gastgeber();
        h.speichern.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.preservation_failed', {
            report: { bookmarks_before: 3, bookmarks_after: 0, attachments_before: 1, attachments_after: 1 },
        }));
        await ersteSeiteDrehen(h);
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        expect(await screen.findByText('Beim Speichern ginge etwas verloren')).toBeInTheDocument();
        expect(screen.getByText('Lesezeichen')).toBeInTheDocument();
        // Ohne Bestätigung geht nichts hinaus.
        await act(async () => { await Promise.resolve(); });
        expect(h.speichern).toHaveBeenCalledTimes(1);

        h.speichern.mockResolvedValueOnce(gespeichert);
        fireEvent.click(screen.getByRole('button', { name: 'Verluste annehmen und speichern' }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(2));
        const [erster, s1] = h.speichern.mock.calls[0] as [CommitBefehl, string];
        const [zweiter, s2] = h.speichern.mock.calls[1] as [CommitBefehl, string];
        expect(erster.accept_losses).toBeUndefined();
        expect(zweiter.accept_losses).toEqual(['bookmarks']);
        expect(zweiter.pages).toEqual(erster.pages);
        // Anderer Rumpf, also neuer Vorgang — sonst 409 idempotency_mismatch.
        expect(s2).not.toBe(s1);
    });

    it('422 abbrechen: Entwurf bleibt, nichts wird gesendet', async () => {
        const h = gastgeber();
        h.speichern.mockRejectedValueOnce(new PdfHostFehler(422, 'pdf.preservation_failed', {
            report: { form_fields_before: 2, form_fields_after: 0 },
        }));
        await ersteSeiteDrehen(h);
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await screen.findByText('Beim Speichern ginge etwas verloren');
        fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
        expect(screen.queryByText('Beim Speichern ginge etwas verloren')).toBeNull();
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);
        expect(h.speichern).toHaveBeenCalledTimes(1);
    });

    it('signiertes Original: Hinweis, Speichern nur als neue Datei', async () => {
        const h = gastgeber({}, info({ inspection: { pages: 3, signed: true }, capabilities: { pages: { state: 'blocked_by_document', reason: 'signed_original' } } }));
        h.speichern.mockResolvedValue({ ...gespeichert, file_id: 'f2', version: 1, name: 'Kopie.pdf' });
        await ersteSeiteDrehen(h);
        expect(screen.getByText(/Signatur vorhanden; Gültigkeit nicht geprüft/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Als neue Fassung speichern/ })).toBeNull();
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 's', ctrlKey: true });
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        expect((h.speichern.mock.calls[0][0] as CommitBefehl).destination.kind).toBe('new_file');
    });
});

// ---------------------------------------------------------------------
// Etappe 2: Kommentieren
// ---------------------------------------------------------------------

const leseansicht = () => screen.getByTestId('leseansicht');

/** Reiter „Kommentieren“ wählen und das Werkzeug im Band drücken. */
async function werkzeugWaehlen(name: string) {
    await screen.findByTestId('leseansicht');
    reiterWaehlen('Kommentieren');
    fireEvent.click(bandKnopf(name));
}

/** Reiter „Kommentieren“ wählen und die Kommentarliste im Arbeitsfach öffnen. */
async function kommentarlisteOeffnen() {
    await screen.findByTestId('leseansicht');
    reiterWaehlen('Kommentieren');
    fireEvent.click(bandKnopf('Kommentarliste'));
}

describe('Kommentieren: Rechte', () => {
    it('view: Liste ohne Werkzeuge, keine Überlagerung', async () => {
        await oeffnen(gastgeber({}, info({ access: 'view' })));
        expect(reiter('Kommentieren')).toBeNull();
        // Wer nicht kommentieren darf, findet die Liste im Reiter Start.
        fireEvent.click(await screen.findByRole('button', { name: 'Kommentare' }));
        expect(await screen.findByText('Anna')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Notiz' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Antworten' })).toBeNull();
        expect(leseansicht().dataset.entwurf).toBe('-1');
    });

    it('comment: Werkzeuge und Speichern, aber kein Bearbeiten-Modus und keine neue Datei', async () => {
        await oeffnen(gastgeber({}, info({ access: 'comment' })));
        expect(await screen.findByText(/Kommentarrecht/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Als neue Datei speichern/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Als neue Fassung speichern/ })).toBeDisabled();
        reiterWaehlen('Kommentieren');
        expect(bandKnopf('Notiz')).toBeInTheDocument();
        expect(bandKnopf('Hervorheben')).toBeInTheDocument();
        expect(bandKnopf('Gelb')).toBeInTheDocument();
        expect(leseansicht().dataset.entwurf).toBe('0');
    });

    it('edit: Seiten verwalten UND Kommentieren', async () => {
        await oeffnen(gastgeber());
        expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
        expect(reiter('Kommentieren')).toBeInTheDocument();
        expect(reiter('Seiten')).toBeInTheDocument();
    });

    it('Wiki (Gastgeber ohne speichern): nie Werkzeuge, auch nicht mit edit-Info', async () => {
        await oeffnen(gastgeber({ speichern: undefined, zielWaehlen: undefined, extrahieren: undefined }));
        expect(reiter('Kommentieren')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: 'Kommentare' }));
        expect(await screen.findByText('Anna')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Notiz' })).toBeNull();
        expect(leseansicht().dataset.entwurf).toBe('-1');
    });

    it('Fähigkeit nicht verfügbar: keine Werkzeuge, dafür der Grund', async () => {
        await oeffnen(gastgeber({}, info({ capabilities: { pages: { state: 'available' }, annotations: { state: 'unsupported', reason: 'xfa' } } })));
        expect(reiter('Kommentieren')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: 'Kommentare' }));
        expect(await screen.findByText('Anmerkungen lassen sich in dieser Datei nicht speichern (xfa).')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Notiz' })).toBeNull();
    });
});

describe('Kommentieren: Entwurf und Speichern', () => {
    it('comment: Notiz setzen → Fokus im Textfeld, Werkzeug aus; Speichern OHNE pages, nur als neue Fassung; danach leer', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        h.speichern.mockResolvedValue({ ...gespeichert, annotations: { added: [{ client_id: 'tmp-1', ref: '31R', nm: 'u' }] } });
        await oeffnen(h);
        await werkzeugWaehlen('Notiz');
        expect(leseansicht().dataset.werkzeug).toBe('note');
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);
        expect(leseansicht().dataset.werkzeug).toBe('');
        expect(leseansicht().dataset.entwurf).toBe('1');
        const feld = await screen.findByLabelText('Text der Anmerkung');
        await waitFor(() => expect(document.activeElement).toBe(feld));
        fireEvent.change(feld, { target: { value: 'Bitte prüfen' } });
        expect(screen.getByText('1 im Entwurf', { exact: false })).toBeInTheDocument();

        (h.laden as ReturnType<typeof vi.fn>).mockResolvedValue({
            daten: new ArrayBuffer(8), version: 13, sha256: 'def', info: info({ access: 'comment', version: 13, sha256: 'def' }),
        });
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl).toEqual({
            expected_version: 12,
            expected_sha256: 'abc',
            destination: { kind: 'new_version' },
            annotations: {
                add: [{ client_id: 'tmp-1', page: 1, kind: 'note', rect: [10, 10, 30, 30], contents: 'Bitte prüfen', color: [1, 0, 0], reply_to: null }],
            },
        });
        expect(befehl).not.toHaveProperty('pages');
        expect((await screen.findAllByText('Gespeichert als Fassung 13')).length).toBeGreaterThan(0);
        await waitFor(() => expect(h.laden).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(leseansicht().dataset.entwurf).toBe('0'));
    });

    it('Antwort auf eine gespeicherte Anmerkung: reply_to = „12R“ auf deren Seite', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        h.speichern.mockResolvedValue(gespeichert);
        await oeffnen(h);
        await kommentarlisteOeffnen();
        await screen.findByText('Anna');
        fireEvent.click(screen.getByRole('button', { name: 'Antworten' }));
        const feld = await screen.findByLabelText('Text der Anmerkung');
        await waitFor(() => expect(document.activeElement).toBe(feld));
        fireEvent.change(feld, { target: { value: 'Erledigt bis Freitag' } });
        expect(screen.getByText(/Antwort · Notiz · Seite 1/)).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 's', ctrlKey: true });
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.annotations?.add).toEqual([
            { client_id: 'tmp-1', page: 0, kind: 'note', rect: [50, 50, 70, 70], contents: 'Erledigt bis Freitag', color: [1, 0.839, 0.039], reply_to: '12R' },
        ]);
    });

    it('Erledigt setzen und Text einer gespeicherten Anmerkung ändern → state und update mit page', async () => {
        const h = gastgeber();
        h.speichern.mockResolvedValue(gespeichert);
        await oeffnen(h);
        await kommentarlisteOeffnen();
        await screen.findByText('Anna');
        fireEvent.click(screen.getByRole('button', { name: 'Als erledigt markieren' }));
        expect(await screen.findByRole('button', { name: 'Wieder öffnen' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Text ändern' }));
        fireEvent.change(await screen.findByLabelText('Text der Anmerkung'), { target: { value: 'Termin ist geprüft' } });
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.annotations).toEqual({
            update: [{ ref: '12R', page: 0, contents: 'Termin ist geprüft' }],
            state: [{ ref: '12R', page: 0, state: 'completed' }],
        });
        expect(befehl).not.toHaveProperty('pages');
    });

    it('comment: lehnt der Server das Löschen einer fremden Anmerkung ab (403), sagt die Anzeige, woran es liegt', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        h.speichern.mockRejectedValueOnce(new PdfHostFehler(403, 'auth.permission_denied'));
        await oeffnen(h);
        await kommentarlisteOeffnen();
        await screen.findByText('Anna');
        fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
        expect(await screen.findByText('Wird beim Speichern gelöscht.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        expect((await screen.findAllByText(/Ändern oder Löschen einer gespeicherten Anmerkung abgelehnt/)).length).toBeGreaterThan(0);
        expect((h.speichern.mock.calls[0][0] as CommitBefehl).annotations).toEqual({ delete: [{ ref: '12R', page: 0 }] });
        // Der Entwurf bleibt; „Behalten“ nimmt die Löschung zurück.
        fireEvent.click(screen.getByRole('button', { name: 'Behalten' }));
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
    });

    it('Esc beendet zuerst das Werkzeug, die Gruppe bleibt offen', async () => {
        await oeffnen(gastgeber({}, info({ access: 'comment' })));
        await werkzeugWaehlen('Freihand');
        expect(leseansicht().dataset.werkzeug).toBe('ink');
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'Escape' });
        expect(leseansicht().dataset.werkzeug).toBe('');
        // Die Gruppe bleibt offen (seit Etappe 8 ohne die Werkzeugknöpfe des Bands).
        expect(fach('Kommentieren')).toBeInTheDocument();
        expect(within(fach('Kommentieren')).getByText(/Kein Werkzeug gewählt/)).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('dialog', { name: /OpenIntraPDF/ }), { key: 'Escape' });
        expect(screen.queryByRole('region', { name: 'Kommentieren' })).toBeNull();
    });

    it('edit: Rückgängig läuft über Seiten- und Anmerkungsbefehle gemeinsam', async () => {
        const h = gastgeber();
        await ersteSeiteDrehen(h);
        fireEvent.click(screen.getByRole('button', { name: 'Lesen' }));
        await werkzeugWaehlen('Rechteck');
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        expect(leseansicht().dataset.entwurf).toBe('1');
        // Zeichenwerkzeuge bleiben aktiv — man zeichnet selten nur ein Rechteck.
        expect(leseansicht().dataset.werkzeug).toBe('square');
        const wurzel = screen.getByRole('dialog', { name: /OpenIntraPDF/ });
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true });
        expect(leseansicht().dataset.entwurf).toBe('0');
        expect((await screen.findAllByText('Änderungen im Entwurf')).length).toBeGreaterThan(0);
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true });
        expect((await screen.findAllByText('Unverändert')).length).toBeGreaterThan(0);
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true, shiftKey: true });
        fireEvent.keyDown(wurzel, { key: 'z', ctrlKey: true, shiftKey: true });
        expect(leseansicht().dataset.entwurf).toBe('1');
    });

    it('edit: eine entfernte Seite nimmt ihre Entwurfsanmerkungen mit — Hinweis im Raster, nichts davon im Befehl', async () => {
        const h = gastgeber();
        h.speichern.mockResolvedValue(gespeichert);
        await oeffnen(h);
        await werkzeugWaehlen('Ellipse');
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
        const kacheln = await screen.findAllByRole('option');
        fireEvent.click(kacheln[1]);
        expect(await screen.findByText(/tragen 1 Anmerkung aus dem Entwurf/)).toBeInTheDocument();
        fireEvent.click(bandKnopf('Entfernen'));
        expect(await screen.findByText('1 Anmerkung aus dem Entwurf entfällt')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.pages).toEqual([{ source: 0, rotate: 0 }, { source: 2, rotate: 0 }]);
        expect(befehl).not.toHaveProperty('annotations');
    });
});

// ---------------------------------------------------------------------
// Etappe 5: Post-it und Stempel
// ---------------------------------------------------------------------

describe('Post-it und Stempel', () => {
    afterEach(() => localStorage.clear());
    const dialog = () => screen.getByRole('dialog', { name: /OpenIntraPDF/ });

    it('Werkzeuge nur mit Anmerkungsrecht: comment zeigt Post-it und Stempel neben der unveränderten Notiz; view und Wiki nicht', async () => {
        await oeffnen(gastgeber({}, info({ access: 'comment' })));
        reiterWaehlen('Kommentieren');
        expect(await screen.findByRole('button', { name: 'Post-it' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Stempel' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Notiz' })).toBeInTheDocument();
        // Alle zwölf Werkzeuge stehen im Band (Etappe 8: nicht mehr zusätzlich im Arbeitsfach).
        const zwoelf = ['Notiz', 'Post-it', 'Textfeld', 'Hervorheben', 'Unterstreichen', 'Durchstreichen', 'Freihand', 'Linie', 'Pfeil', 'Rechteck', 'Ellipse', 'Stempel'];
        for (const name of zwoelf) expect(bandKnopf(name)).toBeInTheDocument();
        fireEvent.click(bandKnopf('Kommentarliste'));
        expect(within(fach('Kommentieren')).queryByRole('button', { name: 'Notiz' })).toBeNull();
        cleanup();

        await oeffnen(gastgeber({}, info({ access: 'view' })));
        expect(reiter('Kommentieren')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: 'Kommentare' }));
        await screen.findByText('Anna');
        expect(screen.queryByRole('button', { name: 'Post-it' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Stempel' })).toBeNull();
        cleanup();

        await oeffnen(gastgeber({ speichern: undefined, zielWaehlen: undefined, extrahieren: undefined }));
        fireEvent.click(await screen.findByRole('button', { name: 'Kommentare' }));
        await screen.findByText('Anna');
        expect(screen.queryByRole('button', { name: 'Post-it' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Stempel' })).toBeNull();
    });

    it('Post-it: Zettelfarbe wählbar, Klick legt den Zettel an und öffnet das Textfeld; Esc verwirft einen leeren Zettel; Befehl kind sticky mit Rect und Farbe', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        h.speichern.mockResolvedValue(gespeichert);
        await oeffnen(h);
        await werkzeugWaehlen('Post-it');
        expect(leseansicht().dataset.werkzeug).toBe('sticky');
        // Zettelfarbe im Band (Gruppe Aussehen); keine Strichstärke für den Zettel.
        expect(bandKnopf('Gelb')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('group', { name: 'Strichstärke' })).toBeNull();
        fireEvent.click(bandKnopf('Rosa'));
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        expect(leseansicht().dataset.werkzeug).toBe('');
        expect(leseansicht().dataset.entwurf).toBe('1');
        const feld = await screen.findByLabelText('Text der Anmerkung');
        await waitFor(() => expect(document.activeElement).toBe(feld));
        expect(screen.getByText(/Post-it · Seite 2/)).toBeInTheDocument();

        // Esc auf dem leeren Zettel nimmt ihn weg — die Gruppe bleibt offen.
        fireEvent.keyDown(dialog(), { key: 'Escape' });
        expect(leseansicht().dataset.entwurf).toBe('0');
        expect(fach('Kommentieren')).toBeInTheDocument();

        // Mit Text bleibt er und geht als sticky hinaus.
        fireEvent.click(bandKnopf('Post-it'));
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        fireEvent.change(await screen.findByLabelText('Text der Anmerkung'), { target: { value: 'Bitte gegenzeichnen' } });
        fireEvent.keyDown(dialog(), { key: 'Escape' });
        expect(leseansicht().dataset.entwurf).toBe('1');
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.annotations?.add).toEqual([
            { client_id: 'tmp-1', page: 1, kind: 'sticky', rect: [10, 10, 30, 30], contents: 'Bitte gegenzeichnen', color: [0.973, 0.733, 0.816], reply_to: null },
        ]);
        expect(befehl).not.toHaveProperty('pages');
    });

    it('Stempel: acht Stempel zur Wahl, Farbe vorbelegt, „Name und Datum“ an; ein Klick stempelt, der Eintrag hat kein Textfeld; Befehl kind stamp mit name/label/signed/lang', async () => {
        const h = gastgeber();
        h.speichern.mockResolvedValue(gespeichert);
        await oeffnen(h);
        await werkzeugWaehlen('Stempel');
        expect(leseansicht().dataset.werkzeug).toBe('stamp');
        expect(screen.getByRole('button', { name: 'Grau' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('checkbox', { name: 'Name und Datum' })).toBeChecked();
        // Ohne Person aus dem Gastgeber steht „Name“ vor dem Datum.
        expect(leseansicht().dataset.unterschrift).toMatch(/^Name · \d/);

        fireEvent.click(screen.getByRole('button', { name: 'Stempel wählen' }));
        const liste = await screen.findByRole('listbox');
        expect(within(liste).getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual([
            'ENTWURF', 'GEPRÜFT', 'FREIGEGEBEN', 'BEZAHLT', 'GEBUCHT', 'EINGEGANGEN', 'ERLEDIGT', 'VERTRAULICH', 'Eigener Text',
        ]);
        fireEvent.click(within(liste).getByRole('option', { name: 'GEPRÜFT' }));
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.getByRole('button', { name: 'Grün' })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        expect(leseansicht().dataset.werkzeug).toBe('');
        expect(leseansicht().dataset.entwurf).toBe('1');
        expect(screen.getByText('GEPRÜFT')).toBeInTheDocument();
        expect(screen.getByText(/Stempel · Seite 2/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Text der Anmerkung')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.annotations?.add).toEqual([{
            client_id: 'tmp-1', page: 1, kind: 'stamp', rect: [10, 10, 30, 30], contents: '', color: [0.18, 0.49, 0.196], reply_to: null,
            stamp: { label: 'GEPRÜFT', name: 'Checked', signed: true, lang: 'de' },
        }]);
    });

    it('Eigener Text: ohne Text ein Hinweis und kein Stempel; mit Text großgeschrieben, name Custom, Farbe und Haken wie gewählt', async () => {
        const h = gastgeber();
        h.speichern.mockResolvedValue(gespeichert);
        await oeffnen(h);
        await werkzeugWaehlen('Stempel');
        fireEvent.click(screen.getByRole('button', { name: 'Stempel wählen' }));
        fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Eigener Text' }));
        expect(await screen.findByText('Geben Sie einen Text ein, bevor Sie stempeln.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        expect(leseansicht().dataset.entwurf).toBe('0');

        fireEvent.change(screen.getByLabelText(/Eigener Stempeltext/), { target: { value: 'kopie für die akte' } });
        expect(screen.queryByText('Geben Sie einen Text ein, bevor Sie stempeln.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Blau' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Name und Datum' }));
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        fireEvent.keyDown(dialog(), { key: 's', ctrlKey: true });
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        const [befehl] = h.speichern.mock.calls[0] as [CommitBefehl];
        expect(befehl.annotations?.add?.[0]).toMatchObject({
            kind: 'stamp', color: [0.082, 0.396, 0.753], stamp: { label: 'KOPIE FÜR DIE AKTE', name: 'Custom', signed: false, lang: 'de' },
        });
    });

    it('die Wahl bleibt erhalten: Stempel, Stempelfarbe, Haken und Zettelfarbe überleben das Schließen', async () => {
        await oeffnen(gastgeber());
        await werkzeugWaehlen('Stempel');
        fireEvent.click(screen.getByRole('button', { name: 'Stempel wählen' }));
        fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'BEZAHLT' }));
        fireEvent.click(screen.getByRole('button', { name: 'Rot' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Name und Datum' }));
        fireEvent.click(bandKnopf('Post-it'));
        fireEvent.click(bandKnopf('Blau'));
        cleanup();

        await oeffnen(gastgeber());
        await werkzeugWaehlen('Stempel');
        expect(screen.getByRole('button', { name: 'Stempel wählen' })).toHaveTextContent('BEZAHLT');
        expect(screen.getByRole('button', { name: 'Rot' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('checkbox', { name: 'Name und Datum' })).not.toBeChecked();
        fireEvent.click(bandKnopf('Post-it'));
        expect(bandKnopf('Blau')).toHaveAttribute('aria-pressed', 'true');
    });

    it('nach dem Speichern zeigt der Bericht die Warnungen sticky_text_truncated und glyphs_missing übersetzt', async () => {
        const h = gastgeber({}, info({ access: 'comment' }));
        h.speichern.mockResolvedValue({ ...gespeichert, report: { warnings: ['sticky_text_truncated', 'glyphs_missing'] } });
        await oeffnen(h);
        await werkzeugWaehlen('Post-it');
        fireEvent.click(screen.getByRole('button', { name: 'Geste' }));
        fireEvent.change(await screen.findByLabelText('Text der Anmerkung'), { target: { value: 'Zażółć gęślą jaźń — 日本語' } });
        fireEvent.click(screen.getByRole('button', { name: /Als neue Fassung speichern/ }));
        await waitFor(() => expect(h.speichern).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/Der Text eines Post-its passte nicht ganz auf den Zettel/)).toBeInTheDocument();
        expect(screen.getByText(/Einige Zeichen kennt die eingebettete Schrift nicht/)).toBeInTheDocument();
        expect(screen.queryByText(/sticky_text_truncated|glyphs_missing/)).toBeNull();
    });
});

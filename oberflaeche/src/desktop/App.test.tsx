// SPDX-License-Identifier: Apache-2.0
//
// Ein zweites Dokument öffnen, während eines offen ist (Review 07.10.2026):
// Bis Bau 2342 ersetzte es einen Entwurf ohne Rückfrage, und die Go-Seite
// vergaß das alte Dokument nie. Der Arbeitsplatz ist hier eine Attrappe,
// die nur Entwurf und Rückfrage kennt; alle Daten sind erfunden.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Ref } from 'react';
import { spracheDeutsch } from '../test/sprache';
import { App } from './App';
import type { Bruecke, Geoeffnet } from './bruecke';

vi.mock('../openintrapdf/PdfArbeitsplatz', async () => {
    const { useImperativeHandle, useState } = await import('react');
    return {
        PdfArbeitsplatz: ({ name, onClose, onSchliessenAbgebrochen, befehle }: {
            name: string; onClose: () => void; onSchliessenAbgebrochen?: () => void; befehle?: Ref<unknown>;
        }) => {
            const [entwurf, setEntwurf] = useState(false);
            const [frage, setFrage] = useState(false);
            useImperativeHandle(befehle, () => ({
                schliessen: () => { if (entwurf) setFrage(true); else onClose(); },
                speichern: () => undefined, drucken: () => undefined, kopie: () => undefined,
            }));
            return (
                <div data-testid="arbeitsplatz" data-entwurf={entwurf}>
                    <span data-testid="name">{name}</span>
                    <button type="button" onClick={() => setEntwurf(true)}>Entwurf anlegen</button>
                    {frage && <p>Ungespeicherte Änderungen</p>}
                    {frage && <button type="button" onClick={() => { setFrage(false); onSchliessenAbgebrochen?.(); }}>Weiter bearbeiten</button>}
                    {frage && <button type="button" onClick={onClose}>Verwerfen</button>}
                </div>
            );
        },
    };
});

beforeAll(() => spracheDeutsch());
afterEach(cleanup);

const A: Geoeffnet = { id: 'a', name: 'Angebot.pdf' };
const B: Geoeffnet = { id: 'b', name: 'Bestellung.pdf' };
const C: Geoeffnet = { id: 'c', name: 'Checkliste.pdf' };

/** Brücke mit Protokoll; jede nicht genannte Methode antwortet leer. */
function bruecke(ueber: Partial<Bruecke> = {}) {
    const aufrufe: string[] = [];
    const basis: Partial<Bruecke> = {
        Start: async () => ({ person: 'Erika', ocr: '5.5.3', zuletzt: [], geoeffnet: A } as unknown as Awaited<ReturnType<Bruecke['Start']>>),
        Zuletzt: async () => [],
        ...ueber,
    };
    const b = new Proxy({} as Bruecke, {
        get: (_ziel, name: string) => (...args: unknown[]) => {
            aufrufe.push(`${name}(${args.map(a => JSON.stringify(a)).join(',')})`);
            const f = (basis as Record<string, ((...a: unknown[]) => unknown) | undefined>)[name];
            return f ? Promise.resolve(f(...args)) : Promise.resolve(undefined);
        },
    });
    return { b, aufrufe };
}

/** Ereignisse der Go-Seite, die der Test auslöst. */
function ereignisse() {
    const abos = new Map<string, (...daten: unknown[]) => void>();
    return {
        ereignis: (name: string, cb: (...daten: unknown[]) => void) => { abos.set(name, cb); return () => abos.delete(name); },
        senden: (name: string, ...daten: unknown[]) => act(() => { abos.get(name)?.(...daten); }),
    };
}

const offen = () => screen.getByTestId('name').textContent;

describe('Desktop-App: zweites Dokument öffnen', () => {
    it('mit Entwurf erst nach der Rückfrage; „Weiter bearbeiten“ behält Dokument und Entwurf', async () => {
        const { b, aufrufe } = bruecke();
        const e = ereignisse();
        render(<App bruecke={b} ereignis={e.ereignis} />);
        await waitFor(() => expect(offen()).toBe('Angebot.pdf'));
        fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));

        await e.senden('geoeffnet', B);
        expect(screen.getByText('Ungespeicherte Änderungen')).toBeInTheDocument();
        expect(offen()).toBe('Angebot.pdf');
        fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
        expect(offen()).toBe('Angebot.pdf');
        expect(screen.getByTestId('arbeitsplatz')).toHaveAttribute('data-entwurf', 'true');
        expect(aufrufe.filter(a => a.startsWith('Schliessen'))).toEqual([]);

        // Schließen über das Menü danach schließt A — und öffnet NICHT das verworfene B.
        await e.senden('menue', 'schliessen');
        fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
        await waitFor(() => expect(screen.queryByTestId('arbeitsplatz')).toBeNull());
        expect(aufrufe).toContain('Schliessen("a")');
    });

    it('„Verwerfen“ schließt das alte (auch in Go) und zeigt das neue ohne Entwurf', async () => {
        const { b, aufrufe } = bruecke();
        const e = ereignisse();
        render(<App bruecke={b} ereignis={e.ereignis} />);
        await waitFor(() => expect(offen()).toBe('Angebot.pdf'));
        fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));

        await e.senden('geoeffnet', B);
        fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
        await waitFor(() => expect(offen()).toBe('Bestellung.pdf'));
        expect(screen.getByTestId('arbeitsplatz')).toHaveAttribute('data-entwurf', 'false');
        expect(aufrufe).toContain('Schliessen("a")');
        expect(aufrufe).not.toContain('Schliessen("b")');
    });

    it('dieselbe Datei noch einmal ändert nichts; ohne Entwurf wird direkt gewechselt', async () => {
        const { b, aufrufe } = bruecke();
        const e = ereignisse();
        render(<App bruecke={b} ereignis={e.ereignis} />);
        await waitFor(() => expect(offen()).toBe('Angebot.pdf'));
        fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));

        await e.senden('geoeffnet', A);
        expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull();
        expect(screen.getByTestId('arbeitsplatz')).toHaveAttribute('data-entwurf', 'true');

        cleanup();
        const { b: b2, aufrufe: aufrufe2 } = bruecke();
        const e2 = ereignisse();
        render(<App bruecke={b2} ereignis={e2.ereignis} />);
        await waitFor(() => expect(offen()).toBe('Angebot.pdf'));
        await e2.senden('geoeffnet', C);
        await waitFor(() => expect(offen()).toBe('Checkliste.pdf'));
        expect(aufrufe2).toContain('Schliessen("a")');
        expect(aufrufe).not.toContain('Schliessen("a")');
    });

    it('auch der Öffnen-Dialog aus dem Menü fragt bei Entwurf nach', async () => {
        const { b } = bruecke({ OeffnenDialog: async () => C });
        const e = ereignisse();
        render(<App bruecke={b} ereignis={e.ereignis} />);
        await waitFor(() => expect(offen()).toBe('Angebot.pdf'));
        fireEvent.click(screen.getByRole('button', { name: 'Entwurf anlegen' }));

        await e.senden('menue', 'oeffnen');
        await screen.findByText('Ungespeicherte Änderungen');
        expect(offen()).toBe('Angebot.pdf');
        fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
        await waitFor(() => expect(offen()).toBe('Checkliste.pdf'));
    });
});

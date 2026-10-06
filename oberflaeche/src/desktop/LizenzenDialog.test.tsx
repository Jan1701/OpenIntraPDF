// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { spracheDeutsch } from '../test/sprache';
import { LizenzenDialog } from './LizenzenDialog';
import type { Lizenzauskunft } from './bruecke';

beforeAll(() => spracheDeutsch());
afterEach(cleanup);

const AUSKUNFT: Lizenzauskunft = {
    app: 'OpenIntraPDF', urheber: '© 2026 Jan Günther', lizenz: 'Apache-2.0', text: 'Apache License\nVersion 2.0',
    teile: [
        { gruppe: 'ocr', name: 'tesseract', fassung: '5.5.3', lizenz: 'Apache-2.0', text: 'TESSERACT-TEXT' },
        { gruppe: 'go', name: 'github.com/wailsapp/wails/v2', fassung: 'v2.16.0', lizenz: 'MIT', text: 'WAILS-TEXT' },
        { gruppe: 'js', name: 'react', fassung: '19.0.0', lizenz: 'MIT', text: 'REACT-TEXT' },
    ],
};

describe('LizenzenDialog', () => {
    it('zeigt Urheber, App-Lizenz und alle Teile nach Gruppen; Klick zeigt den Text', async () => {
        render(<LizenzenDialog bruecke={{ Lizenzen: () => Promise.resolve(AUSKUNFT) }} onSchliessen={() => {}} />);
        expect(await screen.findByText('© 2026 Jan Günther')).toBeInTheDocument();
        expect(screen.getByText('OpenIntraPDF ist freie Software unter der Apache-Lizenz 2.0.')).toBeInTheDocument();
        expect(screen.getByText('Texterkennung')).toBeInTheDocument();
        expect(screen.getByText('Go-Bibliotheken')).toBeInTheDocument();
        expect(screen.getByText('JavaScript-Bibliotheken')).toBeInTheDocument();
        expect(screen.queryByText('Schriften')).toBeNull();
        expect(screen.queryByText('WAILS-TEXT')).toBeNull();
        fireEvent.click(screen.getByText('github.com/wailsapp/wails/v2'));
        expect(screen.getByText('WAILS-TEXT')).toBeInTheDocument();
    });

    it('Suche filtert nach Name und Lizenz', async () => {
        render(<LizenzenDialog bruecke={{ Lizenzen: () => Promise.resolve(AUSKUNFT) }} onSchliessen={() => {}} />);
        const feld = await screen.findByPlaceholderText('Teil suchen …');
        fireEvent.change(feld, { target: { value: 'react' } });
        expect(screen.getByText('react')).toBeInTheDocument();
        expect(screen.queryByText('tesseract')).toBeNull();
        fireEvent.change(feld, { target: { value: 'gibtsnicht' } });
        expect(screen.getByText('Kein Teil gefunden.')).toBeInTheDocument();
    });

    it('Esc und der Schließen-Knopf schließen', async () => {
        const zu = vi.fn();
        render(<LizenzenDialog bruecke={{ Lizenzen: () => Promise.resolve(AUSKUNFT) }} onSchliessen={zu} />);
        await screen.findByText('© 2026 Jan Günther');
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Schließen' }));
        expect(zu).toHaveBeenCalledTimes(2);
    });

    it('Fehler beim Laden: Meldung', async () => {
        render(<LizenzenDialog bruecke={{ Lizenzen: () => Promise.reject(new Error('weg')) }} onSchliessen={() => {}} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Die Lizenztexte ließen sich nicht laden.');
    });
});

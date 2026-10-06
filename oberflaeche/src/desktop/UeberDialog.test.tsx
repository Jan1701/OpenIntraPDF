// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { spracheDeutsch } from '../test/sprache';
import { UeberDialog } from './UeberDialog';

beforeAll(() => spracheDeutsch());
afterEach(cleanup);

describe('UeberDialog (Linux, Windows)', () => {
    it('nennt Fassung mit Bau, Urheber und den Weg zu den Lizenzen', () => {
        const lizenzen = vi.fn();
        render(<UeberDialog fassung={{ fassung: '0.9.3', bau: '2343', urheber: '© 2026 Jan Günther' }}
            onLizenzen={lizenzen} onSchliessen={() => {}} />);
        expect(screen.getByRole('heading', { name: 'Über OpenIntraPDF' })).toBeInTheDocument();
        expect(screen.getByText('Version 0.9.3 (Bau 2343)')).toBeInTheDocument();
        expect(screen.getByText('© 2026 Jan Günther')).toBeInTheDocument();
        expect(screen.getByText(/stehen unter Hilfe → Lizenzen\./)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Lizenzen' }));
        expect(lizenzen).toHaveBeenCalled();
    });

    it('Esc schließt', () => {
        const zu = vi.fn();
        render(<UeberDialog fassung={{}} onLizenzen={() => {}} onSchliessen={zu} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(zu).toHaveBeenCalled();
    });
});

// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { spracheDeutsch } from '../test/sprache';
import { MENUE_SCHLUESSEL, menueTexte, ueberText } from './menue';
import en from '../locales/en/translation.json';
import ja from '../locales/ja/translation.json';

beforeAll(() => spracheDeutsch());

describe('Menütexte für die Go-Seite', () => {
    it('liefert jeden Schlüssel, den menue.go kennt, mit eingesetztem App-Namen', () => {
        const texte = menueTexte(i18next.t, { fassung: '0.9.3', bau: '2343', urheber: '© 2026 Jan Günther' });
        for (const k of MENUE_SCHLUESSEL) {
            expect(texte[k], k).toBeTruthy();
            expect(texte[k], k).not.toMatch(/openintrapdf\.desktop|\{\{/);
        }
        expect(texte.beenden).toBe('OpenIntraPDF beenden');
        expect(texte.ablage).toBe('Ablage');
    });

    it('Info-Fenster: Fassung mit Bau, Urheber, Weg zu den Lizenzen', () => {
        expect(ueberText(i18next.t, { fassung: '0.9.3', bau: '2343', urheber: '© 2026 Jan Günther' })).toBe(
            'PDF lesen, Seiten ordnen, kommentieren, Text erkennen, exportieren, binden.\n\n'
            + 'Version 0.9.3 (Bau 2343)\n© 2026 Jan Günther\n\n'
            + 'Freie Software unter der Apache-Lizenz 2.0. Die Lizenzen der mitgelieferten Teile stehen unter Hilfe → Lizenzen.');
    });

    it('jede Sprache hat alle Menüschlüssel (Stichprobe en, ja)', () => {
        for (const katalog of [en, ja]) {
            const menue = (katalog as { openintrapdf: { desktop: { menue: Record<string, string> } } }).openintrapdf.desktop.menue;
            for (const k of MENUE_SCHLUESSEL) expect(menue[k], k).toBeTruthy();
        }
    });
});

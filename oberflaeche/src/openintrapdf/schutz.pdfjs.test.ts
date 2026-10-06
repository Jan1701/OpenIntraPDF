// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Die geschuetzte Kopie des Go-Adapters (Etappe 9, Abschnitt 3) in pdf.js:
// ohne Kennwort verlangt pdf.js eines, ein falsches weist es ab, das
// Oeffnen-Kennwort und das Rechte-Kennwort oeffnen. getPermissions liefert
// die Rechte-Bits (hier: nur Drucken), und rechteAusFlags liest sie so, wie
// der Arbeitsplatz sperrt. Die Probe testdata/schutz-probe.pdf erzeugt
// openintrapdf/dokument/schutz_test.go (TestSchutzProbeSchreiben mit
// OIH_PROBE_ZIEL): Oeffnen-Kennwort „probe-oeffnen“, Rechte-Kennwort
// „probe-rechte“, zwei Textseiten.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getDocument, PasswordResponses, PermissionFlag } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FLAG, rechteAusFlags } from './rechte';

const probe = fileURLToPath(new URL('./testdata/schutz-probe.pdf', import.meta.url));
const daten = () => new Uint8Array(readFileSync(probe));

/** Oeffnet die Probe mit einem festen Kennwort; ohne Rueckfrage — die Antwort auf onPassword ist das Ergebnis. */
async function oeffnen(kennwort?: string) {
    const aufgabe = getDocument({ data: daten(), ...(kennwort === undefined ? {} : { password: kennwort }) });
    const antworten: number[] = [];
    aufgabe.onPassword = (_antwort: (pw: string) => void, grund: number) => {
        antworten.push(grund);
        // Nicht antworten: Die Aufgabe bleibt haengen — darum sofort zerstoeren.
        void aufgabe.destroy();
    };
    try {
        const dokument = await aufgabe.promise;
        return { dokument, aufgabe, antworten };
    } catch {
        return { dokument: null, aufgabe, antworten };
    }
}

describe('Geschuetzte Kopie in pdf.js', () => {
    it('die Probe ist AES-256 als Revision 6 (#250), nicht die veraltete Revision 5', () => {
        // Das Encrypt-Woerterbuch steht unverschluesselt in der Datei.
        const text = new TextDecoder('latin1').decode(daten());
        expect(text.startsWith('%PDF-2.0')).toBe(true);
        expect(text).toMatch(/\/R 6\b/);
        expect(text).not.toMatch(/\/R 5\b/);
    });

    it('ohne Kennwort fragt pdf.js nach, ein falsches weist es ab', async () => {
        const ohne = await oeffnen();
        expect(ohne.dokument).toBeNull();
        expect(ohne.antworten).toEqual([PasswordResponses.NEED_PASSWORD]);
        const falsch = await oeffnen('falsch-789');
        expect(falsch.dokument).toBeNull();
        expect(falsch.antworten).toEqual([PasswordResponses.INCORRECT_PASSWORD]);
    });

    it('das Oeffnen-Kennwort oeffnet; getPermissions nennt nur Drucken, rechteAusFlags sperrt den Rest', async () => {
        const { dokument, aufgabe } = await oeffnen('probe-oeffnen');
        expect(dokument).not.toBeNull();
        try {
            expect(dokument!.numPages).toBe(2);
            const flags = await dokument!.getPermissions();
            expect(flags).not.toBeNull();
            const menge = new Set(flags);
            expect(menge.has(PermissionFlag.PRINT)).toBe(true);
            expect(menge.has(PermissionFlag.COPY)).toBe(false);
            expect(menge.has(PermissionFlag.MODIFY_CONTENTS)).toBe(false);
            expect(menge.has(PermissionFlag.MODIFY_ANNOTATIONS)).toBe(false);
            // Die festen Flags des Arbeitsplatzes stimmen mit pdf.js ueberein.
            expect(FLAG.PRINT).toBe(PermissionFlag.PRINT);
            expect(FLAG.COPY).toBe(PermissionFlag.COPY);
            expect(FLAG.MODIFY_CONTENTS).toBe(PermissionFlag.MODIFY_CONTENTS);
            expect(FLAG.MODIFY_ANNOTATIONS).toBe(PermissionFlag.MODIFY_ANNOTATIONS);
            expect(FLAG.FILL_INTERACTIVE_FORMS).toBe(PermissionFlag.FILL_INTERACTIVE_FORMS);
            expect(FLAG.ASSEMBLE).toBe(PermissionFlag.ASSEMBLE);
            expect(FLAG.PRINT_HIGH_QUALITY).toBe(PermissionFlag.PRINT_HIGH_QUALITY);
            expect(rechteAusFlags(flags)).toEqual({ drucken: true, kopieren: false, aendern: false, kommentieren: false, ausfuellen: false });
            // Der Inhalt ist da: Die Textebene traegt die Seitenmarke.
            const text = await (await dokument!.getPage(1)).getTextContent();
            expect(text.items.map(i => ('str' in i ? i.str : '')).join(' ')).toContain('SEITE-01');
        } finally {
            await aufgabe.destroy();
        }
    });

    it('das Rechte-Kennwort oeffnet ebenfalls', async () => {
        const { dokument, aufgabe } = await oeffnen('probe-rechte');
        expect(dokument).not.toBeNull();
        expect(dokument!.numPages).toBe(2);
        await aufgabe.destroy();
    });
});

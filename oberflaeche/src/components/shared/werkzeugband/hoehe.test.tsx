// SPDX-License-Identifier: Apache-2.0
//
// Wie viel Höhe nimmt das Werkzeugband der Sicht weg? Gemessen über die
// gesetzten Klassen (test/werkzeugbandHoehe.ts), nicht geschätzt. Die Zahlen
// stehen auch im Kopf von Werkzeugband.tsx; ändert jemand eine Klasse, die die
// Höhe verschiebt, fällt es hier auf.

import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Archive, FolderInput, Mail, Printer, Reply, Save, Trash2 } from 'lucide-react';
import { spracheDeutsch } from '../../../test/sprache';
import { hoeheAusKlassen } from '../../../test/werkzeugbandHoehe';
import { Werkzeugband } from './Werkzeugband';
import type { WerkzeugbandDarstellung, WerkzeugbandDarstellungWert, WerkzeugbandReiter } from './typen';

const nichts = vi.fn();

/** Ein Reiter wie „Start“ im Mailclient: ein großer Teilungsknopf, kleine Knöpfe zu zweit, Menüknopf. */
const REITER: WerkzeugbandReiter[] = [{
    id: 'start',
    name: 'Start',
    gruppen: [
        { id: 'neu', name: 'Neu', knoepfe: [{ id: 'neu', text: 'Neue E-Mail', symbol: Mail, gross: true, onClick: nichts, menue: [{ id: 'termin', text: 'Termin', onClick: nichts }] }] },
        {
            id: 'loeschen', name: 'Löschen', knoepfe: [
                { id: 'loeschen', text: 'Löschen', symbol: Trash2, onClick: nichts },
                { id: 'archivieren', text: 'Archivieren', symbol: Archive, onClick: nichts },
            ],
        },
        { id: 'antworten', name: 'Antworten', knoepfe: [{ id: 'antworten', text: 'Antworten', symbol: Reply, onClick: nichts, gross: true }] },
        { id: 'ordnen', name: 'Ordnen', knoepfe: [{ id: 'verschieben', text: 'Verschieben', symbol: FolderInput, menue: [{ id: 'a', text: 'Archiv', onClick: nichts }] }] },
    ],
}, { id: 'ansicht', name: 'Ansicht', gruppen: [] }];

function darstellung(wert: WerkzeugbandDarstellungWert, bandform: 'einzeilig' | 'klassisch'): WerkzeugbandDarstellung {
    return { wert, bandform, eingeklappt: wert === 'eingeklappt', setzen: nichts, einklappen: nichts };
}

function Aufbau({ d, schnell }: { d: WerkzeugbandDarstellung; schnell?: boolean }) {
    const [aktiv, setAktiv] = useState('start');
    return (
        <Werkzeugband reiter={REITER} aktiv={aktiv} onAktiv={setAktiv} darstellung={d} rechts={<input aria-label="Suchen" className="h-7 w-48" />}
            datei={[{ id: 'x', text: 'Schließen', onClick: nichts }]}
            schnellbereich={schnell ? (
                <>
                    <button type="button" aria-label="Speichern" className="inline-flex h-8 w-8 items-center justify-center"><Save size={16} /></button>
                    <button type="button" aria-label="Drucken" className="inline-flex h-8 w-8 items-center justify-center"><Printer size={16} /></button>
                </>
            ) : undefined} />
    );
}

const werkzeugband = () => screen.getByRole('region', { name: 'Werkzeugband' });
const teil = (name: string) => werkzeugband().querySelector(`[data-werkzeugband-teil="${name}"]`)!;

beforeAll(async () => {
    await spracheDeutsch();
});
afterEach(cleanup);

describe('Höhe des Werkzeugbands', () => {
    it('einzeilig: Reiterzeile 32 px, Band 40 px mit 32 px hohen Knöpfen — zusammen 72 px', () => {
        render(<Aufbau d={darstellung('einzeilig', 'einzeilig')} schnell />);
        expect(hoeheAusKlassen(teil('reiterzeile'))).toBe(32);
        expect(hoeheAusKlassen(teil('band'))).toBe(40);
        for (const knopf of within(teil('band') as HTMLElement).getAllByRole('button')) expect(hoeheAusKlassen(knopf)).toBeLessThanOrEqual(32);
        expect(hoeheAusKlassen(werkzeugband())).toBe(72);
    });

    it('klassisch: 136 px (4 + 32 + 4 + Band 88 + 8), ohne Gruppennamen (unter 1024 px) 118 px', () => {
        render(<Aufbau d={darstellung('klassisch', 'klassisch')} />);
        expect(hoeheAusKlassen(teil('reiterzeile'))).toBe(36);
        expect(hoeheAusKlassen(teil('band'))).toBe(4 + 12 + 58 + 18);
        expect(hoeheAusKlassen(werkzeugband())).toBe(136);
        expect(hoeheAusKlassen(werkzeugband(), ['werkzeugband-gruppenname'])).toBe(118);
    });

    it('eingeklappt: nur die Reiterzeile — 32 px aus einzeilig, 44 px aus klassisch; das vorübergehende Band liegt darüber', () => {
        render(<Aufbau d={darstellung('eingeklappt', 'einzeilig')} />);
        expect(hoeheAusKlassen(werkzeugband())).toBe(32);
        cleanup();
        render(<Aufbau d={darstellung('eingeklappt', 'klassisch')} />);
        expect(hoeheAusKlassen(werkzeugband())).toBe(44);
    });
});

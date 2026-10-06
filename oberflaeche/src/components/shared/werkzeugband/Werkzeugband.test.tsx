// SPDX-License-Identifier: Apache-2.0
//
// Der gemeinsame Werkzeugband-Baustein: einzeilig mit Überlauf, Darstellungswechsel
// samt Merken, Menü- und Teilungsknopf mit Tastatur, Kontrollkästchen, zwei
// Werkzeugbands auf einer Seite (eindeutige Kennungen, Alt nur für das aktive),
// eigene Elemente rechts in der Reiterzeile, Tastenbuchstaben abschaltbar.
// Der Aufbau ahmt den künftigen Mailclient nach; alle Daten sind erfunden.

import { useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { Archive, FolderInput, Mail, PanelRight, Reply, Tag, Trash2 } from 'lucide-react';
import { spracheDeutsch } from '../../../test/sprache';
import { Werkzeugband } from './Werkzeugband';
import type { WerkzeugbandProps } from './Werkzeugband';
import { useWerkzeugbandDarstellung } from './darstellung';
import type { WerkzeugbandBandform, WerkzeugbandReiter } from './typen';

interface Aufrufe {
    neu: Mock<() => void>;
    termin: Mock<() => void>;
    loeschen: Mock<() => void>;
    lesebereich: Mock<(wert: string) => void>;
}

function mailReiter(a: Aufrufe, lage: { unterhaltungen: boolean; setUnterhaltungen: (an: boolean) => void; lesebereich: string }): WerkzeugbandReiter[] {
    return [
        {
            id: 'start',
            name: 'Start',
            gruppen: [
                {
                    id: 'neu',
                    name: 'Neu',
                    knoepfe: [{
                        id: 'neu', text: 'Neue E-Mail', symbol: Mail, gross: true, onClick: a.neu,
                        menue: [
                            { id: 'termin', text: 'Termin', onClick: a.termin },
                            { id: 'kontakt', text: 'Kontakt', onClick: vi.fn() },
                            { id: 'aufgabe', text: 'Aufgabe', onClick: vi.fn(), gesperrt: true },
                        ],
                    }],
                },
                {
                    id: 'loeschen',
                    name: 'Löschen',
                    knoepfe: [
                        { id: 'loeschen', text: 'Löschen', symbol: Trash2, onClick: a.loeschen },
                        { id: 'archivieren', text: 'Archivieren', symbol: Archive, onClick: vi.fn() },
                    ],
                },
                {
                    id: 'antworten',
                    name: 'Antworten',
                    knoepfe: [{ id: 'antworten', text: 'Antworten', symbol: Reply, onClick: vi.fn(), gesperrt: true, titel: 'Keine Nachricht gewählt' }],
                },
                {
                    id: 'ordnen',
                    name: 'Ordnen',
                    knoepfe: [
                        { id: 'verschieben', text: 'Verschieben', symbol: FolderInput, menue: [{ id: 'archiv', text: 'Archiv', onClick: vi.fn() }] },
                        {
                            id: 'kategorisieren', text: 'Kategorisieren', symbol: Tag,
                            menue: [
                                { id: 'rot', text: 'Rot', wahl: 'mehrere', an: true, onClick: vi.fn() },
                                { id: 'blau', text: 'Blau', wahl: 'mehrere', an: false, onClick: vi.fn() },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            id: 'ansicht',
            name: 'Ansicht',
            gruppen: [{
                id: 'layout',
                name: 'Layout',
                knoepfe: [
                    {
                        id: 'lesebereich', text: 'Lesebereich', symbol: PanelRight,
                        menue: ['rechts', 'unten', 'aus'].map(w => ({
                            id: w, text: w[0].toUpperCase() + w.slice(1), wahl: 'eins' as const, an: lage.lesebereich === w, onClick: () => a.lesebereich(w),
                        })),
                    },
                    { art: 'kontrollkaestchen', id: 'unterhaltungen', text: 'Als Unterhaltungen anzeigen', an: lage.unterhaltungen, onWechsel: lage.setUnterhaltungen },
                ],
            }],
        },
    ];
}

function neueAufrufe(): Aufrufe {
    return { neu: vi.fn<() => void>(), termin: vi.fn<() => void>(), loeschen: vi.fn<() => void>(), lesebereich: vi.fn<(wert: string) => void>() };
}

type Zusatz = Partial<Pick<WerkzeugbandProps, 'rechts' | 'tastenbuchstaben' | 'textPraefix' | 'schnellbereich' | 'datei'>> & { tastenBereich?: RefObject<HTMLElement | null> };

function Mail_({ aufrufe, speicher = 'test.werkzeugband', vorgabe = 'einzeilig', zusatz = {} }: { aufrufe: Aufrufe; speicher?: string; vorgabe?: WerkzeugbandBandform; zusatz?: Zusatz }) {
    const darstellung = useWerkzeugbandDarstellung(speicher, vorgabe);
    const [aktiv, setAktiv] = useState('start');
    const [unterhaltungen, setUnterhaltungen] = useState(true);
    const reiter = mailReiter(aufrufe, { unterhaltungen, setUnterhaltungen, lesebereich: 'rechts' });
    return <Werkzeugband reiter={reiter} aktiv={aktiv} onAktiv={setAktiv} darstellung={darstellung} {...zusatz} />;
}

const bereich = (name = 'Werkzeugband') => screen.getByRole('region', { name });
const tipps = (el: HTMLElement) => Array.from(el.querySelectorAll('kbd')).map(k => k.textContent);
const altAllein = () => {
    fireEvent.keyDown(document.body, { key: 'Alt' });
    fireEvent.keyUp(document.body, { key: 'Alt' });
};

beforeAll(async () => {
    await spracheDeutsch();
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ---------------------------------------------------------------------
// Einzeilig mit Überlauf — Breiten nachgebildet: jeder Eintrag 100 px,
// die Karte so breit wie `kartenBreite`, ResizeObserver von Hand.
// ---------------------------------------------------------------------

class NachgebildeterBeobachter {
    static alle: NachgebildeterBeobachter[] = [];
    constructor(private ruf: ResizeObserverCallback) {
        NachgebildeterBeobachter.alle.push(this);
    }
    observe() { /* nichts */ }
    unobserve() { /* nichts */ }
    disconnect() {
        NachgebildeterBeobachter.alle = NachgebildeterBeobachter.alle.filter(b => b !== this);
    }
    static melden() {
        act(() => {
            for (const b of NachgebildeterBeobachter.alle) b.ruf([], b as unknown as ResizeObserver);
        });
    }
}

describe('einzeilig mit Überlauf', () => {
    let kartenBreite = 1000;
    const EINTRAG = 100;
    const rechteck = (links: number, breite: number) => ({ left: links, right: links + breite, width: breite, top: 0, bottom: 32, height: 32, x: links, y: 0, toJSON: () => ({}) }) as DOMRect;

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NachgebildeterBeobachter);
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get(this: HTMLElement) { return this.dataset.werkzeugbandTeil === 'karte' ? kartenBreite : 0; },
        });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value(this: HTMLElement) {
                if (!this.hasAttribute('data-werkzeugband-eintrag')) return rechteck(0, 0);
                const alle = Array.from(this.closest('[data-werkzeugband-teil="karte"]')!.querySelectorAll('[data-werkzeugband-eintrag]'));
                return rechteck(alle.indexOf(this) * EINTRAG, EINTRAG);
            },
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
        kartenBreite = 1000;
    });

    const zeilenKnoepfe = () => Array.from(within(bereich()).getByRole('tabpanel').querySelectorAll('[data-werkzeugband-eintrag] [data-knopf]'))
        .map(b => b.getAttribute('data-knopf'));
    const mehr = () => within(bereich()).queryByRole('button', { name: 'Weitere Befehle' });

    it('eine Zeile kleiner Knöpfe ohne Gruppennamen; was nicht passt, wandert von hinten in „…“ und kommt beim Verbreitern zurück', () => {
        render(<Mail_ aufrufe={neueAufrufe()} />);
        const band = within(bereich()).getByRole('tabpanel');
        // Sechs Einträge à 100 px in 1000 px: alles in der Zeile, kein „…“, große Knöpfe klein.
        expect(zeilenKnoepfe()).toEqual(['neu', 'loeschen', 'archivieren', 'antworten', 'verschieben', 'kategorisieren']);
        expect(mehr()).toBeNull();
        expect(within(band).getByRole('button', { name: 'Neue E-Mail' }).className).toContain('h-8');
        expect(within(band).queryByText('Löschen', { selector: '.werkzeugband-gruppenname' })).toBeNull();
        expect(within(band).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Neu', 'Löschen', 'Antworten', 'Ordnen']);

        // 350 px: Platz bis 316 (350 − 34 für „…“) → drei Einträge, der Rest von hinten in den Überlauf.
        kartenBreite = 350;
        NachgebildeterBeobachter.melden();
        expect(zeilenKnoepfe()).toEqual(['neu', 'loeschen', 'archivieren']);
        fireEvent.click(mehr()!);
        const ueberlauf = within(bereich()).getByRole('group', { name: 'Weitere Befehle' });
        expect(within(ueberlauf).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Antworten', 'Ordnen']);
        // Der erste freie Eintrag hat den Fokus; ein gesperrter nennt seinen Grund.
        expect(within(ueberlauf).getByRole('button', { name: 'Antworten' })).toBeDisabled();
        expect(within(ueberlauf).getByRole('button', { name: 'Antworten' })).toHaveAttribute('title', 'Keine Nachricht gewählt');
        expect(document.activeElement).toBe(within(ueberlauf).getByRole('button', { name: 'Archiv' }));
        // Menüs stehen im Überlauf aufgeklappt; Esc schließt und gibt den Fokus an „…“ zurück.
        expect(within(ueberlauf).getByRole('button', { name: 'Rot' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(within(bereich()).queryByRole('group', { name: 'Weitere Befehle' })).toBeNull();
        expect(document.activeElement).toBe(mehr());

        // Wieder breit: alles zurück, „…“ verschwindet.
        kartenBreite = 1200;
        NachgebildeterBeobachter.melden();
        expect(zeilenKnoepfe()).toHaveLength(6);
        expect(mehr()).toBeNull();
    });

    it('ein Knopf im Überlauf löst aus und schließt das Menü', () => {
        const a = neueAufrufe();
        kartenBreite = 150;
        render(<Mail_ aufrufe={a} />);
        expect(zeilenKnoepfe()).toEqual(['neu']);
        fireEvent.click(mehr()!);
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Löschen' }));
        expect(a.loeschen).toHaveBeenCalledTimes(1);
        expect(within(bereich()).queryByRole('group', { name: 'Weitere Befehle' })).toBeNull();
    });

    it('eigener Inhalt ohne einzeilige Fassung steht nur im Überlauf, mit ihr in der Zeile', () => {
        const darstellung = { wert: 'einzeilig', bandform: 'einzeilig', eingeklappt: false, setzen: vi.fn(), einklappen: vi.fn() } as const;
        const reiter: WerkzeugbandReiter[] = [{
            id: 'start', name: 'Start', gruppen: [
                { id: 'zoom', name: 'Zoom', inhalt: <select aria-label="Zoomstufe groß" />, inhaltEinzeilig: <select aria-label="Zoomstufe" /> },
                { id: 'farbe', name: 'Farbe', inhalt: <button type="button">Farbfelder</button> },
            ],
        }];
        render(<Werkzeugband reiter={reiter} aktiv="start" onAktiv={vi.fn()} darstellung={darstellung} />);
        const band = within(bereich()).getByRole('tabpanel');
        expect(within(band).getByRole('combobox', { name: 'Zoomstufe' })).toBeInTheDocument();
        expect(within(band).queryByRole('button', { name: 'Farbfelder' })).toBeNull();
        fireEvent.click(mehr()!);
        expect(within(band).getByRole('button', { name: 'Farbfelder' })).toBeInTheDocument();
        expect(within(band).queryByRole('combobox', { name: 'Zoomstufe groß' })).toBeNull();
    });
});

describe('Darstellung', () => {
    const darstellungsMenue = () => {
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Darstellung des Werkzeugbands' }));
        return within(bereich()).getByRole('menu');
    };

    it('einzeilig, klassisch, nur Reiter: umschaltbar über das Menü und den Pfeil, je Aufrufer gemerkt', () => {
        render(<Mail_ aufrufe={neueAufrufe()} speicher="mail.werkzeugband" />);
        expect(bereich()).toHaveAttribute('data-darstellung', 'einzeilig');
        let menue = darstellungsMenue();
        expect(within(menue).getAllByRole('menuitemradio').map(m => [m.textContent, m.getAttribute('aria-checked')])).toEqual([
            ['Einzeilig', 'true'], ['Klassisch', 'false'], ['Nur Reiter', 'false'],
        ]);
        fireEvent.click(within(menue).getByRole('menuitemradio', { name: 'Klassisch' }));
        expect(bereich()).toHaveAttribute('data-darstellung', 'klassisch');
        // Klassisch: Gruppennamen unter den Knöpfen, große Knöpfe groß.
        expect(within(bereich()).getByText('Ordnen', { selector: '.werkzeugband-gruppenname' })).toBeInTheDocument();
        expect(within(bereich()).getByRole('button', { name: 'Neue E-Mail' }).className).toContain('min-h-[3.5rem]');
        expect(localStorage.getItem('mail.werkzeugband.bandform')).toBe('klassisch');

        menue = darstellungsMenue();
        fireEvent.click(within(menue).getByRole('menuitemradio', { name: 'Nur Reiter' }));
        expect(within(bereich()).queryByRole('tabpanel')).toBeNull();
        expect(localStorage.getItem('mail.werkzeugband.eingeklappt')).toBe('1');
        // Ein Klick auf einen Reiter zeigt das Band vorübergehend — in der gewählten Form.
        fireEvent.click(within(bereich()).getByRole('tab', { name: 'Ansicht' }));
        expect(within(bereich()).getByRole('tabpanel')).toHaveClass('absolute');
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(within(bereich()).queryByRole('tabpanel')).toBeNull();

        // Wieder neu geöffnet: eingeklappt. Ausklappen führt zur gemerkten Form zurück.
        cleanup();
        render(<Mail_ aufrufe={neueAufrufe()} speicher="mail.werkzeugband" />);
        expect(bereich()).toHaveAttribute('data-darstellung', 'eingeklappt');
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Werkzeugband ausklappen' }));
        expect(bereich()).toHaveAttribute('data-darstellung', 'klassisch');
        expect(localStorage.getItem('mail.werkzeugband.eingeklappt')).toBe('0');

        // Ein anderer Aufrufer hat seinen eigenen Speicher und seine eigene Vorgabe.
        cleanup();
        render(<Mail_ aufrufe={neueAufrufe()} speicher="anderer.werkzeugband" vorgabe="klassisch" />);
        expect(bereich()).toHaveAttribute('data-darstellung', 'klassisch');
        cleanup();
        render(<Mail_ aufrufe={neueAufrufe()} speicher="dritter.werkzeugband" vorgabe="einzeilig" />);
        expect(bereich()).toHaveAttribute('data-darstellung', 'einzeilig');
    });

    describe('vor der Umbenennung gemerkte Werte', () => {
        // Bis Bau 2317 trug der Speicher den früheren Namen des Bandes (zerlegt wie in darstellung.ts).
        const frueher = ['mail', 'rib' + 'bon'].join('.');

        it('werden einmalig übernommen und die alten Schlüssel gelöscht', () => {
            localStorage.setItem(`${frueher}.bandform`, 'klassisch');
            localStorage.setItem(`${frueher}.eingeklappt`, '1');
            render(<Mail_ aufrufe={neueAufrufe()} speicher="mail.werkzeugband" />);
            expect(bereich()).toHaveAttribute('data-darstellung', 'eingeklappt');
            expect(localStorage.getItem('mail.werkzeugband.bandform')).toBe('klassisch');
            expect(localStorage.getItem('mail.werkzeugband.eingeklappt')).toBe('1');
            expect(localStorage.getItem(`${frueher}.bandform`)).toBeNull();
            expect(localStorage.getItem(`${frueher}.eingeklappt`)).toBeNull();
            // Ausklappen führt zur übernommenen Form zurück.
            fireEvent.click(within(bereich()).getByRole('button', { name: 'Werkzeugband ausklappen' }));
            expect(bereich()).toHaveAttribute('data-darstellung', 'klassisch');
        });

        it('ein neuer Wert hat Vorrang; der übrig gebliebene alte Schlüssel wird nur gelöscht', () => {
            localStorage.setItem('mail.werkzeugband.bandform', 'einzeilig');
            localStorage.setItem(`${frueher}.bandform`, 'klassisch');
            render(<Mail_ aufrufe={neueAufrufe()} speicher="mail.werkzeugband" vorgabe="klassisch" />);
            expect(bereich()).toHaveAttribute('data-darstellung', 'einzeilig');
            expect(localStorage.getItem('mail.werkzeugband.bandform')).toBe('einzeilig');
            expect(localStorage.getItem(`${frueher}.bandform`)).toBeNull();
        });

        it('lässt sich der neue Schlüssel nicht schreiben, gilt der alte Wert und bleibt stehen', () => {
            localStorage.setItem(`${frueher}.bandform`, 'klassisch');
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = () => { throw new Error('kein Speicher'); };
            try {
                render(<Mail_ aufrufe={neueAufrufe()} speicher="mail.werkzeugband" />);
                expect(bereich()).toHaveAttribute('data-darstellung', 'klassisch');
            } finally {
                Storage.prototype.setItem = original;
            }
            expect(localStorage.getItem(`${frueher}.bandform`)).toBe('klassisch');
            expect(localStorage.getItem('mail.werkzeugband.bandform')).toBeNull();
        });
    });

    it('das Darstellungsmenü geht mit der Tastatur: Pfeil öffnet, wandert, Esc schließt zum Auslöser', () => {
        render(<Mail_ aufrufe={neueAufrufe()} />);
        const ausloeser = within(bereich()).getByRole('button', { name: 'Darstellung des Werkzeugbands' });
        ausloeser.focus();
        fireEvent.keyDown(ausloeser, { key: 'ArrowDown' });
        const menue = within(bereich()).getByRole('menu');
        expect(ausloeser).toHaveAttribute('aria-expanded', 'true');
        expect(ausloeser).toHaveAttribute('aria-controls', menue.id);
        expect(document.activeElement).toHaveTextContent('Einzeilig');
        fireEvent.keyDown(document.activeElement!, { key: 'End' });
        expect(document.activeElement).toHaveTextContent('Nur Reiter');
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(within(bereich()).queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(ausloeser);
    });
});

describe('Menü- und Teilungsknopf', () => {
    it('Teilungsknopf: der Hauptteil löst aus, ▾ öffnet ein Menü — Pfeiltasten, Pos1/Ende, Esc und Tab', () => {
        const a = neueAufrufe();
        render(<Mail_ aufrufe={a} />);
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Neue E-Mail' }));
        expect(a.neu).toHaveBeenCalledTimes(1);

        const pfeil = within(bereich()).getByRole('button', { name: 'Weitere Möglichkeiten: Neue E-Mail' });
        expect(pfeil).toHaveAttribute('aria-haspopup', 'menu');
        expect(pfeil).toHaveAttribute('aria-expanded', 'false');
        pfeil.focus();
        fireEvent.keyDown(pfeil, { key: 'ArrowDown' });
        const menue = within(bereich()).getByRole('menu');
        expect(pfeil).toHaveAttribute('aria-expanded', 'true');
        expect(menue).toHaveAttribute('aria-labelledby', pfeil.id);
        expect(document.activeElement).toHaveTextContent('Termin');
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement).toHaveTextContent('Kontakt');
        // Der gesperrte Eintrag wird übersprungen: weiter geht es vorn.
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement).toHaveTextContent('Termin');
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
        expect(document.activeElement).toHaveTextContent('Kontakt');
        fireEvent.keyDown(document.activeElement!, { key: 'Home' });
        expect(document.activeElement).toHaveTextContent('Termin');
        // Esc schließt und gibt den Fokus an ▾ zurück.
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(within(bereich()).queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(pfeil);
        // Wahl eines Eintrags: löst aus, schließt, Fokus zurück.
        fireEvent.keyDown(pfeil, { key: 'ArrowDown' });
        fireEvent.click(document.activeElement!);
        expect(a.termin).toHaveBeenCalledTimes(1);
        expect(a.neu).toHaveBeenCalledTimes(1);
        expect(within(bereich()).queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(pfeil);
        // Tab verlässt das Menü und schließt es.
        fireEvent.click(pfeil);
        fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
        expect(within(bereich()).queryByRole('menu')).toBeNull();
    });

    it('Menüknopf ohne Hauptaktion; Wahl eins/mehrere als menuitemradio/menuitemcheckbox; Klick daneben schließt', () => {
        const a = neueAufrufe();
        render(<Mail_ aufrufe={a} />);
        const kategorisieren = within(bereich()).getByRole('button', { name: 'Kategorisieren' });
        expect(kategorisieren).toHaveAttribute('aria-haspopup', 'menu');
        fireEvent.click(kategorisieren);
        expect(within(bereich()).getAllByRole('menuitemcheckbox').map(m => m.getAttribute('aria-checked'))).toEqual(['true', 'false']);
        // Ein anderer Menüknopf ersetzt das offene Menü.
        fireEvent.pointerDown(within(bereich()).getByRole('button', { name: 'Verschieben' }));
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Verschieben' }));
        expect(within(bereich()).getAllByRole('menu')).toHaveLength(1);
        expect(within(bereich()).getByRole('menuitem', { name: 'Archiv' })).toBeInTheDocument();
        fireEvent.pointerDown(document.body);
        expect(within(bereich()).queryByRole('menu')).toBeNull();

        fireEvent.click(within(bereich()).getByRole('tab', { name: 'Ansicht' }));
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Lesebereich' }));
        expect(within(bereich()).getAllByRole('menuitemradio').map(m => [m.textContent, m.getAttribute('aria-checked')])).toEqual([
            ['Rechts', 'true'], ['Unten', 'false'], ['Aus', 'false'],
        ]);
        fireEvent.click(within(bereich()).getByRole('menuitemradio', { name: 'Unten' }));
        expect(a.lesebereich).toHaveBeenCalledWith('unten');
    });

    it('klassisch: das Menü am Teilungsknopf liegt fest am Auslöser, damit das scrollende Band es nicht abschneidet', () => {
        render(<Mail_ aufrufe={neueAufrufe()} vorgabe="klassisch" />);
        fireEvent.click(within(bereich()).getByRole('button', { name: 'Weitere Möglichkeiten: Neue E-Mail' }));
        expect(within(bereich()).getByRole('menu').style.position).toBe('fixed');
    });
});

describe('Kontrollkästchen', () => {
    it('steht als echtes Kontrollkästchen im Band, einzeilig wie klassisch, und schaltet über onWechsel', () => {
        render(<Mail_ aufrufe={neueAufrufe()} />);
        fireEvent.click(within(bereich()).getByRole('tab', { name: 'Ansicht' }));
        const kasten = () => within(bereich()).getByRole('checkbox', { name: 'Als Unterhaltungen anzeigen' });
        expect(kasten()).toBeChecked();
        fireEvent.click(kasten());
        expect(kasten()).not.toBeChecked();

        fireEvent.click(within(bereich()).getByRole('button', { name: 'Darstellung des Werkzeugbands' }));
        fireEvent.click(within(bereich()).getByRole('menuitemradio', { name: 'Klassisch' }));
        expect(kasten()).not.toBeChecked();
        fireEvent.click(kasten());
        expect(kasten()).toBeChecked();
    });

    it('der Tastenbuchstabe schaltet es um', () => {
        render(<Mail_ aufrufe={neueAufrufe()} />);
        altAllein();
        // Kein Datei-Menü: S(tart), A(nsicht) aus den Anfangsbuchstaben.
        expect(tipps(bereich())).toEqual(['S', 'A']);
        fireEvent.keyDown(document.body, { key: 'a' });
        // Lesebereich L, „Als Unterhaltungen anzeigen“ A.
        expect(tipps(bereich())).toEqual(['L', 'A']);
        fireEvent.keyDown(document.body, { key: 'a' });
        expect(within(bereich()).getByRole('checkbox', { name: 'Als Unterhaltungen anzeigen' })).not.toBeChecked();
    });
});

describe('zwei Werkzeugbands auf einer Seite (Hauptfenster und Verfasser)', () => {
    beforeAll(() => {
        i18next.addResourceBundle('de', 'translation', { testverfasser: { bereich: 'Werkzeugband Nachricht' } }, true, true);
    });

    function Seite({ hauptAufrufe, verfasserAufrufe, mitVerfasser = true }: { hauptAufrufe: Aufrufe; verfasserAufrufe: Aufrufe; mitVerfasser?: boolean }) {
        const verfasser = useRef<HTMLDivElement>(null);
        return (
            <>
                <main>
                    <Mail_ aufrufe={hauptAufrufe} speicher="haupt" />
                    <input aria-label="Nachrichtenliste" />
                </main>
                {mitVerfasser && (
                    <section ref={verfasser} aria-label="Verfasser">
                        <Mail_ aufrufe={verfasserAufrufe} speicher="verfasser" zusatz={{ textPraefix: 'testverfasser', tastenBereich: verfasser }} />
                        <textarea aria-label="Nachricht" />
                    </section>
                )}
            </>
        );
    }

    it('alle Kennungen sind eindeutig, und jede Verknüpfung bleibt im eigenen Werkzeugband', () => {
        render(<Seite hauptAufrufe={neueAufrufe()} verfasserAufrufe={neueAufrufe()} />);
        const ids = Array.from(document.querySelectorAll('[id]')).map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const name of ['Werkzeugband', 'Werkzeugband Nachricht']) {
            const r = bereich(name);
            const tab = within(r).getByRole('tab', { selected: true });
            const panel = within(r).getByRole('tabpanel');
            expect(tab.getAttribute('aria-controls')).toBe(panel.id);
            expect(r.querySelector(`[id="${panel.getAttribute('aria-labelledby')}"]`)).toBe(tab);
        }
        // Ein offenes Menü verweist auf seinen Auslöser im selben Werkzeugband.
        fireEvent.click(within(bereich('Werkzeugband Nachricht')).getByRole('button', { name: 'Kategorisieren' }));
        const menue = within(bereich('Werkzeugband Nachricht')).getByRole('menu');
        expect(bereich('Werkzeugband Nachricht').querySelector(`[id="${menue.getAttribute('aria-labelledby')}"]`)).toHaveTextContent('Kategorisieren');
    });

    it('Alt meldet sich nur am aktiven Werkzeugband: zuerst dem obersten, dann dem, in dessen Bereich der Fokus liegt', () => {
        const haupt = neueAufrufe();
        const verfasser = neueAufrufe();
        render(<Seite hauptAufrufe={haupt} verfasserAufrufe={verfasser} />);
        const h = bereich('Werkzeugband');
        const v = bereich('Werkzeugband Nachricht');
        // Zuletzt erschienen: der Verfasser.
        altAllein();
        expect(tipps(v)).toEqual(['S', 'A']);
        expect(tipps(h)).toEqual([]);
        fireEvent.keyDown(document.body, { key: 'Escape' });

        // Fokus in die Nachrichtenliste: das Hauptfenster ist aktiv.
        act(() => screen.getByRole('textbox', { name: 'Nachrichtenliste' }).focus());
        altAllein();
        expect(tipps(h)).toEqual(['S', 'A']);
        expect(tipps(v)).toEqual([]);
        fireEvent.keyDown(document.body, { key: 's' });
        fireEvent.keyDown(document.body, { key: 'l' });
        expect(haupt.loeschen).toHaveBeenCalledTimes(1);
        expect(verfasser.loeschen).not.toHaveBeenCalled();

        // Zeiger in den Verfasser: der ist aktiv; eingeblendete Buchstaben im Hauptfenster gehen aus.
        altAllein();
        expect(tipps(h)).toEqual(['S', 'A']);
        fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Nachricht' }));
        expect(tipps(h)).toEqual([]);
        altAllein();
        expect(tipps(v)).toEqual(['S', 'A']);
        expect(tipps(h)).toEqual([]);
    });

    it('verschwindet der Verfasser, bekommt das Hauptfenster die Tasten wieder', () => {
        const haupt = neueAufrufe();
        const verfasser = neueAufrufe();
        const { rerender } = render(<Seite hauptAufrufe={haupt} verfasserAufrufe={verfasser} />);
        rerender(<Seite hauptAufrufe={haupt} verfasserAufrufe={verfasser} mitVerfasser={false} />);
        altAllein();
        expect(tipps(bereich('Werkzeugband'))).toEqual(['S', 'A']);
    });
});

describe('eigene Elemente rechts in der Reiterzeile', () => {
    it('stehen in derselben Zeile wie die Reiter — einzeilig wie klassisch, ohne zusätzliche Leiste', () => {
        const suche: ReactNode = <input aria-label="Suchen" />;
        render(<Mail_ aufrufe={neueAufrufe()} zusatz={{ rechts: suche }} />);
        const reiterzeile = () => within(bereich()).getByRole('tablist').closest('[data-werkzeugband-teil="reiterzeile"]');
        expect(screen.getByRole('textbox', { name: 'Suchen' }).closest('[data-werkzeugband-teil="reiterzeile"]')).toBe(reiterzeile());
        expect(within(within(bereich()).getByRole('tabpanel')).queryByRole('textbox', { name: 'Suchen' })).toBeNull();
        // Das Werkzeugband besteht aus genau zwei Zeilen: Reiter und Band.
        expect(Array.from(bereich().children).map(c => c.getAttribute('data-werkzeugband-teil'))).toEqual(['reiterzeile', 'band']);
        // Rechts vor den Darstellungsknöpfen.
        const zeile = Array.from(reiterzeile()!.querySelectorAll('input, button[aria-label]')).map(e => e.getAttribute('aria-label'));
        expect(zeile.slice(-3)).toEqual(['Suchen', 'Darstellung des Werkzeugbands', 'Werkzeugband einklappen']);

        fireEvent.click(within(bereich()).getByRole('button', { name: 'Darstellung des Werkzeugbands' }));
        fireEvent.click(within(bereich()).getByRole('menuitemradio', { name: 'Klassisch' }));
        expect(screen.getByRole('textbox', { name: 'Suchen' }).closest('[data-werkzeugband-teil="reiterzeile"]')).toBe(reiterzeile());
    });
});

describe('Tastenbuchstaben abschaltbar', () => {
    it('aus: kein Zuhörer für Tasten am Fenster, Alt blendet nichts ein; Esc im Menü schließt trotzdem', () => {
        const angemeldet = vi.spyOn(window, 'addEventListener');
        try {
            render(<Mail_ aufrufe={neueAufrufe()} zusatz={{ tastenbuchstaben: false }} />);
            expect(angemeldet.mock.calls.filter(([art]) => art === 'keydown' || art === 'keyup')).toEqual([]);
            altAllein();
            expect(tipps(bereich())).toEqual([]);
            fireEvent.keyDown(document.body, { key: 's' });
            expect(within(bereich()).getByRole('tab', { selected: true })).toHaveTextContent('Start');

            fireEvent.click(within(bereich()).getByRole('button', { name: 'Kategorisieren' }));
            fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
            expect(within(bereich()).queryByRole('menu')).toBeNull();
        } finally {
            angemeldet.mockRestore();
        }
    });

    it('an (Vorgabe): Zuhörer am Fenster, Alt blendet ein; nach dem Schließen hängt nichts mehr', () => {
        const angemeldet = vi.spyOn(window, 'addEventListener');
        const abgemeldet = vi.spyOn(window, 'removeEventListener');
        try {
            const { unmount } = render(<Mail_ aufrufe={neueAufrufe()} />);
            expect(angemeldet.mock.calls.filter(([art]) => art === 'keydown')).toHaveLength(1);
            altAllein();
            expect(tipps(bereich())).toEqual(['S', 'A']);
            unmount();
            expect(abgemeldet.mock.calls.filter(([art]) => art === 'keydown')).toHaveLength(1);
        } finally {
            angemeldet.mockRestore();
            abgemeldet.mockRestore();
        }
    });
});

describe('Datei-Menü und Textpräfix', () => {
    it('das Datei-Menü bekommt einen Buchstaben wie ein Reiter; Texte des Aufrufers gehen vor', () => {
        i18next.addResourceBundle('de', 'translation', { testpraefix: { datei: 'Ablage' } }, true, true);
        const speichern = vi.fn();
        render(<Mail_ aufrufe={neueAufrufe()} zusatz={{ textPraefix: 'testpraefix', datei: [{ id: 'speichern', text: 'Speichern', onClick: speichern }] }} />);
        // „bereich“ fehlt beim Aufrufer: es gilt werkzeugband.bereich.
        expect(within(bereich()).getByRole('button', { name: 'Ablage' })).toHaveAttribute('aria-haspopup', 'menu');
        altAllein();
        expect(tipps(bereich())).toEqual(['A', 'S', 'N']);
        fireEvent.keyDown(document.body, { key: 'a' });
        expect(within(within(bereich()).getByRole('menu')).getAllByRole('menuitem').map(m => m.querySelector('kbd')?.textContent)).toEqual(['S']);
        fireEvent.keyDown(document.body, { key: 's' });
        expect(speichern).toHaveBeenCalledTimes(1);
        expect(within(bereich()).queryByRole('menu')).toBeNull();
    });
});

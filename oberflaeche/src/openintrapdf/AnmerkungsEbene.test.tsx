// SPDX-License-Identifier: Apache-2.0
//
// Anmerkungsebene (Etappe 5): die Vorschau von Post-it und Stempel sieht
// aus wie das Erscheinungsbild des Servers, und beide lassen sich im
// Entwurf ziehen und an der Ecke in der Größe ändern — EIN Befehl je Zug.
//
// jsdom misst nichts; die Lage der Seite kommt aus gestubbten Rechtecken,
// der Viewport ist der einfache Fall ohne Drehung (Zoom 1, Ursprung oben
// links). Die Umrechnung bei Drehung prüft koordinaten.test.ts.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { spracheDeutsch } from '../test/sprache';
import { AnmerkungsEbene, Form } from './AnmerkungsEbene';
import type { EbenenAnschluss } from './AnmerkungsEbene';
import type { NeueAnmerkung } from './anmerkungen';
import type { Stil, Viewport } from './koordinaten';

/** Viewport ohne Drehung bei Zoom 1: Anzeige-y = Höhe − PDF-y. */
function viewport(breite: number, hoehe: number): Viewport {
    return {
        transform: [1, 0, 0, -1, 0, hoehe],
        width: breite,
        height: hoehe,
        convertToViewportPoint: (x, y) => [x, hoehe - y],
        convertToPdfPoint: (x, y) => [x, hoehe - y],
    };
}

const rechteck = (x: number, y: number, w: number, h: number) =>
    ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => undefined }) as DOMRect;

function anschlussBauen(breite = 200, hoehe = 300) {
    const container = document.createElement('div');
    const viewer = document.createElement('div');
    const seite = document.createElement('div');
    viewer.appendChild(seite);
    container.appendChild(viewer);
    document.body.appendChild(container);
    container.getBoundingClientRect = () => rechteck(0, 0, 500, 700);
    viewer.getBoundingClientRect = () => rechteck(0, 0, 500, 700);
    seite.getBoundingClientRect = () => rechteck(0, 0, breite, hoehe);
    Object.defineProperty(seite, 'clientWidth', { value: breite });
    Object.defineProperty(seite, 'clientHeight', { value: hoehe });
    const vp = viewport(breite, hoehe);
    const anschluss: EbenenAnschluss = {
        pdfViewer: { pagesCount: 1, getPageView: () => ({ div: seite, viewport: vp }) },
        eventBus: { on: () => undefined },
        container,
        viewer,
    };
    return { anschluss, vp, container };
}

const stil: Stil = { color: [1, 0, 0], width: 2, font_size: 12 };

/** Ein Zettel: PDF [10, 150, 180, 280] = Anzeige links 10, oben 20, 170 × 130. */
const zettel: NeueAnmerkung = {
    client_id: 'tmp-1', page: 0, kind: 'sticky', rect: [10, 150, 180, 280], contents: 'Bitte prüfen', color: [1, 0.961, 0.616], reply_to: null, font_size: 11,
};
const stempel: NeueAnmerkung = {
    client_id: 'tmp-2', page: 0, kind: 'stamp', rect: [20, 200, 170, 250], contents: '', color: [0.18, 0.49, 0.196], reply_to: null,
    stamp: { label: 'GEPRÜFT', name: 'Checked', signed: true, lang: 'de' },
};

beforeAll(async () => { await spracheDeutsch(); });
afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe('Vorschau', () => {
    const vp = viewport(200, 300);

    it('Post-it: Füllung in der Farbe, Rand und Eselsohr dunkler, dunkelgrauer Text mit Umbruch', () => {
        const { container } = render(<svg><Form a={zettel} vp={vp} /></svg>);
        const kasten = container.querySelector('g[data-art="sticky"] > rect')!;
        expect(kasten.getAttribute('fill')).toBe('rgb(255 245 157)');
        expect(kasten.getAttribute('stroke')).toBe('rgb(191 184 118)');
        expect([kasten.getAttribute('x'), kasten.getAttribute('y'), kasten.getAttribute('width'), kasten.getAttribute('height')]).toEqual(['10', '20', '170', '130']);
        const ohr = container.querySelector('polygon[data-teil="eselsohr"]')!;
        expect(ohr.getAttribute('fill')).toBe('rgb(191 184 118)');
        expect(ohr.getAttribute('points')).toBe('166,150 180,136 180,150');
        const text = container.querySelector('foreignObject div') as HTMLElement;
        expect(text.textContent).toBe('Bitte prüfen');
        expect(text.style.color).toBe('rgb(31, 41, 55)');
        expect(text.style.overflowWrap).toBe('anywhere');
        expect(text.style.padding).toBe('6px');
        expect(text.style.font).toContain('11px');
    });

    it('Stempel: Doppelrahmen ohne Füllung, Label fett und zentriert, zweite Zeile nur mit „Name und Datum“', () => {
        const { container, rerender } = render(<svg><Form a={stempel} vp={vp} unterschrift="Anna Muster · 30.09.2026" /></svg>);
        const rahmen = container.querySelectorAll('g[data-art="stamp"] > rect');
        expect(rahmen).toHaveLength(2);
        for (const r of Array.from(rahmen)) {
            expect(r.getAttribute('fill')).toBe('none');
            expect(r.getAttribute('stroke')).toBe('rgb(46 125 50)');
        }
        expect(rahmen[0].getAttribute('stroke-width')).toBe('2');
        expect(rahmen[1].getAttribute('stroke-width')).toBe('0.75');
        const texte = container.querySelectorAll('g[data-art="stamp"] > text');
        expect(texte).toHaveLength(2);
        expect(texte[0].textContent).toBe('GEPRÜFT');
        expect(texte[0].getAttribute('font-weight')).toBe('bold');
        expect(texte[0].getAttribute('text-anchor')).toBe('middle');
        expect(texte[0].getAttribute('x')).toBe('95');
        expect(texte[1].textContent).toBe('Anna Muster · 30.09.2026');
        expect(Number(texte[1].getAttribute('font-size'))).toBeLessThan(Number(texte[0].getAttribute('font-size')));

        rerender(<svg><Form a={{ ...stempel, stamp: { ...stempel.stamp!, signed: false } }} vp={vp} unterschrift="Anna Muster · 30.09.2026" /></svg>);
        expect(container.querySelectorAll('g[data-art="stamp"] > text')).toHaveLength(1);
    });
});

describe('Ziehen und Größe ändern im Entwurf', () => {
    async function ebene(entwurf: NeueAnmerkung[], werkzeug: NeueAnmerkung['kind'] | null = null) {
        const { anschluss, container } = anschlussBauen();
        const onRect = vi.fn();
        const onNeu = vi.fn();
        render(<AnmerkungsEbene anschluss={anschluss} entwurf={entwurf} werkzeug={werkzeug} stil={stil} onNeu={onNeu} onRect={onRect} />, { container });
        return { onRect, container };
    }

    it('Ziehen verschiebt den Zettel und schickt beim Loslassen EIN neues Rect; die Vorschau folgt schon während des Zugs', async () => {
        const { onRect, container } = await ebene([zettel]);
        const griff = await screen.findByTestId('opdf-griff-tmp-1');
        expect(griff.style.left).toBe('10px');
        expect(griff.style.top).toBe('20px');
        fireEvent.pointerDown(griff, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
        fireEvent.pointerMove(griff, { pointerId: 1, clientX: 70, clientY: 90 });
        expect(container.querySelector('g[data-art="sticky"] > rect')?.getAttribute('x')).toBe('30');
        expect(container.querySelector('g[data-art="sticky"] > rect')?.getAttribute('y')).toBe('60');
        expect(onRect).not.toHaveBeenCalled();
        fireEvent.pointerUp(griff, { pointerId: 1, clientX: 70, clientY: 90 });
        expect(onRect).toHaveBeenCalledTimes(1);
        expect(onRect).toHaveBeenCalledWith('tmp-1', 0, [30, 110, 200, 240]);
    });

    it('die Ecke ändert die Größe; die Seite ist die Grenze, ein Zug ohne Weg schickt nichts', async () => {
        const { onRect } = await ebene([zettel]);
        const ecke = await screen.findByTestId('opdf-griff-ecke-tmp-1');
        fireEvent.pointerDown(ecke, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
        fireEvent.pointerUp(ecke, { pointerId: 1, clientX: 120, clientY: 110 });
        expect(onRect).toHaveBeenLastCalledWith('tmp-1', 0, [10, 140, 200, 280]);

        // Weit über die Seite hinaus: sie endet bei 200 × 300.
        const griff = screen.getByTestId('opdf-griff-tmp-1');
        fireEvent.pointerDown(griff, { button: 0, pointerId: 2, clientX: 50, clientY: 50 });
        fireEvent.pointerUp(griff, { pointerId: 2, clientX: 1050, clientY: 1050 });
        expect(onRect).toHaveBeenLastCalledWith('tmp-1', 0, [30, 0, 200, 130]);

        onRect.mockClear();
        fireEvent.pointerDown(griff, { button: 0, pointerId: 3, clientX: 50, clientY: 50 });
        fireEvent.pointerUp(griff, { pointerId: 3, clientX: 50, clientY: 50 });
        expect(onRect).not.toHaveBeenCalled();
    });

    it('auch ein Stempel hat Griffe; solange ein Zeichenwerkzeug die Fläche hält, gibt es keine', async () => {
        await ebene([stempel]);
        expect(await screen.findByTestId('opdf-griff-tmp-2')).toHaveAttribute('title', 'Stempel: Verschieben');
        expect(screen.getByTestId('opdf-griff-ecke-tmp-2')).toHaveAttribute('title', 'Stempel: Größe ändern');
        cleanup();
        document.body.replaceChildren();
        await ebene([zettel, stempel], 'square');
        await waitFor(() => expect(screen.getByTestId('opdf-zeichenflaeche')).toBeInTheDocument());
        expect(screen.queryByTestId('opdf-griff-tmp-1')).toBeNull();
        expect(screen.queryByTestId('opdf-griff-tmp-2')).toBeNull();
    });
});

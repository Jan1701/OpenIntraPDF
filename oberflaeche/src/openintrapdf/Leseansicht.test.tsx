// SPDX-License-Identifier: Apache-2.0
//
// Die Leseansicht ohne pdf.js: Der Viewer ist eine Attrappe mit denselben
// Methoden, damit sich prüfen lässt, WAS die Leseansicht ihm sagt (Suche,
// Anmerkungsmodus) — und das Hand-Werkzeug am nackten Scrollcontainer.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import type { MutableRefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { handGriff, Leseansicht } from './Leseansicht';
import type { LeseSteuerung } from './Leseansicht';
import type { PdfBibliothek } from './pdfjsLaden';

afterEach(() => cleanup());

describe('handGriff', () => {
    function container() {
        const el = document.createElement('div');
        document.body.appendChild(el);
        // jsdom scrollt nicht; die Werte sind einfache Eigenschaften.
        Object.defineProperty(el, 'scrollLeft', { value: 100, writable: true });
        Object.defineProperty(el, 'scrollTop', { value: 400, writable: true });
        return el;
    }

    it('Ziehen verschiebt den Ausschnitt gegen die Zeigerbewegung; die Textauswahl wird unterbunden', () => {
        const el = container();
        const ab = handGriff(el);
        const down = new PointerEvent('pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1, cancelable: true });
        el.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(el.classList.contains('opdf-hand-zieht')).toBe(true);
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 20, pointerId: 1 }));
        expect(el.scrollLeft).toBe(70);
        expect(el.scrollTop).toBe(430);
        el.dispatchEvent(new PointerEvent('pointerup', { clientX: 80, clientY: 20, pointerId: 1 }));
        expect(el.classList.contains('opdf-hand-zieht')).toBe(false);
        // Nach dem Loslassen bewegt sich nichts mehr.
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0, pointerId: 1 }));
        expect(el.scrollLeft).toBe(70);
        ab();
        el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 2 }));
        expect(el.classList.contains('opdf-hand-zieht')).toBe(false);
    });

    it('ein Griff einer Entwurfsanmerkung behält seinen eigenen Zug; die rechte Maustaste zieht nicht', () => {
        const el = container();
        const griff = document.createElement('div');
        griff.className = 'opdf-griff';
        el.appendChild(griff);
        handGriff(el);
        const down = new PointerEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 1, bubbles: true, cancelable: true });
        griff.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(false);
        expect(el.classList.contains('opdf-hand-zieht')).toBe(false);
        el.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 5, clientY: 5, pointerId: 1 }));
        expect(el.classList.contains('opdf-hand-zieht')).toBe(false);
    });
});

// ---------------------------------------------------------------------
// Die Leseansicht mit einer pdf.js-Attrappe
// ---------------------------------------------------------------------

function attrappe() {
    const ereignisse = new Map<string, Array<(e: unknown) => void>>();
    const dispatch = vi.fn((name: string, e: unknown) => ereignisse.get(name)?.forEach(f => f(e)));
    class EventBus {
        on(name: string, f: (e: unknown) => void) { ereignisse.set(name, [...(ereignisse.get(name) ?? []), f]); }
        off() { /* nichts */ }
        dispatch = dispatch;
    }
    class PDFLinkService {
        setViewer() { /* nichts */ }
        setDocument() { /* nichts */ }
        goToDestination = vi.fn();
    }
    class PDFFindController { pageMatches = [[1, 2], [], [3]]; }
    const viewerOptionen: Array<Record<string, unknown>> = [];
    const viewer: PDFViewer[] = [];
    class PDFViewer {
        currentScaleValue = '';
        currentScale = 1;
        currentPageNumber = 1;
        pagesCount = 3;
        constructor(o: Record<string, unknown>) {
            viewerOptionen.push(o);
            viewer.push(this);
        }
        setDocument() { /* nichts */ }
        nextPage = vi.fn();
        previousPage = vi.fn();
        increaseScale = vi.fn();
        decreaseScale = vi.fn();
        scrollPageIntoView = vi.fn();
        getPageView() { return undefined; }
        cleanup() { /* nichts */ }
        update() { /* nichts */ }
        refresh = vi.fn();
    }
    const bibliothek = {
        pdfjs: { AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 } },
        viewer: { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget: { BLANK: 2 } },
        viewerStil: '',
    } as unknown as PdfBibliothek;
    return { bibliothek, dispatch, viewerOptionen, viewer, ereignisse };
}

const dokument = { numPages: 3 } as unknown as PDFDocumentProxy;

function zeigen(a: ReturnType<typeof attrappe>, mehr: Partial<React.ComponentProps<typeof Leseansicht>> = {}) {
    const steuerung = createRef<LeseSteuerung | null>() as MutableRefObject<LeseSteuerung | null>;
    const r = render(
        <Leseansicht bibliothek={a.bibliothek} dokument={dokument} steuerung={steuerung} sichtbar beschriftung="Dokument"
            onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} {...mehr} />,
    );
    return { ...r, steuerung };
}

describe('Leseansicht', () => {
    it('die Steuerung erreicht den Viewer: blättern, zoomen, Seite', () => {
        const a = attrappe();
        const { steuerung } = zeigen(a);
        steuerung.current!.blaettern(1);
        steuerung.current!.zoom('mehr');
        steuerung.current!.zoom(150);
        const viewer = a.viewerOptionen.length;
        expect(viewer).toBe(1);
        expect(steuerung.current!.trefferJeSeite()).toEqual([2, 0, 1]);
    });

    it('die Suche gibt Groß-/Kleinschreibung und ganzes Wort an den PDFFindController weiter; ohne Angabe beides aus', () => {
        const a = attrappe();
        const { steuerung } = zeigen(a);
        steuerung.current!.suchen('Rechnung', 'neu');
        expect(a.dispatch).toHaveBeenLastCalledWith('find', expect.objectContaining({ query: 'Rechnung', type: '', caseSensitive: false, entireWord: false }));
        steuerung.current!.suchen('Rechnung', 'weiter', { caseSensitive: true, entireWord: false });
        expect(a.dispatch).toHaveBeenLastCalledWith('find', expect.objectContaining({ query: 'Rechnung', type: 'again', caseSensitive: true, entireWord: false, findPrevious: false }));
        steuerung.current!.suchen('Rechnung', 'zurueck', { caseSensitive: false, entireWord: true });
        expect(a.dispatch).toHaveBeenLastCalledWith('find', expect.objectContaining({ caseSensitive: false, entireWord: true, findPrevious: true }));
    });

    it('Anmerkungen ausblenden baut den Viewer ohne Anmerkungen neu auf, lässt die Entwurfsebene weg und behält die Seite', () => {
        const a = attrappe();
        const anmerkungen = { entwurf: [], werkzeug: null, stil: { color: [1, 0, 0] as [number, number, number], width: 1, font_size: 12 }, onNeu: () => undefined };
        const { container, rerender, steuerung } = zeigen(a, { anmerkungen });
        expect(a.viewerOptionen).toHaveLength(1);
        expect(a.viewerOptionen[0].annotationMode).toBe(1);
        expect(container.querySelector('.opdf-anmerkungen')).not.toBeNull();
        // Die Leserin ist auf Seite 3, als sie ausblendet.
        a.ereignisse.get('pagechanging')!.forEach(f => f({ pageNumber: 3 }));

        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={dokument} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} anmerkungen={anmerkungen} anmerkungenAusgeblendet />,
        );
        expect(a.viewerOptionen).toHaveLength(2);
        expect(a.viewerOptionen[1].annotationMode).toBe(0);
        expect(container.querySelector('.opdf-anmerkungen')).toBeNull();
        const zweiter = a.viewerOptionen[1] as { container: HTMLElement };
        expect(zweiter.container).toBe(container.querySelector('.opdf-lesecontainer'));
        a.ereignisse.get('pagesinit')!.forEach(f => f({}));
        expect(a.viewer[1].currentPageNumber).toBe(3);

        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={dokument} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} anmerkungen={anmerkungen} />,
        );
        expect(a.viewerOptionen).toHaveLength(3);
        expect(a.viewerOptionen[2].annotationMode).toBe(1);
        expect(container.querySelector('.opdf-anmerkungen')).not.toBeNull();
    });

    it('Dunkles Dokument kennzeichnet nur den Scrollcontainer — der Filter in openintrapdf.css greift am Seitenbild', () => {
        const a = attrappe();
        const { container, rerender, steuerung } = zeigen(a, { dunkel: true });
        const scroll = container.querySelector<HTMLElement>('.opdf-lesecontainer')!;
        expect(scroll.dataset.dunkel).toBe('true');
        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={dokument} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} />,
        );
        expect(scroll.dataset.dunkel).toBeUndefined();
        // Der Viewer wurde dafür nicht neu gebaut.
        expect(a.viewerOptionen).toHaveLength(1);
    });

    it('das Hand-Werkzeug hängt am Scrollcontainer, solange es gewählt ist', () => {
        const a = attrappe();
        const { container, rerender, steuerung } = zeigen(a, { zeiger: 'hand' });
        const scroll = container.querySelector<HTMLElement>('.opdf-lesecontainer')!;
        expect(scroll.dataset.zeiger).toBe('hand');
        fireEvent.pointerDown(scroll, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
        expect(scroll.classList.contains('opdf-hand-zieht')).toBe(true);
        fireEvent.pointerUp(scroll, { pointerId: 1 });
        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={dokument} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} zeiger="text" />,
        );
        expect(scroll.dataset.zeiger).toBe('text');
        fireEvent.pointerDown(scroll, { button: 0, clientX: 0, clientY: 0, pointerId: 2 });
        expect(scroll.classList.contains('opdf-hand-zieht')).toBe(false);
    });
});

describe('Erledigte ausblenden (Etappe 8)', () => {
    it('verborgene Kennungen: Viewer mit Speicher-Modus, noView je Kennung, Neuzeichnen, Stilregel für die HTML-Ebene; leer → zurück zum normalen Modus', () => {
        const a = attrappe();
        const speicher = { setValue: vi.fn(), remove: vi.fn() };
        const mitSpeicher = { numPages: 3, annotationStorage: speicher } as unknown as PDFDocumentProxy;
        const { container, rerender, steuerung } = zeigen(a, { dokument: mitSpeicher });
        expect(a.viewerOptionen[0].annotationMode).toBe(1);
        expect(speicher.setValue).not.toHaveBeenCalled();

        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={mitSpeicher} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} verborgen={['12R', '13R']} />,
        );
        expect(a.viewerOptionen).toHaveLength(2);
        expect(a.viewerOptionen[1].annotationMode).toBe(3);
        expect(speicher.setValue).toHaveBeenCalledWith('12R', { noView: true });
        expect(speicher.setValue).toHaveBeenCalledWith('13R', { noView: true });
        expect(a.viewer[1].refresh).toHaveBeenCalled();
        const stil = container.querySelector('style')?.textContent ?? '';
        expect(stil).toContain('[data-annotation-id="12R"]{display:none}');
        expect(stil).toContain('[data-annotation-id="13R"]{display:none}');

        // Eine Kennung weniger: nur sie wird aus dem Speicher genommen, der Viewer bleibt.
        speicher.setValue.mockClear();
        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={mitSpeicher} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} verborgen={['12R']} />,
        );
        expect(a.viewerOptionen).toHaveLength(2);
        expect(speicher.remove).toHaveBeenCalledWith('13R');
        expect(speicher.remove).not.toHaveBeenCalledWith('12R');
        expect(a.viewer[1].refresh).toHaveBeenCalledTimes(2);

        // Nichts mehr verborgen: Speicher leer, normaler Modus, keine Stilregel.
        rerender(
            <Leseansicht bibliothek={a.bibliothek} dokument={mitSpeicher} steuerung={steuerung} sichtbar beschriftung="Dokument"
                onSeite={() => undefined} onZoom={() => undefined} onSuchstand={() => undefined} />,
        );
        expect(speicher.remove).toHaveBeenCalledWith('12R');
        expect(a.viewerOptionen).toHaveLength(3);
        expect(a.viewerOptionen[2].annotationMode).toBe(1);
        expect(container.querySelector('style')).toBeNull();
    });
});

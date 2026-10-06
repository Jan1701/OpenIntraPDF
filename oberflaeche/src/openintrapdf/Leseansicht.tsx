// SPDX-License-Identifier: Apache-2.0
//
// Die Leseansicht: pdf.js' eigener PDFViewer, nicht nachgebaut.
//
// Fortlaufende Seiten mit Virtualisierung (nur sichtbare Seiten und Nachbarn
// werden gerendert, der Puffer ist begrenzt), Textebene für Auswahl und
// Kopieren, Anmerkungsebene NUR ANZEIGEND, Suche über PDFFindController,
// interne Links über PDFLinkService. Das alles ist in pdf.js fertig und
// gepflegt; hier wird es nur eingebaut (Konzept Kap. 03: „Viewer-Schichten
// wiederverwenden; kein eigenes Rendering erfinden“).
//
// Sicherheit:
//   - Keine PDF-Skripte: Ohne `scriptingManager` bleibt Scripting aus.
//   - Formularfelder werden gezeichnet, aber nicht bedienbar
//     (AnnotationMode.ENABLE statt ENABLE_FORMS) — Lesen erzeugt nichts.
//   - Externe Links öffnen in einem neuen Reiter mit
//     rel="noopener noreferrer". pdf.js lässt ohnehin nur http(s), mailto
//     und Ähnliches durch; `javascript:` fällt vorher heraus.
//
// Hand-Werkzeug (Etappe 7): Mit `zeiger: 'hand'` verschiebt Ziehen den
// Ausschnitt, und Text wird dabei nicht markiert (handGriff). Die Griffe
// der Entwurfsanmerkungen bleiben davon unberührt.
//
// Anmerkungen ein/aus (Etappe 7): pdf.js malt gespeicherte Anmerkungen in
// das Seitenbild und legt die Anmerkungsebene darüber; beides hängt am
// `annotationMode`, der je Viewer feststeht. Ausblenden baut den Viewer
// darum mit `AnnotationMode.DISABLE` neu auf (Zoomvorgabe und Seite bleiben)
// und lässt die Entwurfsebene weg. Gespeichert wird dabei nichts.
//
// Dunkles Dokument (Etappe 7): nur das Seitenbild wird per CSS-Filter
// umgekehrt (openintrapdf.css, `data-dunkel`); Anmerkungsebene und Entwurf
// liegen daneben und behalten ihre Farben. Unabhängig vom Oberflächenthema.
//
// Erledigte ausblenden (Etappe 8): `verborgen` nennt die Kennungen
// gespeicherter Anmerkungen, die NUR in der Anzeige fehlen sollen. pdf.js
// malt Anmerkungen ins Seitenbild; was es dort weglässt, entscheidet je
// Anmerkung `noView` im `annotationStorage` des Dokuments — den der Viewer
// nur mit `AnnotationMode.ENABLE_STORAGE` an den Worker gibt. Solange etwas
// verborgen ist, läuft der Viewer darum in diesem Modus (sonst wie bisher);
// eine Änderung der Menge setzt den Speicher neu und lässt die Seiten mit
// `refresh()` neu zeichnen. Die HTML-Ebene (Popups, Symbole) verschwindet
// über eine Stilregel je Kennung. Gespeichert wird dabei nichts.

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { AnmerkungsEbene } from './AnmerkungsEbene';
import type { AnmerkungsProps, EbenenAnschluss } from './AnmerkungsEbene';
import type { PdfBibliothek } from './pdfjsLaden';

export type ZoomWert = 'auto' | 'page-width' | 'page-fit' | 'mehr' | 'weniger' | number;

export type SuchZustand = 'gefunden' | 'nicht_gefunden' | 'umgebrochen' | 'sucht';

/** Suchoptionen (Etappe 7): Groß-/Kleinschreibung und ganzes Wort — beides kann der PDFFindController. */
export interface SuchOptionen {
    caseSensitive: boolean;
    entireWord: boolean;
}

const SUCHOPTIONEN_VORGABE: SuchOptionen = { caseSensitive: false, entireWord: false };

export interface LeseSteuerung {
    zuSeite(nummer: number): void;
    blaettern(richtung: 1 | -1): void;
    zoom(wert: ZoomWert): void;
    suchen(text: string, art: 'neu' | 'weiter' | 'zurueck', optionen?: SuchOptionen): void;
    sucheBeenden(): void;
    zuZiel(ziel: unknown): void;
    zuStelle(seite: number, rechteck?: number[]): void;
    trefferJeSeite(): number[];
}

interface Props {
    bibliothek: PdfBibliothek;
    dokument: PDFDocumentProxy;
    steuerung: MutableRefObject<LeseSteuerung | null>;
    sichtbar: boolean;
    beschriftung: string;
    onSeite: (nummer: number) => void;
    onZoom: (prozent: number, voreinstellung: string | null) => void;
    /** `zustand` fehlt, wenn pdf.js nur die Trefferzahl nachreicht. */
    onSuchstand: (stand: { zustand?: SuchZustand; aktuell: number; gesamt: number }) => void;
    /** Entwurfsanmerkungen und Werkzeuge (Etappe 2); fehlt, wenn nicht kommentiert werden darf. */
    anmerkungen?: AnmerkungsProps;
    /** Text auswählen (Vorgabe) oder Hand: Ziehen verschiebt den Ausschnitt (Etappe 7). */
    zeiger?: 'text' | 'hand';
    /** Anmerkungsebene (gespeichert und Entwurf) nur in der Anzeige ausblenden (Etappe 7). */
    anmerkungenAusgeblendet?: boolean;
    /** Dunkles Dokument: Seitenbild umgekehrt darstellen (Etappe 7). */
    dunkel?: boolean;
    /** Kennungen gespeicherter Anmerkungen (`12R`), die nur in der Anzeige fehlen (Etappe 8). */
    verborgen?: readonly string[];
    /** Die Rechte der PDF verbieten das Kopieren (Etappe 9): keine Textauswahl. */
    textAuswahlGesperrt?: boolean;
}

/**
 * Das Hand-Werkzeug: Ziehen mit gedrückter Maustaste verschiebt den
 * Scrollcontainer, Text wird dabei nicht markiert. Ein Klick ohne Bewegung
 * bleibt ein Klick, Links gehen weiter. Griffe der Entwurfsanmerkungen
 * (`.opdf-griff`) behalten ihren eigenen Zug. Gibt die Abmeldung zurück.
 */
/** Eine Kennung (`12R`) für einen Attributselektor absichern. */
function stilSicher(id: string): string {
    return id.replace(/["\\]/g, '');
}

export function handGriff(container: HTMLElement): () => void {
    let zug: { x: number; y: number; links: number; oben: number; id: number } | null = null;
    const druecken = (e: PointerEvent) => {
        if (e.button !== 0 || (e.target as Element | null)?.closest?.('.opdf-griff')) return;
        zug = { x: e.clientX, y: e.clientY, links: container.scrollLeft, oben: container.scrollTop, id: e.pointerId };
        container.setPointerCapture?.(e.pointerId);
        container.classList.add('opdf-hand-zieht');
        // Sonst begänne der Browser eine Textauswahl.
        e.preventDefault();
    };
    const bewegen = (e: PointerEvent) => {
        if (!zug || e.pointerId !== zug.id) return;
        container.scrollLeft = zug.links - (e.clientX - zug.x);
        container.scrollTop = zug.oben - (e.clientY - zug.y);
    };
    const loslassen = (e: PointerEvent) => {
        if (!zug || e.pointerId !== zug.id) return;
        zug = null;
        container.releasePointerCapture?.(e.pointerId);
        container.classList.remove('opdf-hand-zieht');
    };
    container.addEventListener('pointerdown', druecken);
    container.addEventListener('pointermove', bewegen);
    container.addEventListener('pointerup', loslassen);
    container.addEventListener('pointercancel', loslassen);
    return () => {
        container.removeEventListener('pointerdown', druecken);
        container.removeEventListener('pointermove', bewegen);
        container.removeEventListener('pointerup', loslassen);
        container.removeEventListener('pointercancel', loslassen);
        container.classList.remove('opdf-hand-zieht');
    };
}

// Symbol für Notizen (Textanmerkungen). pdf.js setzt davor einen Pfad und
// dahinter „annotation-note.svg“ o. Ä.; in einer data:-Adresse landet dieser
// Rest hinter dem # und wird ignoriert. So braucht es keine Bilddateien auf
// dem Server — und es gibt keine 404 für jedes Notizsymbol.
const NOTIZ_SYMBOL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    + '<path d="M4 3h16v12l-6 6H4z" fill="#ffe27a" stroke="#7a5c00" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M14 21v-6h6" fill="none" stroke="#7a5c00" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M7.5 8h9M7.5 11.5h6" stroke="#7a5c00" stroke-width="1.5" stroke-linecap="round"/></svg>',
) + '#';

const SUCHZUSTAND: SuchZustand[] = ['gefunden', 'nicht_gefunden', 'umgebrochen', 'sucht'];

const KEINE: readonly string[] = [];

export function Leseansicht({
    bibliothek, dokument, steuerung, sichtbar, beschriftung, onSeite, onZoom, onSuchstand, anmerkungen, zeiger = 'text', anmerkungenAusgeblendet = false,
    dunkel = false, verborgen = KEINE, textAuswahlGesperrt = false,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const rueckruf = useRef({ onSeite, onZoom, onSuchstand });
    rueckruf.current = { onSeite, onZoom, onSuchstand };
    const zoomVorgabe = useRef<string>('page-width');
    const ansicht = useRef<{ update(): void; refresh?(): void; currentScaleValue: string } | null>(null);
    // Anmerkungsmodus des Viewers: aus, normal oder mit Speicher (verborgene Anmerkungen).
    const anmerkungsModus = anmerkungenAusgeblendet ? 'aus' : verborgen.length ? 'speicher' : 'an';
    // Der fertige Viewer für die Anmerkungsebene — als Zustand, damit sie
    // erst einhängt, wenn es ihn gibt, und wieder aushängt, wenn er weg ist.
    const [anschluss, setAnschluss] = useState<EbenenAnschluss | null>(null);
    // Die aktuelle Seite überlebt einen Neuaufbau des Viewers (Anmerkungen
    // ein/aus); ein anderes Dokument fängt bei 1 an.
    const aktuelleSeite = useRef(1);
    const letztesDokument = useRef(dokument);
    if (letztesDokument.current !== dokument) {
        letztesDokument.current = dokument;
        aktuelleSeite.current = 1;
    }

    useEffect(() => {
        const container = containerRef.current;
        const ziel = viewerRef.current;
        if (!container || !ziel) return;
        const { pdfjs, viewer: V } = bibliothek;
        const abbruch = new AbortController();
        const eventBus = new V.EventBus();
        const linkService = new V.PDFLinkService({
            eventBus,
            externalLinkTarget: V.LinkTarget.BLANK,
            externalLinkRel: 'noopener noreferrer',
        });
        const findController = new V.PDFFindController({ linkService, eventBus });
        const optionen = {
            container,
            viewer: ziel,
            eventBus,
            linkService,
            findController,
            annotationMode: anmerkungsModus === 'aus'
                ? pdfjs.AnnotationMode.DISABLE
                : anmerkungsModus === 'speicher' ? (pdfjs.AnnotationMode.ENABLE_STORAGE ?? pdfjs.AnnotationMode.ENABLE) : pdfjs.AnnotationMode.ENABLE,
            removePageBorders: false,
            imageResourcesPath: NOTIZ_SYMBOL,
            enablePermissions: false,
            // Nicht in den Typen, aber im Code: räumt Beobachter beim Schließen ab.
            abortSignal: abbruch.signal,
        };
        const pdfViewer = new V.PDFViewer(optionen as ConstructorParameters<typeof V.PDFViewer>[0]);
        ansicht.current = pdfViewer;
        linkService.setViewer(pdfViewer);

        const an = (name: string, f: (e: never) => void) => eventBus.on(name, f, { signal: abbruch.signal });
        an('pagesinit', () => {
            // Verborgen (Bearbeiten-Modus, etwa nach dem Neuladen einer
            // gespeicherten Fassung) kann pdf.js nicht scrollen; dann setzt
            // der Wechsel zurück ins Lesen den Zoom.
            if (container.offsetParent) pdfViewer.currentScaleValue = zoomVorgabe.current;
            if (aktuelleSeite.current > 1) pdfViewer.currentPageNumber = aktuelleSeite.current;
        });
        an('pagechanging', (e: { pageNumber: number }) => {
            aktuelleSeite.current = e.pageNumber;
            rueckruf.current.onSeite(e.pageNumber);
        });
        an('scalechanging', (e: { scale: number; presetValue?: string }) => {
            zoomVorgabe.current = e.presetValue || String(e.scale);
            rueckruf.current.onZoom(Math.round(e.scale * 100), e.presetValue ?? null);
        });
        const zaehler = (e: { matchesCount?: { current: number; total: number }; state?: number }) => {
            rueckruf.current.onSuchstand({
                zustand: e.state === undefined ? undefined : (SUCHZUSTAND[e.state] ?? 'sucht'),
                aktuell: e.matchesCount?.current ?? 0,
                gesamt: e.matchesCount?.total ?? 0,
            });
        };
        an('updatefindmatchescount', zaehler);
        an('updatefindcontrolstate', zaehler);

        pdfViewer.setDocument(dokument);
        linkService.setDocument(dokument, null);
        setAnschluss({ pdfViewer, eventBus, container, viewer: ziel });

        // Ändert sich die Breite (Leiste auf/zu, Fenster), rechnet pdf.js
        // „Seitenbreite“ & Co. NICHT von selbst nach — das macht in pdf.js die
        // Viewer-Anwendung, die wir nicht benutzen. Also hier.
        let rahmen = 0;
        const groesse = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
            cancelAnimationFrame(rahmen);
            rahmen = requestAnimationFrame(() => {
                const vorgabe = zoomVorgabe.current;
                if (container.clientWidth > 0 && (vorgabe === 'page-width' || vorgabe === 'page-fit' || vorgabe === 'auto')) {
                    pdfViewer.currentScaleValue = vorgabe;
                }
            });
        });
        groesse?.observe(container);

        let letzteSuche = '';
        steuerung.current = {
            zuSeite(nummer) {
                if (nummer >= 1 && nummer <= dokument.numPages) pdfViewer.currentPageNumber = nummer;
            },
            blaettern(richtung) {
                if (richtung > 0) pdfViewer.nextPage();
                else pdfViewer.previousPage();
            },
            zoom(wert) {
                if (wert === 'mehr') pdfViewer.increaseScale();
                else if (wert === 'weniger') pdfViewer.decreaseScale();
                else if (typeof wert === 'number') pdfViewer.currentScale = wert / 100;
                else pdfViewer.currentScaleValue = wert;
            },
            suchen(text, art, optionen = SUCHOPTIONEN_VORGABE) {
                const neu = art === 'neu' || text !== letzteSuche;
                letzteSuche = text;
                eventBus.dispatch('find', {
                    source: null,
                    type: neu ? '' : 'again',
                    query: text,
                    caseSensitive: optionen.caseSensitive,
                    entireWord: optionen.entireWord,
                    highlightAll: true,
                    findPrevious: art === 'zurueck',
                    matchDiacritics: false,
                });
            },
            sucheBeenden() {
                letzteSuche = '';
                eventBus.dispatch('findbarclose', { source: null });
            },
            zuZiel(zielAngabe) {
                if (typeof zielAngabe === 'string' || Array.isArray(zielAngabe)) {
                    void linkService.goToDestination(zielAngabe);
                }
            },
            zuStelle(seite, rechteck) {
                if (seite < 1 || seite > dokument.numPages) return;
                pdfViewer.scrollPageIntoView({
                    pageNumber: seite,
                    // Links null: waagrecht am Seitenrand bleiben, nur senkrecht zur Stelle.
                    destArray: rechteck ? [null, { name: 'XYZ' }, null, rechteck[3] + 24, null] : undefined,
                    allowNegativeOffset: true,
                });
                // Die Stelle kurz aufleuchten lassen, damit das Auge sie findet.
                const seitenAnsicht = pdfViewer.getPageView(seite - 1) as {
                    div?: HTMLElement;
                    viewport?: { convertToViewportPoint(x: number, y: number): number[] };
                } | undefined;
                if (!rechteck || !seitenAnsicht?.div || !seitenAnsicht.viewport) return;
                // pdf.js 6 kennt nur noch die Punkt-Umrechnung: zwei Ecken.
                const [x1, y1] = seitenAnsicht.viewport.convertToViewportPoint(rechteck[0], rechteck[1]);
                const [x2, y2] = seitenAnsicht.viewport.convertToViewportPoint(rechteck[2], rechteck[3]);
                const markierung = document.createElement('div');
                markierung.className = 'opdf-stelle';
                Object.assign(markierung.style, {
                    left: `${Math.min(x1, x2) - 3}px`,
                    top: `${Math.min(y1, y2) - 3}px`,
                    width: `${Math.abs(x2 - x1) + 6}px`,
                    height: `${Math.abs(y2 - y1) + 6}px`,
                    zIndex: '10',
                });
                seitenAnsicht.div.appendChild(markierung);
                window.setTimeout(() => markierung.remove(), 1800);
            },
            trefferJeSeite() {
                const treffer = findController.pageMatches as unknown[][] | undefined;
                return (treffer ?? []).map(t => (Array.isArray(t) ? t.length : 0));
            },
        };

        return () => {
            steuerung.current = null;
            ansicht.current = null;
            setAnschluss(null);
            groesse?.disconnect();
            cancelAnimationFrame(rahmen);
            abbruch.abort();
            try {
                pdfViewer.cleanup();
                pdfViewer.setDocument(null as unknown as PDFDocumentProxy);
                linkService.setDocument(null);
            } catch {
                // Beim Schließen darf nichts mehr stören.
            }
            ziel.replaceChildren();
        };
    }, [bibliothek, dokument, steuerung, anmerkungsModus]);

    // Verborgene Anmerkungen (Etappe 8): `noView` je Kennung im Speicher des
    // Dokuments setzen bzw. zurücknehmen, dann die Seiten neu zeichnen.
    const verborgenSchluessel = verborgen.join('\n');
    const zuvorVerborgen = useRef<string[]>([]);
    useEffect(() => {
        const speicher = (dokument as unknown as { annotationStorage?: { setValue(id: string, wert: object): void; remove(id: string): void } }).annotationStorage;
        if (!speicher) return;
        const jetzt = verborgenSchluessel ? verborgenSchluessel.split('\n') : [];
        for (const id of zuvorVerborgen.current) {
            if (!jetzt.includes(id)) speicher.remove(id);
        }
        for (const id of jetzt) speicher.setValue(id, { noView: true });
        zuvorVerborgen.current = jetzt;
        ansicht.current?.refresh?.();
    }, [dokument, verborgenSchluessel, anmerkungsModus]);
    // Beim Wechsel des Dokuments beginnt die Buchführung von vorn.
    useEffect(() => () => { zuvorVerborgen.current = []; }, [dokument]);

    // Hand-Werkzeug: nur solange es gewählt ist.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || zeiger !== 'hand') return undefined;
        return handGriff(container);
    }, [zeiger]);

    // Nach dem Bearbeiten wieder sichtbar: Größe neu berechnen, sonst stimmt
    // „Seitenbreite“ nicht mehr, wenn sich das Fenster inzwischen änderte.
    const warSichtbar = useRef(sichtbar);
    useEffect(() => {
        const vorher = warSichtbar.current;
        warSichtbar.current = sichtbar;
        const v = ansicht.current;
        if (!sichtbar || vorher || !v) return;
        v.update();
        v.currentScaleValue = zoomVorgabe.current;
    }, [sichtbar]);

    return (
        <div className={`relative flex-1 min-w-0 min-h-0 ${sichtbar ? '' : 'hidden'}`}>
            <div ref={containerRef} className="opdf-lesecontainer" tabIndex={0} role="region" aria-label={beschriftung} data-zeiger={zeiger}
                data-dunkel={dunkel ? 'true' : undefined} data-kopieren={textAuswahlGesperrt ? 'gesperrt' : undefined}>
                {verborgen.length > 0 && (
                    <style>{verborgen.map(id => `.opdf-lesecontainer .annotationLayer [data-annotation-id="${stilSicher(id)}"]{display:none}`).join('\n')}</style>
                )}
                <div ref={viewerRef} className="pdfViewer" />
                {anschluss && anmerkungen && !anmerkungenAusgeblendet && <AnmerkungsEbene anschluss={anschluss} {...anmerkungen} />}
            </div>
        </div>
    );
}

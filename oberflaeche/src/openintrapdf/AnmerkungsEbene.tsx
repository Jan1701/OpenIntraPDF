// SPDX-License-Identifier: Apache-2.0
//
// Die Anmerkungsebene: Entwurfsanmerkungen als SVG über den pdf.js-Seiten,
// dazu die Gesten der Zeichenwerkzeuge und das Ablesen der Textauswahl.
//
// Warum NICHT im Seiten-Div von pdf.js: `PDFPageView.reset()` leert das Div
// bei jedem Zoomschritt und beim Verlassen des Renderpuffers und behält nur
// seine eigenen Ebenen. Alles Fremde darin wäre nach dem ersten Zoom weg.
// Die Ebene liegt darum als Geschwister neben `.pdfViewer` im
// Scrollcontainer und misst die Lage jeder Seite selbst — nach jedem
// Ereignis, das sie ändern kann (Zoom, Drehung, Rendern, Größe).
//
// Koordinaten: Die Lage einer Seite ist ihr Div (CSS-Pixel im Container);
// darin rechnet ausschließlich der `PageViewport` der Seite (koordinaten.ts).
// Der Viewport enthält Drehung, Zoom und CropBox-Versatz — deshalb sitzt
// jede Anmerkung nach Zoom oder Drehung wieder an derselben Stelle des
// Papiers, ohne dass hier gerechnet wird.
//
// Post-it und Stempel (Etappe 5) lassen sich IM ENTWURF ziehen und an der
// Ecke in der Größe ändern. Dafür liegt je Zettel ein Griff als HTML über
// dem SVG; während des Ziehens zeigt die Vorschau die neue Lage, und erst
// beim Loslassen geht EIN Befehl in den Entwurf — Rückgängig nimmt so den
// ganzen Zug zurück, nicht jeden Bildpunkt einzeln.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ZeigerEreignis } from 'react';
import { useTranslation } from 'react-i18next';
import { rgbZuCss, TEXTMARKIERUNGEN, VERSCHIEBBAR } from './anmerkungen';
import type { NeueAnmerkung } from './anmerkungen';
import { anmerkungAusGeste, inAnzeige, massstab, quadInAnzeige, rechteckAusAnzeigeBox, rechteckInAnzeige } from './koordinaten';
import type { Geste, Stil, Viewport } from './koordinaten';
import { dunkler, POSTIT_INNENABSTAND, POSTIT_MINDEST, POSTIT_SCHRIFT, POSTIT_TEXTFARBE } from './postit';
import { STEMPEL_MINDEST, stempelSchrift } from './stempel';
import type { LinkEintrag } from './kommentare';
import type { AnmerkungsArt, PdfRechteck } from './typen';

interface SeitenAnsicht { div?: HTMLElement; viewport?: Viewport }

/** Was die Leseansicht der Ebene über den pdf.js-Viewer reicht. */
export interface EbenenAnschluss {
    pdfViewer: { pagesCount: number; getPageView(i: number): unknown };
    eventBus: { on(name: string, f: () => void, optionen?: { signal?: AbortSignal }): void };
    /** Der Scrollcontainer. */
    container: HTMLElement;
    /** Das `.pdfViewer`-Element darin. */
    viewer: HTMLElement;
}

export interface AnmerkungsProps {
    /** Neue Anmerkungen des Entwurfs; `page` ist die Quellseite ab 0. */
    entwurf: readonly NeueAnmerkung[];
    werkzeug: AnmerkungsArt | null;
    stil: Stil;
    onNeu: (a: Omit<NeueAnmerkung, 'client_id'>) => void;
    /** Post-it oder Stempel des Entwurfs verschoben oder in der Größe geändert (Etappe 5). */
    onRect?: (client_id: string, page: number, rect: PdfRechteck) => void;
    /** Zweite Zeile eines Stempels mit „Name und Datum“ in der Vorschau, z. B. „Anna Muster · 30.09.2026“. */
    unterschrift?: string;
    /**
     * Links (Etappe 9): Mit dem Link-Werkzeug zeigt die Ebene gespeicherte
     * Links (ohne die zum Löschen vorgemerkten) und neue mit gestrichelter
     * Umrandung; ein Klick darauf meldet den Link zum Löschen.
     */
    links?: {
        gespeichert: readonly LinkEintrag[];
        geloescht: ReadonlySet<string>;
        onKlick: (id: string, page: number, ziel: string) => void;
        /** Beschriftung des Griffs für die Zielangabe. */
        zielText: (l: { url?: string; uri?: string; dest?: unknown; page_target?: number }) => string;
    };
}

interface SeitenLage { seite: number; links: number; oben: number; breite: number; hoehe: number; viewport: Viewport }
interface Box { links: number; oben: number; breite: number; hoehe: number }

/** Eine laufende Geste: Anfang, aktueller Punkt, bei Freihand alle Punkte. */
interface Laufend { lage: SeitenLage; x1: number; y1: number; x2: number; y2: number; punkte: number[] }

/** Ein laufender Zug an einem Griff: welcher Zettel, wie er begann, wo er gerade ist. */
interface Zug { id: string; page: number; art: 'verschieben' | 'groesse'; lage: SeitenLage; start: [number, number]; box: Box; mindest: number }

type Anmerkung = Omit<NeueAnmerkung, 'client_id'>;

export function AnmerkungsEbene({ anschluss, entwurf, werkzeug, stil, onNeu, onRect, unterschrift, links }: AnmerkungsProps & { anschluss: EbenenAnschluss }) {
    const { t } = useTranslation();
    const [lagen, setLagen] = useState<SeitenLage[]>([]);
    const [flaeche, setFlaeche] = useState<Box | null>(null);
    const [laufend, setLaufend] = useState<Laufend | null>(null);
    const laufendRef = useRef<Laufend | null>(null);
    const neuestes = useRef({ lagen, stil, onNeu, werkzeug });
    neuestes.current = { lagen, stil, onNeu, werkzeug };

    // --------------------------------------------------------------
    // Lage der Seiten messen
    // --------------------------------------------------------------
    useEffect(() => {
        const { pdfViewer, eventBus, container, viewer } = anschluss;
        const messen = () => {
            const c = container.getBoundingClientRect();
            const relativ = (r: DOMRect) => ({ links: r.left - c.left + container.scrollLeft, oben: r.top - c.top + container.scrollTop });
            const neu: SeitenLage[] = [];
            for (let i = 0; i < pdfViewer.pagesCount; i++) {
                const pv = pdfViewer.getPageView(i) as SeitenAnsicht | undefined;
                if (!pv?.div || !pv.viewport) continue;
                const { links, oben } = relativ(pv.div.getBoundingClientRect());
                neu.push({
                    seite: i,
                    links: links + pv.div.clientLeft,
                    oben: oben + pv.div.clientTop,
                    breite: pv.div.clientWidth,
                    hoehe: pv.div.clientHeight,
                    viewport: pv.viewport,
                });
            }
            setLagen(neu);
            const v = viewer.getBoundingClientRect();
            setFlaeche({ ...relativ(v), breite: v.width, hoehe: v.height });
        };
        const abbruch = new AbortController();
        let rahmen = 0;
        const planen = () => {
            cancelAnimationFrame(rahmen);
            rahmen = requestAnimationFrame(messen);
        };
        // pdf.js bringt die Viewports der Seiten VOR diesen Ereignissen auf
        // den neuen Stand; danach zu messen ist also richtig.
        for (const name of ['pagesinit', 'pagesloaded', 'scalechanging', 'rotationchanging', 'pagerendered']) {
            eventBus.on(name, planen, { signal: abbruch.signal });
        }
        // Zentrierte Seiten wandern waagrecht, wenn sich die Breite ändert.
        const groesse = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(planen);
        groesse?.observe(viewer);
        planen();
        return () => {
            abbruch.abort();
            groesse?.disconnect();
            cancelAnimationFrame(rahmen);
        };
    }, [anschluss]);

    const zeichnet = !!werkzeug && !TEXTMARKIERUNGEN.includes(werkzeug);

    // Werkzeugwechsel bricht eine laufende Geste ab (Esc beendet das Werkzeug).
    useEffect(() => {
        if (!zeichnet) {
            laufendRef.current = null;
            setLaufend(null);
        }
    }, [zeichnet, werkzeug]);

    const containerPunkt = (e: { clientX: number; clientY: number }): [number, number] => {
        const c = anschluss.container.getBoundingClientRect();
        return [e.clientX - c.left + anschluss.container.scrollLeft, e.clientY - c.top + anschluss.container.scrollTop];
    };
    const lageBei = (x: number, y: number) =>
        neuestes.current.lagen.find(l => x >= l.links && x <= l.links + l.breite && y >= l.oben && y <= l.oben + l.hoehe);

    // --------------------------------------------------------------
    // Gesten der Zeichenwerkzeuge (Notiz, Post-it, Stempel, Textfeld, Freihand, Linie, Pfeil, Rechteck, Ellipse)
    // --------------------------------------------------------------
    const gesteAus = (l: Laufend, art: AnmerkungsArt): Geste => {
        switch (art) {
            case 'note':
            case 'sticky':
            case 'stamp': return { art: 'punkt', x: l.x1, y: l.y1 };
            case 'line':
            case 'arrow': return { art: 'linie', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
            case 'ink': return { art: 'pfad', punkte: l.punkte };
            default: return { art: 'rechteck', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
        }
    };

    const beiDruecken = (e: ZeigerEreignis<HTMLDivElement>) => {
        if (!werkzeug || e.button !== 0) return;
        const [x, y] = containerPunkt(e);
        const lage = lageBei(x, y);
        if (!lage) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const px = x - lage.links;
        const py = y - lage.oben;
        const l: Laufend = { lage, x1: px, y1: py, x2: px, y2: py, punkte: [px, py] };
        laufendRef.current = l;
        setLaufend(l);
    };

    const beiBewegen = (e: ZeigerEreignis<HTMLDivElement>) => {
        const l = laufendRef.current;
        if (!l) return;
        const [x, y] = containerPunkt(e);
        const px = x - l.lage.links;
        const py = y - l.lage.oben;
        const neu: Laufend = { ...l, x2: px, y2: py, punkte: werkzeug === 'ink' ? [...l.punkte, px, py] : l.punkte };
        laufendRef.current = neu;
        setLaufend(neu);
    };

    const beiLoslassen = (e: ZeigerEreignis<HTMLDivElement>) => {
        const l = laufendRef.current;
        laufendRef.current = null;
        setLaufend(null);
        if (!l || !werkzeug) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const a = anmerkungAusGeste(werkzeug, gesteAus(l, werkzeug), l.lage.viewport, l.lage.seite, stil);
        if (a) onNeu(a);
    };

    const beiAbbruch = () => {
        laufendRef.current = null;
        setLaufend(null);
    };

    // --------------------------------------------------------------
    // Post-it und Stempel im Entwurf ziehen und in der Größe ändern
    // --------------------------------------------------------------
    const zug = useRef<Zug | null>(null);
    const [bewegung, setBewegung] = useState<{ id: string; box: Box } | null>(null);

    /** Die Box nach dem Zug: verschoben oder vergrößert, nie über die Seite hinaus. */
    const boxNachZug = (z: Zug, x: number, y: number): Box => {
        const dx = x - z.start[0];
        const dy = y - z.start[1];
        if (z.art === 'verschieben') {
            return {
                ...z.box,
                links: Math.max(0, Math.min(z.box.links + dx, z.lage.breite - z.box.breite)),
                oben: Math.max(0, Math.min(z.box.oben + dy, z.lage.hoehe - z.box.hoehe)),
            };
        }
        return {
            ...z.box,
            breite: Math.max(z.mindest, Math.min(z.box.breite + dx, z.lage.breite - z.box.links)),
            hoehe: Math.max(z.mindest, Math.min(z.box.hoehe + dy, z.lage.hoehe - z.box.oben)),
        };
    };

    const griffStart = (e: ZeigerEreignis<HTMLDivElement>, a: NeueAnmerkung, lage: SeitenLage, art: Zug['art']) => {
        if (e.button !== 0 || !onRect) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const box = rechteckInAnzeige(lage.viewport, a.rect);
        const mindest = (a.kind === 'stamp' ? STEMPEL_MINDEST : POSTIT_MINDEST) * massstab(lage.viewport);
        zug.current = { id: a.client_id, page: a.page, art, lage, start: containerPunkt(e), box, mindest };
        setBewegung({ id: a.client_id, box });
    };

    const griffBewegen = (e: ZeigerEreignis<HTMLDivElement>) => {
        const z = zug.current;
        if (!z) return;
        const [x, y] = containerPunkt(e);
        setBewegung({ id: z.id, box: boxNachZug(z, x, y) });
    };

    const griffEnde = (e: ZeigerEreignis<HTMLDivElement>) => {
        const z = zug.current;
        zug.current = null;
        setBewegung(null);
        if (!z) return;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        const [x, y] = containerPunkt(e);
        const box = boxNachZug(z, x, y);
        if (box.links === z.box.links && box.oben === z.box.oben && box.breite === z.box.breite && box.hoehe === z.box.hoehe) return;
        onRect?.(z.id, z.page, rechteckAusAnzeigeBox(z.lage.viewport, box));
    };

    const griffAbbruch = () => {
        zug.current = null;
        setBewegung(null);
    };

    // --------------------------------------------------------------
    // Textauswahl → Hervorheben, Unterstreichen, Durchstreichen
    // --------------------------------------------------------------
    useEffect(() => {
        if (!werkzeug || !TEXTMARKIERUNGEN.includes(werkzeug)) return;
        const { container } = anschluss;
        const auswerten = () => {
            const { lagen: aktuelle, stil: s, onNeu: neu } = neuestes.current;
            const auswahl = document.getSelection();
            if (!auswahl || auswahl.isCollapsed || !auswahl.rangeCount) return;
            const c = container.getBoundingClientRect();
            const jeSeite = new Map<number, { links: number; oben: number; rechts: number; unten: number }[]>();
            for (let i = 0; i < auswahl.rangeCount; i++) {
                for (const r of Array.from(auswahl.getRangeAt(i).getClientRects())) {
                    if (r.width < 1 || r.height < 1) continue;
                    const links = r.left - c.left + container.scrollLeft;
                    const oben = r.top - c.top + container.scrollTop;
                    const lage = aktuelle.find(l => links + r.width / 2 >= l.links && links + r.width / 2 <= l.links + l.breite
                        && oben + r.height / 2 >= l.oben && oben + r.height / 2 <= l.oben + l.hoehe);
                    if (!lage) continue;
                    const liste = jeSeite.get(lage.seite) ?? [];
                    liste.push({ links: links - lage.links, oben: oben - lage.oben, rechts: links - lage.links + r.width, unten: oben - lage.oben + r.height });
                    jeSeite.set(lage.seite, liste);
                }
            }
            if (!jeSeite.size) return;
            // Je Seite eine Anmerkung — ein Quad je Zeile.
            for (const [seite, boxen] of jeSeite) {
                const lage = aktuelle.find(l => l.seite === seite);
                if (!lage) continue;
                const a = anmerkungAusGeste(werkzeug, { art: 'auswahl', boxen }, lage.viewport, seite, s);
                if (a) neu(a);
            }
            auswahl.removeAllRanges();
        };
        // Beim Loslassen steht die Auswahl erst im nächsten Umlauf fest.
        const beiLoslassenText = () => { window.setTimeout(auswerten, 0); };
        container.addEventListener('pointerup', beiLoslassenText);
        return () => container.removeEventListener('pointerup', beiLoslassenText);
    }, [werkzeug, anschluss]);

    // --------------------------------------------------------------
    // Anzeige
    // --------------------------------------------------------------
    const jeSeite = useMemo(() => {
        const m = new Map<number, NeueAnmerkung[]>();
        for (const a of entwurf) {
            const liste = m.get(a.page);
            if (liste) liste.push(a);
            else m.set(a.page, [a]);
        }
        return m;
    }, [entwurf]);

    const vorschau = laufend && werkzeug
        ? anmerkungAusGeste(werkzeug, gesteAus(laufend, werkzeug), laufend.lage.viewport, laufend.lage.seite, stil)
        : null;

    /** Während eines Zugs zeigt die Vorschau den Zettel schon an der neuen Stelle. */
    const mitZug = (a: NeueAnmerkung, vp: Viewport): NeueAnmerkung =>
        bewegung && bewegung.id === a.client_id ? { ...a, rect: rechteckAusAnzeigeBox(vp, bewegung.box) } : a;

    // Griffe gibt es nur, solange kein Zeichenwerkzeug die Fläche hält —
    // sonst wüsste ein Zug auf dem Zettel nicht, ob er zeichnen oder ziehen soll.
    const griffe = !zeichnet && !!onRect;

    // Links (Etappe 9): sichtbar und klickbar nur mit dem Link-Werkzeug —
    // gespeicherte, die nicht zum Löschen vorgemerkt sind, und die des Entwurfs.
    const linkWerkzeug = werkzeug === 'link' && !!links;
    const gespeicherteLinks = useMemo(() => {
        const m = new Map<number, LinkEintrag[]>();
        if (!links) return m;
        for (const l of links.gespeichert) {
            if (links.geloescht.has(l.id)) continue;
            const liste = m.get(l.page);
            if (liste) liste.push(l);
            else m.set(l.page, [l]);
        }
        return m;
    }, [links]);

    return (
        <div className="opdf-anmerkungen" data-werkzeug={werkzeug ?? undefined}>
            {lagen.map(l => {
                const eintraege = jeSeite.get(l.seite);
                const eigeneVorschau = vorschau && laufend?.lage.seite === l.seite ? vorschau : null;
                if (!eintraege?.length && !eigeneVorschau) return null;
                return (
                    <svg key={l.seite} className="opdf-anmerkungen-seite" aria-hidden
                        style={{ left: l.links, top: l.oben, width: l.breite, height: l.hoehe }}
                        width={l.breite} height={l.hoehe}>
                        {eintraege?.map(a => <Form key={a.client_id} a={mitZug(a, l.viewport)} vp={l.viewport} unterschrift={unterschrift} />)}
                        {eigeneVorschau && <Form a={eigeneVorschau} vp={l.viewport} unterschrift={unterschrift} vorschau />}
                    </svg>
                );
            })}
            {/* Gespeicherte Links: gestrichelt, nur mit dem Link-Werkzeug (die neuen zeichnet Form). */}
            {linkWerkzeug && lagen.map(l => {
                const liste = gespeicherteLinks.get(l.seite);
                if (!liste?.length) return null;
                return (
                    <svg key={`links-${l.seite}`} className="opdf-anmerkungen-seite" aria-hidden
                        style={{ left: l.links, top: l.oben, width: l.breite, height: l.hoehe }} width={l.breite} height={l.hoehe}>
                        {liste.map(k => {
                            const b = rechteckInAnzeige(l.viewport, [k.rect[0], k.rect[1], k.rect[2], k.rect[3]]);
                            return <rect key={k.id} data-art="link" x={b.links} y={b.oben} width={b.breite} height={b.hoehe} fill="none"
                                stroke="var(--opdf-akzent)" strokeWidth={1} strokeDasharray="4 3" />;
                        })}
                    </svg>
                );
            })}
            {/* Reine Zeigerziele (aria-hidden): Mit der Tastatur bleibt die Kommentarliste der Weg zur Anmerkung. */}
            {griffe && lagen.map(l => (jeSeite.get(l.seite) ?? []).filter(a => VERSCHIEBBAR.includes(a.kind)).map(a => {
                const b = bewegung && bewegung.id === a.client_id ? bewegung.box : rechteckInAnzeige(l.viewport, a.rect);
                const name = t(`openintrapdf.kommentare.werkzeug.${a.kind}`);
                return (
                    <div key={a.client_id} className="opdf-griff" data-testid={`opdf-griff-${a.client_id}`} aria-hidden
                        title={`${name}: ${t('openintrapdf.kommentare.griffVerschieben')}`}
                        style={{ left: l.links + b.links, top: l.oben + b.oben, width: b.breite, height: b.hoehe }}
                        onPointerDown={e => griffStart(e, a, l, 'verschieben')} onPointerMove={griffBewegen}
                        onPointerUp={griffEnde} onPointerCancel={griffAbbruch}>
                        <div className="opdf-griff-ecke" data-testid={`opdf-griff-ecke-${a.client_id}`}
                            title={`${name}: ${t('openintrapdf.kommentare.griffGroesse')}`}
                            onPointerDown={e => griffStart(e, a, l, 'groesse')} onPointerMove={griffBewegen}
                            onPointerUp={griffEnde} onPointerCancel={griffAbbruch} />
                    </div>
                );
            }))}
            {zeichnet && flaeche && (
                <div className="opdf-zeichenflaeche" data-testid="opdf-zeichenflaeche"
                    style={{ left: flaeche.links, top: flaeche.oben, width: flaeche.breite, height: flaeche.hoehe }}
                    onPointerDown={beiDruecken} onPointerMove={beiBewegen} onPointerUp={beiLoslassen} onPointerCancel={beiAbbruch} />
            )}
            {/* Klickziele der Links (über der Zeichenfläche): gespeicherte und neue, zum Löschen. */}
            {linkWerkzeug && lagen.map(l => [
                ...(gespeicherteLinks.get(l.seite) ?? []).map(k => ({ id: k.id, page: k.page, rect: [k.rect[0], k.rect[1], k.rect[2], k.rect[3]] as PdfRechteck, ziel: links!.zielText(k) })),
                ...(jeSeite.get(l.seite) ?? []).filter(a => a.kind === 'link').map(a => ({ id: a.client_id, page: a.page, rect: a.rect, ziel: links!.zielText(a) })),
            ].map(k => {
                const b = rechteckInAnzeige(l.viewport, k.rect);
                return (
                    <div key={k.id} className="opdf-link-griff" data-testid={`opdf-link-${k.id}`} aria-hidden
                        title={t('openintrapdf.link.griff', { ziel: k.ziel })}
                        style={{ left: l.links + b.links, top: l.oben + b.oben, width: b.breite, height: b.hoehe }}
                        onPointerDown={e => { e.stopPropagation(); e.preventDefault(); }}
                        onClick={e => { e.stopPropagation(); links!.onKlick(k.id, k.page, k.ziel); }} />
                );
            }))}
        </div>
    );
}

// ---------------------------------------------------------------------
// Eine Anmerkung als SVG — gerechnet aus ihren PDF-Koordinaten
// ---------------------------------------------------------------------

/** Notizsymbol, 20×20, wird auf die Anzeigegröße skaliert. */
const NOTIZ_PFAD = 'M2.5 1.5h10l6 6v11h-16z';
const NOTIZ_FALTE = 'M12.5 1.5v6h6';

const SCHRIFT = 'Helvetica, Arial, sans-serif';

export function Form({ a, vp, vorschau = false, unterschrift }: { a: Anmerkung; vp: Viewport; vorschau?: boolean; unterschrift?: string }) {
    const farbe = rgbZuCss(a.color);
    const m = massstab(vp);
    const strich = Math.max(0.75, (a.width ?? 1) * m);
    const g = { opacity: vorschau ? 0.6 : 1 };
    switch (a.kind) {
        case 'highlight':
            return (
                <g {...g} style={{ mixBlendMode: 'multiply' }}>
                    {(a.quads ?? []).map((q, i) => {
                        const [ol, or, ul, ur] = quadInAnzeige(vp, q);
                        return <polygon key={i} points={`${ol} ${or} ${ur} ${ul}`} fill={farbe} fillOpacity={0.5} />;
                    })}
                </g>
            );
        case 'underline':
            return (
                <g {...g}>
                    {(a.quads ?? []).map((q, i) => {
                        const [, , ul, ur] = quadInAnzeige(vp, q);
                        return <line key={i} x1={ul[0]} y1={ul[1]} x2={ur[0]} y2={ur[1]} stroke={farbe} strokeWidth={Math.max(1, m)} />;
                    })}
                </g>
            );
        case 'strikeout':
            return (
                <g {...g}>
                    {(a.quads ?? []).map((q, i) => {
                        const [ol, or, ul, ur] = quadInAnzeige(vp, q);
                        return (
                            <line key={i} x1={(ol[0] + ul[0]) / 2} y1={(ol[1] + ul[1]) / 2} x2={(or[0] + ur[0]) / 2} y2={(or[1] + ur[1]) / 2}
                                stroke={farbe} strokeWidth={Math.max(1, m)} />
                        );
                    })}
                </g>
            );
        case 'note': {
            const b = rechteckInAnzeige(vp, a.rect);
            return (
                <g {...g} transform={`translate(${b.links} ${b.oben}) scale(${b.breite / 20})`}>
                    <path d={NOTIZ_PFAD} fill={farbe} stroke="rgb(60 50 20)" strokeWidth={1.2} strokeLinejoin="round" />
                    <path d={NOTIZ_FALTE} fill="none" stroke="rgb(60 50 20)" strokeWidth={1.2} strokeLinejoin="round" />
                </g>
            );
        }
        case 'freetext': {
            const b = rechteckInAnzeige(vp, a.rect);
            const schrift = (a.font_size ?? 12) * m;
            return (
                <g {...g}>
                    <rect x={b.links} y={b.oben} width={b.breite} height={b.hoehe} fill="rgb(255 255 255 / 0.85)" stroke={farbe} strokeWidth={Math.max(1, m)} />
                    <foreignObject x={b.links} y={b.oben} width={b.breite} height={b.hoehe}>
                        <div style={{
                            font: `${schrift}px/1.25 ${SCHRIFT}`, color: farbe, padding: 2 * m, boxSizing: 'border-box',
                            width: '100%', height: '100%', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                            {a.contents}
                        </div>
                    </foreignObject>
                </g>
            );
        }
        case 'sticky': {
            // Wie das Erscheinungsbild des Servers: Füllung, 1-pt-Rand in der
            // dunkleren Farbe, Eselsohr unten rechts, dunkelgrauer Text mit
            // 6 pt Abstand, Umbruch an Wortgrenzen (zu lange Wörter hart).
            const b = rechteckInAnzeige(vp, a.rect);
            const rand = dunkler(a.color);
            const schrift = (a.font_size ?? POSTIT_SCHRIFT) * m;
            const ohr = Math.min(14 * m, b.breite / 3, b.hoehe / 3);
            const rechts = b.links + b.breite;
            const unten = b.oben + b.hoehe;
            return (
                <g {...g} data-art="sticky">
                    <rect x={b.links} y={b.oben} width={b.breite} height={b.hoehe} fill={farbe} stroke={rand} strokeWidth={Math.max(0.75, m)} />
                    <polygon data-teil="eselsohr" points={`${rechts - ohr},${unten} ${rechts},${unten - ohr} ${rechts},${unten}`} fill={rand} />
                    <foreignObject x={b.links} y={b.oben} width={b.breite} height={b.hoehe}>
                        <div style={{
                            font: `${schrift}px/1.2 ${SCHRIFT}`, color: POSTIT_TEXTFARBE, padding: POSTIT_INNENABSTAND * m, boxSizing: 'border-box',
                            width: '100%', height: '100%', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
                        }}>
                            {a.contents}
                        </div>
                    </foreignObject>
                </g>
            );
        }
        case 'stamp': {
            // Abgerundeter Doppelrahmen (außen 2 pt, innen 0,75 pt, Abstand
            // 2 pt), keine Füllung, Label fett und zentriert, bei „Name und
            // Datum“ die zweite Zeile mit 40 % der Labelgröße — keine Schrägstellung.
            const b = rechteckInAnzeige(vp, a.rect);
            const label = a.stamp?.label ?? '';
            const signed = !!a.stamp?.signed;
            const groesse = stempelSchrift(b.breite / m, b.hoehe / m, label, signed);
            const aussen = 2 * m;
            const innen = 0.75 * m;
            const abstand = 2 * m;
            const radius = 6 * m;
            const cx = b.links + b.breite / 2;
            const cy = b.oben + b.hoehe / 2;
            const labelHoehe = groesse.label * m * 1.15;
            const zeileHoehe = signed ? groesse.zeile * m * 1.15 : 0;
            const blockOben = cy - (labelHoehe + zeileHoehe) / 2;
            return (
                <g {...g} data-art="stamp">
                    <rect x={b.links + aussen / 2} y={b.oben + aussen / 2} width={Math.max(0, b.breite - aussen)} height={Math.max(0, b.hoehe - aussen)}
                        rx={radius} ry={radius} fill="none" stroke={farbe} strokeWidth={aussen} />
                    <rect x={b.links + aussen + abstand + innen / 2} y={b.oben + aussen + abstand + innen / 2}
                        width={Math.max(0, b.breite - 2 * (aussen + abstand) - innen)} height={Math.max(0, b.hoehe - 2 * (aussen + abstand) - innen)}
                        rx={Math.max(0, radius - aussen - abstand)} ry={Math.max(0, radius - aussen - abstand)} fill="none" stroke={farbe} strokeWidth={innen} />
                    <text x={cx} y={blockOben + labelHoehe / 2} textAnchor="middle" dominantBaseline="central"
                        fontFamily={SCHRIFT} fontWeight="bold" fontSize={groesse.label * m} fill={farbe}>
                        {label}
                    </text>
                    {signed && (
                        <text data-teil="unterschrift" x={cx} y={blockOben + labelHoehe + zeileHoehe / 2} textAnchor="middle" dominantBaseline="central"
                            fontFamily={SCHRIFT} fontSize={groesse.zeile * m} fill={farbe}>
                            {unterschrift ?? ''}
                        </text>
                    )}
                </g>
            );
        }
        case 'ink': {
            const punkte: string[] = [];
            for (const pfad of a.paths ?? []) {
                const teil: string[] = [];
                for (let i = 0; i + 1 < pfad.length; i += 2) teil.push(inAnzeige(vp, pfad[i], pfad[i + 1]).join(','));
                punkte.push(teil.join(' '));
            }
            return (
                <g {...g}>
                    {punkte.map((p, i) => <polyline key={i} points={p} fill="none" stroke={farbe} strokeWidth={strich} strokeLinecap="round" strokeLinejoin="round" />)}
                </g>
            );
        }
        case 'line':
        case 'arrow': {
            if (!a.line) return null;
            const p1 = inAnzeige(vp, a.line[0], a.line[1]);
            const p2 = inAnzeige(vp, a.line[2], a.line[3]);
            let kopf: string | null = null;
            if (a.kind === 'arrow') {
                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const laenge = Math.hypot(dx, dy) || 1;
                const ex = dx / laenge;
                const ey = dy / laenge;
                const groesse = Math.max(6, strich * 4);
                const bx = p2[0] - ex * groesse;
                const by = p2[1] - ey * groesse;
                kopf = `${p2[0]},${p2[1]} ${bx - ey * groesse / 2},${by + ex * groesse / 2} ${bx + ey * groesse / 2},${by - ex * groesse / 2}`;
            }
            return (
                <g {...g}>
                    <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={farbe} strokeWidth={strich} strokeLinecap="round" />
                    {kopf && <polygon points={kopf} fill={farbe} />}
                </g>
            );
        }
        case 'square': {
            const b = rechteckInAnzeige(vp, a.rect);
            return <rect {...g} x={b.links} y={b.oben} width={b.breite} height={b.hoehe} fill="none" stroke={farbe} strokeWidth={strich} />;
        }
        case 'link': {
            // Dünn gestrichelt im Akzent: Ein Link hat im PDF keinen Rahmen; die Umrandung ist nur eine Hilfe zum Finden.
            const b = rechteckInAnzeige(vp, a.rect);
            return <rect {...g} data-art="link" x={b.links} y={b.oben} width={b.breite} height={b.hoehe} fill="none" stroke="var(--opdf-akzent)" strokeWidth={1} strokeDasharray="4 3" />;
        }
        case 'circle': {
            const b = rechteckInAnzeige(vp, a.rect);
            return <ellipse {...g} cx={b.links + b.breite / 2} cy={b.oben + b.hoehe / 2} rx={b.breite / 2} ry={b.hoehe / 2} fill="none" stroke={farbe} strokeWidth={strich} />;
        }
    }
}

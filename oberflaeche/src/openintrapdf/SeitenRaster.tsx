// SPDX-License-Identifier: Apache-2.0
//
// Seitenraster im Bearbeiten-Modus: der ENTWURF, nicht das gespeicherte PDF.
//
// Jede Kachel ist ein Planeintrag. Gewählt wird wie in einer Dateiliste
// (Klick, Umschalt = Bereich, Strg/Cmd = einzeln dazu). Umsortieren geht
// per Ziehen UND per Tastatur (Alt+Pfeil), damit niemand auf die Maus
// angewiesen ist (Konzept Kap. 02). Entfernte Seiten bleiben ausgegraut
// stehen, bis gespeichert wird.

import { useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileInput, RotateCw, Scissors } from 'lucide-react';
import { Miniatur } from './Miniatur';
import type { MiniaturDienst } from './miniaturen';
import type { PlanBefehl, Seitenplan } from './seitenplan';

interface Props {
    plan: Seitenplan;
    nummern: Map<string, number>;
    auswahl: ReadonlySet<string>;
    fokus: string | null;
    miniaturen: MiniaturDienst | null;
    onFokus: (id: string) => void;
    /** Neue Auswahl; `anker` = Ausgangspunkt für Umschalt-Bereiche. */
    onAuswahl: (ids: Set<string>, anker?: string) => void;
    anker: string | null;
    onBefehl: (befehl: PlanBefehl) => void;
    /** Je entferntem Eintrag: wie viele Entwurfsanmerkungen mit ihm entfallen. */
    entfallend?: ReadonlyMap<string, number>;
    /** Strg/Cmd+C, +X, +V im Raster (Etappe 9); fehlt es, tun die Tasten nichts. */
    onZwischenablage?: (art: 'kopieren' | 'ausschneiden' | 'einfuegen') => void;
    /** Einträge, die ausgeschnitten sind und beim Einfügen wandern (Etappe 9). */
    ausgeschnitten?: ReadonlySet<string>;
}

type Einfuegen = { id: string | null; seite: 'vor' | 'nach' } | null;

export function SeitenRaster({ plan, nummern, auswahl, fokus, miniaturen, onFokus, onAuswahl, anker, onBefehl, entfallend, onZwischenablage, ausgeschnitten }: Props) {
    const { t } = useTranslation();
    const raster = useRef<HTMLDivElement>(null);
    const [einfuegen, setEinfuegen] = useState<Einfuegen>(null);
    const gezogen = useRef<string[] | null>(null);
    const aktiv = fokus && plan.some(e => e.id === fokus) ? fokus : plan[0]?.id ?? null;

    const bereich = (von: string, bis: string) => {
        const a = plan.findIndex(e => e.id === von);
        const b = plan.findIndex(e => e.id === bis);
        if (a < 0 || b < 0) return new Set([bis]);
        const [x, y] = a < b ? [a, b] : [b, a];
        return new Set(plan.slice(x, y + 1).map(e => e.id));
    };

    const fokussieren = (id: string) => {
        onFokus(id);
        // Kennungen sind unsere eigenen (s12, s12~2) — ohne Anführungszeichen.
        raster.current?.querySelector<HTMLElement>(`[data-eintrag="${id}"]`)?.focus();
    };

    const klick = (e: MouseEvent, id: string) => {
        onFokus(id);
        if (e.shiftKey && anker) {
            onAuswahl(bereich(anker, id), anker);
        } else if (e.ctrlKey || e.metaKey) {
            const neu = new Set(auswahl);
            if (neu.has(id)) neu.delete(id);
            else neu.add(id);
            onAuswahl(neu, id);
        } else {
            onAuswahl(new Set([id]), id);
        }
    };

    // Spalten des Rasters aus der Lage der Kacheln — für Pfeil hoch/runter.
    const spalten = () => {
        const kacheln = raster.current?.querySelectorAll<HTMLElement>('[data-eintrag]');
        if (!kacheln?.length) return 1;
        const oben = kacheln[0].offsetTop;
        let n = 0;
        for (const k of Array.from(kacheln)) {
            if (k.offsetTop !== oben) break;
            n++;
        }
        return Math.max(1, n);
    };

    const ziele = (): string[] => (auswahl.size ? plan.filter(e => auswahl.has(e.id)).map(e => e.id) : aktiv ? [aktiv] : []);

    const taste = (e: KeyboardEvent) => {
        if (!aktiv) return;
        const i = plan.findIndex(x => x.id === aktiv);
        const strg = e.ctrlKey || e.metaKey;
        let neu = -1;
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
            e.preventDefault();
            onBefehl({ art: 'nachVorn', ids: ziele() });
            return;
        }
        if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
            e.preventDefault();
            onBefehl({ art: 'nachHinten', ids: ziele() });
            return;
        }
        switch (e.key) {
            case 'ArrowLeft': neu = i - 1; break;
            case 'ArrowRight': neu = i + 1; break;
            case 'ArrowUp': neu = i - spalten(); break;
            case 'ArrowDown': neu = i + spalten(); break;
            case 'Home': neu = 0; break;
            case 'End': neu = plan.length - 1; break;
            case ' ': {
                e.preventDefault();
                const n = new Set(auswahl);
                if (n.has(aktiv)) n.delete(aktiv);
                else n.add(aktiv);
                onAuswahl(n, aktiv);
                return;
            }
            case 'Enter':
                e.preventDefault();
                onAuswahl(new Set([aktiv]), aktiv);
                return;
            case 'Delete':
            case 'Backspace': {
                e.preventDefault();
                const ids = ziele();
                const alleEntfernt = ids.every(id => plan.find(x => x.id === id)?.entfernt);
                onBefehl({ art: alleEntfernt ? 'wiederherstellen' : 'entfernen', ids });
                return;
            }
            case 'a':
            case 'A':
                if (strg) {
                    e.preventDefault();
                    onAuswahl(new Set(plan.map(x => x.id)), plan[0]?.id);
                }
                return;
            case 'c':
            case 'C':
            case 'x':
            case 'X':
            case 'v':
            case 'V': {
                if (!strg || !onZwischenablage) return;
                e.preventDefault();
                const k = e.key.toLowerCase();
                onZwischenablage(k === 'c' ? 'kopieren' : k === 'x' ? 'ausschneiden' : 'einfuegen');
                return;
            }
            default:
                return;
        }
        e.preventDefault();
        const ziel = plan[Math.max(0, Math.min(plan.length - 1, neu))];
        if (!ziel) return;
        fokussieren(ziel.id);
        if (e.shiftKey) onAuswahl(bereich(anker ?? aktiv, ziel.id), anker ?? aktiv);
    };

    // ---------------------------------------------------------------
    // Ziehen und Ablegen
    // ---------------------------------------------------------------

    const ziehenStart = (e: DragEvent, id: string) => {
        const ids = auswahl.has(id) ? plan.filter(x => auswahl.has(x.id)).map(x => x.id) : [id];
        if (!auswahl.has(id)) onAuswahl(new Set([id]), id);
        gezogen.current = ids;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ids.join(','));
    };

    const ueber = (e: DragEvent, id: string) => {
        if (!gezogen.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const seite = e.clientX < r.left + r.width / 2 ? 'vor' : 'nach';
        if (einfuegen?.id !== id || einfuegen.seite !== seite) setEinfuegen({ id, seite });
    };

    const ablegen = (e: DragEvent) => {
        e.preventDefault();
        const ids = gezogen.current;
        const ziel = einfuegen;
        gezogen.current = null;
        setEinfuegen(null);
        if (!ids?.length) return;
        let vor: string | null = null;
        if (ziel?.id) {
            if (ziel.seite === 'vor') vor = ziel.id;
            else {
                const i = plan.findIndex(x => x.id === ziel.id);
                vor = plan[i + 1]?.id ?? null;
            }
        }
        onBefehl({ art: 'verschieben', ids, vor });
    };

    return (
        <div className="flex-1 min-h-0 overflow-auto bg-[var(--opdf-lese)] p-4 sm:p-6"
            onDragOver={e => {
                if (!gezogen.current) return;
                e.preventDefault();
                if (einfuegen?.id !== null) setEinfuegen({ id: null, seite: 'nach' });
            }}
            onDrop={ablegen}>
            <p className="sr-only" id="opdf-raster-hilfe">{t('openintrapdf.raster.tastaturhilfe')}</p>
            <div ref={raster} role="listbox" aria-multiselectable="true" aria-label={t('openintrapdf.raster.titel')}
                aria-describedby="opdf-raster-hilfe" onKeyDown={taste}
                className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                {plan.map(e => {
                    const nummer = nummern.get(e.id);
                    const gewaehlt = auswahl.has(e.id);
                    const entfallen = e.entfernt ? (entfallend?.get(e.id) ?? 0) : 0;
                    const geschnitten = !!ausgeschnitten?.has(e.id);
                    const herkunft = e.leer
                        ? t('openintrapdf.raster.leereSeite')
                        : e.fremd
                            ? t('openintrapdf.raster.ausDatei', { name: e.fremd.name, seite: e.fremd.seite + 1 })
                            : t('openintrapdf.raster.original', { seite: e.quelle + 1 });
                    const beschreibung = [
                        nummer ? t('openintrapdf.raster.neueSeite', { seite: nummer }) : t('openintrapdf.raster.wirdEntfernt'),
                        entfallen ? t('openintrapdf.raster.anmerkungenEntfallen', { count: entfallen }) : '',
                        herkunft,
                        e.drehung ? t('openintrapdf.raster.gedreht', { grad: e.drehung }) : '',
                        geschnitten ? t('openintrapdf.raster.ausgeschnitten') : '',
                    ].filter(Boolean).join(', ');
                    // Eine leere Seite hat kein Bild: ein weißes Blatt im Format des Entwurfs.
                    const quer = e.drehung === 90 || e.drehung === 270;
                    const leerVerhaeltnis = e.leer ? (quer ? `${e.leer.hoehe} / ${e.leer.breite}` : `${e.leer.breite} / ${e.leer.hoehe}`) : undefined;
                    const markeVor = einfuegen?.id === e.id && einfuegen.seite === 'vor';
                    const markeNach = einfuegen?.id === e.id && einfuegen.seite === 'nach';
                    return (
                        <div key={e.id} data-eintrag={e.id} role="option" aria-selected={gewaehlt}
                            aria-label={beschreibung} tabIndex={e.id === aktiv ? 0 : -1}
                            draggable onDragStart={d => ziehenStart(d, e.id)} onDragOver={d => ueber(d, e.id)}
                            onDragEnd={() => { gezogen.current = null; setEinfuegen(null); }}
                            onClick={m => klick(m, e.id)} onFocus={() => onFokus(e.id)}
                            className={`relative flex flex-col items-center gap-2 rounded-lg p-2 cursor-pointer select-none
                                ${gewaehlt ? 'bg-[var(--opdf-weich)]' : 'hover:bg-[var(--opdf-weich)]/60'}`}>
                            {markeVor && <span className="absolute -left-2.5 top-2 bottom-2 w-1 rounded bg-[var(--opdf-akzent)]" aria-hidden />}
                            {markeNach && <span className="absolute -right-2.5 top-2 bottom-2 w-1 rounded bg-[var(--opdf-akzent)]" aria-hidden />}
                            <div className={`relative w-full max-w-[150px] ${e.entfernt ? 'opacity-40' : ''} ${geschnitten ? 'opacity-60' : ''}`}>
                                {e.leer ? (
                                    <div data-testid={`opdf-leer-${e.id}`} style={{ aspectRatio: leerVerhaeltnis }}
                                        className={`w-full bg-white border shadow-sm ${gewaehlt ? 'outline outline-[3px] outline-offset-2 outline-[var(--opdf-akzent)] border-transparent' : 'border-[var(--opdf-linie)]'}`} />
                                ) : e.fremd ? (
                                    // Die fremde Datei ist nicht geladen: ein Platzhalter mit Dateiname und Seite.
                                    <div data-testid={`opdf-fremd-${e.id}`} style={{ aspectRatio: quer ? '1.414 / 1' : '1 / 1.414' }}
                                        className={`w-full flex flex-col items-center justify-center gap-1 px-1 text-center text-[11px] leading-tight bg-[var(--opdf-weich)] text-[var(--opdf-gedaempft)] border shadow-sm ${gewaehlt ? 'outline outline-[3px] outline-offset-2 outline-[var(--opdf-akzent)] border-transparent' : 'border-[var(--opdf-linie)]'}`}>
                                        <FileInput size={20} aria-hidden />
                                        <span className="break-words line-clamp-3">{e.fremd.name}</span>
                                        <span>{t('openintrapdf.raster.seiteKurz', { seite: e.fremd.seite + 1 })}</span>
                                    </div>
                                ) : (
                                    <Miniatur dienst={miniaturen} quelle={e.quelle} drehung={e.drehung}
                                        className={`w-full border shadow-sm ${gewaehlt ? 'outline outline-[3px] outline-offset-2 outline-[var(--opdf-akzent)] border-transparent' : 'border-[var(--opdf-linie)]'}`} />
                                )}
                                {e.entfernt && (
                                    <span className="absolute inset-0 flex flex-col items-center justify-center text-center text-xs font-bold text-[var(--opdf-fehler)] bg-[var(--opdf-paneel)]/60 px-1">
                                        {t('openintrapdf.raster.wirdEntfernt')}
                                        {entfallen > 0 && (
                                            <span className="mt-1 font-normal">{t('openintrapdf.raster.anmerkungenEntfallen', { count: entfallen })}</span>
                                        )}
                                    </span>
                                )}
                                {gewaehlt && (
                                    <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-[var(--opdf-akzent)] text-[var(--opdf-auf-akzent)] flex items-center justify-center" aria-hidden>
                                        <Check size={14} />
                                    </span>
                                )}
                                {geschnitten && (
                                    <span className="absolute -top-2 -left-2 h-6 w-6 rounded-full bg-[var(--opdf-paneel)] text-[var(--opdf-akzent)] border border-[var(--opdf-akzent)] flex items-center justify-center" aria-hidden>
                                        <Scissors size={13} />
                                    </span>
                                )}
                            </div>
                            <div className="w-full flex items-center justify-between gap-1 text-xs">
                                <span className="font-semibold tabular-nums">{nummer ?? '–'}</span>
                                <span className="text-[var(--opdf-gedaempft)] truncate">
                                    {e.leer ? t('openintrapdf.raster.leereSeite') : e.fremd ? t('openintrapdf.raster.ausDateiKurz', { seite: e.fremd.seite + 1 }) : t('openintrapdf.raster.originalKurz', { seite: e.quelle + 1 })}
                                </span>
                                {e.drehung !== 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[var(--opdf-akzent)]">
                                        <RotateCw size={12} aria-hidden />{e.drehung}°
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

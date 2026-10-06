// SPDX-License-Identifier: Apache-2.0
//
// Linke Leiste der Leseansicht: Seiten, Lesezeichen, Suche.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ChevronUp, PanelLeftClose, Search } from 'lucide-react';
import { Miniatur } from './Miniatur';
import type { MiniaturDienst } from './miniaturen';
import type { SuchOptionen, SuchZustand } from './Leseansicht';
import { abschnitt, eingabe, leise, symbolKnopf } from './stil';

export type LinksReiter = 'seiten' | 'lesezeichen' | 'suche';

/** Ein Lesezeichen, wie pdf.js es aus getOutline() liefert (gekürzt). */
export interface Lesezeichen {
    title: string;
    dest: unknown;
    url?: string | null;
    items: Lesezeichen[];
    bold?: boolean;
    italic?: boolean;
}

export interface SuchStand {
    text: string;
    zustand?: SuchZustand;
    aktuell: number;
    gesamt: number;
}

interface Props {
    reiter: LinksReiter;
    onReiter: (r: LinksReiter) => void;
    onEinklappen: () => void;
    seitenzahl: number;
    aktuelleSeite: number;
    miniaturen: MiniaturDienst | null;
    onSeite: (nummer: number) => void;
    lesezeichenLaden: () => Promise<Lesezeichen[] | null>;
    onLesezeichen: (l: Lesezeichen) => void;
    suche: SuchStand;
    trefferJeSeite: number[];
    suchfeld: RefObject<HTMLInputElement | null>;
    onSuchtext: (text: string) => void;
    onSuchen: (art: 'weiter' | 'zurueck') => void;
    /** Groß-/Kleinschreibung und ganzes Wort (Etappe 7). */
    suchOptionen: SuchOptionen;
    onSuchOptionen: (o: SuchOptionen) => void;
}

export function Seitenleiste(p: Props) {
    const { t } = useTranslation();
    const reiter: { id: LinksReiter; text: string }[] = [
        { id: 'seiten', text: t('openintrapdf.links.seiten') },
        { id: 'lesezeichen', text: t('openintrapdf.links.lesezeichen') },
        { id: 'suche', text: t('openintrapdf.links.suche') },
    ];
    return (
        <aside className="w-56 shrink-0 flex flex-col min-h-0 border-r border-[var(--opdf-linie)] bg-[var(--opdf-app)]"
            aria-label={t('openintrapdf.links.bereich')}>
            <div className="flex items-center gap-1 px-2 pt-2" role="tablist" aria-label={t('openintrapdf.links.bereich')}>
                {reiter.map(r => (
                    <button key={r.id} type="button" role="tab" aria-selected={p.reiter === r.id}
                        id={`opdf-reiter-${r.id}`} aria-controls={`opdf-tafel-${r.id}`}
                        onClick={() => p.onReiter(r.id)}
                        className={`h-8 px-2 rounded-md text-xs font-semibold ${p.reiter === r.id
                            ? 'bg-[var(--opdf-paneel)] text-[var(--opdf-akzent)] shadow-sm'
                            : 'text-[var(--opdf-gedaempft)] hover:bg-[var(--opdf-weich)]'}`}>
                        {r.text}
                    </button>
                ))}
                <span className="flex-1" />
                <button type="button" className={symbolKnopf} onClick={p.onEinklappen}
                    aria-label={t('openintrapdf.links.einklappen')} title={t('openintrapdf.links.einklappen')}>
                    <PanelLeftClose size={18} />
                </button>
            </div>
            <div role="tabpanel" id={`opdf-tafel-${p.reiter}`} aria-labelledby={`opdf-reiter-${p.reiter}`}
                className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
                {p.reiter === 'seiten' && <SeitenListe {...p} />}
                {p.reiter === 'lesezeichen' && <LesezeichenListe laden={p.lesezeichenLaden} onWahl={p.onLesezeichen} />}
                {p.reiter === 'suche' && <Suche {...p} />}
            </div>
        </aside>
    );
}

function SeitenListe({ seitenzahl, aktuelleSeite, miniaturen, onSeite }: Props) {
    const { t } = useTranslation();
    const liste = useRef<HTMLOListElement>(null);

    // Die aktuelle Seite in der Leiste sichtbar halten, wenn im Dokument
    // geblättert wird.
    useEffect(() => {
        const el = liste.current?.querySelector<HTMLElement>(`[data-seite="${aktuelleSeite}"]`);
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [aktuelleSeite]);

    return (
        <>
            <p className={`${abschnitt} mb-2`}>{t('openintrapdf.links.seitenAnzahl', { count: seitenzahl })}</p>
            <ol ref={liste} className="space-y-3">
                {Array.from({ length: seitenzahl }, (_, i) => i + 1).map(n => (
                    <li key={n}>
                        <button type="button" data-seite={n} onClick={() => onSeite(n)}
                            aria-current={n === aktuelleSeite ? 'page' : undefined}
                            aria-label={t('openintrapdf.links.zuSeite', { seite: n })}
                            className={`w-full flex flex-col items-center gap-1 rounded-md p-2 ${n === aktuelleSeite ? 'bg-[var(--opdf-weich)]' : 'hover:bg-[var(--opdf-weich)]'}`}>
                            <Miniatur dienst={miniaturen} quelle={n - 1} drehung={0}
                                className={`w-28 border shadow-sm ${n === aktuelleSeite ? 'outline outline-2 outline-offset-2 outline-[var(--opdf-akzent)] border-transparent' : 'border-[var(--opdf-linie)]'}`} />
                            <span className={`${leise} tabular-nums`}>{n}</span>
                        </button>
                    </li>
                ))}
            </ol>
        </>
    );
}

function LesezeichenListe({ laden, onWahl }: { laden: () => Promise<Lesezeichen[] | null>; onWahl: (l: Lesezeichen) => void }) {
    const { t } = useTranslation();
    const [eintraege, setEintraege] = useState<Lesezeichen[] | null | undefined>(undefined);

    useEffect(() => {
        let aus = false;
        laden().then(e => { if (!aus) setEintraege(e ?? null); }, () => { if (!aus) setEintraege(null); });
        return () => { aus = true; };
    }, [laden]);

    if (eintraege === undefined) return <p className={leise}>{t('openintrapdf.links.lesezeichenLaden')}</p>;
    if (!eintraege?.length) return <p className={leise}>{t('openintrapdf.links.keineLesezeichen')}</p>;
    return <LesezeichenEbene eintraege={eintraege} tiefe={0} onWahl={onWahl} />;
}

function LesezeichenEbene({ eintraege, tiefe, onWahl }: { eintraege: Lesezeichen[]; tiefe: number; onWahl: (l: Lesezeichen) => void }) {
    return (
        <ul role={tiefe === 0 ? 'tree' : 'group'} className={tiefe ? 'ml-3 border-l border-[var(--opdf-linie)] pl-1' : ''}>
            {eintraege.map((l, i) => <LesezeichenPunkt key={`${tiefe}-${i}`} l={l} tiefe={tiefe} onWahl={onWahl} />)}
        </ul>
    );
}

function LesezeichenPunkt({ l, tiefe, onWahl }: { l: Lesezeichen; tiefe: number; onWahl: (l: Lesezeichen) => void }) {
    const { t } = useTranslation();
    const kinder = l.items?.length > 0;
    const [offen, setOffen] = useState(tiefe === 0);
    return (
        <li role="treeitem" aria-expanded={kinder ? offen : undefined} aria-selected={false}>
            <div className="flex items-start gap-0.5">
                {kinder ? (
                    <button type="button" className="h-7 w-6 shrink-0 inline-flex items-center justify-center rounded hover:bg-[var(--opdf-weich)]"
                        onClick={() => setOffen(o => !o)}
                        aria-label={offen ? t('openintrapdf.links.zuklappen') : t('openintrapdf.links.aufklappen')}>
                        {offen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : <span className="w-6 shrink-0" />}
                <button type="button" onClick={() => onWahl(l)}
                    className={`flex-1 text-left text-sm leading-snug py-1 px-1 rounded hover:bg-[var(--opdf-weich)] ${l.bold ? 'font-semibold' : ''} ${l.italic ? 'italic' : ''}`}>
                    {l.title || t('openintrapdf.links.ohneTitel')}
                </button>
            </div>
            {kinder && offen && <LesezeichenEbene eintraege={l.items} tiefe={tiefe + 1} onWahl={onWahl} />}
        </li>
    );
}

function Suche({ suche, suchfeld, onSuchtext, onSuchen, trefferJeSeite, onSeite, suchOptionen, onSuchOptionen }: Props) {
    const { t } = useTranslation();
    const seitenMitTreffern = trefferJeSeite
        .map((anzahl, i) => ({ seite: i + 1, anzahl }))
        .filter(x => x.anzahl > 0);
    let status = '';
    if (suche.text) {
        if (suche.zustand === 'sucht' && suche.gesamt === 0) status = t('openintrapdf.suche.sucht');
        else if (suche.gesamt > 0) status = t('openintrapdf.suche.treffer', { aktuell: suche.aktuell, count: suche.gesamt });
        else if (suche.zustand === 'nicht_gefunden') status = t('openintrapdf.suche.keinTreffer');
    }
    return (
        <div>
            <label htmlFor="opdf-suchfeld" className={`${abschnitt} block mb-2`}>{t('openintrapdf.suche.titel')}</label>
            <div className="flex items-center gap-1">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--opdf-gedaempft)]" aria-hidden />
                    <input ref={suchfeld} id="opdf-suchfeld" type="search" value={suche.text}
                        className={`${eingabe} w-full pl-7`}
                        placeholder={t('openintrapdf.suche.platzhalter')}
                        onChange={e => onSuchtext(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                onSuchen(e.shiftKey ? 'zurueck' : 'weiter');
                            }
                        }} />
                </div>
                <button type="button" className={symbolKnopf} disabled={!suche.text} onClick={() => onSuchen('zurueck')}
                    aria-label={t('openintrapdf.suche.vorheriger')} title={t('openintrapdf.suche.vorheriger')}>
                    <ChevronUp size={16} />
                </button>
                <button type="button" className={symbolKnopf} disabled={!suche.text} onClick={() => onSuchen('weiter')}
                    aria-label={t('openintrapdf.suche.naechster')} title={t('openintrapdf.suche.naechster')}>
                    <ChevronDown size={16} />
                </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" role="group" aria-label={t('openintrapdf.suche.optionen')}>
                <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={suchOptionen.caseSensitive}
                        onChange={e => onSuchOptionen({ ...suchOptionen, caseSensitive: e.target.checked })} />
                    <span>{t('openintrapdf.suche.gross')}</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={suchOptionen.entireWord}
                        onChange={e => onSuchOptionen({ ...suchOptionen, entireWord: e.target.checked })} />
                    <span>{t('openintrapdf.suche.ganzesWort')}</span>
                </label>
            </div>
            <p className={`${leise} mt-2 min-h-[1rem]`} aria-live="polite">{status}</p>
            {suche.zustand === 'umgebrochen' && suche.gesamt > 0 && (
                <p className={`${leise} mt-1`}>{t('openintrapdf.suche.umgebrochen')}</p>
            )}
            <p className={`${leise} mt-3`}>{t('openintrapdf.suche.tastenhinweis')}</p>
            {seitenMitTreffern.length > 0 && (
                <>
                    <p className={`${abschnitt} mt-4 mb-1`}>{t('openintrapdf.suche.trefferJeSeite')}</p>
                    <ul>
                        {seitenMitTreffern.map(x => (
                            <li key={x.seite}>
                                <button type="button" onClick={() => onSeite(x.seite)}
                                    className="w-full flex justify-between text-sm px-2 py-1 rounded hover:bg-[var(--opdf-weich)]">
                                    <span>{t('openintrapdf.suche.seite', { seite: x.seite })}</span>
                                    <span className="tabular-nums text-[var(--opdf-gedaempft)]">{x.anzahl}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}

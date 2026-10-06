// SPDX-License-Identifier: Apache-2.0
//
// Das einzeilige Band (wie die vereinfachte, einzeilige Leiste in Office-Programmen):
// genau eine Zeile kleiner Knöpfe, 32 px hoch, in einer 36-px-Karte, das
// Band samt Rand 40 px. Gruppen stehen ohne Namen hintereinander, getrennt
// durch schmale Striche.
//
// Was nicht passt, wandert von hinten in das Überlaufmenü „…“. Gemessen
// wird, nicht geschätzt: Nach jeder Änderung der Knöpfe steht einmal alles
// in der Zeile, die rechten Kanten werden abgelesen (vor dem Malen), dann
// bleibt nur, was in die Breite der Karte passt. Ändert sich die Breite
// (ResizeObserver), wird mit den gemerkten Kanten neu geschnitten.
//
// Eigener Inhalt einer Gruppe steht in der Zeile nur in seiner einzeiligen
// Fassung (`inhaltEinzeilig`); ohne sie steht er ausschließlich im
// Überlaufmenü.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as TastenEreignis } from 'react';
import { flushSync } from 'react-dom';
import { Ellipsis } from 'lucide-react';
import type { WerkzeugbandElement, WerkzeugbandGruppe, WerkzeugbandKnopf, WerkzeugbandReiter } from './typen';
import { Element, useWerkzeugbandSteuerung } from './Knoepfe';

/** Schlüssel des Überlaufmenüs (für `offen`). */
const UEBERLAUF = 'mehr';

/** Platz für den Knopf „…“ (32 px) samt Abstand, solange er nicht steht. */
const MEHR_BREITE = 34;

interface Eintrag {
    schluessel: string;
    gruppe: WerkzeugbandGruppe;
    element?: WerkzeugbandElement;
}

function eintraegeAus(gruppen: readonly WerkzeugbandGruppe[]): Eintrag[] {
    const aus: Eintrag[] = [];
    for (const g of gruppen) {
        for (const k of g.knoepfe ?? []) aus.push({ schluessel: `${g.id}/${k.id}`, gruppe: g, element: k });
        if (g.inhaltEinzeilig != null) aus.push({ schluessel: `${g.id}/~inhalt`, gruppe: g });
    }
    return aus;
}

/** Wie viele Einträge von vorn passen; der Rest geht in „…“. */
function schnittBerechnen(kanten: readonly number[], verfuegbar: number, mehrBreite: number): number {
    if (!kanten.length) return 0;
    if (kanten[kanten.length - 1] <= verfuegbar + 0.5) return kanten.length;
    let n = 0;
    while (n < kanten.length && kanten[n] <= verfuegbar - mehrBreite + 0.5) n++;
    return n;
}

function innenbreite(el: HTMLElement): number {
    const stil = getComputedStyle(el);
    return el.clientWidth - (parseFloat(stil.paddingLeft) || 0) - (parseFloat(stil.paddingRight) || 0);
}

interface Props {
    reiter: WerkzeugbandReiter;
    bandId: string;
    reiterId: string;
    buchstaben: Readonly<Record<string, string>> | null;
    /** Eingeklappt und vorübergehend geöffnet: über dem Inhalt. */
    ueber: boolean;
}

export function EinzeiligesBand({ reiter, bandId, reiterId, buchstaben, ueber }: Props) {
    const s = useWerkzeugbandSteuerung();
    const karte = useRef<HTMLDivElement>(null);
    const zeile = useRef<HTMLDivElement>(null);
    const kanten = useRef<number[]>([]);
    const eintraege = eintraegeAus(reiter.gruppen);
    const signatur = JSON.stringify([reiter.id, eintraege.map(e => [e.schluessel, e.element?.text ?? '', e.element?.art ?? '', !!(e.element as WerkzeugbandKnopf | undefined)?.menue])]);
    // `null`: alles steht zum Messen in der Zeile.
    const [schnitt, setSchnitt] = useState<{ signatur: string; anzahl: number } | null>(null);
    const messen = schnitt?.signatur !== signatur;

    const verfuegbar = useCallback(() => (karte.current ? innenbreite(karte.current) : 0), []);

    useLayoutEffect(() => {
        if (!messen || !zeile.current) return;
        const links = zeile.current.getBoundingClientRect().left;
        kanten.current = Array.from(zeile.current.querySelectorAll<HTMLElement>('[data-werkzeugband-eintrag]'))
            .map(el => el.getBoundingClientRect().right - links);
        setSchnitt({ signatur, anzahl: schnittBerechnen(kanten.current, verfuegbar(), MEHR_BREITE) });
    });

    // Breite der Karte ändert sich: mit den gemerkten Kanten neu schneiden, vor dem Malen.
    useEffect(() => {
        if (!karte.current || typeof ResizeObserver === 'undefined') return;
        const beobachter = new ResizeObserver(() => {
            flushSync(() => setSchnitt(alt => (alt ? { ...alt, anzahl: schnittBerechnen(kanten.current, verfuegbar(), MEHR_BREITE) } : alt)));
        });
        beobachter.observe(karte.current);
        return () => beobachter.disconnect();
    }, [verfuegbar]);

    // Nachgeladene Schrift ändert die Breiten: einmal neu messen.
    useEffect(() => {
        let aktiv = true;
        document.fonts?.ready?.then(() => { if (aktiv) setSchnitt(null); }).catch(() => undefined);
        return () => { aktiv = false; };
    }, []);

    const anzahl = messen ? eintraege.length : schnitt.anzahl;
    const inZeile = eintraege.slice(0, anzahl);
    const imUeberlauf = new Set(eintraege.slice(anzahl).map(e => e.schluessel));
    const ueberlaufGruppen = reiter.gruppen.filter(g =>
        (g.inhalt != null && g.inhaltEinzeilig == null)
        || eintraege.some(e => e.gruppe === g && imUeberlauf.has(e.schluessel)));

    const zeilenGruppen = reiter.gruppen
        .map(g => ({ g, eintraege: inZeile.filter(e => e.gruppe === g) }))
        .filter(x => x.eintraege.length);

    const mehrOffen = s.offen === UEBERLAUF;
    // Beim Messen bleibt ein offenes Überlaufmenü stehen, sonst verlöre es den Fokus.
    const mehrZeigen = ueberlaufGruppen.length > 0 || mehrOffen;
    const nichtsUebrig = !messen && !ueberlaufGruppen.length;
    useEffect(() => {
        if (nichtsUebrig && mehrOffen) s.schliessen(false);
    }, [nichtsUebrig, mehrOffen, s]);
    return (
        <div role="tabpanel" id={bandId} aria-labelledby={reiterId} data-werkzeugband-teil="band"
            className={`werkzeugband-band-einzeilig h-10 py-0.5 ${ueber ? 'absolute left-0 right-0 top-full z-20' : ''}`}>
            <div ref={karte} data-werkzeugband-teil="karte"
                className="mx-2.5 flex h-9 items-center rounded-lg bg-[var(--rb-paneel)] px-1.5 shadow-[var(--rb-schatten)]">
                <div ref={zeile} className="flex min-w-0 flex-1 items-center gap-0.5">
                    {zeilenGruppen.map(({ g, eintraege: ge }, i) => (
                        <Fragment key={g.id}>
                            {i > 0 && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-[var(--rb-linie)]" />}
                            <div role="group" aria-label={g.name} className="flex shrink-0 items-center gap-0.5">
                                {ge.map(e => (
                                    <div key={e.schluessel} data-werkzeugband-eintrag className="flex shrink-0 items-center">
                                        {e.element
                                            ? <Element k={e.element} form="zeile" buchstabe={buchstaben?.[e.element.id]} />
                                            : <div className="flex h-8 items-center gap-1">{g.inhaltEinzeilig}</div>}
                                    </div>
                                ))}
                            </div>
                        </Fragment>
                    ))}
                </div>
                {mehrZeigen && (
                    <div className="relative ml-0.5 shrink-0">
                        <button type="button" id={s.ausloeserId(UEBERLAUF)} aria-expanded={mehrOffen}
                            aria-controls={mehrOffen ? s.menueId(UEBERLAUF) : undefined}
                            aria-label={s.tx('weitere')} title={s.tx('weitere')} onClick={() => s.umschalten(UEBERLAUF)}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors motion-reduce:transition-none
                                ${mehrOffen ? 'bg-[var(--rb-weich)] text-[var(--rb-akzent)]' : 'text-[var(--rb-text)] hover:bg-[var(--rb-weich)]'}`}>
                            <Ellipsis size={16} aria-hidden />
                        </button>
                        {mehrOffen && (
                            <Ueberlauf gruppen={ueberlaufGruppen} imUeberlauf={imUeberlauf} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Das Überlaufmenü: die Gruppen mit ihren übrigen Knöpfen als Zeilen, eigener Inhalt in voller Fassung. */
function Ueberlauf({ gruppen, imUeberlauf }: { gruppen: readonly WerkzeugbandGruppe[]; imUeberlauf: ReadonlySet<string> }) {
    const s = useWerkzeugbandSteuerung();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (s.menueFokus.current) ref.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')?.focus();
        // Nur beim Erscheinen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const taste = (e: TastenEreignis<HTMLDivElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            s.schliessen(true);
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const ziel = e.target as HTMLElement;
        if (!(ziel instanceof HTMLButtonElement) && !(ziel instanceof HTMLInputElement && ziel.type === 'checkbox')) return;
        e.preventDefault();
        const alle = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input[type="checkbox"]:not([disabled])'));
        const i = alle.indexOf(ziel);
        alle[(i + (e.key === 'ArrowDown' ? 1 : alle.length - 1)) % alle.length]?.focus();
    };

    const zeile = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--rb-text)] hover:bg-[var(--rb-weich)] disabled:opacity-45 disabled:cursor-not-allowed';
    const ausfuehren = (f: () => void) => {
        s.schliessen(true);
        f();
    };
    return (
        <div ref={ref} id={s.menueId(UEBERLAUF)} role="group" aria-label={s.tx('weitere')} onKeyDown={taste}
            className="absolute right-0 top-full z-30 mt-1 max-h-[70vh] min-w-[14rem] overflow-y-auto rounded-md border border-[var(--rb-linie)] bg-[var(--rb-paneel)] p-1 shadow-[var(--rb-schatten)]">
            {gruppen.map(g => {
                const elemente = (g.knoepfe ?? []).filter(k => imUeberlauf.has(`${g.id}/${k.id}`));
                const inhalt = g.inhaltEinzeilig == null || imUeberlauf.has(`${g.id}/~inhalt`) ? g.inhalt : null;
                return (
                    <div key={g.id} role="group" aria-label={g.name} className="py-0.5">
                        <div aria-hidden className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--rb-gedaempft)]">{g.name}</div>
                        {elemente.map(k => {
                            if (k.art === 'kontrollkaestchen') {
                                return (
                                    <label key={k.id} title={k.titel} className={`${zeile} ${k.gesperrt ? 'opacity-45' : 'cursor-pointer'}`}>
                                        <input type="checkbox" checked={k.an} disabled={k.gesperrt} data-knopf={k.id}
                                            onChange={e => k.onWechsel(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--rb-akzent)]" />
                                        <span>{k.text}</span>
                                    </label>
                                );
                            }
                            const Symbol = k.symbol;
                            const kopf = <><Symbol size={16} aria-hidden className="shrink-0" /><span>{k.text}</span></>;
                            const onClick = k.onClick;
                            return (
                                <Fragment key={k.id}>
                                    {onClick
                                        ? (
                                            <button type="button" data-knopf={k.id} disabled={k.gesperrt} title={k.titel}
                                                aria-pressed={k.gedrueckt === undefined ? undefined : !!k.gedrueckt}
                                                onClick={() => ausfuehren(onClick)}
                                                className={`${zeile} ${k.gedrueckt ? 'bg-[var(--rb-weich)] text-[var(--rb-akzent)]' : ''}`}>
                                                {kopf}
                                            </button>
                                        )
                                        : <div className={`${zeile} hover:bg-transparent ${k.gesperrt ? 'opacity-45' : ''}`}>{kopf}</div>}
                                    {k.menue?.map(d => {
                                        const DSymbol = d.symbol;
                                        return (
                                            <button key={d.id} type="button" data-knopf={`${k.id}/${d.id}`} disabled={k.gesperrt || d.gesperrt} title={d.titel}
                                                aria-pressed={d.wahl ? !!d.an : undefined} onClick={() => ausfuehren(d.onClick)}
                                                className={`${zeile} pl-8 ${d.wahl && d.an ? 'text-[var(--rb-akzent)]' : ''}`}>
                                                {DSymbol && <DSymbol size={14} aria-hidden className="shrink-0" />}<span>{d.text}</span>
                                            </button>
                                        );
                                    })}
                                </Fragment>
                            );
                        })}
                        {inhalt != null && <div className="flex flex-wrap items-center gap-1 px-2 py-1">{inhalt}</div>}
                    </div>
                );
            })}
        </div>
    );
}

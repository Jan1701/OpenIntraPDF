// SPDX-License-Identifier: Apache-2.0
//
// Die Bedienelemente im Band: Knopf (groß, klein, Umschalter, gesperrt mit
// Grund), Menü- und Teilungsknopf, Kontrollkästchen. Jedes in drei Formen:
//   gross — klassisch, Symbol über Text (mind. 56 px hoch)
//   klein — klassisch, Symbol neben Text, 28 px; zwei übereinander
//   zeile — einzeilig, Symbol neben Text, 32 px (auch große Knöpfe)

import { createContext, useContext } from 'react';
import type { KeyboardEvent as TastenEreignis, MutableRefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import type { WerkzeugbandElement, WerkzeugbandKnopf, WerkzeugbandKontrollkaestchen, WerkzeugbandMenueEintrag } from './typen';
import { WerkzeugbandMenue } from './Menue';
import { Tipp } from './Tipp';

export type KnopfForm = 'gross' | 'klein' | 'zeile';

/** Was die Elemente vom Werkzeugband brauchen: welches Menü offen ist, Kennungen, Texte. */
export interface WerkzeugbandSteuerung {
    offen: string | null;
    /** Menü öffnen (Fokus auf den ersten Eintrag) bzw. schließen, wenn es offen ist. */
    umschalten: (schluessel: string) => void;
    schliessen: (fokusZurueck: boolean) => void;
    ausloeserId: (schluessel: string) => string;
    menueId: (schluessel: string) => string;
    /** Ob ein erscheinendes Menü den Fokus bekommt (nicht beim Öffnen über Tastenbuchstaben im Datei-Menü). */
    menueFokus: MutableRefObject<boolean>;
    tx: (schluessel: string, optionen?: Record<string, unknown>) => string;
}

export const WerkzeugbandKontext = createContext<WerkzeugbandSteuerung | null>(null);

export function useWerkzeugbandSteuerung(): WerkzeugbandSteuerung {
    const s = useContext(WerkzeugbandKontext);
    if (!s) throw new Error('Werkzeugband-Element außerhalb des Werkzeugbands');
    return s;
}

/** Schlüssel des Menüs eines Knopfs (für `offen`). */
export const knopfMenue = (id: string) => `knopf-${id}`;

export const istGross = (k: WerkzeugbandElement) => k.art !== 'kontrollkaestchen' && !!k.gross;

const farbe = (an: boolean) => (an ? 'bg-[var(--rb-weich)] text-[var(--rb-akzent)]' : 'text-[var(--rb-text)] hover:bg-[var(--rb-weich)]');

const basis = (an: boolean) =>
    `relative rounded-md transition-colors motion-reduce:transition-none disabled:opacity-45 disabled:cursor-not-allowed ${farbe(an)}`;

const FORM: Record<KnopfForm, string> = {
    gross: 'flex min-w-[4.25rem] max-w-[6.5rem] min-h-[3.5rem] flex-col items-center justify-start gap-1 px-1.5 pt-1.5 pb-1 text-[11px] leading-tight text-center break-words',
    klein: 'inline-flex h-7 items-center gap-1.5 px-2 text-xs whitespace-nowrap',
    zeile: 'inline-flex h-8 items-center gap-1.5 px-2 text-[13px] whitespace-nowrap',
};

const SYMBOL: Record<KnopfForm, number> = { gross: 20, klein: 15, zeile: 16 };

/** Ein Element in seiner Form. */
export function Element({ k, form, buchstabe }: { k: WerkzeugbandElement; form: KnopfForm; buchstabe?: string }) {
    if (k.art === 'kontrollkaestchen') return <Kontrollkaestchen k={k} form={form} buchstabe={buchstabe} />;
    if (k.menue) return <MenueKnopf k={k} menue={k.menue} form={form} buchstabe={buchstabe} />;
    return <Knopf k={k} form={form} buchstabe={buchstabe} />;
}

function Knopf({ k, form, buchstabe }: { k: WerkzeugbandKnopf; form: KnopfForm; buchstabe?: string }) {
    const Symbol = k.symbol;
    return (
        <button type="button" onClick={k.onClick} disabled={k.gesperrt} title={k.titel} data-knopf={k.id}
            aria-pressed={k.gedrueckt === undefined ? undefined : !!k.gedrueckt}
            className={`${basis(!!k.gedrueckt)} ${FORM[form]}`}>
            <Symbol size={SYMBOL[form]} aria-hidden className="shrink-0" />
            <span>{k.text}</span>
            {buchstabe && <Tipp>{buchstabe}</Tipp>}
        </button>
    );
}

/**
 * Menüknopf (ohne `onClick`: der ganze Knopf öffnet das Menü) oder
 * Teilungsknopf (mit `onClick`: Hauptteil löst aus, ▾ öffnet das Menü).
 */
function MenueKnopf({ k, menue, form, buchstabe }: { k: WerkzeugbandKnopf; menue: WerkzeugbandMenueEintrag[]; form: KnopfForm; buchstabe?: string }) {
    const s = useWerkzeugbandSteuerung();
    const schluessel = knopfMenue(k.id);
    const offen = s.offen === schluessel;
    const Symbol = k.symbol;
    const ausloeser = s.ausloeserId(schluessel);

    // Pfeil runter/hoch am Auslöser öffnet wie Enter/Leertaste.
    const ausloeserTaste = (e: TastenEreignis<HTMLButtonElement>) => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !offen) {
            e.preventDefault();
            s.umschalten(schluessel);
        }
    };
    const menueAuf = {
        id: ausloeser,
        'aria-haspopup': 'menu' as const,
        'aria-expanded': offen,
        'aria-controls': offen ? s.menueId(schluessel) : undefined,
        onClick: () => s.umschalten(schluessel),
        onKeyDown: ausloeserTaste,
    };
    const liste = offen && (
        <WerkzeugbandMenue id={s.menueId(schluessel)} ausloeser={ausloeser} eintraege={menue} fest fokussieren={s.menueFokus.current}
            onSchliessen={s.schliessen}
            onWahl={d => {
                s.schliessen(true);
                d.onClick();
            }} />
    );

    if (!k.onClick) {
        return (
            <div className="relative inline-flex">
                <button type="button" disabled={k.gesperrt} title={k.titel} data-knopf={k.id} {...menueAuf}
                    className={`${basis(!!k.gedrueckt || offen)} ${FORM[form]}`}>
                    <Symbol size={SYMBOL[form]} aria-hidden className="shrink-0" />
                    <span>{k.text}</span>
                    <ChevronDown size={12} aria-hidden className="shrink-0 opacity-70" />
                    {buchstabe && <Tipp>{buchstabe}</Tipp>}
                </button>
                {liste}
            </div>
        );
    }

    const pfeil = form === 'gross' ? 'w-4 self-stretch' : form === 'klein' ? 'h-7 w-5' : 'h-8 w-5';
    return (
        <div className="relative inline-flex">
            <button type="button" onClick={k.onClick} disabled={k.gesperrt} title={k.titel} data-knopf={k.id}
                aria-pressed={k.gedrueckt === undefined ? undefined : !!k.gedrueckt}
                className={`${basis(!!k.gedrueckt)} ${FORM[form]} rounded-r-none`}>
                <Symbol size={SYMBOL[form]} aria-hidden className="shrink-0" />
                <span>{k.text}</span>
                {buchstabe && <Tipp>{buchstabe}</Tipp>}
            </button>
            <button type="button" disabled={k.gesperrt} {...menueAuf}
                aria-label={s.tx('menueZu', { name: k.text })} title={s.tx('menueZu', { name: k.text })}
                className={`${basis(offen)} ${pfeil} inline-flex items-center justify-center rounded-l-none`}>
                <ChevronDown size={12} aria-hidden />
            </button>
            {liste}
        </div>
    );
}

function Kontrollkaestchen({ k, form, buchstabe }: { k: WerkzeugbandKontrollkaestchen; form: KnopfForm; buchstabe?: string }) {
    const hoehe = form === 'zeile' ? 'h-8 text-[13px]' : 'h-7 text-xs';
    return (
        <label title={k.titel}
            className={`relative inline-flex ${hoehe} items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[var(--rb-text)] transition-colors motion-reduce:transition-none
                ${k.gesperrt ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-[var(--rb-weich)]'}`}>
            <input type="checkbox" checked={k.an} disabled={k.gesperrt} data-knopf={k.id}
                onChange={e => k.onWechsel(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--rb-akzent)]" />
            <span>{k.text}</span>
            {buchstabe && <Tipp>{buchstabe}</Tipp>}
        </label>
    );
}

/** Klassisch: große Elemente einzeln, kleine zu zweit übereinander — so hoch wie ein großes. */
export function Spalten({ knoepfe, buchstaben }: { knoepfe: readonly WerkzeugbandElement[]; buchstaben: Readonly<Record<string, string>> | null }) {
    const spalten: WerkzeugbandElement[][] = [];
    for (const k of knoepfe) {
        const letzte = spalten[spalten.length - 1];
        if (!istGross(k) && letzte && !istGross(letzte[0]) && letzte.length < 2) letzte.push(k);
        else spalten.push([k]);
    }
    return (
        <>
            {spalten.map((spalte, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                    {spalte.map(k => <Element key={k.id} k={k} form={istGross(k) ? 'gross' : 'klein'} buchstabe={buchstaben?.[k.id]} />)}
                </div>
            ))}
        </>
    );
}

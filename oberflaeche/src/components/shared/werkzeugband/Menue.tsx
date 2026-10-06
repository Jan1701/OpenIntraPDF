// SPDX-License-Identifier: Apache-2.0
//
// Ein Menü des Werkzeugbands (Datei-Menü, Darstellung, Menü- und Teilungsknöpfe)
// nach dem Muster „Menu Button“ der WAI-ARIA-Praxis: `role="menu"`, beim
// Öffnen steht der Fokus auf dem ersten Eintrag, Pfeiltasten/Pos1/Ende
// wandern, `Esc` schließt und gibt den Fokus an den Auslöser zurück, `Tab`
// schließt. Einträge mit Wahl sind `menuitemradio` bzw. `menuitemcheckbox`.
//
// Menüs aus dem Band heraus liegen `fixed` am Auslöser: Das klassische Band
// scrollt waagerecht und würde ein gewöhnlich angehängtes Menü sonst
// abschneiden; beim Scrollen wandern sie mit.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as TastenEreignis } from 'react';
import { Check } from 'lucide-react';
import type { WerkzeugbandMenueEintrag } from './typen';
import { Tipp } from './Tipp';

interface Props {
    id: string;
    /** Kennung des Auslösers (`aria-labelledby`, Fokus beim Schließen). */
    ausloeser: string;
    eintraege: readonly WerkzeugbandMenueEintrag[];
    buchstaben?: Readonly<Record<string, string>> | null;
    onWahl: (eintrag: WerkzeugbandMenueEintrag) => void;
    onSchliessen: (fokusZurueck: boolean) => void;
    /** Beim Erscheinen den ersten freien Eintrag fokussieren. */
    fokussieren: boolean;
    /** Am Auslöser festmachen (`fixed`), statt unter dem Elternelement zu hängen. */
    fest?: boolean;
    ausrichtung?: 'links' | 'rechts';
    breite?: string;
}

function eintraegeIn(menue: HTMLElement): HTMLElement[] {
    return Array.from(menue.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
}

export function WerkzeugbandMenue({ id, ausloeser, eintraege, buchstaben, onWahl, onSchliessen, fokussieren, fest, ausrichtung = 'links', breite = 'min-w-[12rem]' }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [lage, setLage] = useState<CSSProperties | null>(null);

    // Festgemacht: unter den Auslöser, im Fenster gehalten; beim Scrollen und bei neuer Fenstergröße nachgeführt.
    useLayoutEffect(() => {
        if (!fest) return;
        const platzieren = () => {
            const a = document.getElementById(ausloeser)?.getBoundingClientRect();
            if (!a || !ref.current) return;
            const b = ref.current.offsetWidth;
            const rand = 8;
            const links = ausrichtung === 'rechts' ? a.right - b : a.left;
            setLage({ position: 'fixed', top: a.bottom + 2, left: Math.max(rand, Math.min(links, window.innerWidth - b - rand)) });
        };
        platzieren();
        window.addEventListener('scroll', platzieren, true);
        window.addEventListener('resize', platzieren);
        return () => {
            window.removeEventListener('scroll', platzieren, true);
            window.removeEventListener('resize', platzieren);
        };
    }, [fest, ausloeser, ausrichtung]);

    useEffect(() => {
        if (fokussieren && ref.current) eintraegeIn(ref.current)[0]?.focus();
        // Nur beim Erscheinen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const taste = (e: TastenEreignis<HTMLDivElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onSchliessen(true);
            return;
        }
        if (e.key === 'Tab') {
            onSchliessen(false);
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const alle = eintraegeIn(e.currentTarget);
        if (!alle.length) return;
        const i = alle.indexOf(document.activeElement as HTMLElement);
        let n: number;
        if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = alle.length - 1;
        else if (e.key === 'ArrowDown') n = (i + 1) % alle.length;
        else n = (i + alle.length - 1) % alle.length;
        alle[n].focus();
    };

    const ort = fest ? 'z-40' : `absolute top-full z-30 mt-0.5 ${ausrichtung === 'rechts' ? 'right-0' : 'left-0'}`;
    return (
        <div ref={ref} role="menu" id={id} aria-labelledby={ausloeser} onKeyDown={taste}
            style={fest ? (lage ?? { position: 'fixed', visibility: 'hidden' }) : undefined}
            className={`${ort} ${breite} rounded-md border border-[var(--rb-linie)] bg-[var(--rb-paneel)] p-1 shadow-[var(--rb-schatten)]`}>
            {eintraege.map(d => {
                const Symbol = d.symbol;
                const rolle = d.wahl === 'eins' ? 'menuitemradio' : d.wahl === 'mehrere' ? 'menuitemcheckbox' : 'menuitem';
                const buchstabe = buchstaben?.[d.id];
                return (
                    <Fragment key={d.id}>
                        {d.trennerDavor && <div role="separator" className="my-1 h-px bg-[var(--rb-linie)]" />}
                        <button type="button" role={rolle} aria-checked={d.wahl ? !!d.an : undefined} disabled={d.gesperrt} title={d.titel}
                            data-knopf={d.id} onClick={() => onWahl(d)}
                            className="relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--rb-text)] hover:bg-[var(--rb-weich)] disabled:opacity-45 disabled:cursor-not-allowed">
                            {d.wahl && <Check size={14} aria-hidden className={`shrink-0 ${d.an ? 'text-[var(--rb-akzent)]' : 'invisible'}`} />}
                            {Symbol && <Symbol size={16} aria-hidden />}<span>{d.text}</span>
                            {buchstabe && <Tipp>{buchstabe}</Tipp>}
                        </button>
                    </Fragment>
                );
            })}
        </div>
    );
}

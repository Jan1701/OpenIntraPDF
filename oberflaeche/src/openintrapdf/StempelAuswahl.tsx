// SPDX-License-Identifier: Apache-2.0
//
// Das Aufklappfeld für den Stempel (Etappe 5): die acht Stempel als
// Vorschau in ihrer Farbe, dazu „Eigener Text“. Ein natives <select> kann
// seine Einträge nicht als Stempel zeigen — darum ein eigenes Listenfeld
// nach dem Muster einer Auswahlliste: Pfeiltasten wechseln auch ohne
// Aufklappen, Enter oder Leertaste klappt auf, Esc schließt.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as TastenEreignis } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { STEMPEL, stempelFarbeHex, stempelLabel } from './stempel';
import type { StempelId, StempelWahl } from './stempel';
import { leise } from './stil';

/** Ein Stempel im Kleinen: Doppelrahmen und fettes Label in der Farbe. */
export function StempelVorschau({ label, farbe, leer }: { label: string; farbe: string; leer?: boolean }) {
    return (
        <span className="inline-block rounded-md border-2 p-[2px] max-w-full" style={{ borderColor: farbe, color: farbe }} aria-hidden>
            <span className={`block rounded-[3px] border px-2 py-0.5 text-[11px] font-bold tracking-wide truncate ${leer ? 'italic font-normal' : ''}`}
                style={{ borderColor: farbe }}>
                {label}
            </span>
        </span>
    );
}

interface Props {
    wahl: StempelWahl;
    onWahl: (w: StempelWahl) => void;
    sprache: string;
}

type Eintrag = StempelId | 'custom';

export function StempelAuswahl({ wahl, onWahl, sprache }: Props) {
    const { t } = useTranslation();
    const [offen, setOffen] = useState(false);
    const wurzel = useRef<HTMLDivElement>(null);
    const eintraege: Eintrag[] = [...STEMPEL.map(s => s.id), 'custom'];

    const labelVon = (id: Eintrag) => (id === 'custom' ? stempelLabel(wahl.eigenerText, sprache) : t(`openintrapdf.stempel.label.${id}`));
    const farbeVon = (id: Eintrag) => (id === 'custom' ? wahl.farbe : stempelFarbeHex(STEMPEL.find(s => s.id === id)!.farbe));

    // Ein fester Stempel bringt seine Farbe mit; „Eigener Text“ behält die aktuelle.
    const waehlen = (id: Eintrag, schliessen = true) => {
        onWahl(id === 'custom' ? { ...wahl, id } : { ...wahl, id, farbe: farbeVon(id) });
        if (schliessen) setOffen(false);
    };

    // Klick daneben schließt die Liste.
    useEffect(() => {
        if (!offen) return;
        const beiKlick = (e: PointerEvent) => {
            if (!wurzel.current?.contains(e.target as Node)) setOffen(false);
        };
        document.addEventListener('pointerdown', beiKlick);
        return () => document.removeEventListener('pointerdown', beiKlick);
    }, [offen]);

    const taste = (e: TastenEreignis<HTMLButtonElement>) => {
        const i = eintraege.indexOf(wahl.id);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = (i + (e.key === 'ArrowDown' ? 1 : eintraege.length - 1)) % eintraege.length;
            waehlen(eintraege[n], false);
        } else if (e.key === 'Escape' && offen) {
            // Esc gehört hier der Liste, nicht dem Arbeitsplatz (der beendete sonst das Werkzeug).
            e.preventDefault();
            e.stopPropagation();
            setOffen(false);
        }
    };

    const aktuellesLabel = labelVon(wahl.id);
    return (
        <div ref={wurzel} className="relative">
            <button type="button" aria-haspopup="listbox" aria-expanded={offen} aria-label={t('openintrapdf.stempel.auswahl')}
                onClick={() => setOffen(o => !o)} onKeyDown={taste}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--opdf-linie)] bg-[var(--opdf-app)] px-2 py-1.5 text-left hover:bg-[var(--opdf-weich)]">
                <StempelVorschau label={aktuellesLabel || t('openintrapdf.stempel.eigener')} farbe={wahl.farbe} leer={!aktuellesLabel} />
                <ChevronDown size={16} aria-hidden className="shrink-0 text-[var(--opdf-gedaempft)]" />
            </button>
            {offen && (
                <ul role="listbox" aria-label={t('openintrapdf.stempel.auswahl')}
                    className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--opdf-linie)] bg-[var(--opdf-paneel)] p-1 shadow-[var(--opdf-schatten)]">
                    {eintraege.map(id => {
                        const an = wahl.id === id;
                        const label = labelVon(id);
                        return (
                            <li key={id} role="option" aria-selected={an} aria-label={id === 'custom' ? t('openintrapdf.stempel.eigener') : label}
                                onClick={() => waehlen(id)}
                                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${an ? 'bg-[var(--opdf-weich)]' : 'hover:bg-[var(--opdf-weich)]'}`}>
                                {id === 'custom'
                                    ? <span className="text-sm">{t('openintrapdf.stempel.eigener')}</span>
                                    : <StempelVorschau label={label} farbe={farbeVon(id)} />}
                            </li>
                        );
                    })}
                </ul>
            )}
            {wahl.id === 'custom' && (
                <label className="mt-2 block">
                    <span className={`${leise} block mb-1`}>{t('openintrapdf.stempel.eigenerFeld')}</span>
                    <input type="text" value={wahl.eigenerText} maxLength={40} autoComplete="off"
                        placeholder={t('openintrapdf.stempel.eigenerPlatzhalter')}
                        onChange={e => onWahl({ ...wahl, eigenerText: e.target.value })}
                        className="h-9 w-full rounded-md border border-[var(--opdf-linie)] bg-[var(--opdf-app)] px-2 text-sm uppercase text-[var(--opdf-text)] placeholder:normal-case placeholder:text-[var(--opdf-gedaempft)]" />
                </label>
            )}
        </div>
    );
}

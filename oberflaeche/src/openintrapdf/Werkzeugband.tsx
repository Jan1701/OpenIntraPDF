// SPDX-License-Identifier: Apache-2.0
//
// Das Werkzeugband von OpenIntraPDF (Vertrag Etappe 7) ist seit Oktober 2026 der
// gemeinsame Baustein components/shared/werkzeugband. Hier steht nur, was
// OpenIntraPDF eigen ist:
//   - die feste Tastenbuchstaben-Tabelle je Sprache (Tastenbuchstaben.ts),
//     damit sich die Buchstaben nicht mit jeder Übersetzung ändern;
//   - der Speicher `openintrapdf.werkzeugband` mit der Vorgabe klassisch — ein
//     unter dem früheren Schlüssel gemerktes Einklappen wird übernommen
//     (components/shared/werkzeugband/darstellung.ts);
//   - Farbfelder und Strichstärken der Gruppe „Aussehen“.
// Die Farben des Bausteins setzt openintrapdf.css (--werkzeugband-* auf --opdf-*).
// Welche Reiter, Gruppen und Knöpfe es gibt, sagt werkzeugbandAufbau.tsx.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Werkzeugband as Baustein, useWerkzeugbandDarstellung } from '../components/shared/werkzeugband';
import type { WerkzeugbandDarstellung } from '../components/shared/werkzeugband';
import type { DateiEintrag, WerkzeugbandReiter, WerkzeugbandReiterId } from './werkzeugbandAufbau';
import { tastenbuchstaben } from './Tastenbuchstaben';

/** Präfix der gemerkten Darstellung (localStorage). */
export const WERKZEUGBAND_SPEICHER = 'openintrapdf.werkzeugband';

/** Darstellung des Bandes: gemerkt je Gerät, ohne gemerkten Wert klassisch, auf dem Telefon eingeklappt. */
export function usePdfWerkzeugbandDarstellung(): WerkzeugbandDarstellung {
    return useWerkzeugbandDarstellung(WERKZEUGBAND_SPEICHER, 'klassisch');
}

interface Props {
    reiter: WerkzeugbandReiter[];
    datei: DateiEintrag[];
    aktiv: WerkzeugbandReiterId;
    onAktiv: (id: WerkzeugbandReiterId) => void;
    darstellung: WerkzeugbandDarstellung;
    /** Speichern, Drucken, Rückgängig, Wiederholen, Lesen|Bearbeiten — immer sichtbar. */
    schnellbereich: ReactNode;
}

export function Werkzeugband({ reiter, datei, aktiv, onAktiv, darstellung, schnellbereich }: Props) {
    const { i18n } = useTranslation();
    const tabelle = tastenbuchstaben(i18n.resolvedLanguage ?? i18n.language);
    // Die Buchstaben der Tabelle an Reiter, Knöpfe und Datei-Einträge hängen.
    const mitTasten: WerkzeugbandReiter[] = reiter.map(r => ({
        ...r,
        taste: tabelle.reiter[r.id],
        gruppen: r.gruppen.map(g => ({ ...g, knoepfe: g.knoepfe?.map(k => ({ ...k, taste: tabelle.knoepfe[r.id][k.id] })) })),
    }));
    const dateiMitTasten = datei.map(d => ({ ...d, taste: tabelle.knoepfe.datei[d.id] }));
    return (
        <Baustein reiter={mitTasten} datei={dateiMitTasten} dateiTaste={tabelle.reiter.datei} aktiv={aktiv} onAktiv={onAktiv}
            darstellung={darstellung} schnellbereich={schnellbereich} />
    );
}

/** Eine Reihe runder Farbfelder im Band (Gruppe „Aussehen“). */
export function BandFarbfelder({ titel, farben, wert, onWert, namen }: {
    titel: string;
    farben: readonly { id: string; hex: string }[];
    wert: string;
    onWert: (hex: string) => void;
    namen: (id: string) => string;
}) {
    return (
        <div className="flex items-center gap-1" role="group" aria-label={titel} title={titel}>
            {farben.map(f => {
                const name = namen(f.id);
                const an = wert === f.hex;
                return (
                    <button key={f.id} type="button" aria-pressed={an} aria-label={name} title={name} onClick={() => onWert(f.hex)}
                        style={{ background: f.hex }}
                        className={`h-6 w-6 rounded-full border ${an ? 'ring-2 ring-offset-1 ring-[var(--opdf-akzent)] ring-offset-[var(--opdf-paneel)] border-transparent' : 'border-[var(--opdf-linie)]'}`} />
                );
            })}
        </div>
    );
}

/** Die Strichstärken im Band (Gruppe „Aussehen“). */
export function BandStaerken({ titel, staerken, wert, onWert, namen }: {
    titel: string;
    staerken: readonly number[];
    wert: number;
    onWert: (n: number) => void;
    namen: (n: number) => string;
}) {
    return (
        <div className="ml-1 flex items-center gap-0.5" role="group" aria-label={titel} title={titel}>
            {staerken.map(s => {
                const name = namen(s);
                const an = wert === s;
                return (
                    <button key={s} type="button" aria-pressed={an} aria-label={name} title={name} onClick={() => onWert(s)}
                        className={`h-6 w-8 rounded-md inline-flex items-center justify-center ${an ? 'bg-[var(--opdf-weich)] text-[var(--opdf-akzent)]' : 'text-[var(--opdf-text)] hover:bg-[var(--opdf-weich)]'}`}>
                        <span aria-hidden className="block w-5 rounded-full bg-current" style={{ height: s + 1 }} />
                    </button>
                );
            })}
        </div>
    );
}

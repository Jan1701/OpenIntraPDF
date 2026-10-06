// SPDX-License-Identifier: Apache-2.0
//
// Das Arbeitsfach rechts: die geöffnete Werkzeuggruppe mit Titel und
// Schließen. Bis Etappe 6 hieß es Werkzeugleiste und trug daneben eine
// schmale Symbolspalte, über die man die Gruppen wählte; seit Etappe 7
// übernimmt das Werkzeugband diese Aufgabe, und hier bleibt nur das Fach.
//
// Es erscheinen NUR Gruppen, die funktionieren (Konzept Kap. 02: „Noch gar
// nicht implementierte Werkzeuge gehören nicht als funktionslose bunte
// Knöpfe in die normale Oberfläche“). Die Gruppen selbst (Seiten,
// Kommentieren, Binden, OCR, Export) baut der Arbeitsplatz; ihr Zustand
// liegt dort, nicht hier — ein Wechsel des Reiters im Werkzeugband bricht darum
// keinen laufenden Auftrag ab.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { symbolKnopf } from './stil';

export interface WerkzeugGruppe {
    id: string;
    titel: string;
    inhalt: ReactNode;
}

interface Props {
    gruppen: WerkzeugGruppe[];
    aktiv: string | null;
    onAktiv: (id: string | null) => void;
    sichtbar: boolean;
}

export function Arbeitsfach({ gruppen, aktiv, onAktiv, sichtbar }: Props) {
    const { t } = useTranslation();
    const offen = sichtbar ? gruppen.find(g => g.id === aktiv) ?? null : null;
    if (!offen) return null;
    return (
        <section className="w-80 shrink-0 min-h-0 flex flex-col border-l border-[var(--opdf-linie)] bg-[var(--opdf-paneel)]"
            aria-labelledby="opdf-werkzeug-titel">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <h2 id="opdf-werkzeug-titel" className="flex-1 text-base font-semibold">{offen.titel}</h2>
                <button type="button" className={symbolKnopf} onClick={() => onAktiv(null)}
                    aria-label={t('openintrapdf.werkzeuge.gruppeSchliessen')} title={t('openintrapdf.werkzeuge.gruppeSchliessen')}>
                    <X size={16} />
                </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{offen.inhalt}</div>
        </section>
    );
}

/** Ein kleiner Kasten mit Hinweis — für Zustände, die man kennen muss. */
export function Hinweis({ art = 'info', children }: { art?: 'info' | 'warnung' | 'fehler' | 'erfolg'; children: ReactNode }) {
    const farbe = {
        info: 'bg-[var(--opdf-weich)] text-[var(--opdf-text)]',
        warnung: 'bg-[var(--opdf-warn-hg)] text-[var(--opdf-warn-text)]',
        fehler: 'bg-[var(--opdf-fehler-hg)] text-[var(--opdf-fehler)]',
        erfolg: 'bg-[var(--opdf-weich)] text-[var(--opdf-erfolg)]',
    }[art];
    return <div className={`rounded-md px-3 py-2 text-xs leading-relaxed ${farbe}`}>{children}</div>;
}

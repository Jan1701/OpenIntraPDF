// SPDX-License-Identifier: Apache-2.0
//
// Die Einstellungen der Gruppe „Kommentieren“ im Arbeitsfach (Etappe 8):
// die Anleitung zum gewählten Werkzeug und beim Stempel seine Auswahl,
// Farbe und „Name und Datum“. Die Werkzeuge selbst, Farbe und
// Strichstärke stehen seit Etappe 7 im Band; bis Etappe 8 standen sie
// hier ein zweites Mal (KommentarWerkzeuge).

import { useTranslation } from 'react-i18next';
import { STEMPEL_FARBEN, stempelLabel } from './stempel';
import type { StempelWahl } from './stempel';
import { StempelAuswahl } from './StempelAuswahl';
import { abschnitt, leise } from './stil';
import type { AnmerkungsArt } from './typen';

type GestenArt = 'punkt' | 'auswahl' | 'rechteck' | 'linie' | 'pfad' | 'zettel' | 'stempel' | 'link';

const GESTE: Record<AnmerkungsArt, GestenArt> = {
    note: 'punkt', highlight: 'auswahl', underline: 'auswahl', strikeout: 'auswahl', freetext: 'rechteck', ink: 'pfad',
    line: 'linie', arrow: 'linie', square: 'rechteck', circle: 'rechteck', sticky: 'zettel', stamp: 'stempel', link: 'link',
};

interface Props {
    werkzeug: AnmerkungsArt | null;
    /** Stempel (Etappe 5): Stempel, eigener Text, Farbe, „Name und Datum“. */
    stempel: StempelWahl;
    onStempel: (w: StempelWahl) => void;
    /** Aktuelle i18n-Sprache — für die Großschreibung des eigenen Textes. */
    sprache: string;
}

export function KommentarEinstellungen({ werkzeug, stempel, onStempel, sprache }: Props) {
    const { t } = useTranslation();
    const eigenerTextFehlt = werkzeug === 'stamp' && stempel.id === 'custom' && !stempelLabel(stempel.eigenerText, sprache);
    return (
        <div className="space-y-3 text-sm">
            <p className={leise} aria-live="polite">
                {werkzeug
                    ? `${t(`openintrapdf.kommentare.werkzeug.${werkzeug}`)}: ${t(`openintrapdf.kommentare.anleitung.${GESTE[werkzeug]}`)} ${t('openintrapdf.kommentare.anleitungEsc')}`
                    : t('openintrapdf.kommentare.werkzeugAus')}
            </p>

            {werkzeug === 'stamp' && (
                <div className="space-y-3">
                    <div>
                        <p className={`${abschnitt} mb-2`}>{t('openintrapdf.stempel.titel')}</p>
                        <StempelAuswahl wahl={stempel} onWahl={onStempel} sprache={sprache} />
                        {eigenerTextFehlt && <p className={`${leise} mt-1`} role="status">{t('openintrapdf.stempel.leerHinweis')}</p>}
                    </div>
                    <div>
                        <p className={`${abschnitt} mb-2`}>{t('openintrapdf.stempel.farbeTitel')}</p>
                        <div className="flex gap-1.5" role="group" aria-label={t('openintrapdf.stempel.farbeTitel')}>
                            {STEMPEL_FARBEN.map(f => {
                                const name = t(`openintrapdf.stempel.farbe.${f.id}`);
                                const an = stempel.farbe === f.hex;
                                return (
                                    <button key={f.id} type="button" aria-pressed={an} aria-label={name} title={name}
                                        onClick={() => onStempel({ ...stempel, farbe: f.hex })}
                                        style={{ background: f.hex }}
                                        className={`h-7 w-7 rounded-full border ${an ? 'ring-2 ring-offset-2 ring-[var(--opdf-akzent)] ring-offset-[var(--opdf-paneel)] border-transparent' : 'border-[var(--opdf-linie)]'}`} />
                                );
                            })}
                        </div>
                    </div>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={stempel.signed} onChange={e => onStempel({ ...stempel, signed: e.target.checked })} />
                        <span>{t('openintrapdf.stempel.signed')}</span>
                    </label>
                </div>
            )}
        </div>
    );
}

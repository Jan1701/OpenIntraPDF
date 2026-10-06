// SPDX-License-Identifier: Apache-2.0
//
// Werkzeuggruppe „Fassungen“ im Arbeitsfach (Etappe 8): die früheren
// Fassungen der Datei mit Nummer, Datum, Person und Größe. „Ansehen“ zeigt
// eine Fassung nur lesend in der Leseansicht; „Diese Fassung
// wiederherstellen“ fragt im Arbeitsplatz nach und legt wie Drive eine
// neue Fassung an. Ein offener Entwurf blockiert das Wiederherstellen.

import { useTranslation } from 'react-i18next';
import { Eye, History, RotateCcw } from 'lucide-react';
import { groesseText } from './eigenschaften';
import { Hinweis } from './Werkzeugleiste';
import { abschnitt, knopf, leise, rahmenKnopf } from './stil';
import type { PdfFassung } from './typen';

export type FassungenStand = { art: 'laedt' } | { art: 'fertig'; liste: PdfFassung[] } | { art: 'fehler' };

interface Props {
    stand: FassungenStand | null;
    /** Die aktuelle Fassung, wenn bekannt. */
    aktuell?: number;
    /** Die gerade angesehene Fassung. */
    angesehen: number | null;
    onAnsehen: (f: PdfFassung) => void;
    onZurueck: () => void;
    /** Fehlt, wenn Wiederherstellen nicht geht (Recht oder Gastgeber). */
    onWiederherstellen?: (f: PdfFassung) => void;
    entwurfOffen: boolean;
    /** Ein Wiederherstellen läuft gerade. */
    stellt: boolean;
}

export function FassungenWerkzeug({ stand, aktuell, angesehen, onAnsehen, onZurueck, onWiederherstellen, entwurfOffen, stellt }: Props) {
    const { t, i18n } = useTranslation();
    const sprache = i18n.resolvedLanguage || i18n.language || 'de';
    let datum: Intl.DateTimeFormat | null;
    try {
        datum = new Intl.DateTimeFormat(sprache, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        datum = null;
    }
    const datumText = (iso: string) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return datum ? datum.format(d) : d.toISOString();
    };

    return (
        <div className="space-y-4 text-sm">
            <p className={leise}>{t('openintrapdf.fassungen.einleitung')}</p>
            {aktuell !== undefined && (
                <p className={abschnitt}>
                    <History size={14} aria-hidden className="inline-block align-[-2px] mr-1" />
                    {t('openintrapdf.fassungen.aktuell', { version: aktuell })}
                </p>
            )}
            {onWiederherstellen && entwurfOffen && <Hinweis art="warnung">{t('openintrapdf.fassungen.entwurfBlockiert')}</Hinweis>}
            {stellt && <p className={leise} role="status">{t('openintrapdf.fassungen.stellt')}</p>}
            {!stand || stand.art === 'laedt' ? (
                <p className={leise} role="status">{t('openintrapdf.fassungen.laedt')}</p>
            ) : stand.art === 'fehler' ? (
                <p className="text-[var(--opdf-fehler)]" role="alert">{t('openintrapdf.fassungen.fehler')}</p>
            ) : stand.liste.length === 0 ? (
                <p className={leise}>{t('openintrapdf.fassungen.keine')}</p>
            ) : (
                <ul className="space-y-2">
                    {stand.liste.map(f => {
                        const an = angesehen === f.version;
                        return (
                            <li key={f.version} className={`rounded-md border border-[var(--opdf-linie)] px-3 py-2 ${an ? 'bg-[var(--opdf-weich)]' : ''}`}>
                                <p className="font-semibold">{t('openintrapdf.fassungen.eintrag', { version: f.version })}</p>
                                <p className={leise}>
                                    {datumText(f.created_at)}
                                    {f.created_by ? ` · ${f.created_by}` : ''}
                                    {` · ${groesseText(f.size, sprache)}`}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {an ? (
                                        <button type="button" className={rahmenKnopf} onClick={onZurueck}>
                                            <Eye size={14} aria-hidden /> {t('openintrapdf.fassungen.zurueck')}
                                        </button>
                                    ) : (
                                        <button type="button" className={rahmenKnopf} onClick={() => onAnsehen(f)} aria-pressed={false}>
                                            <Eye size={14} aria-hidden /> {t('openintrapdf.fassungen.ansehen')}
                                        </button>
                                    )}
                                    {onWiederherstellen && (
                                        <button type="button" className={knopf} disabled={entwurfOffen || stellt}
                                            title={entwurfOffen ? t('openintrapdf.fassungen.entwurfBlockiert') : undefined}
                                            onClick={() => onWiederherstellen(f)}>
                                            <RotateCcw size={14} aria-hidden /> {t('openintrapdf.fassungen.wiederherstellen')}
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// SPDX-License-Identifier: Apache-2.0
//
// Werkzeuggruppe „Seiten verwalten“ im Arbeitsfach (Bearbeiten-Modus).
//
// Seit Etappe 7 stehen die Seitenaktionen (wählen, drehen, entfernen,
// duplizieren, Reihenfolge, leere Seiten prüfen, Auswahl als neue Datei)
// im Band; hier bleibt nur, was dort nicht steht (Etappe 8): die Auswahl in
// Worten, „vor Seite N“, Hinweise und Meldungen der laufenden Prüfung und
// des Extrahierens sowie die Tastatur. Alles wirkt auf die Auswahl im
// Seitenraster und landet als Befehl im Entwurf.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { Hinweis } from './Werkzeugleiste';
import type { PlanBefehl } from './seitenplan';
import { abschnitt, eingabe, knopf, leise, rahmenKnopf } from './stil';

interface Props {
    /** Kennungen der gewählten Einträge, in Planreihenfolge. */
    gewaehlt: string[];
    /** Wie viele der gewählten schon entfernt sind. */
    gewaehltEntfernt: number;
    verbleibend: number;
    onBefehl: (b: PlanBefehl) => void;
    /** Vor die künftige Seite `nummer` verschieben (ab 1; verbleibend+1 = ans Ende). */
    onVorSeite: (nummer: number) => void;
    leer: { laeuft: boolean; erledigt: number; gesamt: number; meldung: string | null };
    onLeerAbbrechen: () => void;
    /** Ob der Gastgeber extrahieren kann — dann gibt es die Hinweise dazu. */
    extrahierenMoeglich: boolean;
    extrakt: { laeuft: boolean; meldung: string | null; fehler: boolean };
    /** Gewählte Seiten haben im Entwurf eine Drehung — beim Extrahieren zählt die gespeicherte Fassung. */
    drehungImEntwurf: boolean;
    /** So viele Entwurfsanmerkungen entfielen, würde die Auswahl entfernt. */
    anmerkungenBeiEntfernen?: number;
}

export function SeitenWerkzeug(p: Props) {
    const { t } = useTranslation();
    const [vorNummer, setVorNummer] = useState('');
    const anzahl = p.gewaehlt.length;
    const keine = anzahl === 0;
    const alleEntfernt = anzahl > 0 && p.gewaehltEntfernt === anzahl;
    const zahl = Number(vorNummer);
    const vorGueltig = Number.isInteger(zahl) && zahl >= 1 && zahl <= p.verbleibend + 1;

    return (
        <div className="space-y-5 text-sm">
            <p className={leise}>{t('openintrapdf.seiten.einleitung')}</p>

            <div>
                <p className={`${abschnitt} mb-2`}>{t('openintrapdf.seiten.auswahl')}</p>
                <p aria-live="polite">
                    {keine ? t('openintrapdf.seiten.keineAuswahl') : t('openintrapdf.seiten.gewaehlt', { count: anzahl })}
                </p>
                {p.gewaehltEntfernt > 0 && !alleEntfernt && (
                    <button type="button" className={`${knopf} mt-2 w-full`}
                        onClick={() => p.onBefehl({ art: 'wiederherstellen', ids: p.gewaehlt })}>
                        <Undo2 size={16} aria-hidden /> {t('openintrapdf.seiten.wiederherstellen')}
                    </button>
                )}
                {!alleEntfernt && (p.anmerkungenBeiEntfernen ?? 0) > 0 && (
                    <div className="mt-2"><Hinweis art="warnung">{t('openintrapdf.seiten.entfernenAnmerkungen', { count: p.anmerkungenBeiEntfernen })}</Hinweis></div>
                )}
            </div>

            <div>
                <p className={`${abschnitt} mb-2`}>{t('openintrapdf.seiten.reihenfolge')}</p>
                <form className="flex items-end gap-2" onSubmit={e => {
                    e.preventDefault();
                    if (!keine && vorGueltig) {
                        p.onVorSeite(zahl);
                        setVorNummer('');
                    }
                }}>
                    <label className="flex-1">
                        <span className={`${leise} block mb-1`}>{t('openintrapdf.seiten.vorSeite', { max: p.verbleibend + 1 })}</span>
                        <input type="number" inputMode="numeric" min={1} max={p.verbleibend + 1} value={vorNummer}
                            onChange={e => setVorNummer(e.target.value)} className={`${eingabe} w-full`} disabled={keine} />
                    </label>
                    <button type="submit" className={rahmenKnopf} disabled={keine || !vorGueltig}>{t('openintrapdf.seiten.verschieben')}</button>
                </form>
                <p className={`${leise} mt-2`}>{t('openintrapdf.seiten.ziehenHinweis')}</p>
            </div>

            <div>
                <p className={`${abschnitt} mb-2`}>{t('openintrapdf.seiten.leereTitel')}</p>
                {p.leer.laeuft && (
                    <div className="space-y-2" role="status">
                        <p>{t('openintrapdf.seiten.leerLaeuft', { erledigt: p.leer.erledigt, gesamt: p.leer.gesamt })}</p>
                        <div className="h-1.5 rounded bg-[var(--opdf-linie)] overflow-hidden">
                            <div className="h-full bg-[var(--opdf-akzent)]" style={{ width: `${p.leer.gesamt ? (100 * p.leer.erledigt) / p.leer.gesamt : 0}%` }} />
                        </div>
                        <button type="button" className={rahmenKnopf} onClick={p.onLeerAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                    </div>
                )}
                {p.leer.meldung && <p className={`${leise} mt-2`} role="status">{p.leer.meldung}</p>}
                <p className={`${leise} mt-2`}>{t('openintrapdf.seiten.leerHinweis')}</p>
            </div>

            {p.extrahierenMoeglich && (
                <div>
                    <p className={`${abschnitt} mb-2`}>{t('openintrapdf.seiten.neueDateien')}</p>
                    <p className={leise}>{t('openintrapdf.seiten.extraktHinweis')}</p>
                    {p.drehungImEntwurf && !keine && (
                        <div className="mt-2"><Hinweis art="warnung">{t('openintrapdf.seiten.extraktDrehung')}</Hinweis></div>
                    )}
                    {p.extrakt.laeuft && <p className={`${leise} mt-2`} role="status">{t('openintrapdf.seiten.extraktLaeuft')}</p>}
                    {p.extrakt.meldung && (
                        <div className="mt-2" role="status">
                            <Hinweis art={p.extrakt.fehler ? 'fehler' : 'erfolg'}>{p.extrakt.meldung}</Hinweis>
                        </div>
                    )}
                </div>
            )}

            <div>
                <p className={`${abschnitt} mb-2`}>{t('openintrapdf.seiten.tastaturTitel')}</p>
                <p className={leise}>{t('openintrapdf.seiten.tastatur')}</p>
            </div>
        </div>
    );
}

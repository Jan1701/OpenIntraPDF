// SPDX-License-Identifier: Apache-2.0
//
// „Seiten aus Datei …“ (Etappe 9, Vertrag Abschnitt 2): Nach der Wahl im
// Dateiwähler des Gastgebers fragt dieser Dialog, welche Seiten der Datei
// hinter die aktuelle Seite kommen — alle oder ein Bereich wie beim Druck
// („1-3, 5“), mit Prüfung an der Eingabe. Was der Server über die Datei
// weiß (Seitenzahl, Fassung, Passwort), kommt über `quelleInfo`; eine
// passwortgeschützte Quelle lässt sich nicht einfügen, und der Dialog sagt
// das, statt es den Server ablehnen zu lassen.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { seitenbereichParsen } from './druck';
import type { BereichFehler } from './druck';
import { Hinweis } from './Werkzeugleiste';
import { eingabe, hauptKnopf, knopf, leise } from './stil';
import type { DateiWahl, PdfInfo } from './typen';

export type QuellStand =
    | { art: 'laedt' }
    | { art: 'fertig'; info: PdfInfo }
    /** Nicht lesbar (404) oder Netz. */
    | { art: 'fehler' };

interface Props {
    datei: DateiWahl;
    stand: QuellStand;
    /** Seiten ab 0 in der gespeicherten Fassung der Quelle. */
    onEinfuegen: (seiten: number[], info: PdfInfo) => void;
    onAbbrechen: () => void;
}

export function SeitenAusDateiDialog({ datei, stand, onEinfuegen, onAbbrechen }: Props) {
    const { t } = useTranslation();
    const [bereich, setBereich] = useState<'alle' | 'bereich'>('alle');
    const [eingabeText, setEingabeText] = useState('');
    const [fehler, setFehler] = useState<BereichFehler | null>(null);
    const info = stand.art === 'fertig' ? stand.info : null;
    const seitenzahl = info?.inspection?.pages ?? 0;
    const name = info?.name || datei.name;
    const passwort = !!info && (info.inspection?.encrypted || info.capabilities?.merge?.state === 'requires_password'
        || info.capabilities?.merge?.reason === 'encrypted_source');
    const bereit = !!info && seitenzahl > 0 && !passwort;

    const fehlerText = (f: BereichFehler) => {
        switch (f.art) {
            case 'leer': return t('openintrapdf.druck.fehlerLeer');
            case 'form': return t('openintrapdf.druck.fehlerForm', { teil: f.teil });
            default: return t('openintrapdf.druck.fehlerAusserhalb', { seite: f.seite, gesamt: seitenzahl });
        }
    };

    const absenden = () => {
        if (!info || !bereit) return;
        if (bereich === 'alle') {
            onEinfuegen(Array.from({ length: seitenzahl }, (_, i) => i), info);
            return;
        }
        const ergebnis = seitenbereichParsen(eingabeText, seitenzahl);
        if ('fehler' in ergebnis) {
            setFehler(ergebnis.fehler);
            return;
        }
        onEinfuegen(ergebnis.seiten, info);
    };

    return (
        <Dialog titel={t('openintrapdf.seitenAusDatei.titel')} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="submit" form="opdf-seiten-aus-datei" className={hauptKnopf} disabled={!bereit} data-autofocus>
                    {t('openintrapdf.seitenAusDatei.einfuegen')}
                </button>
            </>}>
            <form id="opdf-seiten-aus-datei" onSubmit={e => { e.preventDefault(); absenden(); }} className="space-y-3">
                <p className="font-semibold">{t('openintrapdf.seitenAusDatei.datei', { name })}</p>
                {stand.art === 'laedt' && <p className={leise} role="status">{t('openintrapdf.seitenAusDatei.laedt')}</p>}
                {stand.art === 'fehler' && <Hinweis art="fehler">{t('openintrapdf.seitenAusDatei.nichtLesbar')}</Hinweis>}
                {passwort && <Hinweis art="warnung">{t('openintrapdf.seitenAusDatei.verschluesselt')}</Hinweis>}
                {bereit && (
                    <fieldset className="space-y-1.5">
                        <legend className="mb-1 font-semibold">{t('openintrapdf.druck.bereichTitel')}</legend>
                        <label className="flex items-center gap-2">
                            <input type="radio" name="opdf-quelle-bereich" value="alle" checked={bereich === 'alle'}
                                onChange={() => { setBereich('alle'); setFehler(null); }} />
                            <span>{t('openintrapdf.seitenAusDatei.alle', { count: seitenzahl })}</span>
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="radio" name="opdf-quelle-bereich" value="bereich" checked={bereich === 'bereich'}
                                onChange={() => { setBereich('bereich'); setFehler(null); }} />
                            <span>{t('openintrapdf.druck.bereich')}</span>
                        </label>
                        {bereich === 'bereich' && (
                            <div className="ml-6">
                                <input type="text" value={eingabeText} aria-label={t('openintrapdf.druck.bereich')} aria-invalid={!!fehler}
                                    placeholder={t('openintrapdf.druck.bereichPlatzhalter')} autoComplete="off"
                                    onChange={e => { setEingabeText(e.target.value); setFehler(null); }} className={`${eingabe} w-full`} />
                                <p className={`${leise} mt-1`}>{t('openintrapdf.druck.bereichHinweis')}</p>
                                {fehler && <p className="mt-1 text-[var(--opdf-fehler)]" role="alert">{fehlerText(fehler)}</p>}
                            </div>
                        )}
                    </fieldset>
                )}
                <p className={leise}>{t('openintrapdf.seitenAusDatei.hinweis')}</p>
            </form>
        </Dialog>
    );
}

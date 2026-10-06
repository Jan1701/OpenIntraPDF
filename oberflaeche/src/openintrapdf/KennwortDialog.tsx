// SPDX-License-Identifier: Apache-2.0
//
// Ein Kennwort erfragen (Etappe 9, Vertrag Abschnitt 3): „Kennwort
// entfernen“ und „Rechte-Kennwort eingeben“. Das Kennwort verlässt den
// Dialog nur über `onBestaetigen`; der Arbeitsplatz hält es höchstens für
// die Sitzung im Speicher.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { eingabe, hauptKnopf, knopf, leise } from './stil';

interface Props {
    titel: string;
    text: string;
    knopfText: string;
    /** Vorbelegung, etwa das Kennwort, mit dem die Datei geöffnet wurde. */
    vorgabe?: string;
    laeuft?: boolean;
    fehler?: string | null;
    onBestaetigen: (kennwort: string) => void;
    onAbbrechen: () => void;
}

export function KennwortDialog({ titel, text, knopfText, vorgabe = '', laeuft = false, fehler, onBestaetigen, onAbbrechen }: Props) {
    const { t } = useTranslation();
    const [kennwort, setKennwort] = useState(vorgabe);
    return (
        <Dialog titel={titel} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="submit" form="opdf-kennwort" className={hauptKnopf} disabled={laeuft || !kennwort}>{knopfText}</button>
            </>}>
            <form id="opdf-kennwort" onSubmit={e => { e.preventDefault(); if (kennwort) onBestaetigen(kennwort); }} className="space-y-3">
                <p>{text}</p>
                <label className="block">
                    <span className={`${leise} block mb-1`}>{t('openintrapdf.passwort.feld')}</span>
                    <input type="password" value={kennwort} autoComplete="off" data-autofocus disabled={laeuft}
                        onChange={e => setKennwort(e.target.value)} className={`${eingabe} w-full`} />
                </label>
                {fehler && <p className="text-[var(--opdf-fehler)]" role="alert">{fehler}</p>}
            </form>
        </Dialog>
    );
}

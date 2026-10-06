// SPDX-License-Identifier: Apache-2.0
//
// „Geschützt herunterladen …“ (Etappe 9, Vertrag Abschnitt 3): Öffnen-
// Kennwort (optional), Rechte-Kennwort (Pflicht, sobald ein Recht fehlt;
// sonst gilt das Öffnen-Kennwort als beides), die Rechte und AES-256. Die
// Datei in der Ablage bleibt ungeschützt; geschützt wird nur die Kopie, die
// der Server für diesen einen Aufruf baut. Kennwörter bleiben im Dialog.

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { eingabe, hauptKnopf, knopf, leise } from './stil';
import type { SchutzBefehl } from './typen';

/** Mindestlänge beider Kennwörter (Vertrag: sechs Zeichen, wie der Server prüft). */
export const KENNWORT_MINDEST = 6;

type Recht = keyof SchutzBefehl['permissions'];
const RECHTE: readonly Recht[] = ['print', 'copy', 'modify', 'annotate', 'fill'];

interface Props {
    laeuft: boolean;
    onHerunterladen: (befehl: Omit<SchutzBefehl, 'expected_version'>) => void;
    onAbbrechen: () => void;
}

export function SchutzDialog({ laeuft, onHerunterladen, onAbbrechen }: Props) {
    const { t } = useTranslation();
    const [oeffnen, setOeffnen] = useState('');
    const [rechteKennwort, setRechteKennwort] = useState('');
    const [rechte, setRechte] = useState<Record<Recht, boolean>>({ print: true, copy: true, modify: true, annotate: true, fill: true });
    const [fehler, setFehler] = useState<string | null>(null);
    const id = useId();
    const eingeschraenkt = RECHTE.some(r => !rechte[r]);

    const absenden = () => {
        if (oeffnen && oeffnen.length < KENNWORT_MINDEST) {
            setFehler(t('openintrapdf.schutz.zuKurz', { min: KENNWORT_MINDEST }));
            return;
        }
        if (rechteKennwort && rechteKennwort.length < KENNWORT_MINDEST) {
            setFehler(t('openintrapdf.schutz.zuKurz', { min: KENNWORT_MINDEST }));
            return;
        }
        // Rechte-Kennwort: Pflicht bei eingeschränkten Rechten; sonst genügt das Öffnen-Kennwort als beides.
        const besitzer = rechteKennwort || oeffnen;
        if (!besitzer) {
            setFehler(t(eingeschraenkt ? 'openintrapdf.schutz.rechteKennwortPflicht' : 'openintrapdf.schutz.einKennwort'));
            return;
        }
        if (eingeschraenkt && !rechteKennwort) {
            setFehler(t('openintrapdf.schutz.rechteKennwortPflicht'));
            return;
        }
        const befehl: Omit<SchutzBefehl, 'expected_version'> = { owner_password: besitzer, permissions: { ...rechte } };
        if (oeffnen) befehl.user_password = oeffnen;
        onHerunterladen(befehl);
    };

    return (
        <Dialog titel={t('openintrapdf.schutz.titel')} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="submit" form="opdf-schutz" className={hauptKnopf} disabled={laeuft}>{t('openintrapdf.schutz.herunterladen')}</button>
            </>}>
            <form id="opdf-schutz" onSubmit={e => { e.preventDefault(); absenden(); }} className="space-y-3">
                <p className={leise}>{t('openintrapdf.schutz.einleitung')}</p>
                <div>
                    <label htmlFor={`${id}-oeffnen`} className="block mb-1 font-semibold">{t('openintrapdf.schutz.oeffnenKennwort')}</label>
                    <input id={`${id}-oeffnen`} type="password" value={oeffnen} autoComplete="new-password" data-autofocus disabled={laeuft}
                        aria-describedby={`${id}-oeffnen-hinweis`}
                        onChange={e => { setOeffnen(e.target.value); setFehler(null); }} className={`${eingabe} w-full`} />
                    <p id={`${id}-oeffnen-hinweis`} className={`${leise} mt-1`}>{t('openintrapdf.schutz.oeffnenHinweis')}</p>
                </div>
                <div>
                    <label htmlFor={`${id}-rechte`} className="block mb-1 font-semibold">{t('openintrapdf.schutz.rechteKennwort')}</label>
                    <input id={`${id}-rechte`} type="password" value={rechteKennwort} autoComplete="new-password" disabled={laeuft}
                        aria-describedby={`${id}-rechte-hinweis`}
                        onChange={e => { setRechteKennwort(e.target.value); setFehler(null); }} className={`${eingabe} w-full`} />
                    <p id={`${id}-rechte-hinweis`} className={`${leise} mt-1`}>{t('openintrapdf.schutz.rechteHinweis')}</p>
                </div>
                <fieldset className="space-y-1">
                    <legend className="mb-1 font-semibold">{t('openintrapdf.schutz.rechteTitel')}</legend>
                    {RECHTE.map(r => (
                        <label key={r} className="flex items-center gap-2">
                            <input type="checkbox" checked={rechte[r]} disabled={laeuft}
                                onChange={e => { setRechte({ ...rechte, [r]: e.target.checked }); setFehler(null); }} />
                            <span>{t(`openintrapdf.schutz.recht.${r}`)}</span>
                        </label>
                    ))}
                </fieldset>
                <p className={leise}>{t('openintrapdf.schutz.verschluesselung')}</p>
                {fehler && <p className="text-[var(--opdf-fehler)]" role="alert">{fehler}</p>}
            </form>
        </Dialog>
    );
}

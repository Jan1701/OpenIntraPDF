// SPDX-License-Identifier: Apache-2.0
//
// Der Druckdialog (Etappe 8): Bereich — alle Seiten, aktuelle Seite,
// Auswahl aus dem Seitenraster oder eine Eingabe wie „1-3, 5, 8-“ mit
// Prüfung an der Eingabe — und „Mit Anmerkungen“. Alle Seiten mit
// Anmerkungen gehen den heutigen Weg (`host.drucken`); alles andere
// braucht die Druckfassung des Gastgebers. Fehlt sie, gibt es nur „alle
// Seiten“ mit Anmerkungen, und der Dialog sagt das.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { seitenbereichParsen } from './druck';
import type { BereichFehler } from './druck';
import { eingabe, hauptKnopf, knopf, leise } from './stil';

export interface DruckWahl {
    /** Seiten ab 0; `null` heißt alle. */
    seiten: number[] | null;
    anmerkungen: boolean;
}

type Bereich = 'alle' | 'aktuelle' | 'auswahl' | 'bereich';

interface Props {
    seitenzahl: number;
    /** Aktuelle Seite ab 1. */
    aktuelleSeite: number;
    /** Quellseiten (ab 0) der Auswahl im Seitenraster; leer, wenn keine. */
    auswahl: number[];
    /** Der Gastgeber kann eine Druckfassung bauen — sonst nur alle Seiten mit Anmerkungen. */
    teilbereichMoeglich: boolean;
    laeuft: boolean;
    onDrucken: (wahl: DruckWahl) => void;
    onAbbrechen: () => void;
}

export function DruckDialog({ seitenzahl, aktuelleSeite, auswahl, teilbereichMoeglich, laeuft, onDrucken, onAbbrechen }: Props) {
    const { t } = useTranslation();
    const [bereich, setBereich] = useState<Bereich>('alle');
    const [eingabeText, setEingabeText] = useState('');
    const [anmerkungen, setAnmerkungen] = useState(true);
    const [fehler, setFehler] = useState<BereichFehler | null>(null);

    const fehlerText = (f: BereichFehler) => {
        switch (f.art) {
            case 'leer': return t('openintrapdf.druck.fehlerLeer');
            case 'form': return t('openintrapdf.druck.fehlerForm', { teil: f.teil });
            default: return t('openintrapdf.druck.fehlerAusserhalb', { seite: f.seite, gesamt: seitenzahl });
        }
    };

    const absenden = () => {
        if (bereich === 'alle') {
            onDrucken({ seiten: null, anmerkungen });
            return;
        }
        if (bereich === 'aktuelle') {
            onDrucken({ seiten: [aktuelleSeite - 1], anmerkungen });
            return;
        }
        if (bereich === 'auswahl') {
            onDrucken({ seiten: [...new Set(auswahl)].sort((a, b) => a - b), anmerkungen });
            return;
        }
        const ergebnis = seitenbereichParsen(eingabeText, seitenzahl);
        if ('fehler' in ergebnis) {
            setFehler(ergebnis.fehler);
            return;
        }
        onDrucken({ seiten: ergebnis.seiten, anmerkungen });
    };

    const wahl = (id: Bereich, text: string, gesperrt = false) => (
        <label className={`flex items-center gap-2 ${gesperrt ? 'opacity-50' : ''}`}>
            <input type="radio" name="opdf-druck-bereich" value={id} checked={bereich === id} disabled={gesperrt || laeuft}
                onChange={() => { setBereich(id); setFehler(null); }} />
            <span>{text}</span>
        </label>
    );

    return (
        <Dialog titel={t('openintrapdf.druck.titel')} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="submit" form="opdf-druck" className={hauptKnopf} disabled={laeuft} data-autofocus>{t('openintrapdf.druck.drucken')}</button>
            </>}>
            <form id="opdf-druck" onSubmit={e => { e.preventDefault(); absenden(); }} className="space-y-3">
                <p className={leise}>{t('openintrapdf.druck.einleitung')}</p>
                <fieldset className="space-y-1.5">
                    <legend className="mb-1 font-semibold">{t('openintrapdf.druck.bereichTitel')}</legend>
                    {wahl('alle', t('openintrapdf.druck.alle'))}
                    {wahl('aktuelle', t('openintrapdf.druck.aktuelle', { seite: aktuelleSeite }), !teilbereichMoeglich)}
                    {auswahl.length > 0 && wahl('auswahl', t('openintrapdf.druck.auswahl', { count: new Set(auswahl).size }), !teilbereichMoeglich)}
                    {wahl('bereich', t('openintrapdf.druck.bereich'), !teilbereichMoeglich)}
                    {bereich === 'bereich' && (
                        <div className="ml-6">
                            <input type="text" value={eingabeText} aria-label={t('openintrapdf.druck.bereich')} aria-invalid={!!fehler}
                                placeholder={t('openintrapdf.druck.bereichPlatzhalter')} autoComplete="off" disabled={laeuft}
                                onChange={e => { setEingabeText(e.target.value); setFehler(null); }} className={`${eingabe} w-full`} />
                            <p className={`${leise} mt-1`}>{t('openintrapdf.druck.bereichHinweis')}</p>
                            {fehler && <p className="mt-1 text-[var(--opdf-fehler)]" role="alert">{fehlerText(fehler)}</p>}
                        </div>
                    )}
                </fieldset>
                <label className={`flex items-center gap-2 ${teilbereichMoeglich ? '' : 'opacity-50'}`}>
                    <input type="checkbox" checked={anmerkungen} disabled={!teilbereichMoeglich || laeuft} onChange={e => setAnmerkungen(e.target.checked)} />
                    <span>{t('openintrapdf.druck.mitAnmerkungen')}</span>
                </label>
                {!teilbereichMoeglich && <p className={leise}>{t('openintrapdf.druck.nurAlle')}</p>}
            </form>
        </Dialog>
    );
}

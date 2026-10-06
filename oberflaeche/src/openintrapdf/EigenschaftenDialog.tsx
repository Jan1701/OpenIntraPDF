// SPDX-License-Identifier: Apache-2.0
//
// Der Dialog „Eigenschaften“ (Etappe 7): zeigt, was eigenschaften.ts aus
// dem Dokument liest; Zeilen ohne Wert entfallen. Im Modus Bearbeiten mit
// Recht `edit` (Etappe 8) sind Titel, Thema, Autor und Stichwörter
// Eingabefelder; „Übernehmen“ legt nur die Abweichungen vom Dokument in den
// Entwurf (ein leeres Feld entfernt den Eintrag), gespeichert wird erst
// mit „Speichern“ als `properties` im Commit.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { eigenschaftenLesen, groesseText, ptZuMm } from './eigenschaften';
import type { Eigenschaften, EigenschaftenDokument } from './eigenschaften';
import type { EigenschaftenEntwurf } from './entwurf';
import { abschnitt, eingabe, hauptKnopf, knopf, leise } from './stil';
import type { PdfEigenschaften } from './typen';

/** Höchstlänge je Feld (Server: 1000 Zeichen). */
export const EIGENSCHAFT_HOECHST_ZEICHEN = 1000;

const FELDER: readonly { feld: keyof PdfEigenschaften; wert: keyof Pick<Eigenschaften, 'titel' | 'thema' | 'autor' | 'stichwoerter'>; schluessel: string }[] = [
    { feld: 'title', wert: 'titel', schluessel: 'dokumentTitel' },
    { feld: 'subject', wert: 'thema', schluessel: 'thema' },
    { feld: 'author', wert: 'autor', schluessel: 'autor' },
    { feld: 'keywords', wert: 'stichwoerter', schluessel: 'stichwoerter' },
];

/** Steuerzeichen (auch Zeilenumbruch, Tabulator) — der Server lehnt sie ab. */
// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Die Abweichungen der Eingaben vom Dokument: Was gleich ist, fehlt; was
 * anders ist, steht drin — leer heißt entfernen.
 */
export function eigenschaftenAbweichung(dokument: Eigenschaften, eingaben: Record<keyof PdfEigenschaften, string>): EigenschaftenEntwurf {
    const aus: PdfEigenschaften = {};
    for (const f of FELDER) {
        const neu = eingaben[f.feld].trim();
        const alt = dokument[f.wert] ?? '';
        if (neu !== alt) aus[f.feld] = neu;
    }
    return aus;
}

interface Props {
    dokument: EigenschaftenDokument;
    /** Anzeigename der Datei. */
    name: string;
    /** Bytes, wenn der Gastgeber sie kennt. */
    dateigroesse?: number;
    onSchliessen: () => void;
    /** Bearbeiten (Etappe 8): der Entwurf dazu und das Übernehmen; fehlt beim Lesen. */
    bearbeiten?: { entwurf: EigenschaftenEntwurf; onUebernehmen: (werte: EigenschaftenEntwurf) => void };
    /** Hinweis für Personen, die bearbeiten dürften, aber im Lesen sind. */
    bearbeitenHinweis?: string;
}

export function EigenschaftenDialog({ dokument, name, dateigroesse, onSchliessen, bearbeiten, bearbeitenHinweis }: Props) {
    const { t, i18n } = useTranslation();
    const [stand, setStand] = useState<{ art: 'laedt' } | { art: 'fertig'; werte: Eigenschaften } | { art: 'fehler' }>({ art: 'laedt' });
    const [eingaben, setEingaben] = useState<Record<keyof PdfEigenschaften, string> | null>(null);
    const [meldung, setMeldung] = useState<{ art: 'fehler' | 'info'; text: string } | null>(null);
    // Der Entwurf beim Öffnen: Die Felder werden EINMAL daraus (sonst aus
    // dem Dokument) vorbelegt, sobald die Werte da sind.
    const entwurfBeimOeffnen = useRef(bearbeiten?.entwurf);

    useEffect(() => {
        let aus = false;
        eigenschaftenLesen(dokument, dateigroesse).then(
            werte => {
                if (aus) return;
                setStand({ art: 'fertig', werte });
                const vorbelegt = entwurfBeimOeffnen.current;
                if (vorbelegt) {
                    const e: Record<keyof PdfEigenschaften, string> = { title: '', subject: '', author: '', keywords: '' };
                    for (const f of FELDER) e[f.feld] = vorbelegt[f.feld] ?? werte[f.wert] ?? '';
                    setEingaben(e);
                }
            },
            () => { if (!aus) setStand({ art: 'fehler' }); },
        );
        return () => { aus = true; };
    }, [dokument, dateigroesse]);

    const sprache = i18n.resolvedLanguage || i18n.language || 'de';
    let datum: Intl.DateTimeFormat | null;
    try {
        datum = new Intl.DateTimeFormat(sprache, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        datum = null;
    }
    const datumText = (d: Date | null) => (d ? (datum ? datum.format(d) : d.toISOString()) : undefined);
    const zahl = (n: number, stellen: number) => n.toLocaleString(sprache, { maximumFractionDigits: stellen });

    const zeilen: { schluessel: string; wert: string | undefined }[] = [{ schluessel: 'dateiname', wert: name }];
    if (stand.art === 'fertig') {
        const w = stand.werte;
        if (!bearbeiten) {
            zeilen.push(
                { schluessel: 'dokumentTitel', wert: w.titel },
                { schluessel: 'autor', wert: w.autor },
                { schluessel: 'thema', wert: w.thema },
                { schluessel: 'stichwoerter', wert: w.stichwoerter },
            );
        }
        zeilen.push(
            { schluessel: 'ersteller', wert: w.ersteller },
            { schluessel: 'produzent', wert: w.produzent },
            { schluessel: 'pdfVersion', wert: w.pdfVersion },
            { schluessel: 'erstellt', wert: datumText(w.erstellt) },
            { schluessel: 'geaendert', wert: datumText(w.geaendert) },
            { schluessel: 'seiten', wert: t('openintrapdf.kopf.seiten', { count: w.seiten }) },
            {
                schluessel: 'ersteSeite',
                wert: w.ersteSeite ? t('openintrapdf.eigenschaften.groesse', {
                    breite: zahl(ptZuMm(w.ersteSeite.breitePt), 1), hoehe: zahl(ptZuMm(w.ersteSeite.hoehePt), 1),
                    breitePt: zahl(w.ersteSeite.breitePt, 1), hoehePt: zahl(w.ersteSeite.hoehePt, 1),
                }) : undefined,
            },
            { schluessel: 'dateigroesse', wert: w.dateigroesse === undefined ? undefined : groesseText(w.dateigroesse, sprache) },
        );
    }

    const uebernehmen = () => {
        if (!bearbeiten || !eingaben || stand.art !== 'fertig') return;
        for (const f of FELDER) {
            if (STEUERZEICHEN.test(eingaben[f.feld])) {
                setMeldung({ art: 'fehler', text: `${t(`openintrapdf.eigenschaften.${f.schluessel}`)}: ${t('openintrapdf.eigenschaften.steuerzeichen')}` });
                return;
            }
        }
        const werte = eigenschaftenAbweichung(stand.werte, eingaben);
        const vorher = bearbeiten.entwurf;
        const gleich = FELDER.every(f => werte[f.feld] === vorher[f.feld]);
        bearbeiten.onUebernehmen(werte);
        setMeldung({ art: 'info', text: t(gleich ? 'openintrapdf.eigenschaften.unveraendert' : 'openintrapdf.eigenschaften.uebernommen') });
    };

    return (
        <Dialog titel={t('openintrapdf.eigenschaften.titel')} onAbbrechen={onSchliessen}
            aktionen={<>
                {bearbeiten && (
                    <button type="button" className={hauptKnopf} disabled={!eingaben} onClick={uebernehmen}>{t('openintrapdf.eigenschaften.uebernehmen')}</button>
                )}
                <button type="button" className={knopf} data-autofocus={bearbeiten ? undefined : true} onClick={onSchliessen}>{t('openintrapdf.aktion.schliessen')}</button>
            </>}>
            {stand.art === 'laedt' && <p className={leise} role="status">{t('openintrapdf.eigenschaften.laedt')}</p>}
            {stand.art === 'fehler' && <p className="text-[var(--opdf-fehler)]" role="alert">{t('openintrapdf.eigenschaften.fehler')}</p>}
            {bearbeiten && eingaben && stand.art === 'fertig' && (
                <div className="mb-3 space-y-2">
                    <p className={leise}>{t('openintrapdf.eigenschaften.bearbeitbar')}</p>
                    {FELDER.map(f => (
                        <label key={f.feld} className="block">
                            <span className={`${abschnitt} block mb-1`}>
                                {t(`openintrapdf.eigenschaften.${f.schluessel}`)}
                                {bearbeiten.entwurf[f.feld] !== undefined && ` ${t('openintrapdf.eigenschaften.entwurfMarke')}`}
                            </span>
                            <input type="text" value={eingaben[f.feld]} maxLength={EIGENSCHAFT_HOECHST_ZEICHEN} autoComplete="off"
                                onChange={e => { setMeldung(null); setEingaben({ ...eingaben, [f.feld]: e.target.value }); }}
                                className={`${eingabe} w-full`} />
                        </label>
                    ))}
                    {meldung && (
                        <p className={meldung.art === 'fehler' ? 'text-[var(--opdf-fehler)]' : leise} role={meldung.art === 'fehler' ? 'alert' : 'status'}>
                            {meldung.text}
                        </p>
                    )}
                </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                {zeilen.filter(z => z.wert).map(z => (
                    <div key={z.schluessel} className="contents">
                        <dt className={`${leise} whitespace-nowrap`}>{t(`openintrapdf.eigenschaften.${z.schluessel}`)}</dt>
                        <dd className="break-words">{z.wert}</dd>
                    </div>
                ))}
            </dl>
            {stand.art === 'fertig' && !bearbeiten && (
                <p className={`${leise} mt-3`}>{t('openintrapdf.eigenschaften.nurLesen')}{bearbeitenHinweis ? ` ${bearbeitenHinweis}` : ''}</p>
            )}
        </Dialog>
    );
}

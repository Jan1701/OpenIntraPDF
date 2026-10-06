// SPDX-License-Identifier: Apache-2.0
//
// Links (Etappe 9, Vertrag Abschnitt 4): Nach dem Aufziehen des Rechtecks
// fragt der Dialog nach dem Ziel — eine Web-Adresse (nur http, https,
// mailto) oder eine Seite im Dokument. Ein gespeicherter oder neuer Link
// zeigt im Zweitdialog sein Ziel und lässt sich löschen.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { eingabe, hauptKnopf, knopf, leise, warnKnopf } from './stil';

/** Das Ziel eines Links, wie es in den Befehl geht. */
export type LinkZiel = { uri: string } | { page_target: number };

/** Erlaubte Schemata (Vertrag: alles andere wird abgewiesen). */
const SCHEMATA = ['http:', 'https:', 'mailto:'];

/** Prüft eine Web-Adresse: absolut, mit erlaubtem Schema; `null`, wenn sie nicht geht. */
export function adressePruefen(text: string): string | null {
    const t = text.trim();
    if (!t || t.length > 2000) return null;
    let u: URL;
    try {
        u = new URL(t);
    } catch {
        return null;
    }
    if (!SCHEMATA.includes(u.protocol)) return null;
    if (u.protocol !== 'mailto:' && !u.host) return null;
    return t;
}

interface Props {
    seitenzahl: number;
    /** Vorschlag für die Zielseite (ab 1), etwa die aktuelle. */
    vorschlagSeite: number;
    onAnlegen: (ziel: LinkZiel) => void;
    onAbbrechen: () => void;
}

export function LinkDialog({ seitenzahl, vorschlagSeite, onAnlegen, onAbbrechen }: Props) {
    const { t } = useTranslation();
    const [art, setArt] = useState<'web' | 'seite'>('web');
    const [adresse, setAdresse] = useState('');
    const [seite, setSeite] = useState(String(Math.max(1, Math.min(seitenzahl, vorschlagSeite))));
    const [fehler, setFehler] = useState<string | null>(null);

    const absenden = () => {
        if (art === 'web') {
            const u = adressePruefen(adresse);
            if (!u) {
                setFehler(t('openintrapdf.link.fehlerAdresse'));
                return;
            }
            onAnlegen({ uri: u });
            return;
        }
        const n = Number(seite);
        if (!Number.isInteger(n) || n < 1 || n > seitenzahl) {
            setFehler(t('openintrapdf.link.fehlerSeite', { seite, gesamt: seitenzahl }));
            return;
        }
        onAnlegen({ page_target: n - 1 });
    };

    return (
        <Dialog titel={t('openintrapdf.link.titel')} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="submit" form="opdf-link" className={hauptKnopf}>{t('openintrapdf.link.anlegen')}</button>
            </>}>
            <form id="opdf-link" onSubmit={e => { e.preventDefault(); absenden(); }} className="space-y-3">
                <fieldset className="space-y-1.5">
                    <legend className="mb-1 font-semibold">{t('openintrapdf.link.zielTitel')}</legend>
                    <label className="flex items-center gap-2">
                        <input type="radio" name="opdf-link-art" value="web" checked={art === 'web'} onChange={() => { setArt('web'); setFehler(null); }} />
                        <span>{t('openintrapdf.link.web')}</span>
                    </label>
                    {art === 'web' && (
                        <div className="ml-6">
                            <input type="text" inputMode="url" value={adresse} aria-label={t('openintrapdf.link.web')} aria-invalid={!!fehler} data-autofocus
                                placeholder={t('openintrapdf.link.webPlatzhalter')} autoComplete="off"
                                onChange={e => { setAdresse(e.target.value); setFehler(null); }} className={`${eingabe} w-full`} />
                            <p className={`${leise} mt-1`}>{t('openintrapdf.link.webHinweis')}</p>
                        </div>
                    )}
                    <label className="flex items-center gap-2">
                        <input type="radio" name="opdf-link-art" value="seite" checked={art === 'seite'} onChange={() => { setArt('seite'); setFehler(null); }} />
                        <span>{t('openintrapdf.link.seite')}</span>
                    </label>
                    {art === 'seite' && (
                        <div className="ml-6">
                            <input type="text" inputMode="numeric" value={seite} aria-invalid={!!fehler}
                                aria-label={t('openintrapdf.link.seiteFeld', { max: seitenzahl })} data-autofocus
                                onChange={e => { setSeite(e.target.value); setFehler(null); }} className={`${eingabe} w-28`} />
                            <span className={`${leise} ml-2`}>{t('openintrapdf.link.seiteFeld', { max: seitenzahl })}</span>
                        </div>
                    )}
                </fieldset>
                {fehler && <p className="text-[var(--opdf-fehler)]" role="alert">{fehler}</p>}
            </form>
        </Dialog>
    );
}

/** Ein vorhandener Link: Ziel anzeigen, löschen. */
export function LinkLoeschenDialog({ ziel, entwurf, onLoeschen, onAbbrechen }: {
    ziel: string;
    /** Ein Link des Entwurfs, noch nicht gespeichert. */
    entwurf: boolean;
    onLoeschen: () => void;
    onAbbrechen: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Dialog titel={t('openintrapdf.link.loeschenTitel')} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} data-autofocus onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="button" className={warnKnopf} onClick={onLoeschen}>{t('openintrapdf.link.loeschen')}</button>
            </>}>
            <p className="break-all">{ziel}{entwurf ? ` ${t('openintrapdf.link.entwurf')}` : ''}</p>
            <p className={`${leise} mt-2`}>{t(entwurf ? 'openintrapdf.link.loeschenEntwurfHinweis' : 'openintrapdf.link.loeschenHinweis')}</p>
        </Dialog>
    );
}

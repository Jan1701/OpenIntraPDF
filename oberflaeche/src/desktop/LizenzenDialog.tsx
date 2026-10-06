// SPDX-License-Identifier: Apache-2.0
//
// „Hilfe → Lizenzen“ (06.10.2026): die Lizenz der App, ihr Urheber und alle
// mitgelieferten Teile mit vollem Lizenztext.
//
// Vorher öffnete der Menüpunkt LIZENZEN.md als file://-Adresse, und auf dem
// Mac geschah nichts (Jan: „unter Lizenzen kommt nichts“). Die Texte liefert
// jetzt die Go-Seite (lizenzen.go) aus dem Paket; das Verzeichnis entsteht
// beim Bau (lizenzverzeichnis/).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, LoaderCircle, Search, X } from 'lucide-react';
import type { Bruecke, Lizenzauskunft, LizenzTeil } from './bruecke';

interface Props {
    bruecke: Pick<Bruecke, 'Lizenzen'>;
    onSchliessen: () => void;
}

const GRUPPEN = ['ocr', 'schrift', 'go', 'js'] as const;

export function LizenzenDialog({ bruecke, onSchliessen }: Props) {
    const { t } = useTranslation();
    const titelId = useId();
    const [auskunft, setAuskunft] = useState<Lizenzauskunft | null>(null);
    const [fehler, setFehler] = useState(false);
    const [suche, setSuche] = useState('');
    const [offen, setOffen] = useState<string | null>(null);
    const rahmen = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let aus = false;
        bruecke.Lizenzen().then(a => { if (!aus) setAuskunft(a); }, () => { if (!aus) setFehler(true); });
        return () => { aus = true; };
    }, [bruecke]);

    // Esc schließt; der Fokus geht beim Öffnen in den Dialog und danach
    // zurück. Nur einmal: Hinge der Effekt an onSchliessen, sprängen Fokus und
    // Tastenhörer bei jedem Neuzeichnen der App.
    const schliessenRef = useRef(onSchliessen);
    schliessenRef.current = onSchliessen;
    useEffect(() => {
        const vorher = document.activeElement as HTMLElement | null;
        const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') schliessenRef.current(); };
        document.addEventListener('keydown', taste);
        return () => {
            document.removeEventListener('keydown', taste);
            if (vorher && document.contains(vorher)) vorher.focus();
        };
    }, []);
    // Sobald die Liste steht, ins Suchfeld.
    useEffect(() => {
        if (auskunft) rahmen.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }, [auskunft]);

    const gefiltert = useMemo(() => {
        const q = suche.trim().toLowerCase();
        const teile = auskunft?.teile ?? [];
        return q ? teile.filter(p => `${p.name} ${p.lizenz}`.toLowerCase().includes(q)) : teile;
    }, [auskunft, suche]);

    const schalter = (schluessel: string) => setOffen(o => (o === schluessel ? null : schluessel));

    return (
        <div className="lizenzen-schleier" onMouseDown={e => { if (e.target === e.currentTarget) onSchliessen(); }}>
            <div ref={rahmen} className="lizenzen" role="dialog" aria-modal="true" aria-labelledby={titelId}>
                <header className="lizenzen-kopf">
                    <h2 id={titelId}>{t('openintrapdf.desktop.lizenzen.titel')}</h2>
                    <button type="button" className="lizenzen-zu" onClick={onSchliessen}
                        aria-label={t('openintrapdf.desktop.lizenzen.schliessen')} title={t('openintrapdf.desktop.lizenzen.schliessen')}>
                        <X size={18} aria-hidden />
                    </button>
                </header>

                {fehler && <p className="start-fehler" role="alert">{t('openintrapdf.desktop.lizenzen.fehler')}</p>}
                {!fehler && !auskunft && <p className="lizenzen-laedt"><LoaderCircle size={18} className="animate-spin" aria-hidden /></p>}

                {auskunft && (
                    <div className="lizenzen-inhalt">
                        <section className="lizenzen-app">
                            <p className="lizenzen-app-name">{auskunft.app}</p>
                            <p>{auskunft.urheber}</p>
                            <p>{t('openintrapdf.desktop.lizenzen.app', { app: auskunft.app })}</p>
                            <Eintrag schluessel="app" offen={offen === 'app'} onSchalter={schalter}
                                kopf={<span>{auskunft.lizenz}</span>} text={auskunft.text} />
                        </section>

                        <section aria-labelledby={`${titelId}-teile`}>
                            <h3 id={`${titelId}-teile`} className="lizenzen-teile-titel">
                                {t('openintrapdf.desktop.lizenzen.teile')} <span className="lizenzen-zahl">{auskunft.teile.length}</span>
                            </h3>
                            <p className="lizenzen-hinweis">{t('openintrapdf.desktop.lizenzen.teileHinweis')}</p>
                            <label className="lizenzen-suche">
                                <Search size={16} aria-hidden />
                                <input type="search" value={suche} onChange={e => setSuche(e.target.value)} data-autofocus
                                    placeholder={t('openintrapdf.desktop.lizenzen.suchen')} aria-label={t('openintrapdf.desktop.lizenzen.suchen')} />
                            </label>
                            {gefiltert.length === 0 && <p className="lizenzen-hinweis">{t('openintrapdf.desktop.lizenzen.leer')}</p>}
                            {GRUPPEN.map(g => {
                                const teile = gefiltert.filter(p => p.gruppe === g);
                                if (!teile.length) return null;
                                return (
                                    <div key={g} className="lizenzen-gruppe">
                                        <h4>{t(`openintrapdf.desktop.lizenzen.${g}`)}</h4>
                                        {teile.map(p => {
                                            const k = `${p.gruppe}:${p.name}`;
                                            return <Eintrag key={k} schluessel={k} offen={offen === k} onSchalter={schalter}
                                                kopf={<TeilKopf teil={p} />} text={p.text} />;
                                        })}
                                    </div>
                                );
                            })}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}

function TeilKopf({ teil }: { teil: LizenzTeil }) {
    return (
        <>
            <span className="lizenzen-name">{teil.name}</span>
            {teil.fassung && <span className="lizenzen-fassung">{teil.fassung}</span>}
            {teil.lizenz && <span className="lizenzen-marke">{teil.lizenz}</span>}
        </>
    );
}

interface EintragProps {
    schluessel: string;
    offen: boolean;
    onSchalter: (schluessel: string) => void;
    kopf: React.ReactNode;
    text: string;
}

function Eintrag({ schluessel, offen, onSchalter, kopf, text }: EintragProps) {
    const { t } = useTranslation();
    const id = useId();
    return (
        <div className="lizenzen-eintrag">
            <button type="button" className="lizenzen-zeile" aria-expanded={offen} aria-controls={id}
                title={t(offen ? 'openintrapdf.desktop.lizenzen.textVerbergen' : 'openintrapdf.desktop.lizenzen.textZeigen')}
                onClick={() => onSchalter(schluessel)}>
                {offen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                {kopf}
            </button>
            {offen && <pre id={id} className="lizenzen-text">{text}</pre>}
        </div>
    );
}

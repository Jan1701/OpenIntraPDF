// SPDX-License-Identifier: Apache-2.0
//
// „Hilfe → Über OpenIntraPDF“ unter Linux und Windows (06.10.2026). Auf dem
// Mac zeigt macOS das Info-Fenster selbst (App-Menü); dort setzt die
// Go-Seite nur den Text. Inhalt wie dort: Beschreibung, Fassung mit Bau,
// Urheber, Lizenz -- dazu der Weg zu den Lizenzen.

import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import logoHell from './logo/openintrapdf-transparent-dunkle-schrift.svg';
import logoDunkel from './logo/openintrapdf-transparent-weisse-schrift.svg';
import type { Fassung } from './menue';

interface Props {
    fassung: Fassung;
    onLizenzen: () => void;
    onSchliessen: () => void;
}

export function UeberDialog({ fassung, onLizenzen, onSchliessen }: Props) {
    const { t } = useTranslation();
    const titelId = useId();
    const rahmen = useRef<HTMLDivElement>(null);
    const schliessenRef = useRef(onSchliessen);
    schliessenRef.current = onSchliessen;

    useEffect(() => {
        const vorher = document.activeElement as HTMLElement | null;
        rahmen.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
        const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') schliessenRef.current(); };
        document.addEventListener('keydown', taste);
        return () => {
            document.removeEventListener('keydown', taste);
            if (vorher && document.contains(vorher)) vorher.focus();
        };
    }, []);

    const weg = `${t('openintrapdf.desktop.menue.hilfe')} → ${t('openintrapdf.desktop.menue.lizenzen')}`;
    return (
        <div className="lizenzen-schleier" onMouseDown={e => { if (e.target === e.currentTarget) onSchliessen(); }}>
            <div ref={rahmen} className="lizenzen ueber" role="dialog" aria-modal="true" aria-labelledby={titelId}>
                <header className="lizenzen-kopf">
                    <h2 id={titelId}>{t('openintrapdf.desktop.menue.ueber', { app: 'OpenIntraPDF' })}</h2>
                    <button type="button" className="lizenzen-zu" onClick={onSchliessen}
                        aria-label={t('openintrapdf.desktop.lizenzen.schliessen')} title={t('openintrapdf.desktop.lizenzen.schliessen')}>
                        <X size={18} aria-hidden />
                    </button>
                </header>
                <div className="lizenzen-inhalt ueber-inhalt">
                    <img className="start-logo start-logo-hell ueber-logo" src={logoHell} alt="OpenIntraPDF" draggable={false} />
                    <img className="start-logo start-logo-dunkel ueber-logo" src={logoDunkel} alt="OpenIntraPDF" draggable={false} />
                    <p>{t('openintrapdf.desktop.ueber.text')}</p>
                    <p className="lizenzen-hinweis">{t('openintrapdf.desktop.ueber.fassung', { version: fassung.fassung ?? '', bau: fassung.bau || '–' })}</p>
                    <p>{fassung.urheber}</p>
                    <p className="lizenzen-hinweis">{t('openintrapdf.desktop.ueber.lizenz', { weg })}</p>
                    <div className="ueber-knoepfe">
                        <button type="button" className="start-knopf" onClick={onLizenzen} data-autofocus>
                            {t('openintrapdf.desktop.menue.lizenzen')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

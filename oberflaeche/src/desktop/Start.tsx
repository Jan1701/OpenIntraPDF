// SPDX-License-Identifier: Apache-2.0
//
// Der Startbildschirm: „PDF öffnen …“, Ablegen einer Datei, zuletzt
// geöffnete Dateien (Vertrag Etappe 6, „Mac-Verhalten“). Das Sternlogo
// kommt unverändert aus OpenIntra-Logos (hell/dunkel je nach System).

import { useTranslation } from 'react-i18next';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import logoHell from './logo/openintrapdf-transparent-dunkle-schrift.svg';
import logoDunkel from './logo/openintrapdf-transparent-weisse-schrift.svg';
import type { StartInfo, ZuletztEintrag } from './bruecke';

interface Props {
    info: StartInfo | null;
    zuletzt: ZuletztEintrag[];
    /** Eine Datei wird gerade geöffnet. */
    laedt: boolean;
    fehler: string | null;
    onOeffnen: () => void;
    onZuletzt: (schluessel: string) => void;
}

export function Start({ info, zuletzt, laedt, fehler, onOeffnen, onZuletzt }: Props) {
    const { t } = useTranslation();
    return (
        <div className="start" data-testid="start">
            <div className="start-mitte">
                <img className="start-logo start-logo-hell" src={logoHell} alt="OpenIntraPDF" draggable={false} />
                <img className="start-logo start-logo-dunkel" src={logoDunkel} alt="OpenIntraPDF" draggable={false} />
                <button type="button" className="start-knopf" onClick={onOeffnen} disabled={laedt} data-autofocus>
                    {laedt ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <FolderOpen size={18} aria-hidden />}
                    {laedt ? t('openintrapdf.desktop.start.laedt') : t('openintrapdf.desktop.start.oeffnen')}
                </button>
                <p className="start-ziehen">{t('openintrapdf.desktop.start.ziehen')}</p>
                {fehler && <p className="start-fehler" role="alert">{fehler}</p>}
                <section className="start-zuletzt" aria-labelledby="start-zuletzt-titel">
                    <h2 id="start-zuletzt-titel">{t('openintrapdf.desktop.start.zuletzt')}</h2>
                    {zuletzt.length === 0 ? (
                        <p className="start-leer">{t('openintrapdf.desktop.start.zuletztLeer')}</p>
                    ) : (
                        <ul>
                            {zuletzt.map(e => (
                                <li key={e.schluessel}>
                                    <button type="button" className="start-eintrag" onClick={() => onZuletzt(e.schluessel)} disabled={laedt || e.fehlt}>
                                        <span>
                                            <strong>{e.name}</strong>
                                            <span title={e.ordner}>{e.ordner}</span>
                                        </span>
                                        {e.fehlt && <em>{t('openintrapdf.desktop.start.fehlt')}</em>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
            <footer className="start-fuss">
                <span>{info?.person ? t('openintrapdf.desktop.start.person', { name: info.person }) : ''}</span>
                <span>
                    {info
                        ? info.ocr
                            ? t('openintrapdf.desktop.start.ocrBereit', { version: info.ocr })
                            : t('openintrapdf.desktop.start.ocrFehlt', { grund: info.ocr_fehler ?? '' })
                        : ''}
                </span>
            </footer>
        </div>
    );
}

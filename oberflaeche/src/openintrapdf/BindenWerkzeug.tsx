// SPDX-License-Identifier: Apache-2.0
//
// Werkzeuggruppe „Dateien binden“ (Konzept Kap. 02: Dateien hinzufügen,
// Reihenfolge, Seitenbereiche, Ergebnisname).
//
// Die geöffnete Datei steht zuerst; weitere kommen über den Wähler des
// Gastgebers dazu. Die Reihenfolge lässt sich ziehen UND mit den Pfeilen
// ändern — die Pfeile sind der Weg für Tastatur und Screenreader. Was der
// Server über eine Quelle weiß (Seiten, Signatur, Formular, Passwort),
// steht am Eintrag; Warnungen, die man vor dem Binden kennen muss, stehen
// darunter. Gebunden wird erst nach der Zielwahl im Dialog des Gastgebers.

import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ClipboardList, Combine, GripVertical, LoaderCircle, Lock, Plus, ShieldAlert, X } from 'lucide-react';
import { HOECHST_QUELLEN, OFFEN, bereichLesen } from './binden';
import type { Binden, Quelle } from './binden';
import { Hinweis } from './Werkzeugleiste';
import { abschnitt, eingabe, hauptKnopf, leise, rahmenKnopf, symbolKnopf } from './stil';

interface Props {
    b: Binden;
    /** Ein Seiten- oder Anmerkungsentwurf der geöffneten Datei ist offen — er ist NICHT im Ergebnis. */
    entwurfOffen: boolean;
    /** Ziel erfragen und binden. */
    onBinden: () => void;
    /** Ansage für Screenreader (Reihenfolge, Hinzufügen, Entfernen). */
    onAnsage: (text: string) => void;
}

export function BindenWerkzeug({ b, entwurfOffen, onBinden, onAnsage }: Props) {
    const { t } = useTranslation();
    const gezogen = useRef<string | null>(null);
    const [einfuegen, setEinfuegen] = useState<{ key: string | null; seite: 'vor' | 'nach' } | null>(null);
    const laeuft = b.stand.art === 'laeuft';
    const gesperrt = laeuft || b.waehlt;
    const offen = b.quellen.find(q => q.key === OFFEN);

    const bewegen = (q: Quelle, richtung: -1 | 1) => {
        const stelle = b.verschieben(q.key, richtung);
        if (stelle) onAnsage(t('openintrapdf.binden.verschoben', { name: q.name, nummer: stelle }));
    };
    const entfernen = (q: Quelle) => {
        b.entfernen(q.key);
        onAnsage(t('openintrapdf.binden.entfernt', { name: q.name }));
    };
    const hinzuKnopf = useRef<HTMLButtonElement>(null);
    const hinzufuegen = async () => {
        const n = await b.hinzufuegen();
        // Der Wähler des Gastgebers liegt außerhalb des Arbeitsplatzes; nach
        // dem Schließen kehrt der Fokus hierher zurück, sonst wirken die Tasten nicht mehr.
        hinzuKnopf.current?.focus();
        if (n) onAnsage(t('openintrapdf.binden.hinzugefuegt', { count: n }));
    };

    // Ziehen wie im Seitenraster: vor oder nach dem Eintrag, je nach Hälfte.
    const ziehenStart = (e: DragEvent, key: string) => {
        gezogen.current = key;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
    };
    const ueber = (e: DragEvent, key: string) => {
        if (!gezogen.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const seite = e.clientY < r.top + r.height / 2 ? 'vor' : 'nach';
        if (einfuegen?.key !== key || einfuegen.seite !== seite) setEinfuegen({ key, seite });
    };
    const ablegen = (e: DragEvent) => {
        e.preventDefault();
        const key = gezogen.current;
        const ziel = einfuegen;
        gezogen.current = null;
        setEinfuegen(null);
        if (!key) return;
        let vor: string | null = null;
        if (ziel?.key) {
            if (ziel.seite === 'vor') vor = ziel.key;
            else {
                const i = b.quellen.findIndex(q => q.key === ziel.key);
                vor = b.quellen[i + 1]?.key ?? null;
            }
        }
        const stelle = b.verschiebenVor(key, vor);
        const q = b.quellen.find(x => x.key === key);
        if (stelle && q) onAnsage(t('openintrapdf.binden.verschoben', { name: q.name, nummer: stelle }));
    };

    const { stand } = b;
    const konfliktQuelle = stand.art === 'konflikt' ? b.quellen.find(q => q.id === stand.fileId) : undefined;
    const berichtsTeile = stand.art === 'fertig'
        ? (stand.ergebnis.report?.warnings ?? []).map(w => t(`openintrapdf.warnung.${w}`, { defaultValue: w }))
        : [];

    return (
        <div className="space-y-5 text-sm">
            <p className={leise}>{t('openintrapdf.binden.einleitung')}</p>
            {offen?.version !== undefined && (
                <Hinweis art="info">
                    {t('openintrapdf.binden.fassung', { version: offen.version })}
                    {entwurfOffen && ` ${t('openintrapdf.binden.fassungEntwurf')}`}
                </Hinweis>
            )}

            <div>
                <p className={`${abschnitt} mb-1`}>{t('openintrapdf.binden.quellenTitel')}</p>
                <p className={`${leise} mb-2`} id="opdf-binden-hilfe">{t('openintrapdf.binden.quellenHilfe')}</p>
                <ol className="space-y-2" aria-label={t('openintrapdf.binden.quellenTitel')} aria-describedby="opdf-binden-hilfe"
                    onDragOver={e => {
                        if (!gezogen.current) return;
                        e.preventDefault();
                        if (einfuegen?.key !== null) setEinfuegen({ key: null, seite: 'nach' });
                    }}
                    onDrop={ablegen}>
                    {b.quellen.map((q, i) => (
                        <QuellenEintrag key={q.key} q={q} nummer={i + 1} letzte={i === b.quellen.length - 1} gesperrt={gesperrt}
                            marke={einfuegen?.key === q.key ? einfuegen.seite : null}
                            onHoch={() => bewegen(q, -1)} onRunter={() => bewegen(q, 1)}
                            onEntfernen={q.key === OFFEN ? undefined : () => entfernen(q)}
                            onBereich={text => b.bereichSetzen(q.key, text)}
                            onDragStart={e => ziehenStart(e, q.key)} onDragOver={e => ueber(e, q.key)}
                            onDragEnd={() => { gezogen.current = null; setEinfuegen(null); }} />
                    ))}
                </ol>
                <button ref={hinzuKnopf} type="button" className={`${rahmenKnopf} w-full mt-2`} onClick={() => void hinzufuegen()}
                    disabled={gesperrt || b.quellen.length >= HOECHST_QUELLEN}>
                    {b.waehlt ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
                    {t('openintrapdf.binden.hinzufuegen')}
                </button>
                {b.quellen.length >= HOECHST_QUELLEN && (
                    <p className={`${leise} mt-1`}>{t('openintrapdf.binden.zuViele', { max: HOECHST_QUELLEN })}</p>
                )}
            </div>

            {/* Was man vor dem Binden wissen muss */}
            {(b.warnungen.signierte.length > 0 || b.warnungen.formular || b.warnungen.passwort.length > 0) && (
                <div className="space-y-2" role="status">
                    {b.warnungen.signierte.length > 0 && (
                        <Hinweis art="warnung">
                            {t('openintrapdf.binden.warnungSigniert', { count: b.warnungen.signierte.length, namen: b.warnungen.signierte.join(', ') })}
                        </Hinweis>
                    )}
                    {b.warnungen.formular && <Hinweis art="info">{t('openintrapdf.binden.warnungFormular')}</Hinweis>}
                    {b.warnungen.passwort.length > 0 && (
                        <Hinweis art="fehler">
                            {t('openintrapdf.binden.warnungPasswort', { count: b.warnungen.passwort.length, namen: b.warnungen.passwort.join(', ') })}
                        </Hinweis>
                    )}
                </div>
            )}

            <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={b.lesezeichen} disabled={gesperrt} onChange={e => b.setLesezeichen(e.target.checked)} />
                <span>
                    <span className="block font-semibold">{t('openintrapdf.binden.lesezeichen')}</span>
                    <span className={`${leise} block`}>{t('openintrapdf.binden.lesezeichenHinweis')}</span>
                </span>
            </label>

            <div>
                <label htmlFor="opdf-binden-name" className={`${abschnitt} block mb-2`}>{t('openintrapdf.binden.nameTitel')}</label>
                <input id="opdf-binden-name" value={b.name} disabled={gesperrt} onChange={e => b.setName(e.target.value)} className={`${eingabe} w-full`} />
            </div>

            {stand.art === 'fertig' && (
                <div role="status" className="space-y-2">
                    <Hinweis art="erfolg">{t('openintrapdf.binden.erfolg', { name: stand.ergebnis.name })}</Hinweis>
                    {berichtsTeile.length > 0 && <Hinweis art="info">{t('openintrapdf.binden.bericht')} {berichtsTeile.join(' · ')}</Hinweis>}
                </div>
            )}
            {stand.art === 'konflikt' && (
                <div role="alert" className="space-y-2">
                    <Hinweis art="fehler">
                        {stand.aktuelleVersion
                            ? t('openintrapdf.binden.konflikt', { name: konfliktQuelle?.name ?? t('openintrapdf.binden.eineQuelle'), version: stand.aktuelleVersion })
                            : t('openintrapdf.binden.konfliktOhneFassung', { name: konfliktQuelle?.name ?? t('openintrapdf.binden.eineQuelle') })}
                    </Hinweis>
                    <button type="button" className={rahmenKnopf} onClick={() => { b.quellenNeuLaden(); onAnsage(t('openintrapdf.binden.neuGeladen')); }}>
                        {t('openintrapdf.binden.quellenNeuLaden')}
                    </button>
                </div>
            )}
            {stand.art === 'fehlgeschlagen' && (
                <div role="alert" className="space-y-2">
                    <Hinweis art="fehler">
                        <span className="font-semibold">{t('openintrapdf.binden.fehlgeschlagen')}</span>{' '}
                        {t(`openintrapdf.binden.fehler.${stand.grund}`)}
                        {stand.meldung && ` ${stand.meldung}`}
                    </Hinweis>
                    {stand.wiederholbar && (
                        <button type="button" className={rahmenKnopf} onClick={() => void b.erneut()}>{t('openintrapdf.aktion.erneut')}</button>
                    )}
                </div>
            )}

            <button type="button" className={`${hauptKnopf} w-full`} disabled={gesperrt || b.pruefung !== null || !b.name.trim()} onClick={onBinden}>
                {laeuft ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Combine size={16} aria-hidden />}
                {t(laeuft ? 'openintrapdf.binden.laeuft' : 'openintrapdf.binden.binden')}
            </button>
            <p className={leise}>
                {b.pruefung && b.pruefung !== 'passwort' && b.pruefung !== 'zuViele'
                    ? t(`openintrapdf.binden.nichtBereit.${b.pruefung}`)
                    : t('openintrapdf.binden.bindenHinweis')}
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------
// Ein Eintrag der Quellenliste
// ---------------------------------------------------------------------

function QuellenEintrag({ q, nummer, letzte, gesperrt, marke, onHoch, onRunter, onEntfernen, onBereich, onDragStart, onDragOver, onDragEnd }: {
    q: Quelle;
    nummer: number;
    letzte: boolean;
    gesperrt: boolean;
    marke: 'vor' | 'nach' | null;
    onHoch: () => void;
    onRunter: () => void;
    /** Fehlt bei der geöffneten Datei — sie bleibt immer dabei. */
    onEntfernen?: () => void;
    onBereich: (text: string) => void;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragEnd: () => void;
}) {
    const { t } = useTranslation();
    const bereich = bereichLesen(q);
    const ungueltig = bereich === 'ungueltig';
    const feldId = `opdf-binden-bereich-${q.key}`;
    const hinweisId = `${feldId}-hinweis`;

    let stand: string;
    if (q.laedt) stand = t('openintrapdf.binden.laedt');
    else if (q.fehler === 'netz') stand = t('openintrapdf.binden.netz');
    else if (q.fehler) stand = t('openintrapdf.binden.nichtLesbar');
    else if (q.seitenzahl !== undefined) stand = t('openintrapdf.binden.seiten', { count: q.seitenzahl });
    else stand = t('openintrapdf.binden.seitenUnbekannt');

    return (
        <li draggable={!gesperrt} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
            aria-label={t('openintrapdf.binden.eintrag', { nummer, name: q.name })}
            className={`relative rounded-md border p-2 bg-[var(--opdf-app)] ${q.fehler ? 'border-[var(--opdf-fehler)]' : 'border-[var(--opdf-linie)]'}`}>
            {marke === 'vor' && <span className="absolute left-2 right-2 -top-1.5 h-1 rounded bg-[var(--opdf-akzent)]" aria-hidden />}
            {marke === 'nach' && <span className="absolute left-2 right-2 -bottom-1.5 h-1 rounded bg-[var(--opdf-akzent)]" aria-hidden />}
            <div className="flex items-start gap-1">
                <span className="mt-2 shrink-0 cursor-grab text-[var(--opdf-gedaempft)]" aria-hidden><GripVertical size={16} /></span>
                <span className="mt-1.5 w-5 shrink-0 text-right font-semibold tabular-nums">{nummer}.</span>
                <div className="min-w-0 flex-1 pt-1">
                    <p className="truncate font-semibold" title={q.name}>{q.name}</p>
                    <p className={`${leise} flex flex-wrap items-center gap-x-2 gap-y-0.5 ${q.fehler ? 'text-[var(--opdf-fehler)]' : ''}`}>
                        {q.laedt && <LoaderCircle size={12} className="animate-spin" aria-hidden />}
                        <span>{stand}</span>
                        {q.signiert && <Marke symbol={ShieldAlert} text={t('openintrapdf.binden.signiert')} />}
                        {q.formular && <Marke symbol={ClipboardList} text={t('openintrapdf.binden.formular')} />}
                        {q.passwort && <Marke symbol={Lock} text={t('openintrapdf.binden.passwort')} fehler />}
                    </p>
                </div>
                <div className="flex shrink-0 items-center">
                    <button type="button" className={`${symbolKnopf} h-8 w-8`} onClick={onHoch} disabled={gesperrt || nummer === 1}
                        aria-label={t('openintrapdf.binden.nachOben', { name: q.name })} title={t('openintrapdf.binden.nachOben', { name: q.name })}>
                        <ArrowUp size={15} />
                    </button>
                    <button type="button" className={`${symbolKnopf} h-8 w-8`} onClick={onRunter} disabled={gesperrt || letzte}
                        aria-label={t('openintrapdf.binden.nachUnten', { name: q.name })} title={t('openintrapdf.binden.nachUnten', { name: q.name })}>
                        <ArrowDown size={15} />
                    </button>
                    {onEntfernen && (
                        <button type="button" className={`${symbolKnopf} h-8 w-8`} onClick={onEntfernen} disabled={gesperrt}
                            aria-label={t('openintrapdf.binden.entfernen', { name: q.name })} title={t('openintrapdf.binden.entfernen', { name: q.name })}>
                            <X size={15} />
                        </button>
                    )}
                </div>
            </div>
            <div className="mt-1.5 pl-7">
                <label htmlFor={feldId} className="sr-only">{t('openintrapdf.binden.bereich', { name: q.name })}</label>
                <input id={feldId} value={q.bereichText} disabled={gesperrt || !!q.fehler} placeholder={t('openintrapdf.binden.bereichPlatzhalter')}
                    aria-invalid={ungueltig || undefined} aria-describedby={hinweisId}
                    onChange={e => onBereich(e.target.value)} className={`${eingabe} h-8 w-full text-xs`} />
                <p id={hinweisId} className={`${leise} mt-0.5 ${ungueltig ? 'text-[var(--opdf-fehler)]' : ''}`} role={ungueltig ? 'alert' : undefined}>
                    {ungueltig
                        ? (q.seitenzahl !== undefined
                            ? t('openintrapdf.binden.bereichUngueltig', { count: q.seitenzahl })
                            : t('openintrapdf.binden.bereichUngueltigOhneZahl'))
                        : t('openintrapdf.binden.bereichHinweis')}
                </p>
            </div>
        </li>
    );
}

function Marke({ symbol: Symbol, text, fehler = false }: { symbol: typeof ShieldAlert; text: string; fehler?: boolean }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded px-1 ${fehler ? 'bg-[var(--opdf-fehler-hg)] text-[var(--opdf-fehler)]' : 'bg-[var(--opdf-warn-hg)] text-[var(--opdf-warn-text)]'}`}>
            <Symbol size={11} aria-hidden />{text}
        </span>
    );
}

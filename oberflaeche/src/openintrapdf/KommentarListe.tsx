// SPDX-License-Identifier: Apache-2.0
//
// Die Kommentarliste: gespeicherte Anmerkungen des Dokuments und die neuen
// aus dem Entwurf, Antworten unter ihrer Ursprungsanmerkung. Ein Klick auf
// den Kopf eines Eintrags springt zur Stelle; der Fokus bleibt in der
// Liste, damit man mit der Tastatur weitergehen kann (Konzept Kap. 02).
//
// Ohne `entwurf` ist die Liste rein lesend (Wiki, Recht `view`, Fähigkeit
// fehlt). Mit `entwurf` gibt es Antworten, Erledigt, Text ändern, Löschen —
// alles nur als Befehl im Entwurf, gespeichert wird erst auf Wunsch.
//
// Wem eine gespeicherte Anmerkung gehört, weiß nur der Server (Vertrag:
// Urheberschaft in `pdf_annotation_authors`). Mit Recht `comment` werden
// Ändern und Löschen deshalb auch für gespeicherte angeboten; lehnt der
// Server sie ab, zeigt der Arbeitsplatz das verständlich an.
//
// Sortieren und Filtern (Etappe 8): nach Seite, Datum oder Autor; Filter
// nach Status, Art, Autor und Freitext. Die Filter wirken nur auf die
// Liste; die Seite zeigt weiter alles — außer „Erledigte auf der Seite
// ausblenden“, das der Arbeitsplatz an die Leseansicht reicht (nur
// Anzeige, gespeichert wird nichts). Die Sortierung wird je Gerät gemerkt,
// die Filter nicht.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, NotebookPen, Stamp } from 'lucide-react';
import { ART_NAME } from './anmerkungen';
import type { AnmerkungsBefehl, AnmerkungsEntwurf, Statuswert } from './anmerkungen';
import { ART_GRUPPE, fadenStatus, istStatusmarke } from './kommentare';
import type { ArtGruppe, FadenStatus, Kommentar } from './kommentare';
import { Hinweis } from './Werkzeugleiste';
import { eingabe, knopf, leise } from './stil';
import type { PdfZugriff } from './typen';

export interface ListenEntwurf {
    anmerkungen: AnmerkungsEntwurf;
    zugriff: Exclude<PdfZugriff, 'view'>;
    /** Kennung (`tmp-N`), deren Textfeld den Fokus bekommen soll — frisch angelegt. */
    fokus: string | null;
    onFokusErledigt: () => void;
    onBefehl: (b: AnmerkungsBefehl) => void;
    /** Antwort auf einen Eintrag anlegen; der Arbeitsplatz vergibt die Kennung. */
    onAntworten: (auf: { id: string; page: number; rect: number[] | undefined }) => void;
}

interface Props {
    laden: (fortschritt: (seite: number, gesamt: number) => void) => Promise<Kommentar[]>;
    /** `seite` ab 1 im gespeicherten Dokument. */
    onZuStelle: (seite: number, rechteck?: number[]) => void;
    entwurf?: ListenEntwurf;
    /** Warum es keine Werkzeuge gibt, obwohl das Recht da wäre. */
    gesperrt?: string;
    /** Häkchen „Erledigte auf der Seite ausblenden“ (Etappe 8); fehlt es, gibt es das Häkchen nicht. */
    erledigteAusblenden?: { an: boolean; setzen: (an: boolean) => void };
}

export type Sortierung = 'seite' | 'datum' | 'autor';
export type StatusFilter = 'alle' | 'offen' | 'erledigt';
export type ArtFilter = 'alle' | ArtGruppe;

export const SORTIERUNG_SPEICHER = 'openintrapdf.kommentare.sortierung';
const SORTIERUNGEN: readonly Sortierung[] = ['seite', 'datum', 'autor'];
const STATUS_FILTER: readonly StatusFilter[] = ['alle', 'offen', 'erledigt'];
const ART_FILTER: readonly ArtFilter[] = ['alle', 'notiz', 'markierung', 'zeichnung', 'stempel', 'postit'];

export function sortierungLesen(): Sortierung {
    try {
        const w = localStorage.getItem(SORTIERUNG_SPEICHER);
        return SORTIERUNGEN.includes(w as Sortierung) ? (w as Sortierung) : 'seite';
    } catch {
        return 'seite';
    }
}

export function sortierungMerken(s: Sortierung): void {
    try {
        localStorage.setItem(SORTIERUNG_SPEICHER, s);
    } catch {
        // Privates Fenster o. Ä.: Die Wahl gilt dann nur bis zum Schließen.
    }
}

/** Ein Eintrag der Liste — gespeichert oder aus dem Entwurf. */
interface Eintrag {
    id: string;
    page: number;
    art: string;
    autor: string;
    datum: Date | null;
    /** Gespeicherter Text (bei Entwurfseinträgen der aktuelle). */
    text: string;
    entwurf: boolean;
    rechteck?: number[];
    antwortAuf?: string;
    antworten: Eintrag[];
    /** Nur an der Wurzel: der Status im PDF und der daraus (mit Entwurf) wirksame. */
    marke: FadenStatus | null;
    status: Statuswert;
}

function eintraegeBauen(bestand: readonly Kommentar[], entwurf: AnmerkungsEntwurf | undefined): Eintrag[] {
    const alle = new Map<string, Eintrag>();
    for (const k of bestand) {
        if (istStatusmarke(k)) continue;
        alle.set(k.id, {
            id: k.id, page: k.seite - 1, art: k.art, autor: k.autor, datum: k.datum, text: k.text, entwurf: false, rechteck: k.rechteck,
            antwortAuf: k.antwortAuf, antworten: [], marke: null, status: 'none',
        });
    }
    for (const a of entwurf?.neue ?? []) {
        // Ein Link ist kein Kommentar (Etappe 9): Er erscheint als Umrandung in der Leseansicht.
        if (a.kind === 'link') continue;
        // Ein Stempel trägt sein Label; `contents` schreibt der Server beim Speichern.
        const text = a.kind === 'stamp' ? (a.stamp?.label ?? '') : a.contents;
        alle.set(a.client_id, {
            id: a.client_id, page: a.page, art: ART_NAME[a.kind], autor: '', datum: null, text, entwurf: true, rechteck: a.rect,
            antwortAuf: a.reply_to ?? undefined, antworten: [], marke: null, status: 'none',
        });
    }
    const wurzeln: Eintrag[] = [];
    for (const e of alle.values()) {
        const eltern = e.antwortAuf ? alle.get(e.antwortAuf) : undefined;
        if (eltern && eltern !== e) eltern.antworten.push(e);
        else wurzeln.push(e);
    }
    // Status nur am Faden (Wurzel): aus der neuesten Statusmarke im PDF,
    // überlagert von einer Änderung im Entwurf (Etappe 8).
    for (const w of wurzeln) {
        if (w.entwurf) continue;
        w.marke = fadenStatus(bestand, w.id);
        w.status = entwurf?.status[w.id]?.state ?? (w.marke?.zustand === 'completed' ? 'completed' : 'none');
    }
    // Nach Seite; innerhalb einer Seite bleibt die Lesereihenfolge (Bestand vor Entwurf).
    return wurzeln.sort((a, b) => a.page - b.page);
}

/** Ob ein Faden (mit Antworten) zu den Filtern passt. */
function passt(e: Eintrag, f: { status: StatusFilter; art: ArtFilter; autoren: ReadonlySet<string>; text: string; sie: string }): boolean {
    if (f.status === 'offen' && e.status === 'completed') return false;
    if (f.status === 'erledigt' && e.status !== 'completed') return false;
    if (f.art !== 'alle' && ART_GRUPPE[e.art] !== f.art) return false;
    const faden = [e, ...e.antworten];
    const name = (x: Eintrag) => (x.entwurf ? f.sie : x.autor);
    if (f.autoren.size && !faden.some(x => f.autoren.has(name(x)))) return false;
    if (f.text) {
        const suche = f.text.toLowerCase();
        if (!faden.some(x => x.text.toLowerCase().includes(suche))) return false;
    }
    return true;
}

function sortieren(liste: Eintrag[], s: Sortierung, sie: string): Eintrag[] {
    const aus = [...liste];
    if (s === 'datum') {
        // Neueste zuerst; ein Entwurf ist das Neueste, ohne Datum kommt zuletzt.
        const wert = (e: Eintrag) => (e.entwurf ? Number.POSITIVE_INFINITY : e.datum ? e.datum.getTime() : Number.NEGATIVE_INFINITY);
        aus.sort((a, b) => wert(b) - wert(a));
    } else if (s === 'autor') {
        const name = (e: Eintrag) => (e.entwurf ? sie : e.autor);
        aus.sort((a, b) => name(a).localeCompare(name(b)) || a.page - b.page);
    }
    return aus;
}

export function KommentarListe({ laden, onZuStelle, entwurf, gesperrt, erledigteAusblenden }: Props) {
    const { t, i18n } = useTranslation();
    const [liste, setListe] = useState<Kommentar[] | null>(null);
    const [fehler, setFehler] = useState(false);
    const [stand, setStand] = useState<{ seite: number; gesamt: number } | null>(null);
    const [sortierung, setSortierungIntern] = useState<Sortierung>(sortierungLesen);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
    const [artFilter, setArtFilter] = useState<ArtFilter>('alle');
    const [autoren, setAutoren] = useState<ReadonlySet<string>>(() => new Set());
    const [suchtext, setSuchtext] = useState('');
    const sortierungSetzen = (s: Sortierung) => {
        setSortierungIntern(s);
        sortierungMerken(s);
    };

    useEffect(() => {
        let aus = false;
        laden((seite, gesamt) => { if (!aus) setStand({ seite, gesamt }); })
            .then(l => { if (!aus) setListe(l); }, () => { if (!aus) setFehler(true); });
        return () => { aus = true; };
    }, [laden]);

    const sie = t('openintrapdf.kommentare.sie');
    const eintraege = useMemo(() => eintraegeBauen(liste ?? [], entwurf?.anmerkungen), [liste, entwurf?.anmerkungen]);
    const bestandAnzahl = useMemo(() => (liste ?? []).filter(k => !istStatusmarke(k)).length, [liste]);
    const alleAutoren = useMemo(() => {
        const namen = new Set<string>();
        const sammeln = (e: Eintrag) => {
            namen.add(e.entwurf ? sie : e.autor);
            e.antworten.forEach(sammeln);
        };
        eintraege.forEach(sammeln);
        return [...namen].sort((a, b) => a.localeCompare(b));
    }, [eintraege, sie]);
    const sichtbar = useMemo(
        () => sortieren(eintraege.filter(e => passt(e, { status: statusFilter, art: artFilter, autoren, text: suchtext.trim(), sie })), sortierung, sie),
        [eintraege, statusFilter, artFilter, autoren, suchtext, sortierung, sie],
    );

    if (fehler) return <p className={leise}>{t('openintrapdf.kommentare.fehler')}</p>;
    if (!liste) {
        return (
            <p className={leise} role="status">
                {stand && stand.gesamt > 1
                    ? t('openintrapdf.kommentare.sucht', { seite: stand.seite, gesamt: stand.gesamt })
                    : t('openintrapdf.kommentare.laedt')}
            </p>
        );
    }

    const datum = new Intl.DateTimeFormat(i18n.language || 'de', { dateStyle: 'short', timeStyle: 'short' });
    const imEntwurf = entwurf ? entwurf.anmerkungen.neue.length : 0;
    const autorUmschalten = (name: string, an: boolean) => setAutoren(alt => {
        const neu = new Set(alt);
        if (an) neu.add(name);
        else neu.delete(name);
        return neu;
    });
    return (
        <div>
            <p className={`${leise} mb-2`}>
                {bestandAnzahl ? t('openintrapdf.kommentare.anzahl', { count: bestandAnzahl }) : t('openintrapdf.kommentare.keine')}
                {imEntwurf > 0 && ` · ${t('openintrapdf.kommentare.imEntwurf', { count: imEntwurf })}`}
            </p>
            {gesperrt && <div className="mb-3"><Hinweis art="info">{gesperrt}</Hinweis></div>}
            {!entwurf && <p className={`${leise} mb-3`}>{t('openintrapdf.kommentare.nurLesen')}</p>}
            {entwurf?.zugriff === 'comment' && <p className={`${leise} mb-3`}>{t('openintrapdf.kommentare.fremdeHinweis')}</p>}

            {eintraege.length > 0 && (
                <div className="mb-3 space-y-2 text-xs" role="group" aria-label={t('openintrapdf.kommentare.filter.titel')}>
                    <div className="flex items-center gap-2">
                        <label className="flex flex-1 items-center gap-1">
                            <span className={leise}>{t('openintrapdf.kommentare.sortierung.titel')}</span>
                            <select value={sortierung} onChange={e => sortierungSetzen(e.target.value as Sortierung)} className={`${eingabe} h-7 flex-1 text-xs`}>
                                {SORTIERUNGEN.map(s => <option key={s} value={s}>{t(`openintrapdf.kommentare.sortierung.${s}`)}</option>)}
                            </select>
                        </label>
                        <span className="shrink-0 tabular-nums" role="status">
                            {t('openintrapdf.kommentare.zaehler', { sichtbar: sichtbar.length, gesamt: eintraege.length })}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <label className="flex flex-1 items-center gap-1">
                            <span className="sr-only">{t('openintrapdf.kommentare.filter.status')}</span>
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className={`${eingabe} h-7 w-full text-xs`}>
                                {STATUS_FILTER.map(s => <option key={s} value={s}>{t(`openintrapdf.kommentare.filter.statusWert.${s}`)}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-1 items-center gap-1">
                            <span className="sr-only">{t('openintrapdf.kommentare.filter.art')}</span>
                            <select value={artFilter} onChange={e => setArtFilter(e.target.value as ArtFilter)} className={`${eingabe} h-7 w-full text-xs`}>
                                {ART_FILTER.map(a => <option key={a} value={a}>{t(`openintrapdf.kommentare.filter.artWert.${a}`)}</option>)}
                            </select>
                        </label>
                    </div>
                    <label className="block">
                        <span className="sr-only">{t('openintrapdf.kommentare.filter.text')}</span>
                        <input type="search" value={suchtext} onChange={e => setSuchtext(e.target.value)}
                            placeholder={t('openintrapdf.kommentare.filter.text')} className={`${eingabe} h-7 w-full text-xs`} />
                    </label>
                    {alleAutoren.length > 1 && (
                        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
                            <legend className={`${leise} mb-0.5`}>{t('openintrapdf.kommentare.filter.autor')}</legend>
                            {alleAutoren.map(name => (
                                <label key={name} className="inline-flex items-center gap-1">
                                    <input type="checkbox" checked={autoren.has(name)} onChange={e => autorUmschalten(name, e.target.checked)} />
                                    <span>{name || t('openintrapdf.kommentare.ohneAutor')}</span>
                                </label>
                            ))}
                        </fieldset>
                    )}
                    {erledigteAusblenden && (
                        <label className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={erledigteAusblenden.an} onChange={e => erledigteAusblenden.setzen(e.target.checked)} />
                            <span>{t('openintrapdf.kommentare.erledigteAusblenden')}</span>
                        </label>
                    )}
                </div>
            )}

            {eintraege.length > 0 && sichtbar.length === 0 && <p className={`${leise} mb-2`} role="status">{t('openintrapdf.kommentare.filter.keineTreffer')}</p>}
            <ul className="space-y-2">
                {sichtbar.map(e => (
                    <EintragZeile key={e.id} eintrag={e} entwurf={entwurf} datum={datum} onZuStelle={onZuStelle} />
                ))}
            </ul>
        </div>
    );
}

function EintragZeile({ eintrag: e, entwurf, datum, onZuStelle, tiefe = 0 }: {
    eintrag: Eintrag;
    entwurf?: ListenEntwurf;
    datum: Intl.DateTimeFormat;
    onZuStelle: (seite: number, rechteck?: number[]) => void;
    tiefe?: number;
}) {
    const { t } = useTranslation();
    const a = entwurf?.anmerkungen;
    const geloescht = !!a?.geloescht[e.id];
    const textEntwurf = a?.texte[e.id];
    const text = e.entwurf ? e.text : (textEntwurf?.contents ?? e.text);
    const gespeichert: Statuswert = e.marke?.zustand === 'completed' ? 'completed' : 'none';
    const statusEntwurf = a?.status[e.id]?.state;
    const erledigt = e.status === 'completed';
    const [bearbeitet, setBearbeitet] = useState(false);
    const textfeld = useRef<HTMLTextAreaElement>(null);
    const seite = e.page + 1;

    // Frisch angelegt: Fokus ins Textfeld (Konzept Kap. 02).
    useEffect(() => {
        if (entwurf?.fokus === e.id && textfeld.current) {
            textfeld.current.focus();
            entwurf.onFokusErledigt();
        }
    }, [entwurf, e.id]);

    const textAendern = (contents: string) => entwurf?.onBefehl({
        art: 'anmerkungText', ziel: e.id, page: e.page, contents, original: e.entwurf ? undefined : e.text,
    });

    // Der Text eines Stempels ist nicht bearbeitbar (der Server lehnt `update`
    // darauf ab): Löschen und neu setzen. Post-it und Stempel tragen ihr Symbol.
    const stempel = e.art === 'stempel';
    const ArtSymbol = e.art === 'postit' ? NotebookPen : stempel ? Stamp : null;
    const zeigtTextfeld = entwurf && !geloescht && !stempel && (e.entwurf || bearbeitet);
    return (
        <li className={tiefe ? 'ml-4' : ''}>
            <div className={`rounded-md border-l-[3px] bg-[var(--opdf-app)] px-3 py-2
                ${e.entwurf ? 'border-[var(--opdf-akzent)]' : 'border-[#deb23c]'} ${geloescht || erledigt ? 'opacity-60' : ''}`}
                data-erledigt={erledigt ? 'ja' : undefined}>
                <button type="button" onClick={() => onZuStelle(seite, e.rechteck)} className="w-full text-left hover:underline"
                    aria-label={t('openintrapdf.kommentare.zurStelle', { seite })}>
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-semibold truncate">
                            {erledigt && <CircleCheck size={14} aria-hidden className="inline-block align-[-3px] mr-1 text-[var(--opdf-erfolg)]" />}
                            {e.entwurf ? t('openintrapdf.kommentare.sie') : (e.autor || t('openintrapdf.kommentare.ohneAutor'))}
                        </span>
                        <span className="shrink-0 text-[var(--opdf-gedaempft)]">
                            {e.entwurf ? t('openintrapdf.kommentare.entwurf') : (e.datum ? datum.format(e.datum) : '')}
                        </span>
                    </span>
                    {!zeigtTextfeld && text && (
                        <span className={`block mt-1 text-sm leading-snug line-clamp-4 whitespace-pre-line ${geloescht ? 'line-through' : ''}`}>{text}</span>
                    )}
                    <span className={`block mt-1 ${leise}`}>
                        {e.antwortAuf ? `${t('openintrapdf.kommentare.antwortAuf')} · ` : ''}
                        {ArtSymbol && <ArtSymbol size={12} aria-hidden className="inline-block align-[-2px] mr-1" />}
                        {t(`openintrapdf.kommentare.art.${e.art}`)} · {t('openintrapdf.kommentare.seite', { seite })}
                    </span>
                    {e.marke && e.marke.zustand !== 'none' && statusEntwurf === undefined && (
                        <span className={`block mt-0.5 ${leise}`}>
                            {t(`openintrapdf.kommentare.status.${e.marke.zustand}`, {
                                name: e.marke.autor || t('openintrapdf.kommentare.ohneAutor'),
                                datum: e.marke.datum ? datum.format(e.marke.datum) : '–',
                            })}
                        </span>
                    )}
                </button>
                {zeigtTextfeld && (
                    <label className="block mt-1">
                        <span className="sr-only">{t('openintrapdf.kommentare.textFeld')}</span>
                        <textarea ref={textfeld} value={text} rows={3} onChange={ev => textAendern(ev.target.value)}
                            placeholder={t('openintrapdf.kommentare.textPlatzhalter')}
                            className={`${eingabe} h-auto w-full py-1 leading-snug`} />
                    </label>
                )}
                {entwurf && (
                    <span className={`block mt-1 ${leise}`}>
                        {geloescht && t('openintrapdf.kommentare.wirdGeloescht')}
                        {!geloescht && textEntwurf && t('openintrapdf.kommentare.geaendert')}
                        {!geloescht && statusEntwurf === 'completed' && ` ${t('openintrapdf.kommentare.erledigtEntwurf')}`}
                        {!geloescht && statusEntwurf === 'none' && ` ${t('openintrapdf.kommentare.wiederOffenEntwurf')}`}
                    </span>
                )}
                {entwurf && (
                    <div className="mt-1 flex flex-wrap gap-x-1">
                        {geloescht ? (
                            <button type="button" className={`${knopf} h-7 px-2 text-xs`}
                                onClick={() => entwurf.onBefehl({ art: 'anmerkungBehalten', ziel: e.id })}>
                                {t('openintrapdf.kommentare.behalten')}
                            </button>
                        ) : (
                            <>
                                <button type="button" className={`${knopf} h-7 px-2 text-xs`}
                                    onClick={() => entwurf.onAntworten({ id: e.id, page: e.page, rect: e.rechteck })}>
                                    {t('openintrapdf.kommentare.antworten')}
                                </button>
                                {!e.entwurf && !e.antwortAuf && (
                                    <button type="button" className={`${knopf} h-7 px-2 text-xs`}
                                        onClick={() => entwurf.onBefehl({
                                            art: 'anmerkungStatus', ref: e.id, page: e.page, gespeichert,
                                            state: erledigt ? 'none' : 'completed',
                                        })}>
                                        {erledigt ? t('openintrapdf.kommentare.wiederOeffnen') : t('openintrapdf.kommentare.erledigtSetzen')}
                                    </button>
                                )}
                                {!e.entwurf && !stempel && (
                                    <button type="button" className={`${knopf} h-7 px-2 text-xs`} aria-pressed={bearbeitet}
                                        onClick={() => setBearbeitet(b => !b)}>
                                        {bearbeitet ? t('openintrapdf.kommentare.textFertig') : t('openintrapdf.kommentare.textAendern')}
                                    </button>
                                )}
                                <button type="button" className={`${knopf} h-7 px-2 text-xs text-[var(--opdf-fehler)]`}
                                    onClick={() => entwurf.onBefehl({ art: 'anmerkungLoeschen', ziel: e.id, page: e.page })}>
                                    {t('openintrapdf.kommentare.loeschen')}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
            {e.antworten.length > 0 && (
                <ul className="mt-2 space-y-2">
                    {e.antworten.map(k => (
                        <EintragZeile key={k.id} eintrag={k} entwurf={entwurf} datum={datum} onZuStelle={onZuStelle} tiefe={tiefe + 1} />
                    ))}
                </ul>
            )}
        </li>
    );
}

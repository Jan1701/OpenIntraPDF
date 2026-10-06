// SPDX-License-Identifier: Apache-2.0
//
// Werkzeuggruppe „Exportieren“ (Etappe 4).
//
// Drei Schritte untereinander in derselben Gruppe: Ziel, Seiten und
// „Analysieren“ → der Auftrag läuft (wie bei der OCR) → Vorschau aus dem
// Modell mit Warnungen, darunter Format, Ziel und „Exportieren“. Im Writer
// sind die Blöcke in Lesereihenfolge zu sehen, ein Klick zeigt die Stelle
// im PDF; bei der Tabelle steht jedes Raster mit Rohwerten, Kopfzeilen und
// Spaltentyp — Zahl wird nur, was hier als Zahl gewählt ist (Konzept
// Kap. 05). Fehlt die Fähigkeit, steht hier nur der Grund.

import { useTranslation } from 'react-i18next';
import { FileOutput, LoaderCircle, Play, RotateCcw } from 'lucide-react';
import { FORMATE, TRENNZEICHEN, seitenOhneText, tabellenAus, warnungLesen, zahlDeuten } from './exportieren';
import type { Export, ExportZiel } from './exportieren';
import { Laeuft } from './TexterkennungWerkzeug';
import type { ExportFormat, ExportWarnung, Modell, ModellTabelle, OcrSprache, PdfFaehigkeit, SeitenLage, SpaltenTyp, ZahlenGebiet } from './typen';
import { Hinweis } from './Werkzeugleiste';
import { abschnitt, eingabe, hauptKnopf, leise, rahmenKnopf } from './stil';

const SPRACHEN: OcrSprache[] = ['deu+eng', 'deu', 'eng'];
const TYPEN: SpaltenTyp[] = ['text', 'number', 'date'];
const GEBIETE: ZahlenGebiet[] = ['de', 'en'];
/** Mehr Zeilen je Tabelle zeigt die Vorschau nicht — sie ist zum Prüfen, nicht zum Lesen. */
const VORSCHAU_ZEILEN = 30;

interface Props {
    /** Die Fähigkeit fehlt: nur der Hinweis, keine Knöpfe. */
    nichtVerfuegbar: PdfFaehigkeit | null;
    exp: Export;
    /** Gespeicherte Fassung, aus der exportiert wird. */
    version: number | undefined;
    /** Ein Seiten- oder Anmerkungsentwurf ist offen — er ist NICHT im Export. */
    entwurfOffen: boolean;
    /** Zur Stelle im PDF (Seite ab 1, Lage im angezeigten Seitenraum). */
    onZuStelle: (seite: number, lage: SeitenLage | null) => void;
    /** Ziel erfragen und ausgeben. */
    onExportieren: () => void;
}

const seitenText = (seiten: number[]) => [...seiten].sort((a, b) => a - b).map(p => p + 1).join(', ');

export function ExportWerkzeug(p: Props) {
    const { t } = useTranslation();
    const { exp } = p;
    const { auftrag } = exp;

    if (p.nichtVerfuegbar) {
        const { state, reason } = p.nichtVerfuegbar;
        return (
            <div className="space-y-3 text-sm">
                <p className={leise}>{t('openintrapdf.export.einleitung')}</p>
                <Hinweis art="warnung">
                    {state === 'requires_worker'
                        ? t('openintrapdf.export.nichtVerfuegbar.requires_worker')
                        : t('openintrapdf.export.nichtVerfuegbar.sonst', { grund: reason || state })}
                </Hinweis>
            </div>
        );
    }

    const inAuswahl = auftrag.art === 'keiner' || auftrag.art === 'startet';
    return (
        <div className="space-y-5 text-sm">
            <p className={leise}>{t('openintrapdf.export.einleitung')}</p>
            {p.version !== undefined && (
                <Hinweis art="info">
                    {t('openintrapdf.export.fassung', { version: p.version })}
                    {p.entwurfOffen && ` ${t('openintrapdf.export.fassungEntwurf')}`}
                </Hinweis>
            )}
            {exp.meldung && (
                <div role="status"><Hinweis art={exp.meldung.art}>{t(`openintrapdf.export.${exp.meldung.schluessel}`, exp.meldung.werte)}</Hinweis></div>
            )}
            {inAuswahl && <Auswahl {...p} />}
            {auftrag.art === 'laeuft' && (
                <Laeuft praefix="export" auftrag={auftrag.auftrag} abbruch={auftrag.abbruch} abfrageFehler={auftrag.abfrageFehler} onAbbrechen={() => void exp.abbrechen()} />
            )}
            {auftrag.art === 'fertig' && <Vorschau {...p} />}
            {auftrag.art === 'fehlgeschlagen' && (
                <div className="space-y-3">
                    <div role="alert">
                        <Hinweis art="fehler">
                            {t('openintrapdf.export.fehlgeschlagen')}
                            {auftrag.auftrag.error && ` ${t('openintrapdf.export.fehlerGrund', { grund: auftrag.auftrag.error })}`}
                        </Hinweis>
                    </div>
                    <button type="button" className={rahmenKnopf} onClick={exp.zuruecksetzen}>{t('openintrapdf.export.neueAnalyse')}</button>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Schritt 1: Ziel, Seiten, Sprache, Analysieren
// ---------------------------------------------------------------------

function Auswahl({ exp }: Props) {
    const { t } = useTranslation();
    const startet = exp.auftrag.art === 'startet';
    const seitenUngueltig = exp.seiten === 'ungueltig';
    const ziele: ExportZiel[] = ['writer', 'tabelle'];

    return (
        <>
            <fieldset>
                <legend className={`${abschnitt} mb-2`}>{t('openintrapdf.export.zielTitel')}</legend>
                <div className="grid gap-2">
                    {ziele.map(z => (
                        <label key={z} className={`flex gap-3 items-start rounded-md border p-2 cursor-pointer hover:bg-[var(--opdf-weich)]
                            ${exp.ziel === z ? 'border-[var(--opdf-akzent)] bg-[var(--opdf-weich)]' : 'border-[var(--opdf-linie)]'}`}>
                            <input type="radio" name="opdf-export-ziel" className="mt-1" value={z} checked={exp.ziel === z} disabled={startet}
                                onChange={() => exp.zielSetzen(z)} />
                            <span className="min-w-0">
                                <span className="block font-semibold">{t(`openintrapdf.export.ziel.${z}`)}</span>
                                <span className={`${leise} block`}>{t(`openintrapdf.export.zielHinweis.${z}`)}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <div>
                <label htmlFor="opdf-export-seiten" className={`${abschnitt} block mb-2`}>{t('openintrapdf.export.seitenTitel')}</label>
                <input id="opdf-export-seiten" value={exp.seitenText} disabled={startet} placeholder={t('openintrapdf.export.seitenPlatzhalter')}
                    aria-invalid={seitenUngueltig || undefined} aria-describedby="opdf-export-seiten-hinweis"
                    onChange={e => exp.setSeitenText(e.target.value)} className={`${eingabe} w-full`} />
                <p id="opdf-export-seiten-hinweis" className={`${leise} mt-1`} role={seitenUngueltig ? 'alert' : undefined}>
                    {seitenUngueltig ? t('openintrapdf.export.seitenUngueltig') : t('openintrapdf.export.seitenHinweis')}
                </p>
            </div>

            <div>
                <label htmlFor="opdf-export-sprache" className={`${abschnitt} block mb-2`}>{t('openintrapdf.ocr.spracheTitel')}</label>
                <select id="opdf-export-sprache" value={exp.sprache} disabled={startet}
                    onChange={e => exp.setSprache(e.target.value as OcrSprache)} className={`${eingabe} w-full`}>
                    {SPRACHEN.map(s => <option key={s} value={s}>{t(`openintrapdf.ocr.sprache.${s}`)}</option>)}
                </select>
                <p className={`${leise} mt-1`}>{t('openintrapdf.export.spracheHinweis')}</p>
            </div>

            {exp.startFehler && (
                <div role="alert">
                    <Hinweis art="fehler">
                        {exp.startFehler.grund === 'rechteBits'
                            ? t('openintrapdf.schutz.gesperrtKopieren')
                            : exp.startFehler.grund === 'rechteKennwort'
                            ? `${t('openintrapdf.schutz.abgelehnt')} ${t('openintrapdf.schutz.gesperrtKopieren')}`
                            : (exp.startFehler.grund === 'sonst' && exp.startFehler.meldung)
                            || t(`openintrapdf.export.start.${exp.startFehler.grund === 'seitenMitText' ? 'sonst' : exp.startFehler.grund}`)}
                    </Hinweis>
                </div>
            )}

            <button type="button" className={`${hauptKnopf} w-full`} disabled={startet || seitenUngueltig} onClick={() => void exp.starten()}>
                {startet ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
                {t(startet ? 'openintrapdf.export.startet' : 'openintrapdf.export.analysieren')}
            </button>
            <p className={leise}>{t('openintrapdf.export.startHinweis')}</p>
        </>
    );
}

// ---------------------------------------------------------------------
// Schritt 2 und 3: Vorschau, Warnungen, Format, Ziel, Exportieren
// ---------------------------------------------------------------------

function Vorschau({ exp, onZuStelle, onExportieren }: Props) {
    const { t } = useTranslation();
    const { modell, fertigerAuftrag, exportStand, rumpf } = exp;
    const meta = fertigerAuftrag?.result?.meta ?? {};
    const daten = modell.daten;

    if (modell.laedt || (!daten && !modell.fehler)) {
        return (
            <p className="flex items-center gap-2 text-[var(--opdf-gedaempft)]" role="status">
                <LoaderCircle size={16} className="animate-spin" aria-hidden /> {t('openintrapdf.export.modellLaedt')}
            </p>
        );
    }
    if (!daten) {
        return (
            <div className="space-y-3">
                <div role="alert"><Hinweis art="fehler">{t('openintrapdf.export.modellFehler')}</Hinweis></div>
                <button type="button" className={rahmenKnopf} onClick={exp.modellErneut}>{t('openintrapdf.aktion.erneut')}</button>
                <button type="button" className={rahmenKnopf} onClick={exp.zuruecksetzen}>{t('openintrapdf.export.neueAnalyse')}</button>
            </div>
        );
    }

    const zaehler = zusammenfassung(daten, meta);
    const teile = [
        t('openintrapdf.export.zaehler.seiten', { count: zaehler.seiten }),
        t('openintrapdf.export.zaehler.absaetze', { count: zaehler.absaetze }),
        zaehler.ueberschriften > 0 && t('openintrapdf.export.zaehler.ueberschriften', { count: zaehler.ueberschriften }),
        zaehler.listen > 0 && t('openintrapdf.export.zaehler.listen', { count: zaehler.listen }),
        t('openintrapdf.export.zaehler.tabellen', { count: zaehler.tabellen }),
    ].filter(Boolean);
    const exportiert = exportStand.art === 'laeuft';
    const formatFehler = 'fehler' in rumpf ? rumpf.fehler : null;

    return (
        <div className="space-y-5">
            <div>
                <p className={`${abschnitt} mb-1`}>{t('openintrapdf.export.vorschauTitel')}</p>
                <p>{teile.join(' · ')}</p>
            </div>

            <Warnungen liste={[...(meta.warnings ?? []), ...daten.warnungen]} unsicher={meta.low_confidence ?? []} ocrSeiten={meta.ocr_pages ?? []}
                ohneText={seitenOhneText(daten)} />

            {exp.ziel === 'writer'
                ? <WriterVorschau modell={daten} onZuStelle={onZuStelle} />
                : <TabellenVorschau exp={exp} modell={daten} onZuStelle={onZuStelle} />}

            <div className="space-y-3 border-t border-[var(--opdf-linie)] pt-4">
                <p className={abschnitt}>{t('openintrapdf.export.ausgabeTitel')}</p>
                <label className="block">
                    <span className="block mb-1">{t('openintrapdf.export.formatTitel')}</span>
                    <select value={exp.format} disabled={exportiert} onChange={e => exp.setFormat(e.target.value as ExportFormat)}
                        aria-label={t('openintrapdf.export.formatTitel')} className={`${eingabe} w-full`}>
                        {FORMATE[exp.ziel].map(f => <option key={f} value={f}>{t(`openintrapdf.export.format.${f}`)}</option>)}
                    </select>
                </label>
                {exp.format === 'csv' && (
                    <>
                        <label className="block">
                            <span className="block mb-1">{t('openintrapdf.export.trennzeichenTitel')}</span>
                            <select value={exp.csv.delimiter} disabled={exportiert} onChange={e => exp.setCsv({ ...exp.csv, delimiter: e.target.value })}
                                aria-label={t('openintrapdf.export.trennzeichenTitel')} className={`${eingabe} w-full`}>
                                {TRENNZEICHEN.map(z => <option key={z} value={z}>{t(`openintrapdf.export.trennzeichen.${z === ';' ? 'semikolon' : z === ',' ? 'komma' : 'tab'}`)}</option>)}
                            </select>
                        </label>
                        {exp.uebernommene.length > 1 && (
                            <label className="block">
                                <span className="block mb-1">{t('openintrapdf.export.csvTabelle')}</span>
                                <select value={exp.csv.table ?? ''} disabled={exportiert} onChange={e => exp.setCsv({ ...exp.csv, table: e.target.value === '' ? null : Number(e.target.value) })}
                                    aria-label={t('openintrapdf.export.csvTabelle')} className={`${eingabe} w-full`}>
                                    <option value="">{t('openintrapdf.export.csvTabelleWaehlen')}</option>
                                    {exp.uebernommene.map(i => <option key={i} value={i}>{t('openintrapdf.export.tabelle', { index: i + 1 })}</option>)}
                                </select>
                            </label>
                        )}
                    </>
                )}
                {formatFehler && formatFehler !== 'keinModell' && (
                    <div role="alert"><Hinweis art="warnung">{t(`openintrapdf.export.rumpfFehler.${formatFehler}`)}</Hinweis></div>
                )}

                {exportStand.art === 'fertig' && (
                    <div role="status" className="space-y-2">
                        <Hinweis art="erfolg">{t('openintrapdf.export.erfolg', { name: exportStand.ergebnis.name })}</Hinweis>
                        <Warnungen liste={exportStand.ergebnis.warnings ?? []} unsicher={[]} ocrSeiten={[]} ohneText={[]} />
                    </div>
                )}
                {exportStand.art === 'fehlgeschlagen' && (
                    <div role="alert" className="space-y-2">
                        <Hinweis art="fehler">
                            {t(`openintrapdf.export.exportFehler.${exportStand.fehler.grund}`)}
                            {exportStand.fehler.meldung && ` ${exportStand.fehler.meldung}`}
                        </Hinweis>
                        {exportStand.fehler.wiederholbar && (
                            <button type="button" className={rahmenKnopf} onClick={() => void exp.erneut()}>{t('openintrapdf.aktion.erneut')}</button>
                        )}
                    </div>
                )}

                <button type="button" className={`${hauptKnopf} w-full`} disabled={!!formatFehler || exportiert} onClick={onExportieren}>
                    {exportiert ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <FileOutput size={16} aria-hidden />}
                    {t(exportiert ? 'openintrapdf.export.exportiert' : 'openintrapdf.export.exportieren')}
                </button>
                <p className={leise}>{t('openintrapdf.export.exportHinweis')}</p>
                <button type="button" className={`${rahmenKnopf} w-full`} disabled={exportiert} onClick={exp.zuruecksetzen}>
                    <RotateCcw size={16} aria-hidden /> {t('openintrapdf.export.neueAnalyse')}
                </button>
            </div>
        </div>
    );
}

/** Zähler aus `result_meta`; fehlt etwas, zählt das Modell. */
function zusammenfassung(modell: Modell, meta: { pages?: number; paragraphs?: number; headings?: number; lists?: number; tables?: unknown[] }) {
    const bloecke = modell.seiten.flatMap(s => s.bloecke);
    const art = (a: 'absatz' | 'ueberschrift' | 'liste') => bloecke.filter(b => b.typ === 'absatz' && b.art === a).length;
    return {
        seiten: meta.pages ?? modell.seiten.length,
        absaetze: meta.paragraphs ?? art('absatz'),
        ueberschriften: meta.headings ?? art('ueberschrift'),
        listen: meta.lists ?? art('liste'),
        tabellen: meta.tables?.length ?? bloecke.filter(b => b.typ === 'tabelle').length,
    };
}

// ---------------------------------------------------------------------
// Warnungen — immer sichtbar
// ---------------------------------------------------------------------

/** `unsicher` und `ocrSeiten` zählen ab 0 (Server), `ohneText` ab 1 (Modell). */
function Warnungen({ liste, unsicher, ocrSeiten, ohneText }: { liste: ExportWarnung[]; unsicher: number[]; ocrSeiten: number[]; ohneText: number[] }) {
    const { t } = useTranslation();
    const codes = liste.map(warnungLesen).filter(w => w.code);
    if (!codes.length && !unsicher.length && !ocrSeiten.length && !ohneText.length) return null;
    return (
        <div className="space-y-2" role="status">
            {ohneText.length > 0 && <Hinweis art="warnung">{t('openintrapdf.export.seitenOhneText', { count: ohneText.length, seiten: ohneText.join(', ') })}</Hinweis>}
            {ocrSeiten.length > 0 && <Hinweis art="info">{t('openintrapdf.export.ocrSeiten', { count: ocrSeiten.length, seiten: seitenText(ocrSeiten) })}</Hinweis>}
            {unsicher.length > 0 && <Hinweis art="warnung">{t('openintrapdf.export.unsichereSeiten', { count: unsicher.length, seiten: seitenText(unsicher) })}</Hinweis>}
            {codes.map((w, i) => (
                <Hinweis key={`${w.code}-${i}`} art="warnung">
                    {t(`openintrapdf.export.warnung.${w.code}`, {
                        defaultValue: w.code,
                        ...(w.count !== undefined ? { count: w.count } : {}),
                        seiten: w.pages ? seitenText(w.pages) : '',
                        detail: w.detail ? t(`openintrapdf.export.warnung.detail.${w.detail}`, { defaultValue: w.detail }) : '',
                    })}
                </Hinweis>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------
// Writer: Blöcke in Lesereihenfolge
// ---------------------------------------------------------------------

function WriterVorschau({ modell, onZuStelle }: { modell: Modell; onZuStelle: Props['onZuStelle'] }) {
    const { t } = useTranslation();
    const eintraege = modell.seiten.flatMap(s => s.bloecke.map((block, i) => ({ block, seite: s.nr, key: `${s.nr}-${i}` })));
    if (!eintraege.length) return <Hinweis art="info">{t('openintrapdf.export.keineBloecke')}</Hinweis>;
    return (
        <ol className="space-y-1.5" aria-label={t('openintrapdf.export.bloeckeTitel')}>
            {eintraege.map(({ block, seite, key }) => {
                const art = block.typ === 'tabelle' ? 'tabelle' : block.art;
                const unsicher = block.typ === 'absatz' && block.unsicher;
                const wiederholt = block.typ === 'absatz' && block.wiederholt;
                return (
                    <li key={key}>
                        <button type="button" onClick={() => onZuStelle(seite, block.lage)} aria-label={t('openintrapdf.export.zurStelle', { seite })}
                            className={`w-full text-left rounded-md border-l-[3px] bg-[var(--opdf-app)] px-3 py-2 hover:bg-[var(--opdf-weich)] ${wiederholt ? 'opacity-60' : ''}
                                ${unsicher ? 'border-[var(--opdf-warn-text)]' : art === 'ueberschrift' ? 'border-[var(--opdf-akzent)]' : 'border-[var(--opdf-linie)]'}`}>
                            <span className={`flex items-baseline justify-between gap-2 ${leise}`}>
                                <span className="font-semibold uppercase tracking-wider text-[10px]">
                                    {t(`openintrapdf.export.block.${art}`)}
                                    {wiederholt && <span className="ml-2 normal-case tracking-normal font-normal">{t('openintrapdf.export.wiederholt')}</span>}
                                </span>
                                <span className="shrink-0">
                                    {unsicher && <span className="text-[var(--opdf-warn-text)] font-semibold mr-2">{t('openintrapdf.export.unsicher')}</span>}
                                    {t('openintrapdf.export.blockSeite', { seite })}
                                </span>
                            </span>
                            {block.typ === 'tabelle' ? (
                                <span className="block mt-1 text-sm">{t('openintrapdf.export.tabelleKurz', { index: block.index + 1, zeilen: block.zeilen.length, spalten: block.spalten })}</span>
                            ) : (
                                <span className={`block mt-1 text-sm leading-snug line-clamp-3 whitespace-pre-line ${art === 'ueberschrift' ? 'font-semibold' : ''}`}
                                    style={block.ebene > 0 && art !== 'ueberschrift' ? { paddingLeft: `${Math.min(block.ebene, 4) * 0.75}rem` } : undefined}>
                                    {art === 'liste' && '• '}{block.text}
                                </span>
                            )}
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

// ---------------------------------------------------------------------
// Tabelle: Raster je Tabelle mit übernehmen, Kopfzeilen, Spaltentyp
// ---------------------------------------------------------------------

function TabellenVorschau({ exp, modell, onZuStelle }: { exp: Export; modell: Modell; onZuStelle: Props['onZuStelle'] }) {
    const { t } = useTranslation();
    const liste = tabellenAus(modell);
    if (!liste.length) return <Hinweis art="warnung">{t('openintrapdf.export.keineTabellen')}</Hinweis>;
    return (
        <div className="space-y-4">
            <div className="flex rounded-lg border border-[var(--opdf-linie)] bg-[var(--opdf-app)] p-0.5 w-fit" role="group" aria-label={t('openintrapdf.export.zahlformatTitel')}>
                {GEBIETE.map(g => (
                    <button key={g} type="button" aria-pressed={exp.gebiet === g} onClick={() => exp.setGebiet(g)}
                        className={`h-8 px-3 rounded-md text-xs ${exp.gebiet === g ? 'bg-[var(--opdf-paneel)] text-[var(--opdf-akzent)] font-semibold shadow-sm' : ''}`}>
                        {t(`openintrapdf.export.zahlformat.${g}`)}
                    </button>
                ))}
            </div>
            {liste.map(({ tabelle, seite }) => (
                <TabellenRaster key={tabelle.index} tabelle={tabelle} seite={seite} exp={exp} onZuStelle={onZuStelle} />
            ))}
            <p className={leise}>{t('openintrapdf.export.rohwerte')}</p>
        </div>
    );
}

function TabellenRaster({ tabelle, seite, exp, onZuStelle }: { tabelle: ModellTabelle; seite: number; exp: Export; onZuStelle: Props['onZuStelle'] }) {
    const { t } = useTranslation();
    const wahl = exp.tabellen.get(tabelle.index);
    if (!wahl) return null;
    const nr = tabelle.index + 1;
    const zeilen = tabelle.zeilen.slice(0, VORSCHAU_ZEILEN);
    const spalten = Array.from({ length: tabelle.spalten }, (_, i) => i);
    /** Der erste Wert unter den Kopfzeilen — an ihm zeigt der Hinweis, wie eine Zahl gelesen wird. */
    const ersterWert = (spalte: number) => tabelle.zeilen.slice(wahl.header_rows).map(z => z[spalte]?.text.trim() ?? '').find(Boolean) ?? '';

    return (
        <section aria-label={t('openintrapdf.export.tabelle', { index: nr })}
            className={`rounded-md border p-2 space-y-2 ${wahl.include ? 'border-[var(--opdf-akzent)]' : 'border-[var(--opdf-linie)] opacity-70'}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                    <input type="checkbox" checked={wahl.include} aria-label={t('openintrapdf.export.uebernehmenTabelle', { index: nr })}
                        onChange={e => exp.tabelleSetzen(tabelle.index, { include: e.target.checked })} />
                    {t('openintrapdf.export.tabelle', { index: nr })}
                </label>
                <button type="button" className={`${leise} hover:underline`} onClick={() => onZuStelle(seite, tabelle.lage)}>
                    {t('openintrapdf.export.tabelleSeite', { seite })}
                </button>
                <label className="ml-auto flex items-center gap-2">
                    <span className={leise}>{t('openintrapdf.export.kopfzeilen')}</span>
                    <select value={wahl.header_rows} aria-label={t('openintrapdf.export.kopfzeilenTabelle', { index: nr })}
                        onChange={e => exp.tabelleSetzen(tabelle.index, { header_rows: Number(e.target.value) })} className={`${eingabe} h-7 text-xs`}>
                        {[0, 1, 2].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
            </div>
            <div className="overflow-x-auto">
                <table className="text-xs border-collapse min-w-full">
                    <thead>
                        <tr>
                            {spalten.map(c => {
                                const typ = wahl.column_types[c] ?? 'text';
                                const roh = ersterWert(c);
                                const gelesen = typ === 'number' && roh ? zahlDeuten(roh, exp.gebiet) : null;
                                return (
                                    <th key={c} className="align-top p-1 text-left font-normal border-b border-[var(--opdf-linie)]">
                                        <select value={typ} aria-label={t('openintrapdf.export.spaltenTyp', { spalte: c + 1, index: nr })}
                                            onChange={e => exp.spaltenTypSetzen(tabelle.index, c, e.target.value as SpaltenTyp)}
                                            className={`${eingabe} h-7 text-xs w-full min-w-[5rem]`}>
                                            {TYPEN.map(ty => <option key={ty} value={ty}>{t(`openintrapdf.export.typ.${ty}`)}</option>)}
                                        </select>
                                        {typ === 'number' && roh && (
                                            <span className={`${leise} block mt-1 whitespace-nowrap`}>
                                                {gelesen !== null ? t('openintrapdf.export.zahlHinweis', { roh, wert: gelesen }) : t('openintrapdf.export.zahlUnlesbar', { roh })}
                                            </span>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {zeilen.map((zeile, r) => (
                            <tr key={r} className={r < wahl.header_rows ? 'font-semibold bg-[var(--opdf-weich)]' : ''}>
                                {spalten.map(c => {
                                    const zelle = zeile[c];
                                    const unsicher = zelle?.konf !== undefined && zelle.konf < 50;
                                    return (
                                        <td key={c} title={unsicher ? t('openintrapdf.export.zelleUnsicher') : undefined}
                                            className={`p-1 border-b border-[var(--opdf-linie)] whitespace-pre-wrap align-top tabular-nums
                                                ${unsicher ? 'bg-[var(--opdf-warn-hg)] text-[var(--opdf-warn-text)]' : ''}`}>
                                            {zelle?.text ?? ''}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {tabelle.zeilen.length > VORSCHAU_ZEILEN && (
                    <p className={`${leise} mt-1`}>{t('openintrapdf.export.mehrZeilen', { count: tabelle.zeilen.length - VORSCHAU_ZEILEN })}</p>
                )}
            </div>
        </section>
    );
}

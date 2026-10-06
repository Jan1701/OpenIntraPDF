// SPDX-License-Identifier: Apache-2.0
//
// Werkzeuggruppe „Text erkennen“ (Etappe 3).
//
// Vier Bilder, eines nach dem anderen: Seiten wählen und Sprache → Auftrag
// läuft („Seite x von y“, Abbrechen) → Vorschau mit Warnungen und den
// Knöpfen zum Speichern oder Verwerfen → oder ein Fehlschlag mit Grund.
// Fehlt der Dienst auf dem Server, steht hier nur der Hinweis dazu
// (Konzept Kap. 01, „Produktgrenzen als nachvollziehbare Zustände“).

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Play, Save, Trash2, XCircle } from 'lucide-react';
import { Miniatur } from './Miniatur';
import type { MiniaturDienst } from './miniaturen';
import { waehlbar, standardAuswahl } from './texterkennung';
import type { Texterkennung } from './texterkennung';
import type { OcrSprache, PdfAuftrag } from './typen';
import { Hinweis } from './Werkzeugleiste';
import { abschnitt, eingabe, hauptKnopf, leise, rahmenKnopf } from './stil';

const SPRACHEN: OcrSprache[] = ['deu+eng', 'deu', 'eng'];

interface Props {
    /** Der Dienst fehlt: nur der Hinweis, keine Knöpfe. */
    fehltBaustein: boolean;
    ocr: Texterkennung;
    miniaturen: MiniaturDienst | null;
    /** Stand der Vorschau in der Leseansicht; `null` = keine. */
    vorschau: { laedt: boolean; fehler: boolean } | null;
    onVorschauErneut: () => void;
    onStarten: () => void;
    onSpeichern: (art: 'fassung' | 'datei') => void;
    onVerwerfen: () => void;
    speichert: boolean;
    /** Signiertes Original: nur als neue Datei. */
    nurNeueDatei: boolean;
    /** Der Gastgeber kann ein Ziel erfragen. */
    neueDateiMoeglich: boolean;
}

/** „3, 5, 8“ aus Seiten ab 0. */
const seitenText = (seiten: number[]) => [...seiten].sort((a, b) => a - b).map(p => p + 1).join(', ');

export function TexterkennungWerkzeug(p: Props) {
    const { t } = useTranslation();
    const { ocr } = p;
    const { arten, auftrag } = ocr;
    const inAuswahl = auftrag.art === 'keiner' || auftrag.art === 'startet';

    // Seitenarten erst holen, wenn die Gruppe offen ist — ein Lauf über
    // alle Seiten lohnt nicht für jedes geöffnete PDF.
    useEffect(() => {
        if (!p.fehltBaustein && inAuswahl && !arten.daten && !arten.laedt && !arten.fehler) void ocr.artenLaden();
    }, [p.fehltBaustein, inAuswahl, arten.daten, arten.laedt, arten.fehler, ocr]);

    if (p.fehltBaustein) {
        return (
            <div className="space-y-3 text-sm">
                <p className={leise}>{t('openintrapdf.ocr.einleitung')}</p>
                <Hinweis art="warnung">{t('openintrapdf.ocr.fehltBaustein')}</Hinweis>
            </div>
        );
    }

    return (
        <div className="space-y-5 text-sm">
            <p className={leise}>{t('openintrapdf.ocr.einleitung')}</p>
            {ocr.meldung && (
                <div role="status"><Hinweis art={ocr.meldung.art}>{t(`openintrapdf.ocr.${ocr.meldung.schluessel}`, ocr.meldung.werte)}</Hinweis></div>
            )}
            {inAuswahl && <Auswahl {...p} />}
            {auftrag.art === 'laeuft' && <Laeuft auftrag={auftrag.auftrag} abbruch={auftrag.abbruch} abfrageFehler={auftrag.abfrageFehler} onAbbrechen={() => void ocr.abbrechen()} />}
            {auftrag.art === 'fertig' && <Fertig {...p} auftrag={auftrag.auftrag} />}
            {auftrag.art === 'fehlgeschlagen' && (
                <div className="space-y-3">
                    <div role="alert">
                        <Hinweis art="fehler">
                            {t('openintrapdf.ocr.fehlgeschlagen')}
                            {auftrag.auftrag.error && ` ${t('openintrapdf.ocr.fehlerGrund', { grund: auftrag.auftrag.error })}`}
                        </Hinweis>
                    </div>
                    <button type="button" className={rahmenKnopf} onClick={ocr.zuruecksetzen}>{t('openintrapdf.ocr.erneut')}</button>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Seiten und Sprache wählen
// ---------------------------------------------------------------------

function Auswahl({ ocr, miniaturen, onStarten }: Props) {
    const { t } = useTranslation();
    const { arten, auswahl, sprache, startFehler, auftrag } = ocr;
    const startet = auftrag.art === 'startet';

    if (arten.laedt || (!arten.daten && !arten.fehler)) {
        return (
            <p className="flex items-center gap-2 text-[var(--opdf-gedaempft)]" role="status">
                <LoaderCircle size={16} className="animate-spin" aria-hidden /> {t('openintrapdf.ocr.artenLaden')}
            </p>
        );
    }
    if (!arten.daten) {
        return (
            <div className="space-y-3">
                <div role="alert"><Hinweis art="fehler">{t(`openintrapdf.ocr.artenFehler.${arten.fehler}`)}</Hinweis></div>
                <button type="button" className={rahmenKnopf} onClick={() => void ocr.artenLaden()}>{t('openintrapdf.aktion.erneut')}</button>
            </div>
        );
    }

    const seiten = arten.daten.pages;
    const belegbar = seiten.filter(waehlbar);
    const umschalten = (page: number, an: boolean) => {
        const neu = new Set(auswahl);
        if (an) neu.add(page);
        else neu.delete(page);
        ocr.setAuswahl(neu);
    };

    return (
        <>
            <div>
                <p className={`${abschnitt} mb-2`}>{t('openintrapdf.ocr.seitenTitel')}</p>
                {belegbar.length === 0 ? (
                    <Hinweis art="info">{t('openintrapdf.ocr.keineSeiten')}</Hinweis>
                ) : (
                    <>
                        <p className="mb-2" aria-live="polite">{t('openintrapdf.ocr.gewaehlt', { count: auswahl.size })}</p>
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button type="button" className={rahmenKnopf} onClick={() => ocr.setAuswahl(standardAuswahl(arten.daten!))}>
                                {t('openintrapdf.ocr.standardWaehlen')}
                            </button>
                            <button type="button" className={rahmenKnopf} disabled={auswahl.size === 0} onClick={() => ocr.setAuswahl(new Set())}>
                                {t('openintrapdf.ocr.keineWaehlen')}
                            </button>
                        </div>
                    </>
                )}
                <ul className="space-y-2" aria-label={t('openintrapdf.ocr.seitenTitel')}>
                    {seiten.map(e => {
                        const frei = waehlbar(e);
                        const an = auswahl.has(e.page);
                        const grund = e.kind === 'text' ? t('openintrapdf.ocr.gesperrtText') : e.kind === 'gemischt' ? t('openintrapdf.ocr.gesperrtGemischt') : null;
                        return (
                            <li key={e.page}>
                                <label className={`flex gap-3 items-start rounded-md border p-2 ${frei ? 'cursor-pointer hover:bg-[var(--opdf-weich)]' : 'opacity-70'} ${an ? 'border-[var(--opdf-akzent)] bg-[var(--opdf-weich)]' : 'border-[var(--opdf-linie)]'}`}>
                                    <input type="checkbox" className="mt-1" checked={an} disabled={!frei || startet}
                                        aria-label={t('openintrapdf.ocr.seite', { seite: e.page + 1 })}
                                        aria-describedby={grund ? `opdf-ocr-grund-${e.page}` : undefined}
                                        onChange={ev => umschalten(e.page, ev.target.checked)} />
                                    <Miniatur dienst={miniaturen} quelle={e.page} drehung={0} className="w-12 shrink-0 border border-[var(--opdf-linie)]" />
                                    <span className="min-w-0 text-sm">
                                        <span className="block font-semibold">
                                            {t('openintrapdf.ocr.seite', { seite: e.page + 1 })} · {t(`openintrapdf.ocr.art.${e.kind}`)}
                                        </span>
                                        <span className={`${leise} block`}>
                                            {e.chars > 0 && `${t('openintrapdf.ocr.zeichen', { count: e.chars })} · `}
                                            {t('openintrapdf.ocr.bildanteil', { anteil: Math.round((e.image_ratio ?? 0) * 100) })}
                                        </span>
                                        {grund && <span id={`opdf-ocr-grund-${e.page}`} className={`${leise} block`}>{grund}</span>}
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div>
                <label htmlFor="opdf-ocr-sprache" className={`${abschnitt} block mb-2`}>{t('openintrapdf.ocr.spracheTitel')}</label>
                <select id="opdf-ocr-sprache" value={sprache} disabled={startet}
                    onChange={e => ocr.setSprache(e.target.value as OcrSprache)} className={`${eingabe} w-full`}>
                    {SPRACHEN.map(s => <option key={s} value={s}>{t(`openintrapdf.ocr.sprache.${s}`)}</option>)}
                </select>
            </div>

            {startFehler && (
                <div role="alert">
                    <Hinweis art="fehler">
                        {startFehler.grund === 'seitenMitText'
                            ? t('openintrapdf.ocr.start.seitenMitText', { count: startFehler.seiten?.length ?? 0, seiten: seitenText(startFehler.seiten ?? []) })
                            : startFehler.grund === 'rechteBits'
                                ? t('openintrapdf.schutz.gesperrtAendern')
                                : startFehler.grund === 'rechteKennwort'
                                    ? `${t('openintrapdf.schutz.abgelehnt')} ${t('openintrapdf.schutz.gesperrtAendern')}`
                                    : (startFehler.grund === 'sonst' && startFehler.meldung) || t(`openintrapdf.ocr.start.${startFehler.grund}`)}
                    </Hinweis>
                </div>
            )}

            <button type="button" className={`${hauptKnopf} w-full`} disabled={startet || auswahl.size === 0} onClick={onStarten}>
                {startet ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
                {t(startet ? 'openintrapdf.ocr.startet' : 'openintrapdf.ocr.starten')}
            </button>
            <p className={leise}>{t('openintrapdf.ocr.startHinweis')}</p>
        </>
    );
}

// ---------------------------------------------------------------------
// Auftrag läuft — auch für „Exportieren“ (Etappe 4), dort mit eigenen Texten
// ---------------------------------------------------------------------

export function Laeuft({ auftrag, abbruch, abfrageFehler, onAbbrechen, praefix = 'ocr' }: {
    auftrag: PdfAuftrag; abbruch: boolean; abfrageFehler: number; onAbbrechen: () => void;
    /** Gruppe, deren Texte gelten: `openintrapdf.<praefix>.laeuftTitel` usw. */
    praefix?: 'ocr' | 'export';
}) {
    const { t } = useTranslation();
    const done = auftrag.progress?.done ?? 0;
    const total = auftrag.progress?.total ?? 0;
    const wartet = auftrag.state === 'queued' || total === 0;
    return (
        <div className="space-y-3" role="status" aria-live="polite">
            <p className={`${abschnitt}`}>{t(`openintrapdf.${praefix}.laeuftTitel`)}</p>
            <p className="flex items-center gap-2">
                <LoaderCircle size={16} className="animate-spin" aria-hidden />
                {wartet ? t(`openintrapdf.${praefix}.wartet`) : t(`openintrapdf.${praefix}.fortschritt`, { done, total })}
            </p>
            <div className="h-1.5 rounded bg-[var(--opdf-linie)] overflow-hidden" aria-hidden>
                <div className="h-full bg-[var(--opdf-akzent)] transition-[width]" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
            </div>
            {abfrageFehler > 0 && <Hinweis art="warnung">{t(`openintrapdf.${praefix}.abfrageFehler`)}</Hinweis>}
            <button type="button" className={rahmenKnopf} disabled={abbruch} onClick={onAbbrechen}>
                <XCircle size={16} aria-hidden /> {t(abbruch ? `openintrapdf.${praefix}.brichtAb` : `openintrapdf.${praefix}.abbrechen`)}
            </button>
            <p className={leise}>{t(`openintrapdf.${praefix}.laeuftHinweis`)}</p>
        </div>
    );
}

// ---------------------------------------------------------------------
// Fertig: Vorschau, Warnungen, Speichern oder Verwerfen
// ---------------------------------------------------------------------

function Fertig({ auftrag, vorschau, onVorschauErneut, onSpeichern, onVerwerfen, speichert, nurNeueDatei, neueDateiMoeglich }: Props & { auftrag: PdfAuftrag }) {
    const { t } = useTranslation();
    const meta = auftrag.result?.meta ?? {};
    const quer = (meta.pages_skipped ?? []).filter(s => s.reason === 'page_sideways').map(s => s.page);
    const sonstUebersprungen = (meta.pages_skipped ?? []).filter(s => s.reason !== 'page_sideways');
    const unsicher = meta.low_confidence_pages ?? [];
    const erkannt = meta.pages_recognized?.length ?? 0;
    const ablauf = auftrag.expires_at ? new Date(auftrag.expires_at) : null;
    const bereit = !!vorschau && !vorschau.laedt && !vorschau.fehler;

    return (
        <div className="space-y-4">
            <div role="status">
                <Hinweis art="warnung">
                    <span className="block font-semibold">{t('openintrapdf.ocr.vorschauTitel')}</span>
                    {t('openintrapdf.ocr.vorschauText')}
                </Hinweis>
            </div>

            {vorschau?.laedt && (
                <p className="flex items-center gap-2 text-[var(--opdf-gedaempft)]" role="status">
                    <LoaderCircle size={16} className="animate-spin" aria-hidden /> {t('openintrapdf.ocr.ergebnisLaedt')}
                </p>
            )}
            {vorschau?.fehler && (
                <div className="space-y-2">
                    <div role="alert"><Hinweis art="fehler">{t('openintrapdf.ocr.ergebnisFehler')}</Hinweis></div>
                    <button type="button" className={rahmenKnopf} onClick={onVorschauErneut}>{t('openintrapdf.aktion.erneut')}</button>
                </div>
            )}

            <div>
                <p className={`${abschnitt} mb-2`}>{t('openintrapdf.ocr.ergebnisTitel')}</p>
                <p>
                    {t('openintrapdf.ocr.erkannt', { count: erkannt })}
                    {meta.words !== undefined && ` · ${t('openintrapdf.ocr.woerter', { count: meta.words })}`}
                </p>
                {ablauf && !Number.isNaN(ablauf.getTime()) && (
                    <p className={`${leise} mt-1`}>{t('openintrapdf.ocr.laeuftAb', { zeit: ablauf.toLocaleString() })}</p>
                )}
            </div>

            {(unsicher.length > 0 || quer.length > 0 || sonstUebersprungen.length > 0) && (
                <div className="space-y-2" role="status">
                    {unsicher.length > 0 && (
                        <Hinweis art="warnung">{t('openintrapdf.ocr.unsicher', { count: unsicher.length, seiten: seitenText(unsicher) })}</Hinweis>
                    )}
                    {quer.length > 0 && (
                        <Hinweis art="warnung">{t('openintrapdf.ocr.quer', { count: quer.length, seiten: seitenText(quer) })}</Hinweis>
                    )}
                    {sonstUebersprungen.length > 0 && (
                        <Hinweis art="warnung">
                            {t('openintrapdf.ocr.uebersprungen', {
                                count: sonstUebersprungen.length,
                                seiten: seitenText(sonstUebersprungen.map(s => s.page)),
                                grund: [...new Set(sonstUebersprungen.map(s => s.reason))]
                                    .map(r => t(`openintrapdf.ocr.grund.${r}`, { defaultValue: r })).join(', '),
                            })}
                        </Hinweis>
                    )}
                </div>
            )}

            {/* Nichts erkannt: Eine neue Fassung waere eine Kopie ohne
                Nutzen. Dann bleibt nur Verwerfen (Dev-Probe 29.09.2026). */}
            {erkannt === 0 && (
                <div role="status"><Hinweis art="warnung">{t('openintrapdf.ocr.nichtsErkannt')}</Hinweis></div>
            )}
            <div className="grid gap-2">
                {erkannt > 0 && !nurNeueDatei && (
                    <button type="button" className={hauptKnopf} disabled={!bereit || speichert} onClick={() => onSpeichern('fassung')}>
                        <Save size={16} aria-hidden /> {t('openintrapdf.ocr.neueFassung')}
                    </button>
                )}
                {erkannt > 0 && neueDateiMoeglich && (
                    <button type="button" className={nurNeueDatei ? hauptKnopf : rahmenKnopf} disabled={!bereit || speichert} onClick={() => onSpeichern('datei')}>
                        {nurNeueDatei && <Save size={16} aria-hidden />} {t('openintrapdf.ocr.neueDatei')}
                    </button>
                )}
                <button type="button" className={erkannt > 0 ? rahmenKnopf : hauptKnopf} disabled={speichert} onClick={onVerwerfen}>
                    <Trash2 size={16} aria-hidden /> {t('openintrapdf.ocr.verwerfen')}
                </button>
            </div>
            {nurNeueDatei && <p className={leise}>{t('openintrapdf.ocr.nurNeueDatei')}</p>}
        </div>
    );
}

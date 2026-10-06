// SPDX-License-Identifier: Apache-2.0
//
// Das gemeinsame Werkzeugband (aus OpenIntraPDF, Vertrag Etappe 7, herausgelöst):
// eine Reiterzeile mit optionalem Schnellbereich links und eigenen Elementen
// rechts (`rechts`, etwa ein Suchfeld — keine zusätzliche Leiste), darunter
// das Band des gewählten Reiters mit seinen Gruppen. Das Datei-Menü ist ein
// Reiter ohne Band. Welche Reiter, Gruppen und Knöpfe es gibt, sagt der
// Aufrufer (typen.ts); hier stehen Darstellung und Bedienung.
//
// Herkunft: Konzept: Befehle in Registern mit Gruppen – wie es auch
// LibreOffice als „Notebookbar“ (Ansicht „In Registern“) anbietet. Eigener
// Code, eigene Gestaltung, keine Symbole oder Stile aus anderen Produkten;
// Symbole aus lucide (ISC). Farben über --werkzeugband-* (werkzeugband.css).
//
// Darstellungen (`useWerkzeugbandDarstellung`, je Aufrufer gemerkt; umschaltbar
// über das Menü „Darstellung des Werkzeugbands“ und den Pfeil am Ende der
// Reiterzeile):
//   einzeilig   eine Zeile kleiner Knöpfe, Überlauf in „…“ (EinzeiligesBand)
//   klassisch   große und kleine Knöpfe mit Gruppennamen (wie OpenIntraPDF)
//   eingeklappt nur die Reiterzeile; ein Klick auf einen Reiter öffnet das
//               Band vorübergehend über dem Inhalt, Klick daneben/Esc schließt
//
// Höhen — gemessen über die gesetzten Klassen (hoehe.test.tsx; für
// OpenIntraPDF openintrapdf/Werkzeugband.hoehe.test.tsx), bei 16 px Grundschrift:
//   einzeilig    72 px = Reiterzeile 32 + Band 40 (32er Knöpfe in 36er Karte)
//   klassisch   136 px = 4 + Reiterzeile 32 + 4 + Band 88 (12 + Knöpfe 58 +
//                Gruppenname 18) + 8; nur große Knöpfe: 134; unter 1024 px
//                ohne Gruppennamen 118. Eine zweizeilige Beschriftung großer
//                Knöpfe (max. 6,5 rem breit) kostet bis zu 5,5 px mehr.
//   eingeklappt  32 px aus einzeilig, 44 px aus klassisch (4 + 32 + 8)
// Höhere Elemente im Schnellbereich heben die Reiterzeile an: OpenIntraPDF
// hat 36-px-Knöpfe dort (h-9) und misst klassisch 140 px, eingeklappt 48 px
// — genau wie vor dem Umbau.
//
// Tastatur: Die Reiterzeile ist eine `tablist` mit Pfeiltasten, Pos1 und
// Ende, das Band ein `tabpanel`, jede Gruppe eine `group`; Menüs folgen dem
// Muster „Menu Button“ (Menue.tsx). `Alt` allein (drücken und ohne andere
// Taste loslassen) blendet Tastenbuchstaben ein — erst an den Reitern, dann
// an den Knöpfen des gewählten Reiters; `Esc` geht eine Ebene zurück.
// `Alt`+Taste bleibt dem Browser und dem Aufrufer. Stehen mehrere Werkzeugbands
// auf einer Seite, bekommt nur das aktive die Tasten (tastenVerteiler.ts);
// mit `tastenbuchstaben={false}` reagiert ein Werkzeugband auf Alt gar nicht.
//
// Mehrere Werkzeugbands auf einer Seite: alle Kennungen hängen an `useId`.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as TastenEreignis, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, LayoutPanelTop } from 'lucide-react';
import type { WerkzeugbandDarstellung, WerkzeugbandDarstellungWert, WerkzeugbandElement, WerkzeugbandMenueEintrag, WerkzeugbandReiter } from './typen';
import { idZuTaste, tastenVergeben } from './tastenbuchstaben';
import { tastenAnmelden } from './tastenVerteiler';
import { knopfMenue, WerkzeugbandKontext, Spalten } from './Knoepfe';
import type { WerkzeugbandSteuerung } from './Knoepfe';
import { WerkzeugbandMenue } from './Menue';
import { EinzeiligesBand } from './EinzeiligesBand';
import { Tipp } from './Tipp';
import './werkzeugband.css';

export interface WerkzeugbandProps<R extends string = string> {
    reiter: WerkzeugbandReiter<R>[];
    aktiv: R;
    onAktiv: (id: R) => void;
    /** Darstellung samt Umschalten, aus `useWerkzeugbandDarstellung(speicher, vorgabe)`. */
    darstellung: WerkzeugbandDarstellung;
    /** Einträge des Datei-Menüs; leer oder weggelassen: kein Datei-Menü. */
    datei?: WerkzeugbandMenueEintrag[];
    /** Tastenbuchstabe des Datei-Menüs; sonst vergeben. */
    dateiTaste?: string;
    /** Immer sichtbar links in der Reiterzeile (Speichern, Drucken, Rückgängig …). */
    schnellbereich?: ReactNode;
    /** Eigene Elemente rechts in der Reiterzeile, vor den Darstellungsknöpfen (Suchfeld …). */
    rechts?: ReactNode;
    /** Alt-Tastenbuchstaben; Vorgabe an. Aus: kein Zuhörer am Fenster, Alt bleibt dem Browser. */
    tastenbuchstaben?: boolean;
    /**
     * i18n-Präfix des Aufrufers: Jeder Text des Bausteins (`bereich`, `datei`,
     * `einklappen` …) wird zuerst unter `<textPraefix>.<schluessel>` gesucht,
     * dann unter `werkzeugband.<schluessel>`.
     */
    textPraefix?: string;
    /**
     * Bereich, in dem Fokus oder Zeiger dieses Werkzeugband für die Tastenbuchstaben
     * aktiv machen (Verfasserfenster). Vorgabe: der umgebende Dialog, sonst die Seite.
     */
    tastenBereich?: RefObject<HTMLElement | null>;
    className?: string;
}

/** Kennung des Datei-Menüs unter den Reitern (kollidiert mit keiner Reiter-ID). */
const DATEI = '\u0000datei';

type Tipps = null | { ebene: 'reiter' } | { ebene: 'knoepfe'; reiter: string };

const DARSTELLUNGEN: WerkzeugbandDarstellungWert[] = ['einzeilig', 'klassisch', 'eingeklappt'];

function elementeVon(r: WerkzeugbandReiter | undefined): WerkzeugbandElement[] {
    return r?.gruppen.flatMap(g => g.knoepfe ?? []) ?? [];
}

export function Werkzeugband<R extends string = string>({
    reiter, aktiv, onAktiv, darstellung, datei = [], dateiTaste, schnellbereich, rechts,
    tastenbuchstaben = true, textPraefix, tastenBereich, className = '',
}: WerkzeugbandProps<R>) {
    const { t } = useTranslation();
    const tx = useCallback((schluessel: string, optionen?: Record<string, unknown>): string => (
        textPraefix ? t([`${textPraefix}.${schluessel}`, `werkzeugband.${schluessel}`], optionen) : t(`werkzeugband.${schluessel}`, optionen)
    ), [t, textPraefix]);

    const basis = useId();
    const reiterId = (id: string) => `${basis}-reiter-${id}`;
    const bandId = `${basis}-band`;
    const ausloeserId = useCallback((s: string) => `${basis}-ausloeser-${s}`, [basis]);
    const menueId = useCallback((s: string) => `${basis}-menue-${s}`, [basis]);

    const wurzel = useRef<HTMLDivElement>(null);
    const [offen, setOffen] = useState<string | null>(null);
    const menueFokus = useRef(true);
    const [vorlaeufig, setVorlaeufig] = useState(false);
    const [tipps, setTipps] = useState<Tipps>(null);
    const altAllein = useRef(false);

    const { eingeklappt, bandform } = darstellung;
    const gewaehlt = reiter.find(r => r.id === aktiv) ?? reiter[0];
    const bandOffen = !!gewaehlt && (!eingeklappt || vorlaeufig);

    // Tastenbuchstaben je Ebene: Reiter samt Datei-Menü; Knöpfe eines Reiters; Datei-Einträge.
    const reiterTasten = useMemo(() => tastenVergeben([
        ...(datei.length ? [{ id: DATEI, text: tx('datei'), taste: dateiTaste }] : []),
        ...reiter.map(r => ({ id: r.id, text: r.name, taste: r.taste })),
    ]), [datei.length, dateiTaste, reiter, tx]);
    const knopfTasten = useCallback((ebene: string) => (
        ebene === DATEI ? tastenVergeben(datei) : tastenVergeben(elementeVon(reiter.find(r => r.id === ebene)))
    ), [datei, reiter]);

    // Verweise für die Tastenbehandlung, die über den Verteiler am Fenster hängt.
    const stand = useRef({ reiter, datei, gewaehlt, eingeklappt, tipps, offen, vorlaeufig, onAktiv, reiterTasten, knopfTasten });
    stand.current = { reiter, datei, gewaehlt, eingeklappt, tipps, offen, vorlaeufig, onAktiv, reiterTasten, knopfTasten };

    useEffect(() => {
        if (!eingeklappt) setVorlaeufig(false);
    }, [eingeklappt]);

    /** Offenes Menü schließen; den Fokus zurück an den Auslöser, wenn gewünscht. */
    const schliessen = useCallback((fokusZurueck: boolean) => {
        const alt = stand.current.offen;
        setOffen(null);
        if (alt && fokusZurueck) document.getElementById(ausloeserId(alt))?.focus();
    }, [ausloeserId]);

    const umschalten = useCallback((s: string) => {
        setTipps(null);
        menueFokus.current = true;
        setOffen(o => (o === s ? null : s));
    }, []);

    const steuerung = useMemo<WerkzeugbandSteuerung>(() => ({
        offen, umschalten, schliessen, ausloeserId, menueId, menueFokus, tx,
    }), [offen, umschalten, schliessen, ausloeserId, menueId, tx]);

    const reiterWaehlen = (id: R) => {
        onAktiv(id);
        if (stand.current.eingeklappt) setVorlaeufig(true);
    };

    // Zeiger: Tipps aus; außerhalb schließt Menü und vorübergehendes Band,
    // innerhalb schließt ein Klick neben Menü und Auslöser das Menü.
    useEffect(() => {
        const beiZeiger = (e: PointerEvent) => {
            setTipps(null);
            const ziel = e.target as Node;
            const o = stand.current.offen;
            if (wurzel.current?.contains(ziel)) {
                if (o && !document.getElementById(menueId(o))?.contains(ziel) && !document.getElementById(ausloeserId(o))?.contains(ziel)) setOffen(null);
                return;
            }
            setOffen(null);
            setVorlaeufig(false);
        };
        window.addEventListener('pointerdown', beiZeiger, true);
        return () => window.removeEventListener('pointerdown', beiZeiger, true);
    }, [menueId, ausloeserId]);

    // Esc geht eine Ebene zurück: Tipps → Menü → vorübergehendes Band. Liefert, ob es etwas zu tun gab.
    const escape = useCallback((): boolean => {
        const s = stand.current;
        if (s.tipps) {
            setTipps(s.tipps.ebene === 'knoepfe' ? { ebene: 'reiter' } : null);
            if (s.offen) schliessen(false);
            return true;
        }
        if (s.offen) {
            const menue = document.getElementById(menueId(s.offen));
            schliessen(!!menue?.contains(document.activeElement));
            return true;
        }
        if (s.eingeklappt && s.vorlaeufig) {
            setVorlaeufig(false);
            return true;
        }
        return false;
    }, [schliessen, menueId]);

    // Tastenbuchstaben und Esc — in der Fangphase, damit der Aufrufer
    // dieselbe Taste nicht noch einmal auswertet. Nur das aktive Werkzeugband.
    useEffect(() => {
        if (!tastenbuchstaben) return;
        const ausloesen = (id: string, ebene: string): boolean => {
            const s = stand.current;
            if (ebene === DATEI) {
                const eintrag = s.datei.find(d => d.id === id);
                if (!eintrag || eintrag.gesperrt) return false;
                setOffen(null);
                eintrag.onClick();
                return true;
            }
            const k = elementeVon(s.reiter.find(r => r.id === ebene)).find(x => x.id === id);
            if (!k || k.gesperrt) return false;
            if (k.art === 'kontrollkaestchen') k.onWechsel(!k.an);
            else if (k.onClick) k.onClick();
            else if (k.menue) {
                menueFokus.current = true;
                setOffen(knopfMenue(k.id));
            }
            return true;
        };
        const taste = (e: KeyboardEvent) => {
            const s = stand.current;
            if (e.key === 'Alt') {
                altAllein.current = !e.ctrlKey && !e.metaKey && !e.shiftKey;
                return;
            }
            if (e.altKey) {
                altAllein.current = false;
                return;
            }
            if (e.key === 'Escape') {
                if (escape()) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
            if (!s.tipps) return;
            if (e.ctrlKey || e.metaKey || e.key.length !== 1) {
                setTipps(null);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (s.tipps.ebene === 'reiter') {
                const id = idZuTaste(s.reiterTasten, e.key);
                if (!id) return;
                if (id === DATEI) {
                    if (!s.datei.length) return;
                    menueFokus.current = false;
                    setOffen('datei');
                    setTipps({ ebene: 'knoepfe', reiter: DATEI });
                    return;
                }
                const r = s.reiter.find(x => x.id === id);
                if (!r || r.gesperrt) return;
                s.onAktiv(r.id);
                if (s.eingeklappt) setVorlaeufig(true);
                setTipps({ ebene: 'knoepfe', reiter: id });
                return;
            }
            const knopfId = idZuTaste(s.knopfTasten(s.tipps.reiter), e.key);
            if (knopfId && ausloesen(knopfId, s.tipps.reiter)) setTipps(null);
        };
        const loslassen = (e: KeyboardEvent) => {
            if (e.key !== 'Alt') return;
            if (altAllein.current) {
                e.preventDefault();
                setTipps(alt => (alt ? null : { ebene: 'reiter' }));
            }
            altAllein.current = false;
        };
        return tastenAnmelden({
            bereich: () => tastenBereich?.current ?? wurzel.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
            wurzel: () => wurzel.current,
            taste,
            loslassen,
            verlassen: () => {
                altAllein.current = false;
                setTipps(null);
            },
        });
    }, [tastenbuchstaben, tastenBereich, escape]);

    // Esc im Werkzeugband selbst — für ein Werkzeugband ohne Tastenbuchstaben oder eines, das gerade nicht aktiv ist.
    const lokaleTaste = (e: TastenEreignis<HTMLDivElement>) => {
        if (e.key === 'Escape' && escape()) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    // Pfeiltasten in der Reiterzeile.
    const reiterTaste = (e: TastenEreignis<HTMLButtonElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const frei = reiter.filter(r => !r.gesperrt);
        if (!frei.length) return;
        const i = Math.max(0, frei.findIndex(r => r.id === aktiv));
        let ziel = i;
        if (e.key === 'ArrowLeft') ziel = (i + frei.length - 1) % frei.length;
        else if (e.key === 'ArrowRight') ziel = (i + 1) % frei.length;
        else if (e.key === 'Home') ziel = 0;
        else ziel = frei.length - 1;
        reiterWaehlen(frei[ziel].id);
        document.getElementById(reiterId(frei[ziel].id))?.focus();
    };

    // Pfeil runter am Auslöser eines Menüs in der Reiterzeile öffnet es wie Enter.
    const ausloeserTaste = (s: string) => (e: TastenEreignis<HTMLButtonElement>) => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && offen !== s) {
            e.preventDefault();
            umschalten(s);
        }
    };

    const tippReiter = tipps?.ebene === 'reiter';
    const tippEbene = tipps?.ebene === 'knoepfe' ? tipps.reiter : null;
    const knopfBuchstaben = tippEbene && tippEbene !== DATEI ? knopfTasten(tippEbene) : null;
    const einzeilig = bandform === 'einzeilig';
    // Einzeilig bricht die Reiterzeile nicht um; feste Teile schrumpfen dann nicht.
    const fest = einzeilig ? 'shrink-0' : '';
    const dateiOffen = offen === 'datei';

    const darstellungEintraege: WerkzeugbandMenueEintrag[] = DARSTELLUNGEN.map(w => ({
        id: w, text: tx(`darstellung.${w}`), wahl: 'eins', an: darstellung.wert === w, onClick: () => darstellung.setzen(w),
    }));

    // Aufbau wie die abgesetzte Bandkarte im Euro-Office-Theme „OpenIntra“ (docker/eurooffice/themes,
    // Jan 02.10.2026): Reiterzeile auf der Programmfläche, aktiver Reiter mit Strich, das Band
    // als abgesetzte Karte.
    return (
        <WerkzeugbandKontext.Provider value={steuerung}>
            <div ref={wurzel} role="region" aria-label={tx('bereich')} onKeyDown={lokaleTaste} data-darstellung={darstellung.wert}
                className={`oih-werkzeugband relative shrink-0 bg-[var(--rb-flaeche)] ${einzeilig ? '' : 'pb-2'} ${className}`}>
                <div data-werkzeugband-teil="reiterzeile"
                    className={einzeilig
                        ? 'flex h-8 flex-nowrap items-center gap-x-2 px-2 sm:px-3'
                        : 'flex flex-wrap items-center gap-x-2 gap-y-1 px-2 sm:px-3 pt-1'}>
                    {schnellbereich != null && (
                        <>
                            <div className={`flex items-center gap-1 ${fest}`} role="group" aria-label={tx('schnellbereich')}>
                                {schnellbereich}
                            </div>
                            <span className={`mx-1 hidden sm:inline-block h-6 w-px bg-[var(--rb-linie)] ${fest}`} aria-hidden />
                        </>
                    )}

                    {/* Datei-Menü und Reiter bleiben beim Umbruch zusammen. */}
                    <div className={`flex items-center gap-0.5 ${einzeilig ? 'min-w-0' : ''}`}>
                        {datei.length > 0 && (
                            <div className={`relative ${fest}`}>
                                <button type="button" aria-haspopup="menu" aria-expanded={dateiOffen} id={ausloeserId('datei')}
                                    aria-controls={dateiOffen ? menueId('datei') : undefined}
                                    onClick={() => umschalten('datei')} onKeyDown={ausloeserTaste('datei')}
                                    className={`relative h-8 px-3 rounded-[5px] text-[13px] font-medium ${dateiOffen ? 'bg-[var(--rb-weich)] text-[var(--rb-akzent)]' : 'text-[var(--rb-text)] hover:bg-[var(--rb-weich)]'}`}>
                                    {tx('datei')}
                                    {tippReiter && <Tipp>{reiterTasten[DATEI]}</Tipp>}
                                </button>
                                {dateiOffen && (
                                    <WerkzeugbandMenue id={menueId('datei')} ausloeser={ausloeserId('datei')} eintraege={datei} breite="min-w-[16rem]"
                                        buchstaben={tippEbene === DATEI ? knopfTasten(DATEI) : null} fokussieren={menueFokus.current}
                                        onSchliessen={schliessen}
                                        onWahl={d => {
                                            schliessen(true);
                                            d.onClick();
                                        }} />
                                )}
                            </div>
                        )}

                        <div role="tablist" aria-label={tx('reiterliste')}
                            className={einzeilig ? 'werkzeugband-reiterliste -mx-1 -my-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 py-1' : 'flex items-center gap-0.5'}>
                            {reiter.map(r => {
                                const an = r.id === gewaehlt?.id;
                                return (
                                    <button key={r.id} type="button" role="tab" id={reiterId(r.id)} aria-selected={an}
                                        aria-controls={an && bandOffen ? bandId : undefined} tabIndex={an ? 0 : -1} disabled={!!r.gesperrt} title={r.gesperrt}
                                        onClick={() => reiterWaehlen(r.id)} onKeyDown={reiterTaste}
                                        onDoubleClick={() => { if (an) darstellung.einklappen(!eingeklappt); }}
                                        className={`relative h-8 px-3 rounded-[5px] text-[13px] font-medium disabled:opacity-45 disabled:cursor-not-allowed ${einzeilig ? 'shrink-0 whitespace-nowrap' : ''}
                                            ${an && bandOffen ? "text-[var(--rb-akzent)] after:content-[''] after:absolute after:inset-x-3 after:bottom-0.5 after:h-[3px] after:rounded-sm after:bg-[var(--rb-akzent)]" : 'text-[var(--rb-text)] hover:bg-[var(--rb-weich)]'}`}>
                                        {r.name}
                                        {tippReiter && reiterTasten[r.id] && <Tipp>{reiterTasten[r.id]}</Tipp>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <span className="flex-1" />
                    {rechts != null && <div className="flex min-w-0 items-center gap-1">{rechts}</div>}
                    <div className={`relative ${fest}`}>
                        <button type="button" id={ausloeserId('darstellung')} aria-haspopup="menu" aria-expanded={offen === 'darstellung'}
                            aria-controls={offen === 'darstellung' ? menueId('darstellung') : undefined}
                            aria-label={tx('darstellung.titel')} title={tx('darstellung.titel')}
                            onClick={() => umschalten('darstellung')} onKeyDown={ausloeserTaste('darstellung')}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--rb-gedaempft)] hover:bg-[var(--rb-weich)]">
                            <LayoutPanelTop size={16} aria-hidden />
                        </button>
                        {offen === 'darstellung' && (
                            <WerkzeugbandMenue id={menueId('darstellung')} ausloeser={ausloeserId('darstellung')} eintraege={darstellungEintraege}
                                ausrichtung="rechts" fokussieren={menueFokus.current} onSchliessen={schliessen}
                                onWahl={d => {
                                    schliessen(true);
                                    d.onClick();
                                }} />
                        )}
                    </div>
                    <button type="button" onClick={() => darstellung.einklappen(!eingeklappt)} aria-pressed={eingeklappt}
                        aria-label={tx(eingeklappt ? 'ausklappen' : 'einklappen')} title={tx(eingeklappt ? 'ausklappen' : 'einklappen')}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--rb-gedaempft)] hover:bg-[var(--rb-weich)] ${fest}`}>
                        {eingeklappt ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    </button>
                </div>

                {bandOffen && gewaehlt && (einzeilig
                    ? <EinzeiligesBand reiter={gewaehlt} bandId={bandId} reiterId={reiterId(gewaehlt.id)} buchstaben={knopfBuchstaben} ueber={eingeklappt} />
                    : (
                        <div role="tabpanel" id={bandId} aria-labelledby={reiterId(gewaehlt.id)} data-werkzeugband-teil="band"
                            className={`werkzeugband-band flex items-stretch gap-1 overflow-x-auto mx-2.5 mt-1 rounded-lg bg-[var(--rb-paneel)] shadow-[var(--rb-schatten)] px-2 sm:px-3 py-1.5
                                ${eingeklappt ? 'absolute left-0 right-0 top-full z-20' : ''}`}>
                            {gewaehlt.gruppen.map(g => (
                                <div key={g.id} role="group" aria-label={g.name}
                                    className="flex shrink-0 flex-col border-r border-[var(--rb-linie)] pr-2 mr-1 last:border-r-0 last:mr-0 last:pr-0">
                                    <div className="flex flex-1 items-start gap-1">
                                        {g.knoepfe && <Spalten knoepfe={g.knoepfe} buchstaben={knopfBuchstaben} />}
                                        {g.inhalt && <div className="flex items-center gap-1 self-center">{g.inhalt}</div>}
                                    </div>
                                    <span className="werkzeugband-gruppenname mt-0.5 text-center text-[10px] leading-4 text-[var(--rb-gedaempft)]">{g.name}</span>
                                </div>
                            ))}
                        </div>
                    ))}
            </div>
        </WerkzeugbandKontext.Provider>
    );
}

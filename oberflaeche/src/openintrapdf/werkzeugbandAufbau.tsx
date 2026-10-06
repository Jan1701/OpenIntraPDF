// SPDX-License-Identifier: Apache-2.0
//
// Aufbau des Werkzeugbands (Vertrag Etappe 7, Abschnitt 1): Reiter → Gruppen →
// Knöpfe als schlichte Datenstruktur. `reiterBauen` macht aus der Lage des
// Arbeitsplatzes (Rechte, Modus, Gastgeber, Zustand) genau die Reiter, die
// es gerade gibt — ein Knopf erscheint nur, wenn seine Funktion beim
// Gastgeber und mit den Rechten tatsächlich geht; eine Gruppe ohne Knöpfe
// entfällt, ein Reiter ohne Gruppen ebenso. Was nur VORÜBERGEHEND nicht
// geht (falscher Modus, laufende Texterkennung), bleibt gesperrt stehen
// und nennt den Grund.
//
// Die Darstellung (der gemeinsame Baustein components/shared/werkzeugband, die
// Typen stammen von dort) kennt nur diese Struktur, nicht den Arbeitsplatz;
// die Tastenbuchstaben (Tastenbuchstaben.ts) hängen an den `id`s von
// Reitern und Knöpfen.

import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
    ArrowLeft, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Circle, ClipboardCopy, ClipboardPaste, Combine, Copy,
    Download, Eye, EyeOff, FileInput, FilePlus, FileOutput, Hand, Highlighter, History, Info, KeyRound, Link2, ListChecks, Lock, LockOpen,
    MessageSquare, Minus, Monitor, Moon, MoveHorizontal, NotebookPen, PanelLeft, PanelRight, PanelTop, PenLine, Printer, RotateCcw, RotateCw, Save, ScanSearch,
    ScanText, Scissors, Search, Square, SquareDashed, Stamp, StickyNote, Strikethrough, Sun, SunMoon, TextCursor, Trash2, Type, Underline, Undo2,
    X, Zap, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { ThemaWahl } from './thema';
import type { AnmerkungsArt } from './typen';
import type { WerkzeugbandGruppe, WerkzeugbandKnopf, WerkzeugbandMenueEintrag, WerkzeugbandReiter as BausteinReiter } from '../components/shared/werkzeugband';
import type { WerkzeugbandReiterId } from './Tastenbuchstaben';

export type { WerkzeugbandReiterId } from './Tastenbuchstaben';

export type { WerkzeugbandGruppe, WerkzeugbandKnopf } from '../components/shared/werkzeugband';

/** Ein Reiter des PDF-Werkzeugbands: die Kennungen sind fest (Tastenbuchstaben.ts). */
export type WerkzeugbandReiter = BausteinReiter<WerkzeugbandReiterId>;

/** Ein Eintrag des Datei-Menüs (Reiter ohne Band). */
export type DateiEintrag = WerkzeugbandMenueEintrag;

/** Wie das Band einen Knopf des Arbeitsfachs (OCR, Export, Binden …) anspricht. */
export interface FachKnopf {
    offen: boolean;
    oeffnen: () => void;
}

/**
 * Die Lage des Arbeitsplatzes, soweit das Werkzeugband sie braucht. Jedes
 * `null`/`undefined` heißt: gibt es bei diesem Gastgeber oder mit diesen
 * Rechten nicht — der Knopf entfällt dann.
 */
export interface WerkzeugbandLage {
    t: TFunction;
    lesen: boolean;
    /** Ein Dokument ist geladen. */
    dokument: boolean;

    datei: {
        neueFassung: { gesperrt: boolean; onClick: () => void } | null;
        neueDatei: { gesperrt: boolean; onClick: () => void } | null;
        herunterladen: { laeuft: boolean; onClick: () => void } | null;
        /** `gesperrt` nennt den Grund, warum die Rechte der PDF das Drucken verbieten (Etappe 9). */
        drucken: { laeuft: boolean; gesperrt?: string | null; onClick: () => void } | null;
        /** Schnelldruck ohne Dialog (Etappe 8); nur, wenn der Gastgeber ihn anbietet (Desktop). */
        schnelldruck: { laeuft: boolean; gesperrt?: string | null; onClick: () => void } | null;
        /** Geschützte Kopie herunterladen (Etappe 9); fehlt beim Gastgeber ohne `geschuetzt`. */
        geschuetzt: (() => void) | null;
        /** Kennwort entfernen (Etappe 9): nur mit edit an einer verschlüsselten Datei. */
        kennwortEntfernen: (() => void) | null;
        /** Rechte-Kennwort eingeben (Etappe 9): nur, solange die Rechte der PDF etwas sperren. */
        rechteKennwort: (() => void) | null;
        /** Eigenschaften anzeigen (Dialog); fehlt, solange es den Dialog nicht gibt. */
        eigenschaften: (() => void) | null;
        /** Fassungen im Arbeitsfach (Etappe 8); fehlt beim Gastgeber ohne Fassungen. */
        fassungen: FachKnopf | null;
        schliessen: () => void;
    };

    navigation: {
        seite: number;
        seitenzahl: number;
        zuSeite: (n: number) => void;
        blaettern: (richtung: 1 | -1) => void;
        /** Das Seitenfeld selbst (Formular mit Eingabe). */
        feld: ReactNode;
    };
    zoom: {
        zoomen: (wert: 'auto' | 'page-width' | 'page-fit' | 'mehr' | 'weniger') => void;
        /** Die Auswahlliste der Stufen. */
        auswahl: ReactNode;
        vorgabe: string | null;
    };
    suche: { offen: boolean; oeffnen: () => void };
    /** Text auswählen / Hand (Abschnitt 2.1); `gesperrt` nennt den Grund, warum Text auswählen nicht geht (Etappe 9). */
    zeiger: { wert: 'text' | 'hand'; setzen: (z: 'text' | 'hand') => void; gesperrt?: string | null } | null;
    /** Die lesende Kommentarliste für alle, die nicht kommentieren dürfen. */
    kommentareLesen: FachKnopf | null;

    /** Kommentieren ist grundsätzlich möglich (Recht und Fähigkeit); `gesperrt` nennt eine vorübergehende Sperre. */
    kommentieren: {
        gesperrt: string | null;
        werkzeug: AnmerkungsArt | null;
        setWerkzeug: (w: AnmerkungsArt | null) => void;
        aussehen: ReactNode;
        liste: FachKnopf;
        /** Anmerkungen ein/aus (Abschnitt 2.2); fehlt, solange es den Schalter nicht gibt. */
        anmerkungen: { sichtbar: boolean; umschalten: () => void } | null;
    } | null;

    /**
     * Einfügen (Etappe 9): nur sichtbar, solange der Reiter etwas enthält —
     * heute die Gruppe Links; Bild und Formen kommen mit E14. Gleiche
     * Bedingungen wie Kommentieren (ein Link ist eine Anmerkung).
     */
    einfuegen: {
        gesperrt: string | null;
        werkzeug: AnmerkungsArt | null;
        setWerkzeug: (w: AnmerkungsArt | null) => void;
    } | null;

    /** Seiten verwalten: nur mit Recht edit; `bedienbar` nur im Modus Bearbeiten. */
    seiten: {
        bedienbar: boolean;
        /** Grund, warum Bearbeiten gerade nicht geht — sperrt den ganzen Reiter. */
        gesperrt: string | null;
        keineAuswahl: boolean;
        alleEntfernt: boolean;
        alleWaehlen: () => void;
        auswahlAufheben: () => void;
        drehen: (grad: 90 | -90) => void;
        entfernen: () => void;
        wiederherstellen: () => void;
        duplizieren: () => void;
        nachVorn: () => void;
        nachHinten: () => void;
        leerLaeuft: boolean;
        leerPruefen: () => void;
        extrahieren: ((art: 'one' | 'each') => void) | null;
        extraktLaeuft: boolean;
        /** Leere Seite nach der gewählten bzw. aktuellen Seite (Etappe 9). */
        leereSeite: () => void;
        /** Seiten aus einer anderen Datei (Etappe 9); fehlt beim Gastgeber ohne Dateiwähler. */
        seitenAusDatei: (() => void) | null;
        /** Zwischenablage des Dokuments (Etappe 9): `leer` sperrt Einfügen. */
        zwischenablage: { leer: boolean; kopieren: () => void; ausschneiden: () => void; einfuegen: () => void };
    } | null;

    werkzeuge: {
        ocr: FachKnopf | null;
        export: FachKnopf | null;
        binden: FachKnopf | null;
    };

    ansicht: {
        seitenleiste: { offen: boolean; umschalten: () => void } | null;
        arbeitsfach: { offen: boolean; umschalten: () => void } | null;
        werkzeugband: { eingeklappt: boolean; umschalten: () => void };
        thema: { wahl: ThemaWahl; setzen: (w: ThemaWahl) => void } | null;
        /** Dunkles Dokument (Abschnitt 2.3); fehlt, solange es den Schalter nicht gibt. */
        dunklesDokument: { an: boolean; umschalten: () => void } | null;
    };
}

const ANMERKUNGS_SYMBOLE: Record<AnmerkungsArt, LucideIcon> = {
    note: StickyNote, sticky: NotebookPen, freetext: Type, highlight: Highlighter, underline: Underline, strikeout: Strikethrough,
    ink: PenLine, line: Minus, arrow: ArrowUpRight, square: Square, circle: Circle, stamp: Stamp, link: Link2,
};

/** Reiter mit Gruppen und das Datei-Menü aus der Lage. */
export function reiterBauen(l: WerkzeugbandLage): { reiter: WerkzeugbandReiter[]; datei: DateiEintrag[] } {
    const { t } = l;
    const reiter: WerkzeugbandReiter[] = [];

    // ---------------------------------------------------------------
    // Start: Lesen — Navigation, Zoom, Suche, Zeiger; dazu die lesende Kommentarliste.
    // ---------------------------------------------------------------
    const nurLesen = l.lesen ? null : t('openintrapdf.werkzeugband.nurLesen');
    const lesend = l.lesen && l.dokument;
    const start: WerkzeugbandGruppe[] = [
        {
            id: 'navigation',
            name: t('openintrapdf.werkzeugband.gruppe.navigation'),
            knoepfe: [
                { id: 'erste', text: t('openintrapdf.werkzeugband.knopf.erste'), symbol: ChevronsLeft, onClick: () => l.navigation.zuSeite(1), gesperrt: !lesend || l.navigation.seite <= 1, titel: nurLesen ?? undefined },
                { id: 'vorige', text: t('openintrapdf.fuss.vorige'), symbol: ChevronLeft, onClick: () => l.navigation.blaettern(-1), gesperrt: !lesend || l.navigation.seite <= 1, titel: nurLesen ?? undefined },
                { id: 'naechste', text: t('openintrapdf.fuss.naechste'), symbol: ChevronRight, onClick: () => l.navigation.blaettern(1), gesperrt: !lesend || l.navigation.seite >= l.navigation.seitenzahl, titel: nurLesen ?? undefined },
                { id: 'letzte', text: t('openintrapdf.werkzeugband.knopf.letzte'), symbol: ChevronsRight, onClick: () => l.navigation.zuSeite(l.navigation.seitenzahl), gesperrt: !lesend || l.navigation.seite >= l.navigation.seitenzahl, titel: nurLesen ?? undefined },
            ],
            // Seitenfeld und Zoomliste sind 28 px hoch und passen auch in die einzeilige Darstellung.
            inhalt: l.navigation.feld,
            inhaltEinzeilig: l.navigation.feld,
        },
        {
            id: 'zoom',
            name: t('openintrapdf.fuss.zoom'),
            knoepfe: [
                { id: 'kleiner', text: t('openintrapdf.fuss.kleiner'), symbol: ZoomOut, onClick: () => l.zoom.zoomen('weniger'), gesperrt: !lesend, titel: nurLesen ?? undefined },
                { id: 'groesser', text: t('openintrapdf.fuss.groesser'), symbol: ZoomIn, onClick: () => l.zoom.zoomen('mehr'), gesperrt: !lesend, titel: nurLesen ?? undefined },
                { id: 'seitenbreite', text: t('openintrapdf.fuss.seitenbreite'), symbol: MoveHorizontal, onClick: () => l.zoom.zoomen('page-width'), gesperrt: !lesend, gedrueckt: l.zoom.vorgabe === 'page-width', titel: nurLesen ?? undefined },
                { id: 'ganzeSeite', text: t('openintrapdf.fuss.ganzeSeite'), symbol: SquareDashed, onClick: () => l.zoom.zoomen('page-fit'), gesperrt: !lesend, gedrueckt: l.zoom.vorgabe === 'page-fit', titel: nurLesen ?? undefined },
            ],
            inhalt: l.zoom.auswahl,
            inhaltEinzeilig: l.zoom.auswahl,
        },
        {
            id: 'suchen',
            name: t('openintrapdf.werkzeugband.gruppe.suchen'),
            knoepfe: [
                { id: 'suchen', text: t('openintrapdf.werkzeugband.knopf.suchen'), symbol: Search, onClick: l.suche.oeffnen, gross: true, gedrueckt: l.suche.offen, gesperrt: !l.dokument },
            ],
        },
    ];
    if (l.zeiger) {
        const z = l.zeiger;
        start.push({
            id: 'zeiger',
            name: t('openintrapdf.werkzeugband.gruppe.werkzeug'),
            knoepfe: [
                { id: 'zeigerText', text: t('openintrapdf.werkzeugband.knopf.zeigerText'), symbol: TextCursor, onClick: () => z.setzen('text'), gross: true, gedrueckt: z.wert === 'text', gesperrt: !lesend || !!z.gesperrt, titel: z.gesperrt ?? t('openintrapdf.werkzeugband.knopf.zeigerTextTaste') },
                { id: 'zeigerHand', text: t('openintrapdf.werkzeugband.knopf.zeigerHand'), symbol: Hand, onClick: () => z.setzen('hand'), gross: true, gedrueckt: z.wert === 'hand', gesperrt: !lesend, titel: t('openintrapdf.werkzeugband.knopf.zeigerHandTaste') },
            ],
        });
    }
    if (l.kommentareLesen) {
        start.push({
            id: 'kommentare',
            name: t('openintrapdf.werkzeugband.gruppe.kommentare'),
            knoepfe: [
                { id: 'kommentare', text: t('openintrapdf.werkzeuge.kommentare'), symbol: MessageSquare, onClick: l.kommentareLesen.oeffnen, gross: true, gedrueckt: l.kommentareLesen.offen },
            ],
        });
    }
    reiter.push({ id: 'start', name: t('openintrapdf.werkzeugband.reiter.start'), gruppen: start });

    // ---------------------------------------------------------------
    // Kommentieren
    // ---------------------------------------------------------------
    if (l.kommentieren) {
        const k = l.kommentieren;
        const werkzeug = (art: AnmerkungsArt): WerkzeugbandKnopf => ({
            id: art,
            text: t(`openintrapdf.kommentare.werkzeug.${art}`),
            symbol: ANMERKUNGS_SYMBOLE[art],
            onClick: () => k.setWerkzeug(k.werkzeug === art ? null : art),
            gross: true,
            gedrueckt: k.werkzeug === art,
            gesperrt: !!k.gesperrt,
            titel: k.gesperrt ?? undefined,
        });
        reiter.push({
            id: 'kommentieren',
            name: t('openintrapdf.werkzeugband.reiter.kommentieren'),
            gesperrt: k.gesperrt ?? undefined,
            gruppen: [
                { id: 'notizen', name: t('openintrapdf.werkzeugband.gruppe.notizen'), knoepfe: [werkzeug('note'), werkzeug('sticky'), werkzeug('freetext')] },
                { id: 'markieren', name: t('openintrapdf.werkzeugband.gruppe.textMarkieren'), knoepfe: [werkzeug('highlight'), werkzeug('underline'), werkzeug('strikeout')] },
                { id: 'zeichnen', name: t('openintrapdf.werkzeugband.gruppe.zeichnen'), knoepfe: [werkzeug('ink'), werkzeug('line'), werkzeug('arrow'), werkzeug('square'), werkzeug('circle')] },
                { id: 'stempel', name: t('openintrapdf.stempel.titel'), knoepfe: [werkzeug('stamp')] },
                ...(k.aussehen ? [{ id: 'aussehen', name: t('openintrapdf.werkzeugband.gruppe.aussehen'), inhalt: k.aussehen, inhaltEinzeilig: k.aussehen }] : []),
                {
                    id: 'kommentare',
                    name: t('openintrapdf.werkzeugband.gruppe.kommentare'),
                    knoepfe: [
                        { id: 'kommentarliste', text: t('openintrapdf.werkzeugband.knopf.kommentarliste'), symbol: MessageSquare, onClick: k.liste.oeffnen, gross: true, gedrueckt: k.liste.offen },
                        ...(k.anmerkungen ? [{
                            id: 'anmerkungen', text: t('openintrapdf.werkzeugband.knopf.anmerkungen'), symbol: k.anmerkungen.sichtbar ? Eye : EyeOff,
                            onClick: k.anmerkungen.umschalten, gross: true, gedrueckt: k.anmerkungen.sichtbar,
                            titel: t(k.anmerkungen.sichtbar ? 'openintrapdf.werkzeugband.knopf.anmerkungenAus' : 'openintrapdf.werkzeugband.knopf.anmerkungenAn'),
                        } satisfies WerkzeugbandKnopf] : []),
                    ],
                },
            ],
        });
    }

    // ---------------------------------------------------------------
    // Einfügen (Etappe 9): Links
    // ---------------------------------------------------------------
    if (l.einfuegen) {
        const e = l.einfuegen;
        reiter.push({
            id: 'einfuegen',
            name: t('openintrapdf.werkzeugband.reiter.einfuegen'),
            gesperrt: e.gesperrt ?? undefined,
            gruppen: [{
                id: 'links',
                name: t('openintrapdf.werkzeugband.gruppe.links'),
                knoepfe: [{
                    id: 'link', text: t('openintrapdf.kommentare.werkzeug.link'), symbol: Link2,
                    onClick: () => e.setWerkzeug(e.werkzeug === 'link' ? null : 'link'), gross: true,
                    gedrueckt: e.werkzeug === 'link', gesperrt: !!e.gesperrt, titel: e.gesperrt ?? t('openintrapdf.kommentare.anleitung.link'),
                }],
            }],
        });
    }

    // ---------------------------------------------------------------
    // Seiten (nur Bearbeiten)
    // ---------------------------------------------------------------
    if (l.seiten) {
        const s = l.seiten;
        const sperre = s.gesperrt ?? (s.bedienbar ? null : t('openintrapdf.werkzeugband.nurBearbeiten'));
        // Ein Knopf ist gesperrt, wenn der Reiter es ist oder seine Vorbedingung fehlt (keine Auswahl, läuft schon).
        const aktion = (id: string, text: string, symbol: LucideIcon, onClick: () => void, extra: Partial<WerkzeugbandKnopf> = {}): WerkzeugbandKnopf => ({
            id, text, symbol, onClick, gross: true, ...extra,
            gesperrt: !s.bedienbar || !!extra.gesperrt,
            titel: sperre ?? extra.titel,
        });
        const gruppen: WerkzeugbandGruppe[] = [
            {
                id: 'auswahl',
                name: t('openintrapdf.seiten.auswahl'),
                knoepfe: [
                    aktion('alleWaehlen', t('openintrapdf.seiten.alleWaehlen'), ListChecks, s.alleWaehlen, { gross: false }),
                    aktion('auswahlAufheben', t('openintrapdf.seiten.auswahlAufheben'), X, s.auswahlAufheben, { gross: false, gesperrt: s.keineAuswahl }),
                ],
            },
            {
                id: 'bearbeiten',
                name: t('openintrapdf.seiten.bearbeiten'),
                knoepfe: [
                    aktion('linksDrehen', t('openintrapdf.seiten.linksDrehen'), RotateCcw, () => s.drehen(-90), { gesperrt: s.keineAuswahl }),
                    aktion('rechtsDrehen', t('openintrapdf.seiten.rechtsDrehen'), RotateCw, () => s.drehen(90), { gesperrt: s.keineAuswahl }),
                    s.alleEntfernt
                        ? aktion('wiederherstellen', t('openintrapdf.seiten.wiederherstellen'), Undo2, s.wiederherstellen)
                        : aktion('entfernen', t('openintrapdf.seiten.entfernen'), Trash2, s.entfernen, { gesperrt: s.keineAuswahl }),
                    aktion('duplizieren', t('openintrapdf.seiten.duplizieren'), Copy, s.duplizieren, { gesperrt: s.keineAuswahl }),
                ],
            },
            {
                id: 'zwischenablage',
                name: t('openintrapdf.seiten.zwischenablageTitel'),
                knoepfe: [
                    aktion('kopieren', t('openintrapdf.seiten.kopieren'), ClipboardCopy, s.zwischenablage.kopieren, { gross: false, gesperrt: s.keineAuswahl, titel: t('openintrapdf.seiten.kopierenHinweis') }),
                    aktion('ausschneiden', t('openintrapdf.seiten.ausschneiden'), Scissors, s.zwischenablage.ausschneiden, { gross: false, gesperrt: s.keineAuswahl, titel: t('openintrapdf.seiten.ausschneidenHinweis') }),
                    aktion('einfuegen', t('openintrapdf.seiten.einfuegen'), ClipboardPaste, s.zwischenablage.einfuegen, {
                        gesperrt: s.zwischenablage.leer, titel: t(s.zwischenablage.leer ? 'openintrapdf.seiten.einfuegenLeer' : 'openintrapdf.seiten.einfuegenHinweis'),
                    }),
                ],
            },
            {
                id: 'einfuegen',
                name: t('openintrapdf.seiten.einfuegenTitel'),
                knoepfe: [
                    aktion('leereSeite', t('openintrapdf.seiten.leereSeite'), FilePlus, s.leereSeite, { titel: t('openintrapdf.seiten.leereSeiteHinweis') }),
                    ...(s.seitenAusDatei ? [aktion('seitenAusDatei', t('openintrapdf.seiten.seitenAusDatei'), FileInput, s.seitenAusDatei, { titel: t('openintrapdf.seiten.seitenAusDateiHinweis') })] : []),
                ],
            },
            {
                id: 'reihenfolge',
                name: t('openintrapdf.seiten.reihenfolge'),
                knoepfe: [
                    aktion('nachVorn', t('openintrapdf.seiten.nachVorn'), ArrowLeft, s.nachVorn, { gesperrt: s.keineAuswahl }),
                    aktion('nachHinten', t('openintrapdf.seiten.nachHinten'), ArrowRight, s.nachHinten, { gesperrt: s.keineAuswahl }),
                ],
            },
            {
                id: 'pruefen',
                name: t('openintrapdf.seiten.leereTitel'),
                knoepfe: [aktion('leerPruefen', t('openintrapdf.seiten.leerPruefen'), ScanSearch, s.leerPruefen, { gesperrt: s.leerLaeuft })],
            },
        ];
        if (s.extrahieren) {
            const extrahieren = s.extrahieren;
            gruppen.push({
                id: 'neueDateien',
                name: t('openintrapdf.seiten.neueDateien'),
                knoepfe: [
                    aktion('extrahieren', t('openintrapdf.seiten.extrahieren'), FileOutput, () => extrahieren('one'), { gesperrt: s.keineAuswahl || s.extraktLaeuft }),
                    aktion('teilen', t('openintrapdf.seiten.teilen'), Scissors, () => extrahieren('each'), { gesperrt: s.keineAuswahl || s.extraktLaeuft }),
                ],
            });
        }
        reiter.push({ id: 'seiten', name: t('openintrapdf.werkzeugband.reiter.seiten'), gruppen, gesperrt: s.gesperrt ?? undefined });
    }

    // ---------------------------------------------------------------
    // Werkzeuge: öffnen das jeweilige Werkzeug im Arbeitsfach
    // ---------------------------------------------------------------
    const werkzeuge: WerkzeugbandKnopf[] = [];
    if (l.werkzeuge.ocr) werkzeuge.push({ id: 'ocr', text: t('openintrapdf.werkzeugband.knopf.texterkennung'), symbol: ScanText, onClick: l.werkzeuge.ocr.oeffnen, gross: true, gedrueckt: l.werkzeuge.ocr.offen });
    if (l.werkzeuge.export) werkzeuge.push({ id: 'export', text: t('openintrapdf.export.titel'), symbol: FileOutput, onClick: l.werkzeuge.export.oeffnen, gross: true, gedrueckt: l.werkzeuge.export.offen });
    if (l.werkzeuge.binden) werkzeuge.push({ id: 'binden', text: t('openintrapdf.binden.titel'), symbol: Combine, onClick: l.werkzeuge.binden.oeffnen, gross: true, gedrueckt: l.werkzeuge.binden.offen });
    if (werkzeuge.length) {
        reiter.push({
            id: 'werkzeuge',
            name: t('openintrapdf.werkzeugband.reiter.werkzeuge'),
            gruppen: [{ id: 'werkzeuge', name: t('openintrapdf.werkzeugband.gruppe.werkzeuge'), knoepfe: werkzeuge }],
        });
    }

    // ---------------------------------------------------------------
    // Ansicht
    // ---------------------------------------------------------------
    const a = l.ansicht;
    const leisten: WerkzeugbandKnopf[] = [];
    if (a.seitenleiste) leisten.push({ id: 'seitenleiste', text: t('openintrapdf.werkzeugband.knopf.seitenleiste'), symbol: PanelLeft, onClick: a.seitenleiste.umschalten, gross: true, gedrueckt: a.seitenleiste.offen });
    if (a.arbeitsfach) leisten.push({ id: 'arbeitsfach', text: t('openintrapdf.werkzeugband.knopf.arbeitsfach'), symbol: PanelRight, onClick: a.arbeitsfach.umschalten, gross: true, gedrueckt: a.arbeitsfach.offen });
    leisten.push({ id: 'werkzeugband', text: t('openintrapdf.werkzeugband.knopf.werkzeugbandEinklappen'), symbol: PanelTop, onClick: a.werkzeugband.umschalten, gross: true, gedrueckt: a.werkzeugband.eingeklappt });
    const darstellung: WerkzeugbandKnopf[] = [];
    if (a.thema) {
        const thema = a.thema;
        const wahl = (id: ThemaWahl, knopf: string, symbol: LucideIcon): WerkzeugbandKnopf => ({
            id: knopf, text: t(`openintrapdf.thema.${id}`), symbol, onClick: () => thema.setzen(id), gedrueckt: thema.wahl === id,
        });
        darstellung.push(wahl('hell', 'themaHell', Sun), wahl('dunkel', 'themaDunkel', Moon), wahl('system', 'themaSystem', Monitor));
    }
    if (a.dunklesDokument) {
        const dunkel = a.dunklesDokument;
        darstellung.push({
            id: 'dunkel', text: t('openintrapdf.werkzeugband.knopf.dunklesDokument'), symbol: SunMoon, onClick: dunkel.umschalten, gross: true,
            gedrueckt: dunkel.an, gesperrt: !l.dokument, titel: t('openintrapdf.werkzeugband.knopf.dunklesDokumentHinweis'),
        });
    }
    const ansicht: WerkzeugbandGruppe[] = [{ id: 'leisten', name: t('openintrapdf.werkzeugband.gruppe.leisten'), knoepfe: leisten }];
    if (darstellung.length) ansicht.push({ id: 'darstellung', name: t('openintrapdf.thema.titel'), knoepfe: darstellung });
    reiter.push({ id: 'ansicht', name: t('openintrapdf.werkzeugband.reiter.ansicht'), gruppen: ansicht });

    // ---------------------------------------------------------------
    // Datei-Menü
    // ---------------------------------------------------------------
    const d = l.datei;
    const datei: DateiEintrag[] = [];
    if (d.neueFassung) datei.push({ id: 'neueFassung', text: t('openintrapdf.aktion.neueFassung'), symbol: Save, onClick: d.neueFassung.onClick, gesperrt: d.neueFassung.gesperrt });
    if (d.neueDatei) datei.push({ id: 'neueDatei', text: t('openintrapdf.aktion.neueDatei'), symbol: Save, onClick: d.neueDatei.onClick, gesperrt: d.neueDatei.gesperrt });
    if (d.herunterladen) datei.push({ id: 'herunterladen', text: t('openintrapdf.aktion.herunterladen'), symbol: Download, onClick: d.herunterladen.onClick, gesperrt: d.herunterladen.laeuft, titel: t('openintrapdf.aktion.herunterladenHinweis') });
    if (d.drucken) datei.push({ id: 'drucken', text: t('openintrapdf.aktion.drucken'), symbol: Printer, onClick: d.drucken.onClick, gesperrt: d.drucken.laeuft || !l.dokument || !!d.drucken.gesperrt, titel: d.drucken.gesperrt ?? t('openintrapdf.aktion.druckenHinweis') });
    if (d.schnelldruck) datei.push({ id: 'schnelldruck', text: t('openintrapdf.druck.schnelldruck'), symbol: Zap, onClick: d.schnelldruck.onClick, gesperrt: d.schnelldruck.laeuft || !l.dokument || !!d.schnelldruck.gesperrt, titel: d.schnelldruck.gesperrt ?? t('openintrapdf.druck.schnelldruckHinweis') });
    if (d.geschuetzt) datei.push({ id: 'geschuetzt', text: t('openintrapdf.schutz.menue'), symbol: Lock, onClick: d.geschuetzt, gesperrt: !l.dokument, titel: t('openintrapdf.schutz.menueHinweis') });
    if (d.kennwortEntfernen) datei.push({ id: 'kennwortEntfernen', text: t('openintrapdf.schutz.kennwortEntfernen'), symbol: LockOpen, onClick: d.kennwortEntfernen, gesperrt: !l.dokument, titel: t('openintrapdf.schutz.kennwortEntfernenHinweis') });
    if (d.rechteKennwort) datei.push({ id: 'rechteKennwort', text: t('openintrapdf.schutz.rechteKennwortEingeben'), symbol: KeyRound, onClick: d.rechteKennwort, gesperrt: !l.dokument, titel: t('openintrapdf.schutz.rechteKennwortEingebenHinweis') });
    if (d.eigenschaften) datei.push({ id: 'eigenschaften', text: t('openintrapdf.eigenschaften.titel'), symbol: Info, onClick: d.eigenschaften, gesperrt: !l.dokument });
    if (d.fassungen) datei.push({ id: 'fassungen', text: t('openintrapdf.fassungen.titel'), symbol: History, onClick: d.fassungen.oeffnen, gesperrt: !l.dokument });
    datei.push({ id: 'schliessen', text: t('openintrapdf.aktion.schliessen'), symbol: X, onClick: d.schliessen, titel: t('openintrapdf.aktion.schliessenTaste') });

    return { reiter, datei };
}

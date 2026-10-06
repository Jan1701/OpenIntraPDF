// SPDX-License-Identifier: Apache-2.0
//
// Typen des gemeinsamen Werkzeugbands: Reiter → Gruppen → Knöpfe als schlichte
// Datenstruktur. Welche Reiter es gibt, sagt der Aufrufer (OpenIntraPDF:
// openintrapdf/werkzeugbandAufbau.tsx); der Baustein kennt nur diese Struktur.

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Ein Eintrag in einem Menü: Datei-Menü, Menü- oder Teilungsknopf. */
export interface WerkzeugbandMenueEintrag {
    id: string;
    text: string;
    symbol?: LucideIcon;
    onClick: () => void;
    gesperrt?: boolean;
    /** Hinweis beim Darüberfahren, etwa der Sperrgrund. */
    titel?: string;
    /** Tastenbuchstabe (nur im Datei-Menü ausgewertet); fehlt er, wird einer vergeben. */
    taste?: string;
    /**
     * Wahl im Menü: `eins` — eine aus mehreren (Lesebereich Rechts/Unten/Aus,
     * `menuitemradio`); `mehrere` — Haken (Kategorien, `menuitemcheckbox`).
     * `an` sagt, ob der Eintrag gewählt ist.
     */
    wahl?: 'eins' | 'mehrere';
    an?: boolean;
    /** Trennlinie vor diesem Eintrag. */
    trennerDavor?: boolean;
}

/**
 * Ein Knopf im Band.
 *
 * - `gross`: Symbol über Text (Hauptaktionen); sonst klein (Symbol neben Text).
 *   Einzeilig sind alle Knöpfe klein.
 * - `gedrueckt`: Umschalter (`aria-pressed`).
 * - `menue`: mit `onClick` ein Teilungsknopf (der Hauptteil löst aus, ▾ öffnet
 *   das Menü — „Neue E-Mail ▾“), ohne `onClick` ein Menüknopf (der ganze Knopf
 *   öffnet das Menü — „Verschieben ▾“).
 */
export interface WerkzeugbandKnopf {
    art?: 'knopf';
    /** Kennung — für Tastenbuchstaben und Tests; je Reiter eindeutig. */
    id: string;
    text: string;
    symbol: LucideIcon;
    onClick?: () => void;
    gross?: boolean;
    gedrueckt?: boolean;
    gesperrt?: boolean;
    titel?: string;
    /** Tastenbuchstabe; fehlt er, wird einer aus der Beschriftung vergeben. */
    taste?: string;
    menue?: WerkzeugbandMenueEintrag[];
}

/** Ein Kontrollkästchen im Band („Als Unterhaltungen anzeigen“). */
export interface WerkzeugbandKontrollkaestchen {
    art: 'kontrollkaestchen';
    id: string;
    text: string;
    an: boolean;
    onWechsel: (an: boolean) => void;
    gesperrt?: boolean;
    titel?: string;
    taste?: string;
}

export type WerkzeugbandElement = WerkzeugbandKnopf | WerkzeugbandKontrollkaestchen;

export interface WerkzeugbandGruppe {
    id: string;
    /** Klassisch sichtbar unter den Knöpfen; einzeilig nur als Name der Gruppe für Bildschirmleser. */
    name: string;
    knoepfe?: WerkzeugbandElement[];
    /** Eigener Inhalt (Seitenfeld, Zoomliste, Farbfelder) rechts neben den Knöpfen. */
    inhalt?: ReactNode;
    /**
     * Die einzeilige Fassung von `inhalt` (höchstens 32 px hoch). Fehlt sie,
     * steht `inhalt` in der einzeiligen Darstellung nur im Überlaufmenü „…“.
     */
    inhaltEinzeilig?: ReactNode;
}

export interface WerkzeugbandReiter<R extends string = string> {
    id: R;
    name: string;
    gruppen: WerkzeugbandGruppe[];
    /** Grund, warum der Reiter gerade nicht bedienbar ist (gesperrt, aber sichtbar). */
    gesperrt?: string;
    taste?: string;
}

/** Die drei Darstellungen des Bandes. */
export type WerkzeugbandDarstellungWert = 'einzeilig' | 'klassisch' | 'eingeklappt';

/** Die Form des offenen Bandes — auch des vorübergehend geöffneten im eingeklappten Zustand. */
export type WerkzeugbandBandform = Exclude<WerkzeugbandDarstellungWert, 'eingeklappt'>;

/** Zustand der Darstellung, wie ihn `useWerkzeugbandDarstellung` liefert. */
export interface WerkzeugbandDarstellung {
    /** Was gerade gilt. */
    wert: WerkzeugbandDarstellungWert;
    bandform: WerkzeugbandBandform;
    eingeklappt: boolean;
    setzen: (w: WerkzeugbandDarstellungWert) => void;
    /** Ein-/Ausklappen; ausgeklappt gilt wieder die zuletzt gewählte Bandform. */
    einklappen: (e: boolean) => void;
}

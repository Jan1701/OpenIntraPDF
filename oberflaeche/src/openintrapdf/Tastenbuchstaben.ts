// SPDX-License-Identifier: Apache-2.0
//
// Tastenbuchstaben des PDF-Werkzeugbands (Vertrag Etappe 7, Abschnitt 2.6).
//
// `Alt` kurz drücken und loslassen blendet an den Reitern Buchstaben ein;
// der Buchstabe wählt den Reiter, danach erscheinen die Buchstaben seiner
// Knöpfe. Die Logik steckt im gemeinsamen Baustein
// (components/shared/werkzeugband/tastenbuchstaben.ts); OpenIntraPDF gibt seine
// Buchstaben je Sprache fest vor und hängt sie in Werkzeugband.tsx an Reiter,
// Knöpfe und Datei-Einträge — nichts wird aus Beschriftungen abgeleitet,
// damit sich die Buchstaben nicht mit jeder Übersetzung ändern. Innerhalb
// einer Ebene (alle Reiter; alle Knöpfe EINES Reiters) kommt kein Buchstabe
// doppelt vor (Tastenbuchstaben.test.ts prüft das). Fehlt eine Sprache,
// gilt Englisch.
//
// Die Kennungen sind die `id`s aus werkzeugbandAufbau.tsx. Ein Knopf ohne
// Eintrag bekäme vom Baustein einen freien Buchstaben aus seiner
// Beschriftung — der Test verlangt trotzdem für jeden einen festen.

import { idZuTaste } from '../components/shared/werkzeugband';

export type WerkzeugbandReiterId = 'start' | 'kommentieren' | 'einfuegen' | 'seiten' | 'werkzeuge' | 'ansicht';

/** Das Datei-Menü ist kein Reiter mit Band, bekommt aber wie einer einen Buchstaben. */
export type TastenReiterId = WerkzeugbandReiterId | 'datei';

export interface TastenTabelle {
    reiter: Record<TastenReiterId, string>;
    knoepfe: Record<TastenReiterId, Record<string, string>>;
}

const DEUTSCH: TastenTabelle = {
    reiter: { datei: 'D', start: 'S', kommentieren: 'K', einfuegen: 'F', seiten: 'E', werkzeuge: 'W', ansicht: 'A' },
    knoepfe: {
        datei: {
            neueFassung: 'F', neueDatei: 'N', herunterladen: 'H', drucken: 'D', schnelldruck: 'L', eigenschaften: 'E', fassungen: 'V', schliessen: 'S',
            geschuetzt: 'G', kennwortEntfernen: 'K', rechteKennwort: 'R',
        },
        start: {
            erste: 'E', vorige: 'V', naechste: 'N', letzte: 'L', kleiner: 'K', groesser: 'G', seitenbreite: 'B', ganzeSeite: 'Z',
            suchen: 'S', zeigerText: 'T', zeigerHand: 'H', kommentare: 'M',
        },
        kommentieren: {
            note: 'N', sticky: 'P', freetext: 'T', highlight: 'H', underline: 'U', strikeout: 'D', ink: 'F', line: 'L', arrow: 'I',
            square: 'R', circle: 'E', stamp: 'S', kommentarliste: 'K', anmerkungen: 'A',
        },
        seiten: {
            alleWaehlen: 'A', auswahlAufheben: 'U', linksDrehen: 'L', rechtsDrehen: 'R', entfernen: 'E', wiederherstellen: 'W',
            duplizieren: 'D', nachVorn: 'V', nachHinten: 'H', leerPruefen: 'P', extrahieren: 'N', teilen: 'T',
            leereSeite: 'S', seitenAusDatei: 'I', kopieren: 'K', ausschneiden: 'X', einfuegen: 'F',
        },
        einfuegen: { link: 'L' },
        werkzeuge: { ocr: 'T', export: 'E', binden: 'B' },
        ansicht: { seitenleiste: 'S', arbeitsfach: 'A', werkzeugband: 'R', themaHell: 'H', themaDunkel: 'D', themaSystem: 'W', dunkel: 'U' },
    },
};

const ENGLISCH: TastenTabelle = {
    reiter: { datei: 'F', start: 'H', kommentieren: 'C', einfuegen: 'I', seiten: 'P', werkzeuge: 'T', ansicht: 'V' },
    knoepfe: {
        datei: {
            neueFassung: 'V', neueDatei: 'N', herunterladen: 'D', drucken: 'P', schnelldruck: 'Q', eigenschaften: 'R', fassungen: 'H', schliessen: 'C',
            geschuetzt: 'T', kennwortEntfernen: 'M', rechteKennwort: 'W',
        },
        start: {
            erste: 'F', vorige: 'P', naechste: 'N', letzte: 'L', kleiner: 'K', groesser: 'G', seitenbreite: 'W', ganzeSeite: 'O',
            suchen: 'S', zeigerText: 'T', zeigerHand: 'H', kommentare: 'C',
        },
        kommentieren: {
            note: 'N', sticky: 'S', freetext: 'T', highlight: 'H', underline: 'U', strikeout: 'K', ink: 'F', line: 'L', arrow: 'A',
            square: 'R', circle: 'E', stamp: 'P', kommentarliste: 'C', anmerkungen: 'V',
        },
        seiten: {
            alleWaehlen: 'A', auswahlAufheben: 'C', linksDrehen: 'L', rechtsDrehen: 'R', entfernen: 'D', wiederherstellen: 'S',
            duplizieren: 'U', nachVorn: 'F', nachHinten: 'B', leerPruefen: 'N', extrahieren: 'E', teilen: 'P',
            leereSeite: 'K', seitenAusDatei: 'I', kopieren: 'Y', ausschneiden: 'X', einfuegen: 'V',
        },
        einfuegen: { link: 'L' },
        werkzeuge: { ocr: 'O', export: 'E', binden: 'M' },
        ansicht: { seitenleiste: 'S', arbeitsfach: 'A', werkzeugband: 'R', themaHell: 'L', themaDunkel: 'D', themaSystem: 'Y', dunkel: 'K' },
    },
};

export const TASTENBUCHSTABEN: Record<'de' | 'en', TastenTabelle> = { de: DEUTSCH, en: ENGLISCH };

/** Die Tabelle zur Sprache der Oberfläche (`de`, `de-CH` …); sonst Englisch. */
export function tastenbuchstaben(sprache: string | undefined): TastenTabelle {
    const kurz = (sprache ?? '').toLowerCase().split(/[-_]/)[0];
    return kurz === 'de' ? DEUTSCH : ENGLISCH;
}

/** Der Reiter zu einer gedrückten Taste, oder `null`. */
export function reiterZuTaste(tabelle: TastenTabelle, taste: string): TastenReiterId | null {
    return idZuTaste(tabelle.reiter, taste) as TastenReiterId | null;
}

/** Die Knopfkennung zu einer gedrückten Taste im gewählten Reiter, oder `null`. */
export function knopfZuTaste(tabelle: TastenTabelle, reiter: TastenReiterId, taste: string): string | null {
    return idZuTaste(tabelle.knoepfe[reiter] ?? {}, taste);
}

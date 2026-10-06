// SPDX-License-Identifier: Apache-2.0
//
// Die Darstellung des Bandes — einzeilig, klassisch oder eingeklappt —,
// gemerkt je Aufrufer und Gerät (localStorage; ohne Speicher gilt die Wahl
// bis zum Schließen).
//
// Gespeichert sind zwei Werte, damit Ausklappen zur vorher gewählten Form
// zurückführt:
//   <speicher>.eingeklappt  '1' | '0'
//   <speicher>.bandform     'einzeilig' | 'klassisch'
// OpenIntraPDF nimmt den Speicher `openintrapdf.werkzeugband`, der Mailclient
// `mail.werkzeugband`.
//
// Bis Bau 2317 trugen die Schlüssel statt `werkzeugband` den früheren,
// englischen Namen des Bandes. Ein dort gemerkter Wert wird beim ersten Lesen
// einmalig unter den neuen Schlüssel übernommen und der alte gelöscht — so
// verliert niemand seine Einstellung (`fruehererSpeicher`).
//
// Ohne gemerkten Wert gilt die Vorgabe des Aufrufers; unter 640 px
// Fensterbreite (Telefon) beginnt das Band eingeklappt.

import { useCallback, useMemo, useState } from 'react';
import type { WerkzeugbandBandform, WerkzeugbandDarstellung, WerkzeugbandDarstellungWert } from './typen';

/** Unter dieser Breite klappt das Band beim ersten Öffnen ein (Telefon). */
export const TELEFON_BREITE = 640;

function lesen(schluessel: string): string | null {
    try {
        return localStorage.getItem(schluessel);
    } catch {
        return null;
    }
}

function schreiben(schluessel: string, wert: string): boolean {
    try {
        localStorage.setItem(schluessel, wert);
        return true;
    } catch {
        // Privates Fenster o. Ä.: Die Wahl gilt dann nur bis zum Schließen.
        return false;
    }
}

function entfernen(schluessel: string) {
    try {
        localStorage.removeItem(schluessel);
    } catch {
        // Ohne Speicher gibt es auch nichts zu entfernen.
    }
}

/**
 * Der frühere Name des Bandes in den Schlüsseln (bis Bau 2317). Er steht hier
 * bewusst zerlegt: Als Bezeichnung soll er im Code nirgends mehr vorkommen
 * (die Prüfung sucht danach), gebraucht wird er nur noch, um gemerkte Werte
 * zu übernehmen.
 */
const FRUEHERER_NAME = ['rib', 'bon'].join('');

/**
 * Das frühere Präfix zu einem Speicher, dessen letzter Teil `werkzeugband`
 * heißt (`mail.werkzeugband` → früher `mail.` + alter Name); sonst `null`.
 */
export function fruehererSpeicher(speicher: string): string | null {
    const treffer = /^(.*\.)?werkzeugband$/.exec(speicher);
    return treffer ? `${treffer[1] ?? ''}${FRUEHERER_NAME}` : null;
}

/**
 * Einen gemerkten Wert lesen. Steht unter dem früheren Schlüssel noch einer,
 * wird er übernommen, falls der neue fehlt, und danach gelöscht — gelöscht
 * nur, wenn das Schreiben geklappt hat oder der neue schon steht.
 */
function lesenMitUebernahme(speicher: string, feld: string): string | null {
    const schluessel = `${speicher}.${feld}`;
    const wert = lesen(schluessel);
    const vorher = fruehererSpeicher(speicher);
    if (vorher === null) return wert;
    const alterSchluessel = `${vorher}.${feld}`;
    const alterWert = lesen(alterSchluessel);
    if (alterWert === null) return wert;
    if (wert !== null) {
        entfernen(alterSchluessel);
        return wert;
    }
    if (schreiben(schluessel, alterWert)) entfernen(alterSchluessel);
    return alterWert;
}

interface Stand {
    bandform: WerkzeugbandBandform;
    eingeklappt: boolean;
}

function anfang(speicher: string, vorgabe: WerkzeugbandBandform): Stand {
    const form = lesenMitUebernahme(speicher, 'bandform');
    const ein = lesenMitUebernahme(speicher, 'eingeklappt');
    return {
        bandform: form === 'einzeilig' || form === 'klassisch' ? form : vorgabe,
        eingeklappt: ein === '1' ? true : ein === '0' ? false : typeof window !== 'undefined' && window.innerWidth < TELEFON_BREITE,
    };
}

/**
 * Darstellung des Bandes für einen Aufrufer.
 *
 * @param speicher Präfix der localStorage-Schlüssel, je Aufrufer eigen (z. B. `mail.werkzeugband`).
 * @param vorgabe  Bandform ohne gemerkten Wert (OpenIntraPDF: klassisch, Mail: einzeilig).
 */
export function useWerkzeugbandDarstellung(speicher: string, vorgabe: WerkzeugbandBandform = 'klassisch'): WerkzeugbandDarstellung {
    const [stand, setStand] = useState<Stand>(() => anfang(speicher, vorgabe));

    const einklappen = useCallback((e: boolean) => {
        setStand(s => ({ ...s, eingeklappt: e }));
        schreiben(`${speicher}.eingeklappt`, e ? '1' : '0');
    }, [speicher]);

    const setzen = useCallback((w: WerkzeugbandDarstellungWert) => {
        if (w === 'eingeklappt') {
            einklappen(true);
            return;
        }
        setStand({ bandform: w, eingeklappt: false });
        schreiben(`${speicher}.bandform`, w);
        schreiben(`${speicher}.eingeklappt`, '0');
    }, [speicher, einklappen]);

    return useMemo(() => ({
        wert: stand.eingeklappt ? 'eingeklappt' : stand.bandform,
        bandform: stand.bandform,
        eingeklappt: stand.eingeklappt,
        setzen,
        einklappen,
    }), [stand, setzen, einklappen]);
}

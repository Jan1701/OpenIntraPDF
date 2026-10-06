// SPDX-License-Identifier: Apache-2.0
//
// Tastenbuchstaben des Werkzeugbands: `Alt` kurz drücken und loslassen blendet an
// den Reitern Buchstaben ein, der Buchstabe wählt den Reiter, danach stehen
// die Buchstaben seiner Knöpfe da.
//
// Je Ebene (alle Reiter samt Datei-Menü; alle Knöpfe EINES Reiters; die
// Einträge des Datei-Menüs) kommt kein Buchstabe doppelt vor. Der Aufrufer
// kann Buchstaben vorgeben (`taste`) — OpenIntraPDF tut das mit seiner
// festen Tabelle je Sprache, damit sich die Buchstaben nicht mit jeder
// Übersetzung ändern. Wo nichts vorgegeben ist, gilt der Anfangsbuchstabe
// der Beschriftung, bei Doppelung der nächste freie Buchstabe aus ihr, dann
// irgendein freier von A bis Z, dann eine Ziffer.

export interface TastenQuelle {
    id: string;
    text: string;
    taste?: string;
}

const RESERVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Nur Buchstaben und Ziffern taugen als Taste. */
function tauglich(z: string): boolean {
    return /^[\p{L}\p{N}]$/u.test(z);
}

/** Vergibt je Eintrag einen Buchstaben, ohne Doppelung. Vorgaben gehen vor; eine doppelte Vorgabe zählt nur beim ersten. */
export function tastenVergeben(eintraege: readonly TastenQuelle[]): Record<string, string> {
    const vergeben: Record<string, string> = {};
    const belegt = new Set<string>();
    for (const e of eintraege) {
        const v = e.taste?.toUpperCase();
        if (v && v.length === 1 && tauglich(v) && !belegt.has(v)) {
            vergeben[e.id] = v;
            belegt.add(v);
        }
    }
    for (const e of eintraege) {
        if (vergeben[e.id]) continue;
        const kandidaten = [...e.text.toUpperCase()].filter(tauglich).concat([...RESERVE]);
        const frei = kandidaten.find(z => !belegt.has(z));
        if (!frei) continue;
        vergeben[e.id] = frei;
        belegt.add(frei);
    }
    return vergeben;
}

/** Die Kennung zur gedrückten Taste, oder `null`. Groß-/Kleinschreibung zählt nicht. */
export function idZuTaste(vergeben: Readonly<Record<string, string>>, taste: string): string | null {
    const t = taste.toUpperCase();
    for (const [id, buchstabe] of Object.entries(vergeben)) {
        if (buchstabe === t) return id;
    }
    return null;
}

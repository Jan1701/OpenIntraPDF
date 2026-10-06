// SPDX-License-Identifier: Apache-2.0
//
// Rechte einer fremd geschützten PDF (Etappe 9, Vertrag Abschnitt 3), wie
// pdf.js sie aus dem Encrypt-Wörterbuch liest: `getPermissions()` liefert
// die gesetzten Flags (ISO 32000-1, Tabelle 22) oder `null`, wenn die
// Datei nicht geschützt ist. Reine Funktionen; die Sperren zieht der
// Arbeitsplatz, aufheben kann sie das Rechte-Kennwort für die Sitzung.

/** pdf.js `PermissionFlag` — fest, damit Tests ohne pdf.js auskommen. */
export const FLAG = {
    PRINT: 0b100,
    MODIFY_CONTENTS: 0b1000,
    COPY: 0b10000,
    MODIFY_ANNOTATIONS: 0b100000,
    FILL_INTERACTIVE_FORMS: 0b100000000,
    COPY_FOR_ACCESSIBILITY: 0b1000000000,
    ASSEMBLE: 0b10000000000,
    PRINT_HIGH_QUALITY: 0b100000000000,
} as const;

/** Was die Datei erlaubt; `true` heißt erlaubt. */
export interface DokumentRechte {
    drucken: boolean;
    kopieren: boolean;
    aendern: boolean;
    kommentieren: boolean;
    ausfuellen: boolean;
}

/**
 * Die Rechte aus den Flags von `getPermissions()`; `null`, wenn nichts
 * eingeschränkt ist (keine Verschlüsselung oder alles erlaubt). Ändern
 * gilt auch mit „Zusammenstellen“ (Seiten einfügen, drehen, löschen), wie
 * der Server es prüft; Kommentieren schließt Ausfüllen ein.
 */
export function rechteAusFlags(flags: Iterable<number> | null | undefined): DokumentRechte | null {
    if (!flags) return null;
    const menge = new Set(flags);
    const r: DokumentRechte = {
        drucken: menge.has(FLAG.PRINT) || menge.has(FLAG.PRINT_HIGH_QUALITY),
        kopieren: menge.has(FLAG.COPY),
        aendern: menge.has(FLAG.MODIFY_CONTENTS) || menge.has(FLAG.ASSEMBLE),
        kommentieren: menge.has(FLAG.MODIFY_ANNOTATIONS),
        ausfuellen: menge.has(FLAG.FILL_INTERACTIVE_FORMS) || menge.has(FLAG.MODIFY_ANNOTATIONS),
    };
    return r.drucken && r.kopieren && r.aendern && r.kommentieren && r.ausfuellen ? null : r;
}

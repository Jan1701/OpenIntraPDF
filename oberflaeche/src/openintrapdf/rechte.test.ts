// SPDX-License-Identifier: Apache-2.0
//
// Rechte aus den pdf.js-Flags (Etappe 9, Abschnitt 3).

import { describe, expect, it } from 'vitest';
import { FLAG, rechteAusFlags } from './rechte';

describe('rechteAusFlags', () => {
    it('ohne Schutz oder mit allen Rechten gibt es keine Einschränkung', () => {
        expect(rechteAusFlags(null)).toBeNull();
        expect(rechteAusFlags(undefined)).toBeNull();
        expect(rechteAusFlags(Object.values(FLAG))).toBeNull();
        expect(rechteAusFlags([FLAG.PRINT, FLAG.COPY, FLAG.MODIFY_CONTENTS, FLAG.MODIFY_ANNOTATIONS])).toBeNull();
    });

    it('nur Drucken: alles andere ist gesperrt; Kommentieren schließt Ausfüllen ein; Zusammenstellen zählt als Ändern', () => {
        expect(rechteAusFlags([FLAG.PRINT, FLAG.PRINT_HIGH_QUALITY])).toEqual({ drucken: true, kopieren: false, aendern: false, kommentieren: false, ausfuellen: false });
        expect(rechteAusFlags([])).toEqual({ drucken: false, kopieren: false, aendern: false, kommentieren: false, ausfuellen: false });
        expect(rechteAusFlags([FLAG.MODIFY_ANNOTATIONS])).toMatchObject({ kommentieren: true, ausfuellen: true, aendern: false });
        expect(rechteAusFlags([FLAG.ASSEMBLE])).toMatchObject({ aendern: true, kopieren: false });
        expect(rechteAusFlags(new Set([FLAG.FILL_INTERACTIVE_FORMS, FLAG.COPY_FOR_ACCESSIBILITY]))).toMatchObject({ ausfuellen: true, kommentieren: false, kopieren: false });
    });
});

// SPDX-License-Identifier: Apache-2.0
//
// Die Tastenbuchstaben des Werkzeugbands: je Sprache fest, innerhalb einer Ebene
// ohne Doppelung, und jeder Knopf, den werkzeugbandAufbau.tsx bauen kann, hat
// einen — sonst bliebe er mit Alt unerreichbar.

import { describe, expect, it } from 'vitest';
import { knopfZuTaste, reiterZuTaste, TASTENBUCHSTABEN, tastenbuchstaben } from './Tastenbuchstaben';
import type { TastenReiterId } from './Tastenbuchstaben';
import { reiterBauen } from './werkzeugbandAufbau';
import type { WerkzeugbandLage } from './werkzeugbandAufbau';

const nichts = () => undefined;
const fach = { offen: false, oeffnen: nichts };

/** Eine Lage, in der es alles gibt — so viele Knöpfe wie möglich. */
function volleLage(): WerkzeugbandLage {
    return {
        t: ((k: string) => k) as WerkzeugbandLage['t'],
        lesen: true,
        dokument: true,
        datei: {
            neueFassung: { gesperrt: false, onClick: nichts },
            neueDatei: { gesperrt: false, onClick: nichts },
            herunterladen: { laeuft: false, onClick: nichts },
            drucken: { laeuft: false, onClick: nichts },
            schnelldruck: { laeuft: false, onClick: nichts },
            eigenschaften: nichts,
            fassungen: fach,
            geschuetzt: nichts,
            kennwortEntfernen: nichts,
            rechteKennwort: nichts,
            schliessen: nichts,
        },
        navigation: { seite: 2, seitenzahl: 3, zuSeite: nichts, blaettern: nichts, feld: null },
        zoom: { zoomen: nichts, auswahl: null, vorgabe: null },
        suche: { offen: false, oeffnen: nichts },
        zeiger: { wert: 'text', setzen: nichts },
        kommentareLesen: fach,
        kommentieren: { gesperrt: null, werkzeug: null, setWerkzeug: nichts, aussehen: null, liste: fach, anmerkungen: { sichtbar: true, umschalten: nichts } },
        einfuegen: { gesperrt: null, werkzeug: null, setWerkzeug: nichts },
        seiten: {
            bedienbar: true, gesperrt: null, keineAuswahl: false, alleEntfernt: false, alleWaehlen: nichts, auswahlAufheben: nichts,
            drehen: nichts, entfernen: nichts, wiederherstellen: nichts, duplizieren: nichts, nachVorn: nichts, nachHinten: nichts,
            leerLaeuft: false, leerPruefen: nichts, extrahieren: nichts, extraktLaeuft: false, leereSeite: nichts, seitenAusDatei: nichts,
            zwischenablage: { leer: false, kopieren: nichts, ausschneiden: nichts, einfuegen: nichts },
        },
        werkzeuge: { ocr: fach, export: fach, binden: fach },
        ansicht: {
            seitenleiste: { offen: true, umschalten: nichts },
            arbeitsfach: { offen: false, umschalten: nichts },
            werkzeugband: { eingeklappt: false, umschalten: nichts },
            thema: { wahl: 'system', setzen: nichts },
            dunklesDokument: { an: false, umschalten: nichts },
        },
    };
}

describe('Tastenbuchstaben', () => {
    for (const [sprache, tabelle] of Object.entries(TASTENBUCHSTABEN)) {
        it(`${sprache}: Reiter und Knöpfe je Ebene ohne Doppelung, nur Großbuchstaben`, () => {
            const reiter = Object.values(tabelle.reiter);
            expect(new Set(reiter).size).toBe(reiter.length);
            for (const b of reiter) expect(b).toMatch(/^[A-Z]$/);
            for (const [id, knoepfe] of Object.entries(tabelle.knoepfe)) {
                const buchstaben = Object.values(knoepfe);
                expect(new Set(buchstaben).size, `Reiter ${id}`).toBe(buchstaben.length);
                for (const b of buchstaben) expect(b).toMatch(/^[A-Z]$/);
            }
        });

        it(`${sprache}: jeder Knopf, den das Werkzeugband bauen kann, hat einen Buchstaben`, () => {
            const { reiter, datei } = reiterBauen(volleLage());
            for (const r of reiter) {
                const ids = r.gruppen.flatMap(g => (g.knoepfe ?? []).map(k => k.id));
                for (const id of ids) expect(tabelle.knoepfe[r.id][id], `${sprache}: ${r.id}/${id}`).toMatch(/^[A-Z]$/);
                expect(tabelle.reiter[r.id]).toMatch(/^[A-Z]$/);
            }
            for (const d of datei) expect(tabelle.knoepfe.datei[d.id], `${sprache}: datei/${d.id}`).toMatch(/^[A-Z]$/);
        });
    }

    it('Entfernen und Wiederherstellen teilen sich den Platz, nicht den Buchstaben', () => {
        const lage = volleLage();
        lage.seiten!.alleEntfernt = true;
        const seiten = reiterBauen(lage).reiter.find(r => r.id === 'seiten')!;
        const ids = seiten.gruppen.flatMap(g => (g.knoepfe ?? []).map(k => k.id));
        expect(ids).toContain('wiederherstellen');
        expect(ids).not.toContain('entfernen');
        expect(TASTENBUCHSTABEN.de.knoepfe.seiten.wiederherstellen).not.toBe(TASTENBUCHSTABEN.de.knoepfe.seiten.entfernen);
    });

    it('Deutsch für de und de-CH, sonst Englisch; Tasten werden unabhängig von der Schreibung gefunden', () => {
        expect(tastenbuchstaben('de')).toBe(TASTENBUCHSTABEN.de);
        expect(tastenbuchstaben('de-CH')).toBe(TASTENBUCHSTABEN.de);
        expect(tastenbuchstaben('fr')).toBe(TASTENBUCHSTABEN.en);
        expect(tastenbuchstaben(undefined)).toBe(TASTENBUCHSTABEN.en);
        expect(reiterZuTaste(TASTENBUCHSTABEN.de, 'k')).toBe('kommentieren');
        expect(reiterZuTaste(TASTENBUCHSTABEN.en, 'c')).toBe('kommentieren');
        expect(reiterZuTaste(TASTENBUCHSTABEN.de, 'x')).toBeNull();
        expect(knopfZuTaste(TASTENBUCHSTABEN.de, 'kommentieren', 'n')).toBe('note');
        expect(knopfZuTaste(TASTENBUCHSTABEN.de, 'datei', 'e')).toBe('eigenschaften');
        expect(knopfZuTaste(TASTENBUCHSTABEN.de, 'start' as TastenReiterId, '1')).toBeNull();
    });
});

// SPDX-License-Identifier: Apache-2.0
//
// Texterkennung (Etappe 3): Seitenarten, Auswahlregeln, Auftrag.
//
// Die Erkennung läuft auf dem Server als Auftrag (Vertrag Etappe 3). Die
// Oberfläche reiht ihn ein, fragt alle zwei Sekunden nach, kann ihn
// abbrechen und findet ihn nach dem Neuöffnen wieder — das erledigt der
// gemeinsame Kern in auftrag.ts. Ein fertiger Auftrag ist KEINE Fassung
// (Konzept Kap. 02) — das Ergebnis wird als Vorschau gezeigt und erst
// durch „Als neue Fassung“ oder „Als neue Datei“ etwas, das andere sehen.
//
// Drei Regeln:
//   1. Seiten mit Text (`text`, `gemischt`) werden nie belegt; der Server
//      lehnte das ohnehin mit 422 ab. Sie sind in der Liste gesperrt, mit
//      Grund.
//   2. EIN Idempotency-Key je Startversuch mit demselben Rumpf (wie beim
//      Speichern): Nach einem Netzfehler entsteht kein zweiter Auftrag.
//   3. Was der Server als fertig meldet, wird nur dann wieder aufgegriffen,
//      wenn es nicht schon veröffentlicht ist — erkennbar an der
//      Prüfsumme der aktuellen Fassung oder an `base_version`.

import { useCallback, useEffect, useState } from 'react';
import { useAuftrag } from './auftrag';
import { Vorgaenge } from './speichern';
import { alsHostFehler } from './typen';
import type { OcrBefehl, OcrSprache, PdfAuftrag, PdfHost, PdfHostFehler, SeitenArten, SeitenArtEintrag } from './typen';

export { ABFRAGE_MS, auftragWiederfinden } from './auftrag';
export type { AuftragsAnzeige, Meldung } from './auftrag';

// ---------------------------------------------------------------------
// Auswahlregeln
// ---------------------------------------------------------------------

/** Ob eine Seite belegt werden darf: nur ohne Textebene. */
export function waehlbar(e: SeitenArtEintrag): boolean {
    return e.kind !== 'text' && e.kind !== 'gemischt';
}

/**
 * Standardauswahl: Scans und leere Seiten mit spürbarem Bildanteil —
 * dieselbe Regel, die der Server bei `pages: null` anwendet. Eine leere
 * Seite ohne Bild bleibt wählbar, aber nicht vorgewählt.
 */
export function standardAuswahl(arten: SeitenArten): Set<number> {
    const s = new Set<number>();
    for (const e of arten.pages) {
        if (!waehlbar(e)) continue;
        if (e.kind === 'scan' || (e.kind === 'leer' && e.image_ratio >= 0.5)) s.add(e.page);
    }
    return s;
}

/** Nimmt aus einer Auswahl heraus, was nicht (mehr) wählbar ist. */
export function auswahlBereinigen(auswahl: Set<number>, arten: SeitenArten): Set<number> {
    const erlaubt = new Set(arten.pages.filter(waehlbar).map(e => e.page));
    return new Set([...auswahl].filter(p => erlaubt.has(p)));
}

// ---------------------------------------------------------------------
// Fehler beim Start
// ---------------------------------------------------------------------

export type StartFehlerGrund = 'konflikt' | 'seitenMitText' | 'zuViele' | 'dienst' | 'netz' | 'recht' | 'rechteBits' | 'rechteKennwort' | 'sonst';

export interface StartFehler {
    grund: StartFehlerGrund;
    /** Bei `seitenMitText`: die betroffenen Seiten ab 0. */
    seiten?: number[];
    /** Text des Gastgebers für unbekannte Ablehnungen. */
    meldung?: string;
    wiederholbar: boolean;
}

export function startFehlerEinordnen(f: PdfHostFehler): StartFehler {
    if (f.status === 412 || f.code === 'pdf.version_conflict') return { grund: 'konflikt', wiederholbar: false };
    if (f.code === 'pdf.ocr_page_has_text') {
        const roh = f.params.pages;
        const seiten = Array.isArray(roh) ? roh.map(Number).filter(n => Number.isInteger(n) && n >= 0) : [];
        return { grund: 'seitenMitText', seiten, wiederholbar: false };
    }
    if (f.code === 'pdf.too_many_jobs' || f.status === 429) return { grund: 'zuViele', wiederholbar: true };
    if (f.code === 'pdf.ocr_unavailable' || f.status === 503) return { grund: 'dienst', wiederholbar: true };
    if (f.status === 0) return { grund: 'netz', wiederholbar: true };
    if (f.status >= 500 || f.status === 408) return { grund: 'dienst', wiederholbar: true };
    if (f.status === 401 || f.status === 403) return { grund: 'recht', wiederholbar: false };
    // Die Rechte-Bits der PDF (Kopieren bzw. Ändern) verbieten den Auftrag: mit
    // dem Rechte-Kennwort (Datei → Rechte-Kennwort eingeben) geht es noch einmal.
    if (f.code === 'pdf.permission_restricted') return { grund: 'rechteBits', wiederholbar: true };
    // Das mitgeschickte Rechte-Kennwort stimmt nicht (mehr): Der Arbeitsplatz
    // verwirft es für die Sitzung, die Sperren gelten wieder — wie beim Commit.
    if (f.code === 'pdf.wrong_password') return { grund: 'rechteKennwort', wiederholbar: true };
    return { grund: 'sonst', meldung: f.meldung, wiederholbar: false };
}

// ---------------------------------------------------------------------
// Der Ablauf als Hook
// ---------------------------------------------------------------------

export interface ArtenStand {
    laedt: boolean;
    daten: SeitenArten | null;
    /** Fehlergrund als Schlüsselteil: `dienst`, `netz`, `sonst`. */
    fehler: 'dienst' | 'netz' | 'sonst' | null;
}

interface Optionen {
    host: PdfHost;
    /** Fehlt, solange die Info nicht da ist — dann läuft nichts. */
    fileId?: string;
    version?: number;
    sha256?: string;
    /** Gruppe sichtbar und Dienst verfügbar. */
    verfuegbar: boolean;
    /** Nur für Tests: kürzerer Abfragetakt. */
    abfrageMs?: number;
    /** Ein Auftrag aus einer früheren Sitzung wurde aufgegriffen. */
    onWiedergefunden?: (auftrag: PdfAuftrag) => void;
    /** Das Rechte-Kennwort der Sitzung (nach Prüfung am Gastgeber): geht beim Anlegen mit, wenn die Rechte-Bits der PDF sonst sperren. */
    rechteKennwort?: string | null;
}

const seitenListe = (s: Iterable<number>) => [...s].sort((a, b) => a - b);

export function useTexterkennung({ host, fileId, version, sha256, verfuegbar, abfrageMs, onWiedergefunden, rechteKennwort }: Optionen) {
    const kern = useAuftrag({ host, fileId, version, sha256, verfuegbar, art: 'ocr', abfrageMs, onWiedergefunden });
    const { startBeginnen, startVerworfen, uebernehmen, abschliessen: kernAbschliessen, zuruecksetzen: kernZuruecksetzen } = kern;
    const [arten, setArten] = useState<ArtenStand>({ laedt: false, daten: null, fehler: null });
    const [auswahl, setAuswahl] = useState<Set<number>>(() => new Set());
    const [sprache, setSprache] = useState<OcrSprache>('deu+eng');
    const [vorgaenge] = useState(() => new Vorgaenge());

    // Eine neue Fassung macht Seitenarten und Auswahl ungültig.
    useEffect(() => {
        setArten({ laedt: false, daten: null, fehler: null });
        setAuswahl(new Set());
    }, [version, fileId]);

    const artenLaden = useCallback(async () => {
        if (!host.seitenarten) return;
        setArten(a => ({ ...a, laedt: true, fehler: null }));
        try {
            const daten = await host.seitenarten();
            setArten({ laedt: false, daten, fehler: null });
            setAuswahl(standardAuswahl(daten));
        } catch (e) {
            const f = alsHostFehler(e);
            const fehler = f.status === 0 ? 'netz' : f.status === 503 || f.code === 'pdf.ocr_unavailable' ? 'dienst' : 'sonst';
            setArten({ laedt: false, daten: null, fehler });
        }
    }, [host]);

    const [startFehler, setStartFehler] = useState<StartFehler | null>(null);

    const starten = useCallback(async () => {
        if (!host.ocrStarten || version === undefined) return;
        const befehl: OcrBefehl = {
            kind: 'ocr',
            expected_version: version,
            options: { pages: seitenListe(auswahl), languages: sprache },
            ...(rechteKennwort ? { owner_password: rechteKennwort } : {}),
        };
        if (!befehl.options.pages!.length) return;
        const s = vorgaenge.schluesselFuer(befehl);
        setStartFehler(null);
        if (!startBeginnen()) return;
        try {
            const a = await host.ocrStarten(befehl, s);
            vorgaenge.abschliessen();
            uebernehmen(a);
        } catch (e) {
            const fehler = startFehlerEinordnen(alsHostFehler(e));
            if (!fehler.wiederholbar) vorgaenge.abschliessen();
            // Seiten, die inzwischen Text haben, fliegen aus der Auswahl.
            if (fehler.grund === 'seitenMitText' && fehler.seiten?.length) {
                const weg = new Set(fehler.seiten);
                setAuswahl(alt => new Set([...alt].filter(p => !weg.has(p))));
                setArten(alt => alt.daten ? {
                    ...alt,
                    daten: { ...alt.daten, pages: alt.daten.pages.map(p => (weg.has(p.page) ? { ...p, kind: 'text' as const } : p)) },
                } : alt);
            }
            setStartFehler(fehler);
            startVerworfen();
        }
    }, [host, version, auswahl, sprache, rechteKennwort, vorgaenge, startBeginnen, uebernehmen, startVerworfen]);

    /** Nach dem Veröffentlichen: erledigt, ohne Meldung — das sagt die Zustandsanzeige. */
    const abschliessen = useCallback((id: string) => {
        kernAbschliessen(id);
        setArten({ laedt: false, daten: null, fehler: null });
    }, [kernAbschliessen]);

    /** Nach einem Fehlschlag zurück zur Auswahl. */
    const zuruecksetzen = useCallback(() => {
        kernZuruecksetzen();
        setStartFehler(null);
    }, [kernZuruecksetzen]);

    return {
        arten, artenLaden,
        auswahl, setAuswahl, sprache, setSprache,
        auftrag: kern.auftrag, startFehler, meldung: kern.meldung,
        starten, abbrechen: kern.abbrechen, verwerfen: kern.verwerfen, abschliessen, zuruecksetzen,
        /** Solange etwas läuft oder auf sein Speichern wartet, sind andere Entwürfe gesperrt. */
        aktiv: kern.aktiv,
    };
}

export type Texterkennung = ReturnType<typeof useTexterkennung>;

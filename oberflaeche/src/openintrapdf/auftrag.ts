// SPDX-License-Identifier: Apache-2.0
//
// Ein Auftrag auf dem Server (Vertrag Etappe 3): einreihen, alle zwei
// Sekunden nachfragen, abbrechen, nach dem Neuöffnen wiederfinden.
//
// Das ist der gemeinsame Kern von „Text erkennen“ (texterkennung.ts) und
// „Exportieren“ (exportieren.ts). Was hier steht, weiß nichts von Seiten,
// Sprachen oder Tabellen — nur von Zuständen: keiner → startet → läuft →
// fertig | fehlgeschlagen. Was der Auftrag bedeutet, sagen die beiden
// Hooks darüber.
//
// Zwei Regeln:
//   1. Eine Nachfrage, die während des Abbruchs unterwegs war, darf den
//      Stand „keiner“ nicht wieder mit „läuft“ überschreiben.
//   2. Was in dieser Sitzung erledigt wurde (veröffentlicht, verworfen,
//      abgebrochen), wird nicht wieder aufgegriffen — auch wenn die Liste
//      des Servers es noch nennt.

import { useCallback, useEffect, useRef, useState } from 'react';
import { alsHostFehler } from './typen';
import type { PdfAuftrag, PdfHost } from './typen';

/** Abstand zwischen zwei Nachfragen beim laufenden Auftrag. */
export const ABFRAGE_MS = 2000;

/** So oft darf eine Nachfrage scheitern, bevor die Anzeige aufgibt. */
const ABFRAGE_FEHLER_GRENZE = 5;

const OFFEN: PdfAuftrag['state'][] = ['queued', 'running'];

/**
 * Welcher Auftrag der gewünschten Art aus der Liste des Servers weiterläuft
 * oder auf sein Ende wartet. Laufende gehen vor fertigen. Ausgelassen wird,
 * was in dieser Sitzung schon erledigt wurde, was zu einer anderen Fassung
 * gehört (`base_version`) oder was bereits die aktuelle Fassung IST
 * (Prüfsumme des Ergebnisses = Prüfsumme der Datei).
 */
export function auftragWiederfinden(
    liste: PdfAuftrag[],
    basis: { version?: number; sha256?: string },
    erledigt: ReadonlySet<string>,
    art: PdfAuftrag['kind'] = 'ocr',
): PdfAuftrag | null {
    const passt = (a: PdfAuftrag) => {
        if (a.kind !== art || erledigt.has(a.id)) return false;
        if (a.base_version !== undefined && basis.version !== undefined && a.base_version !== basis.version) return false;
        const sha = a.result?.sha256?.toLowerCase();
        if (sha && basis.sha256 && sha === basis.sha256.toLowerCase()) return false;
        return true;
    };
    return liste.find(a => OFFEN.includes(a.state) && passt(a))
        ?? liste.find(a => a.state === 'succeeded' && passt(a))
        ?? null;
}

export type AuftragsAnzeige =
    | { art: 'keiner' }
    | { art: 'startet' }
    | { art: 'laeuft'; auftrag: PdfAuftrag; abbruch: boolean; abfrageFehler: number }
    | { art: 'fertig'; auftrag: PdfAuftrag }
    | { art: 'fehlgeschlagen'; auftrag: PdfAuftrag };

export interface Meldung {
    art: 'info' | 'fehler';
    /** Schlüssel unter `openintrapdf.<gruppe>.` mit Werten. */
    schluessel: string;
    werte?: Record<string, unknown>;
}

interface Optionen {
    host: PdfHost;
    /** Fehlt, solange die Info nicht da ist — dann läuft nichts. */
    fileId?: string;
    version?: number;
    sha256?: string;
    /** Gruppe sichtbar und Dienst verfügbar. */
    verfuegbar: boolean;
    /** Welche Aufträge der Liste hierher gehören. */
    art: PdfAuftrag['kind'];
    /** Nur für Tests: kürzerer Abfragetakt. */
    abfrageMs?: number;
    /** Ein Auftrag aus einer früheren Sitzung wurde aufgegriffen. */
    onWiedergefunden?: (auftrag: PdfAuftrag) => void;
}

/** Die Anzeige zu einem Auftrag des Servers. */
function anzeigeAus(a: PdfAuftrag, abbruch = false): AuftragsAnzeige {
    switch (a.state) {
        case 'queued':
        case 'running':
            return { art: 'laeuft', auftrag: a, abbruch, abfrageFehler: 0 };
        case 'succeeded':
            return { art: 'fertig', auftrag: a };
        case 'failed':
            return { art: 'fehlgeschlagen', auftrag: a };
        case 'cancelled':
            return { art: 'keiner' };
    }
}

export function useAuftrag({ host, fileId, version, sha256, verfuegbar, art, abfrageMs = ABFRAGE_MS, onWiedergefunden }: Optionen) {
    const [auftrag, setAuftrag] = useState<AuftragsAnzeige>({ art: 'keiner' });
    const [meldung, setMeldung] = useState<Meldung | null>(null);
    // Aufträge, die in dieser Sitzung veröffentlicht, verworfen oder
    // abgebrochen wurden — die Liste des Servers nennt sie vielleicht noch.
    const erledigt = useRef(new Set<string>());
    const auftragRef = useRef(auftrag);
    auftragRef.current = auftrag;
    const wiedergefunden = useRef(onWiedergefunden);
    wiedergefunden.current = onWiedergefunden;

    /** Antwort des Servers (Start, Wiederfinden) in die Anzeige übernehmen. */
    const uebernehmen = useCallback((a: PdfAuftrag) => {
        if (a.state === 'cancelled') {
            erledigt.current.add(a.id);
            setMeldung({ art: 'info', schluessel: 'abgebrochen' });
        }
        setAuftrag(anzeigeAus(a));
    }, []);

    /** Antwort einer Nachfrage übernehmen — nur, wenn derselbe Auftrag noch läuft. */
    const nachfrageUebernehmen = useCallback((a: PdfAuftrag) => {
        if (a.state === 'cancelled') {
            erledigt.current.add(a.id);
            setMeldung({ art: 'info', schluessel: 'abgebrochen' });
        }
        setAuftrag(alt => (alt.art === 'laeuft' && alt.auftrag.id === a.id ? anzeigeAus(a, alt.abbruch) : alt));
    }, []);

    // Nach dem Öffnen: läuft für diese Datei schon etwas, oder wartet ein
    // Ergebnis auf sein Ende?
    useEffect(() => {
        if (!verfuegbar || !fileId || !host.auftraege) return;
        let aus = false;
        host.auftraege(fileId).then(liste => {
            if (aus || auftragRef.current.art !== 'keiner') return;
            const a = auftragWiederfinden(liste, { version, sha256 }, erledigt.current, art);
            if (!a) return;
            uebernehmen(a);
            setMeldung({ art: 'info', schluessel: 'wiedergefunden' });
            wiedergefunden.current?.(a);
        }, () => { /* Ohne Liste geht es ohne Wiederfinden weiter. */ });
        return () => { aus = true; };
        // Die Fassung ändert sich nur durch unser eigenes Neuladen — und
        // dann soll die Liste erneut gelesen werden.
    }, [verfuegbar, fileId, version, sha256, host, art, uebernehmen]);

    // Nachfragen, solange der Auftrag läuft. Jede Antwort setzt einen neuen
    // Stand und damit die nächste Nachfrage; das Aufräumen beendet sie.
    useEffect(() => {
        if (auftrag.art !== 'laeuft' || !host.auftrag) return;
        const { auftrag: a, abfrageFehler } = auftrag;
        let aus = false;
        const zeit = setTimeout(async () => {
            try {
                const neu = await host.auftrag!(a.id);
                if (aus) return;
                nachfrageUebernehmen(neu);
            } catch (e) {
                if (aus) return;
                const f = alsHostFehler(e);
                // Weg (404: Frist abgelaufen oder Recht entzogen) ist endgültig;
                // ein Netzfehler wird ein paarmal übergangen.
                const endgueltig = f.status === 404 || abfrageFehler + 1 >= ABFRAGE_FEHLER_GRENZE;
                if (endgueltig) {
                    erledigt.current.add(a.id);
                    setMeldung({ art: 'fehler', schluessel: f.status === 404 ? 'auftragWeg' : 'abfrageAbgebrochen' });
                }
                setAuftrag(alt => {
                    if (alt.art !== 'laeuft' || alt.auftrag.id !== a.id) return alt;
                    return endgueltig ? { art: 'keiner' } : { ...alt, abfrageFehler: alt.abfrageFehler + 1 };
                });
            }
        }, abfrageMs);
        return () => {
            aus = true;
            clearTimeout(zeit);
        };
    }, [auftrag, host, abfrageMs, nachfrageUebernehmen]);

    /** Vor dem Einreihen: „startet“, bis der Server geantwortet hat. */
    const startBeginnen = useCallback(() => {
        if (auftragRef.current.art !== 'keiner') return false;
        setMeldung(null);
        setAuftrag({ art: 'startet' });
        return true;
    }, []);

    /** Der Server hat den Start abgelehnt: zurück zu „keiner“. */
    const startVerworfen = useCallback(() => setAuftrag({ art: 'keiner' }), []);

    const abbrechen = useCallback(async () => {
        const stand = auftragRef.current;
        if (stand.art !== 'laeuft' || stand.abbruch || !host.auftragAbbrechen) return;
        setAuftrag({ ...stand, abbruch: true });
        try {
            await host.auftragAbbrechen(stand.auftrag.id);
            erledigt.current.add(stand.auftrag.id);
            setAuftrag({ art: 'keiner' });
            setMeldung({ art: 'info', schluessel: 'abgebrochen' });
        } catch {
            setAuftrag(a => (a.art === 'laeuft' ? { ...a, abbruch: false } : a));
            setMeldung({ art: 'fehler', schluessel: 'abbruchFehler' });
        }
    }, [host]);

    /**
     * Ergebnis verwerfen: lokal vergessen und dem Server sagen, dass es
     * nicht mehr gebraucht wird (Abbruch räumt auf). Scheitert das, bleibt
     * es bis zur Frist liegen — kein Grund, die Person aufzuhalten.
     */
    const verwerfen = useCallback(() => {
        const stand = auftragRef.current;
        if (stand.art === 'keiner' || stand.art === 'startet') return;
        erledigt.current.add(stand.auftrag.id);
        setAuftrag({ art: 'keiner' });
        setMeldung({ art: 'info', schluessel: 'verworfen' });
        host.auftragAbbrechen?.(stand.auftrag.id).catch(() => undefined);
    }, [host]);

    /** Erledigt, ohne Meldung — das sagt die Zustandsanzeige. */
    const abschliessen = useCallback((id: string) => {
        erledigt.current.add(id);
        setAuftrag({ art: 'keiner' });
        setMeldung(null);
    }, []);

    /** Nach einem Fehlschlag zurück zum Anfang. */
    const zuruecksetzen = useCallback(() => {
        const stand = auftragRef.current;
        if (stand.art === 'fehlgeschlagen') erledigt.current.add(stand.auftrag.id);
        setAuftrag({ art: 'keiner' });
        setMeldung(null);
    }, []);

    const aktiv = auftrag.art === 'laeuft' || auftrag.art === 'fertig' || auftrag.art === 'startet';

    return {
        auftrag, auftragRef, meldung, setMeldung,
        uebernehmen, startBeginnen, startVerworfen,
        abbrechen, verwerfen, abschliessen, zuruecksetzen,
        aktiv,
    };
}

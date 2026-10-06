// SPDX-License-Identifier: Apache-2.0
//
// Sicheres Speichern: Befehl an den Gastgeber, Zustände laut Konzept Kap. 02.
//
// Drei Regeln tragen das Ganze:
//
//   1. EIN Idempotency-Key je Speichervorgang. Wer nach einem Netzfehler
//      „Erneut versuchen“ drückt (oder denselben Entwurf noch einmal
//      speichert), schickt DENSELBEN Schlüssel mit demselben Rumpf. Kam der
//      erste Versuch in Wahrheit an und nur die Antwort ging verloren, gibt
//      der Server das gespeicherte Ergebnis zurück — keine zweite Fassung.
//      Ein anderer Rumpf bekommt immer einen neuen Schlüssel; derselbe
//      Schlüssel mit anderem Rumpf wäre 409 `pdf.idempotency_mismatch`.
//
//   2. Bei 412 (Datei inzwischen geändert) bleibt der Entwurf stehen. Die
//      Person entscheidet: als neue Datei speichern oder neu laden.
//
//   3. Bei 422 `pdf.preservation_failed` wird NICHT still weitergemacht.
//      Der Bericht wird gezeigt; nur nach ausdrücklicher Bestätigung geht
//      derselbe Plan mit `accept_losses` noch einmal hinaus — das ist ein
//      anderer Rumpf, also ein neuer Vorgang mit neuem Schlüssel.

import { useCallback, useRef, useState } from 'react';
import { neuerSchluessel } from './hilfen';
import { alsHostFehler } from './typen';
import type { CommitBefehl, CommitErgebnis, ErhaltungsBericht, PdfHost, PdfHostFehler } from './typen';

/**
 * Merkt sich den offenen Vorgang: Schlüssel + Rumpf. Solange er offen ist,
 * bekommt derselbe Rumpf denselben Schlüssel.
 */
export class Vorgaenge {
    private offen: { schluessel: string; rumpf: string } | null = null;
    private readonly erzeugen: () => string;

    constructor(erzeugen: () => string = neuerSchluessel) {
        this.erzeugen = erzeugen;
    }

    schluesselFuer(befehl: unknown): string {
        const rumpf = JSON.stringify(befehl);
        if (this.offen?.rumpf === rumpf) return this.offen.schluessel;
        this.offen = { schluessel: this.erzeugen(), rumpf };
        return this.offen.schluessel;
    }

    /** Nach Erfolg oder endgültigem Fehler: der nächste Rumpf bekommt einen neuen Schlüssel. */
    abschliessen(): void {
        this.offen = null;
    }
}

export type FehlerGrund = 'netz' | 'server' | 'recht' | 'signiert' | 'schluessel' | 'anmerkung' | 'sonst';

/** Ob der Befehl gespeicherte Anmerkungen ändert, löscht oder umstellt. */
const beruehrtGespeicherte = (b: CommitBefehl) =>
    !!(b.annotations?.update?.length || b.annotations?.delete?.length || b.annotations?.state?.length);

export type SpeicherStand =
    | { art: 'ruhe' }
    | { art: 'speichert' }
    | { art: 'gespeichert'; version?: number; neueDatei?: string; bericht?: ErhaltungsBericht }
    /** `code` ist der Fehlerschlüssel des Servers (Etappe 9: `pdf.permission_restricted`, `pdf.wrong_password`). */
    | { art: 'fehlgeschlagen'; grund: FehlerGrund; wiederholbar: boolean; meldung?: string; code?: string }
    | { art: 'konflikt'; aktuelleVersion?: number }
    | { art: 'verlust'; bericht: ErhaltungsBericht; klassen: string[]; befehl: CommitBefehl };

/**
 * Welche Klassen gingen verloren? Nennt der Server sie ausdrücklich, zählt
 * seine Liste; sonst wird aus den Zählern vorher/nachher geschlossen.
 */
export function verlustKlassen(bericht: ErhaltungsBericht, params: Record<string, unknown> = {}): string[] {
    for (const feld of ['losses', 'lost', 'classes']) {
        const liste = params[feld];
        if (Array.isArray(liste) && liste.length && liste.every(x => typeof x === 'string')) return liste as string[];
    }
    const k: string[] = [];
    const weniger = (vorher?: number, nachher?: number) => (nachher ?? 0) < (vorher ?? 0);
    if (weniger(bericht.bookmarks_before, bericht.bookmarks_after)) k.push('bookmarks');
    if (weniger(bericht.attachments_before, bericht.attachments_after)) k.push('attachments');
    if (weniger(bericht.form_fields_before, bericht.form_fields_after)) k.push('form_fields');
    return k;
}

/** Ordnet einen Fehler einem Anzeigezustand zu; ein Fehlschlag trägt den Schlüssel des Servers. */
export function fehlerEinordnen(f: PdfHostFehler, befehl: CommitBefehl): SpeicherStand {
    const stand = einordnen(f, befehl);
    return stand.art === 'fehlgeschlagen' && f.code ? { ...stand, code: f.code } : stand;
}

function einordnen(f: PdfHostFehler, befehl: CommitBefehl): SpeicherStand {
    if (f.status === 412 || f.code === 'pdf.version_conflict') {
        return { art: 'konflikt', aktuelleVersion: f.aktuelleVersion };
    }
    if (f.code === 'pdf.preservation_failed') {
        const bericht = f.bericht ?? {};
        const klassen = verlustKlassen(bericht, f.params);
        if (klassen.length) return { art: 'verlust', bericht, klassen, befehl };
        return { art: 'fehlgeschlagen', grund: 'sonst', wiederholbar: false, meldung: f.meldung };
    }
    if (f.code === 'pdf.signed_original') {
        return { art: 'fehlgeschlagen', grund: 'signiert', wiederholbar: false, meldung: f.meldung };
    }
    // Wem eine gespeicherte Anmerkung gehört, weiß nur der Server: Lehnt er
    // eine Änderung daran ab (403 oder 422 `pdf.invalid_annotation`), ist
    // das kein Rechteproblem der Datei, sondern dieser einen Anmerkung.
    if ((f.status === 403 || f.code === 'pdf.invalid_annotation') && beruehrtGespeicherte(befehl)) {
        return { art: 'fehlgeschlagen', grund: 'anmerkung', wiederholbar: false, meldung: f.meldung };
    }
    if (f.status === 0) return { art: 'fehlgeschlagen', grund: 'netz', wiederholbar: true, meldung: f.meldung };
    if (f.status >= 500 || f.status === 408 || f.status === 429) {
        return { art: 'fehlgeschlagen', grund: 'server', wiederholbar: true, meldung: f.meldung };
    }
    if (f.status === 403 || f.status === 401) {
        return { art: 'fehlgeschlagen', grund: 'recht', wiederholbar: false, meldung: f.meldung };
    }
    if (f.status === 409) return { art: 'fehlgeschlagen', grund: 'schluessel', wiederholbar: false, meldung: f.meldung };
    return { art: 'fehlgeschlagen', grund: 'sonst', wiederholbar: false, meldung: f.meldung };
}

interface Optionen {
    host: PdfHost;
    /** Wird nach erfolgreichem Speichern gerufen (neu laden, Gastgeber informieren). */
    onErfolg: (ergebnis: CommitErgebnis, befehl: CommitBefehl) => void;
    /** Für Tests: eigener Schlüsselerzeuger. */
    schluessel?: () => string;
    /**
     * Anderer Weg als `host.speichern` — das Veröffentlichen eines
     * OCR-Auftrags (Etappe 3) hat dieselben Zustände und Fehler, nur eine
     * andere Route.
     */
    sendenUeber?: (befehl: CommitBefehl, schluessel: string) => Promise<CommitErgebnis>;
}

export function useSpeichern({ host, onErfolg, schluessel, sendenUeber }: Optionen) {
    const [stand, setStand] = useState<SpeicherStand>({ art: 'ruhe' });
    const [vorgaenge] = useState(() => new Vorgaenge(schluessel));
    const letzter = useRef<CommitBefehl | null>(null);
    const erfolg = useRef(onErfolg);
    erfolg.current = onErfolg;
    const ueber = useRef(sendenUeber);
    ueber.current = sendenUeber;

    const senden = useCallback(async (befehl: CommitBefehl): Promise<boolean> => {
        const weg = ueber.current;
        if (!weg && !host.speichern) return false;
        const s = vorgaenge.schluesselFuer(befehl);
        letzter.current = befehl;
        setStand({ art: 'speichert' });
        let ergebnis: CommitErgebnis;
        try {
            ergebnis = weg ? await weg(befehl, s) : await host.speichern!(befehl, s);
        } catch (e) {
            const neu = fehlerEinordnen(alsHostFehler(e), befehl);
            // Nur ein wiederholbarer Fehler hält den Vorgang (und damit den
            // Schlüssel) offen; alles andere braucht ohnehin einen neuen Rumpf.
            if (!(neu.art === 'fehlgeschlagen' && neu.wiederholbar)) vorgaenge.abschliessen();
            setStand(neu);
            return false;
        }
        vorgaenge.abschliessen();
        setStand(befehl.destination.kind === 'new_file'
            ? { art: 'gespeichert', neueDatei: ergebnis.name, bericht: ergebnis.report }
            : { art: 'gespeichert', version: ergebnis.version, bericht: ergebnis.report });
        erfolg.current(ergebnis, befehl);
        return true;
    }, [host, vorgaenge]);

    /** „Erneut versuchen“: derselbe Befehl, derselbe Schlüssel. */
    const erneut = useCallback(() => (letzter.current ? senden(letzter.current) : Promise.resolve(false)), [senden]);

    /** Erhaltungsbericht bestätigt: dieselben Seiten, Verluste ausdrücklich angenommen. */
    const verlusteAnnehmen = useCallback(() => {
        if (stand.art !== 'verlust') return Promise.resolve(false);
        return senden({ ...stand.befehl, accept_losses: stand.klassen });
    }, [stand, senden]);

    /** Zurück in Ruhe — etwa nach „Neu laden“ oder wenn der Entwurf sich ändert. */
    const zuruecksetzen = useCallback(() => setStand({ art: 'ruhe' }), []);

    return { stand, senden, erneut, verlusteAnnehmen, zuruecksetzen };
}

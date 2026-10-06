// SPDX-License-Identifier: Apache-2.0
//
// Dateien binden: mehrere Drive-PDFs in gewählter Reihenfolge zu einer
// NEUEN Datei (`POST /api/pdf/merge`, Konzept Kap. 01 Ablauf 3). Die
// Quellen bleiben, wie sie sind — deshalb genügt Lesen.
//
// Gebunden wird immer die GESPEICHERTE Fassung jeder Quelle. Ein offener
// Entwurf der geöffneten Datei ist nicht darin; die Gruppe sagt das.
//
// Drei Regeln, dieselben wie beim Speichern (speichern.ts):
//   1. EIN Idempotency-Key je Vorgang mit demselben Rumpf — nach einem
//      Netzfehler entsteht keine zweite Datei. Ein anderer Rumpf (andere
//      Reihenfolge, anderes Ziel, angenommene Verluste) ist ein neuer
//      Vorgang mit neuem Schlüssel.
//   2. 412: Eine Quelle hat inzwischen eine neue Fassung. Sie wird nicht
//      still eingemischt (Konzept Kap. 06); die Quellen werden auf Wunsch
//      neu geladen, und die Person bindet dann erneut.
//   3. 422 `pdf.preservation_failed`: Bericht zeigen, erst nach
//      Bestätigung mit `accept_losses` noch einmal.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seitenbereichLesen } from './exportieren';
import { namensStamm } from './hilfen';
import { verlustKlassen, Vorgaenge } from './speichern';
import { alsHostFehler } from './typen';
import type { BindeBefehl, BindeErgebnis, BindeQuelle, ErhaltungsBericht, PdfHost, PdfHostFehler, PdfInfo, PdfZiel } from './typen';

/** Höchstzahl der Quellen (Server: `dokument.HoechstQuellen`). */
export const HOECHST_QUELLEN = 20;

/** Der Eintrag der geöffneten Datei — immer dabei, nie zu entfernen. */
export const OFFEN = 'offen';

/** Eine Quelle in der Liste: die Datei plus das, was der Server über sie weiß. */
export interface Quelle {
    /** Eindeutig je Eintrag; dieselbe Datei darf mehrmals vorkommen. */
    key: string;
    id: string;
    name: string;
    /** Fassung, die gebunden wird; bei der geöffneten Datei die geladene. */
    version?: number;
    seitenzahl?: number;
    signiert: boolean;
    formular: boolean;
    passwort: boolean;
    /** Die Info wird gerade geholt. */
    laedt: boolean;
    /** Die Info ließ sich nicht holen: nicht lesbar (404) oder Netz. */
    fehler: 'nichtLesbar' | 'netz' | null;
    /** Eingabe „1-3, 5“; leer = alle Seiten. */
    bereichText: string;
}

/** Was aus einer `PdfInfo` in den Eintrag übernommen wird. */
export function merkmale(info: PdfInfo): Pick<Quelle, 'version' | 'seitenzahl' | 'signiert' | 'formular' | 'passwort'> {
    const i = info.inspection;
    const f = info.capabilities;
    return {
        version: info.version,
        seitenzahl: i?.pages,
        signiert: !!i?.signed,
        formular: !!i?.forms || (i?.form_fields ?? 0) > 0,
        passwort: f?.merge?.state === 'requires_password' || f?.pages?.state === 'requires_password',
    };
}

/**
 * Seitenbereich einer Quelle, ab 0. Leer heißt alle Seiten (`null`).
 * Ist die Seitenzahl noch unbekannt, prüft erst der Server die Grenze.
 */
export function bereichLesen(q: Pick<Quelle, 'bereichText' | 'seitenzahl'>): number[] | null | 'ungueltig' {
    return seitenbereichLesen(q.bereichText, q.seitenzahl ?? Number.MAX_SAFE_INTEGER);
}

export type BefehlFehler = 'keineQuellen' | 'zuViele' | 'laedt' | 'nichtLesbar' | 'passwort' | 'bereich';

/** Baut den Rumpf — oder nennt den ersten Grund, warum er noch nicht geht. */
export function bindeBefehl(quellen: Quelle[], ziel: PdfZiel, lesezeichen: boolean): { befehl: BindeBefehl } | { fehler: BefehlFehler } {
    if (!quellen.length) return { fehler: 'keineQuellen' };
    if (quellen.length > HOECHST_QUELLEN) return { fehler: 'zuViele' };
    const sources: BindeQuelle[] = [];
    for (const q of quellen) {
        if (q.laedt) return { fehler: 'laedt' };
        if (q.fehler) return { fehler: 'nichtLesbar' };
        if (q.passwort) return { fehler: 'passwort' };
        const seiten = bereichLesen(q);
        if (seiten === 'ungueltig') return { fehler: 'bereich' };
        const s: BindeQuelle = { file_id: q.id };
        if (q.version !== undefined) s.expected_version = q.version;
        if (seiten) s.pages = seiten;
        sources.push(s);
    }
    return { befehl: { sources, destination: ziel, bookmarks_per_source: lesezeichen } };
}

export type BindeFehlerGrund = 'netz' | 'server' | 'recht' | 'nichtLesbar' | 'schluessel' | 'sonst';

export type BindeStand =
    | { art: 'ruhe' }
    | { art: 'laeuft' }
    | { art: 'fertig'; ergebnis: BindeErgebnis }
    /** 412: `fileId` nennt die geänderte Quelle, wenn der Server sie nennt. */
    | { art: 'konflikt'; fileId?: string; aktuelleVersion?: number }
    | { art: 'verlust'; bericht: ErhaltungsBericht; klassen: string[]; befehl: BindeBefehl }
    | { art: 'fehlgeschlagen'; grund: BindeFehlerGrund; wiederholbar: boolean; meldung?: string };

/** Ordnet einen Fehler des Gastgebers einem Anzeigezustand zu. */
export function bindeFehlerEinordnen(f: PdfHostFehler, befehl: BindeBefehl): BindeStand {
    if (f.status === 412 || f.code === 'pdf.version_conflict') {
        const fileId = typeof f.params.file_id === 'string' ? f.params.file_id : undefined;
        return { art: 'konflikt', fileId, aktuelleVersion: f.aktuelleVersion };
    }
    if (f.code === 'pdf.preservation_failed') {
        const bericht = f.bericht ?? {};
        const klassen = verlustKlassen(bericht, f.params);
        if (klassen.length) return { art: 'verlust', bericht, klassen, befehl };
        return { art: 'fehlgeschlagen', grund: 'sonst', wiederholbar: false, meldung: f.meldung };
    }
    if (f.status === 0) return { art: 'fehlgeschlagen', grund: 'netz', wiederholbar: true, meldung: f.meldung };
    if (f.status >= 500 || f.status === 408 || f.status === 429) {
        return { art: 'fehlgeschlagen', grund: 'server', wiederholbar: true, meldung: f.meldung };
    }
    if (f.status === 404) return { art: 'fehlgeschlagen', grund: 'nichtLesbar', wiederholbar: false, meldung: f.meldung };
    if (f.status === 403 || f.status === 401) return { art: 'fehlgeschlagen', grund: 'recht', wiederholbar: false, meldung: f.meldung };
    if (f.status === 409) return { art: 'fehlgeschlagen', grund: 'schluessel', wiederholbar: false, meldung: f.meldung };
    // Alles andere trägt der übersetzte Satz des Servers (fehler.pdf.*): zu
    // viele Quellen, Formularkollision, Passwort, keine Seiten, zu groß.
    return { art: 'fehlgeschlagen', grund: 'sonst', wiederholbar: false, meldung: f.meldung };
}

// ---------------------------------------------------------------------
// Der Ablauf als Hook
// ---------------------------------------------------------------------

interface Optionen {
    host: PdfHost;
    /** Die geöffnete Datei — erste Quelle; `null`, solange sie unbekannt ist. */
    erste: { id: string; name: string; version?: number; info?: PdfInfo } | null;
    /** Gruppe sichtbar und Dokument geladen. */
    verfuegbar: boolean;
    /** Vorschlag für den Zielnamen aus dem Stamm der ersten Quelle (übersetzt der Aufrufer). */
    vorschlagName: (stamm: string) => string;
    onGebunden?: (ergebnis: BindeErgebnis) => void;
    /** Für Tests: eigener Schlüsselerzeuger. */
    schluessel?: () => string;
}

export function useBinden({ host, erste, verfuegbar, vorschlagName, onGebunden, schluessel }: Optionen) {
    const [quellen, setQuellen] = useState<Quelle[]>([]);
    // Spiegel für Befehle, die auf dem aktuellen Stand rechnen müssen.
    const quellenRef = useRef(quellen);
    quellenRef.current = quellen;
    const [lesezeichen, setLesezeichenWahl] = useState(true);
    const [eigenerName, setEigenerName] = useState<string | null>(null);
    const [stand, setStand] = useState<BindeStand>({ art: 'ruhe' });
    const [waehlt, setWaehlt] = useState(false);
    const [vorgaenge] = useState(() => new Vorgaenge(schluessel));
    const letzter = useRef<BindeBefehl | null>(null);
    const laufend = useRef(0);
    const gebunden = useRef(onGebunden);
    gebunden.current = onGebunden;
    const vorschlag = useRef(vorschlagName);
    vorschlag.current = vorschlagName;

    const aendern = useCallback((f: (alt: Quelle[]) => Quelle[]) => {
        setQuellen(f);
        // Eine Änderung an der Liste macht den letzten Ausgang gegenstandslos —
        // außer der Vorgang läuft noch oder wartet auf die Bestätigung.
        setStand(s => (s.art === 'laeuft' || s.art === 'verlust' ? s : { art: 'ruhe' }));
    }, []);

    const infoLaden = useCallback(async (key: string, id: string) => {
        if (!host.quelleInfo) {
            setQuellen(alt => alt.map(q => (q.key === key ? { ...q, laedt: false } : q)));
            return;
        }
        setQuellen(alt => alt.map(q => (q.key === key ? { ...q, laedt: true, fehler: null } : q)));
        try {
            const info = await host.quelleInfo(id);
            setQuellen(alt => alt.map(q => (q.key === key ? { ...q, ...merkmale(info), name: info.name || q.name, laedt: false, fehler: null } : q)));
        } catch (e) {
            const f = alsHostFehler(e);
            const fehler = f.status === 0 || f.status >= 500 ? 'netz' : 'nichtLesbar';
            setQuellen(alt => alt.map(q => (q.key === key ? { ...q, laedt: false, fehler } : q)));
        }
    }, [host]);

    // Die geöffnete Datei ist die erste Quelle. Wird sie neu geladen (neue
    // Fassung), folgt der Eintrag; ihr Seitenbereich bleibt.
    const ersteId = erste?.id;
    const ersteName = erste?.name;
    const ersteVersion = erste?.version;
    const ersteInfo = erste?.info;
    useEffect(() => {
        if (!verfuegbar || !ersteId || !ersteName) {
            setQuellen([]);
            setStand({ art: 'ruhe' });
            return;
        }
        setQuellen(alt => {
            const bisher = alt.find(q => q.key === OFFEN);
            const eintrag: Quelle = {
                key: OFFEN, id: ersteId, name: ersteName,
                signiert: false, formular: false, passwort: false,
                ...(ersteInfo ? merkmale(ersteInfo) : {}),
                laedt: !ersteInfo, fehler: null,
                bereichText: bisher?.bereichText ?? '',
            };
            if (ersteVersion !== undefined) eintrag.version = ersteVersion;
            if (!bisher) return [eintrag, ...alt];
            return alt.map(q => (q.key === OFFEN ? eintrag : q));
        });
        if (!ersteInfo) void infoLaden(OFFEN, ersteId);
    }, [verfuegbar, ersteId, ersteName, ersteVersion, ersteInfo, infoLaden]);

    /** „PDF hinzufügen …“: den Wähler des Gastgebers öffnen; liefert die Zahl der neuen Einträge. */
    const hinzufuegen = useCallback(async (): Promise<number> => {
        if (!host.dateienWaehlen) return 0;
        setWaehlt(true);
        let gewaehlt: { id: string; name: string }[] = [];
        try {
            gewaehlt = await host.dateienWaehlen();
        } finally {
            setWaehlt(false);
        }
        if (!gewaehlt.length) return 0;
        const neue: Quelle[] = gewaehlt.map(d => ({
            key: `q${++laufend.current}`, id: d.id, name: d.name,
            signiert: false, formular: false, passwort: false, laedt: true, fehler: null, bereichText: '',
        }));
        aendern(alt => [...alt, ...neue]);
        for (const q of neue) void infoLaden(q.key, q.id);
        return neue.length;
    }, [host, aendern, infoLaden]);

    const entfernen = useCallback((key: string) => {
        if (key === OFFEN) return;
        aendern(alt => alt.filter(q => q.key !== key));
    }, [aendern]);

    /** Einen Eintrag um eine Stelle bewegen; liefert die neue Stelle (ab 1) oder `null`. */
    const verschieben = useCallback((key: string, richtung: -1 | 1): number | null => {
        const alt = quellenRef.current;
        const i = alt.findIndex(q => q.key === key);
        const j = i + richtung;
        if (i < 0 || j < 0 || j >= alt.length) return null;
        const neu = [...alt];
        [neu[i], neu[j]] = [neu[j], neu[i]];
        aendern(() => neu);
        return j + 1;
    }, [aendern]);

    /** Ziehen: `key` vor `vor` einreihen (`null` = ans Ende); liefert die neue Stelle (ab 1). */
    const verschiebenVor = useCallback((key: string, vor: string | null): number | null => {
        const alt = quellenRef.current;
        const eintrag = alt.find(q => q.key === key);
        if (!eintrag || key === vor) return null;
        const ohne = alt.filter(q => q.key !== key);
        const ziel = vor === null ? ohne.length : ohne.findIndex(q => q.key === vor);
        if (ziel < 0) return null;
        const neu = [...ohne.slice(0, ziel), eintrag, ...ohne.slice(ziel)];
        if (neu.every((q, n) => q.key === alt[n].key)) return null;
        aendern(() => neu);
        return ziel + 1;
    }, [aendern]);

    const bereichSetzen = useCallback((key: string, text: string) => {
        aendern(alt => alt.map(q => (q.key === key ? { ...q, bereichText: text } : q)));
    }, [aendern]);

    const setLesezeichen = useCallback((an: boolean) => {
        setLesezeichenWahl(an);
        setStand(s => (s.art === 'laeuft' || s.art === 'verlust' ? s : { art: 'ruhe' }));
    }, []);

    /** Zielname: die eigene Eingabe, sonst der Vorschlag aus der ersten Quelle. */
    const name = eigenerName ?? (quellen[0] ? vorschlag.current(namensStamm(quellen[0].name)) : '');
    const setName = useCallback((n: string) => setEigenerName(n), []);

    /** Warum „Binden“ noch nicht geht — `null`, wenn alles bereit ist. */
    const pruefung = useMemo((): BefehlFehler | null => {
        const g = bindeBefehl(quellen, { drive_id: '', folder_id: null, name: '' }, lesezeichen);
        return 'fehler' in g ? g.fehler : null;
    }, [quellen, lesezeichen]);

    const warnungen = useMemo(() => ({
        signierte: quellen.filter(q => q.signiert).map(q => q.name),
        /** Formularfelder in mehr als einer Quelle: gleiche Namen entscheidet der Server. */
        formular: quellen.filter(q => q.formular).length >= 2,
        passwort: quellen.filter(q => q.passwort).map(q => q.name),
    }), [quellen]);

    const senden = useCallback(async (befehl: BindeBefehl): Promise<boolean> => {
        if (!host.binden) return false;
        const s = vorgaenge.schluesselFuer(befehl);
        letzter.current = befehl;
        setStand({ art: 'laeuft' });
        try {
            const ergebnis = await host.binden(befehl, s);
            vorgaenge.abschliessen();
            setStand({ art: 'fertig', ergebnis });
            gebunden.current?.(ergebnis);
            return true;
        } catch (e) {
            const neu = bindeFehlerEinordnen(alsHostFehler(e), befehl);
            // Nur ein wiederholbarer Fehler hält den Vorgang (und den Schlüssel) offen.
            if (!(neu.art === 'fehlgeschlagen' && neu.wiederholbar)) vorgaenge.abschliessen();
            setStand(neu);
            return false;
        }
    }, [host, vorgaenge]);

    /** Mit dem gewählten Ziel binden. */
    const binden = useCallback((ziel: PdfZiel): Promise<boolean> => {
        const g = bindeBefehl(quellenRef.current, ziel, lesezeichen);
        if ('fehler' in g) return Promise.resolve(false);
        return senden(g.befehl);
    }, [lesezeichen, senden]);

    /** „Erneut versuchen“: derselbe Rumpf, derselbe Schlüssel. */
    const erneut = useCallback(() => (letzter.current ? senden(letzter.current) : Promise.resolve(false)), [senden]);

    /** Erhaltungsbericht bestätigt: dieselben Quellen, Verluste ausdrücklich angenommen. */
    const verlusteAnnehmen = useCallback(() => {
        if (stand.art !== 'verlust') return Promise.resolve(false);
        return senden({ ...stand.befehl, accept_losses: stand.klassen });
    }, [stand, senden]);

    /** Nach 412: Fassung und Merkmale aller Quellen neu holen. */
    const quellenNeuLaden = useCallback(() => {
        setStand({ art: 'ruhe' });
        for (const q of quellenRef.current) void infoLaden(q.key, q.id);
    }, [infoLaden]);

    const zuruecksetzen = useCallback(() => setStand({ art: 'ruhe' }), []);

    return {
        quellen, name, setName, lesezeichen, setLesezeichen, pruefung, warnungen, stand, waehlt,
        hinzufuegen, entfernen, verschieben, verschiebenVor, bereichSetzen,
        binden, erneut, verlusteAnnehmen, quellenNeuLaden, zuruecksetzen,
    };
}

export type Binden = ReturnType<typeof useBinden>;

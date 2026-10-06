// SPDX-License-Identifier: Apache-2.0
//
// Exportieren nach Writer und Tabelle (Etappe 4): Analyse als Auftrag,
// Vorschau aus dem Dokumentmodell, Ausgabe als neue Drive-Datei.
//
// Zwei Schritte, wie der Vertrag sie vorsieht:
//   1. Analyse — ein Auftrag auf dem Server (Kern in auftrag.ts). Sie
//      liest die Wörter der gespeicherten Fassung und baut daraus das
//      Modell: Absätze, Überschriften, Listen, Tabellen mit Typvorschlag.
//   2. Ausgabe — synchron: Format, Tabellenwahl, Zahlformat und Ziel gehen
//      an `POST /api/pdf/jobs/{id}/export`; die Antwort ist die neue Datei.
//
// Drei Regeln aus Konzept Kap. 05:
//   1. Nie still umwandeln. Zahl wird nur, was die Person als „Zahl“
//      gewählt hat; der Rohtext bleibt in der Vorschau sichtbar, und ein
//      Hinweis zeigt, wie er gelesen würde (`1.234,56 → 1234,56`).
//   2. Exportiert wird die GESPEICHERTE Fassung. Ein offener Entwurf sperrt
//      den Export nicht, ist aber nicht darin — das sagt die Oberfläche.
//   3. EIN Idempotency-Key je Ausgabeversuch mit demselben Rumpf: Nach
//      einem Netzfehler entsteht keine zweite Datei.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuftrag } from './auftrag';
import { Vorgaenge } from './speichern';
import { startFehlerEinordnen } from './texterkennung';
import type { StartFehler } from './texterkennung';
import { alsHostFehler } from './typen';
import type {
    AnalyseBefehl, ExportBefehl, ExportErgebnis, ExportFormat, ExportWarnung, Modell, ModellBlock, ModellTabelle, ModellZelle,
    OcrSprache, PdfAuftrag, PdfHost, PdfHostFehler, SeitenLage, SpaltenTyp, ZahlenGebiet,
} from './typen';

export type ExportZiel = 'writer' | 'tabelle';

/** Welche Formate zu welchem Ziel gehören; das erste ist die Vorgabe. */
export const FORMATE: Record<ExportZiel, ExportFormat[]> = { writer: ['docx', 'odt'], tabelle: ['xlsx', 'csv'] };

export const TRENNZEICHEN = [';', ',', '\t'] as const;

// ---------------------------------------------------------------------
// Seitenbereich
// ---------------------------------------------------------------------

/**
 * „1-3, 5“ → Seiten ab 0, sortiert, ohne Doppelte. Leer heißt alle
 * Seiten (`null`); Unlesbares oder Seiten außerhalb ergeben `'ungueltig'`.
 */
export function seitenbereichLesen(text: string, seitenzahl: number): number[] | null | 'ungueltig' {
    const t = text.replace(/\s+/g, '');
    if (!t) return null;
    const seiten = new Set<number>();
    for (const teil of t.split(/[,;]/)) {
        const m = /^(\d+)(?:[-–](\d+))?$/.exec(teil);
        if (!m) return 'ungueltig';
        const von = Number(m[1]);
        const bis = m[2] === undefined ? von : Number(m[2]);
        if (von < 1 || bis < von || bis > seitenzahl) return 'ungueltig';
        for (let s = von; s <= bis; s++) seiten.add(s - 1);
    }
    return [...seiten].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------
// Zahlen: wie ein Rohwert gelesen würde
// ---------------------------------------------------------------------

const ZAHL: Record<ZahlenGebiet, RegExp> = {
    de: /^[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/,
    en: /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/,
};

/**
 * Liest einen Rohwert als Zahl im gewählten Gebietsschema und gibt zurück,
 * was daraus würde — als Text, damit `00123 → 123` sichtbar ist. `null`,
 * wenn der Wert keine Zahl in diesem Schema ist.
 */
export function zahlDeuten(roh: string, gebiet: ZahlenGebiet): string | null {
    const t = roh.trim();
    if (!ZAHL[gebiet].test(t)) return null;
    const normal = gebiet === 'de' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    const wert = Number(normal);
    if (!Number.isFinite(wert)) return null;
    const text = String(wert);
    return gebiet === 'de' ? text.replace('.', ',') : text;
}

// ---------------------------------------------------------------------
// Das Modell lesen
// ---------------------------------------------------------------------

// Der Draht (Go-Paket `openintrapdf/export`, `Dokument`):
//   { warnings:[{code,count,pages,detail}], pages:[{ page (ab 0), source,
//     blocks:[{ type: paragraph|heading|list|table, level, text, lines,
//       source, uncertain, repeated, bbox:[4], table?:{ index, cols,
//       header_rows, column_types, rows:[[{ text, confidence }]] } }] }] }

type Roh = Record<string, unknown>;
const alsRoh = (x: unknown): Roh => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Roh) : {});
const alsListe = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const alsText = (x: unknown): string => (typeof x === 'string' ? x : '');
const alsZahl = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

function lageLesen(x: unknown): SeitenLage | null {
    const l = alsListe(x).map(alsZahl);
    // Eine Lage aus lauter Nullen ist keine: der Server kennt sie nicht.
    return l.length === 4 && l.every(n => n !== undefined) && l.some(n => n !== 0) ? (l as SeitenLage) : null;
}

const TYPEN: SpaltenTyp[] = ['text', 'number', 'date'];
const alsTyp = (x: unknown): SpaltenTyp => (TYPEN.includes(x as SpaltenTyp) ? (x as SpaltenTyp) : 'text');

const QUELLEN: Record<string, 'textebene' | 'ocr' | 'leer'> = { text_layer: 'textebene', ocr: 'ocr', none: 'leer' };
const ARTEN: Record<string, 'absatz' | 'ueberschrift' | 'liste'> = { paragraph: 'absatz', heading: 'ueberschrift', list: 'liste' };

function zelleLesen(x: unknown): ModellZelle {
    const z = alsRoh(x);
    const konf = alsZahl(z.confidence);
    // -1 heißt: aus der Textebene oder leer — keine Sicherheit, die man anzeigen müsste.
    return konf !== undefined && konf >= 0 ? { text: alsText(z.text), konf } : { text: alsText(z.text) };
}

function tabelleLesen(x: unknown, lage: SeitenLage | null): ModellTabelle {
    const t = alsRoh(x);
    const zeilen = alsListe(t.rows).map(z => alsListe(z).map(zelleLesen));
    const spalten = alsZahl(t.cols) ?? Math.max(0, ...zeilen.map(z => z.length));
    const vorschlag = alsListe(t.column_types).map(alsTyp);
    return {
        typ: 'tabelle',
        index: alsZahl(t.index) ?? 0,
        // Rechteckig, auch wenn eine Zeile kürzer kam.
        zeilen: zeilen.map(z => (z.length < spalten ? [...z, ...Array.from({ length: spalten - z.length }, () => ({ text: '' }))] : z)),
        spalten,
        kopfzeilen: alsZahl(t.header_rows) ?? 0,
        typvorschlag: Array.from({ length: spalten }, (_, i) => vorschlag[i] ?? 'text'),
        lage,
    };
}

function blockLesen(x: unknown): ModellBlock {
    const b = alsRoh(x);
    const lage = lageLesen(b.bbox);
    if (b.type === 'table' || b.table) return tabelleLesen(b.table, lage);
    return {
        typ: 'absatz',
        art: ARTEN[alsText(b.type)] ?? 'absatz',
        ebene: alsZahl(b.level) ?? 0,
        text: alsText(b.text) || alsListe(b.lines).map(alsText).join(' '),
        quelle: QUELLEN[alsText(b.source)] ?? 'textebene',
        unsicher: b.uncertain === true,
        wiederholt: b.repeated === true,
        lage,
    };
}

/**
 * Macht aus der rohen Antwort von `…/model` das Modell der Vorschau. Was
 * fehlt, wird leer — eine Seite ohne Blöcke ist kein Fehler.
 */
export function modellLesen(roh: unknown): Modell {
    const m = alsRoh(roh);
    const seiten = alsListe(m.pages).map((s, i) => {
        const r = alsRoh(s);
        const page = alsZahl(r.page);
        return {
            nr: (page !== undefined && page >= 0 ? page : i) + 1,
            quelle: QUELLEN[alsText(r.source)] ?? 'textebene',
            bloecke: alsListe(r.blocks).map(blockLesen),
        };
    });
    return { warnungen: alsListe(m.warnings) as ExportWarnung[], seiten };
}

/** Alle Tabellen des Modells in Lesereihenfolge, mit ihrer Seite. */
export function tabellenAus(modell: Modell): { tabelle: ModellTabelle; seite: number }[] {
    const aus: { tabelle: ModellTabelle; seite: number }[] = [];
    for (const s of modell.seiten) for (const b of s.bloecke) if (b.typ === 'tabelle') aus.push({ tabelle: b, seite: s.nr });
    return aus;
}

/** Code, Anzahl, Seiten (ab 0) und Detail einer Warnung — ein Objekt oder ein nackter Code. */
export function warnungLesen(w: ExportWarnung): { code: string; count?: number; pages?: number[]; detail?: string } {
    if (typeof w === 'string') return { code: w };
    const r = alsRoh(w);
    const pages = alsListe(r.pages).map(alsZahl).filter((n): n is number => n !== undefined);
    const aus: ReturnType<typeof warnungLesen> = { code: alsText(r.code) };
    const count = alsZahl(r.count);
    if (count !== undefined) aus.count = count;
    if (pages.length) aus.pages = pages;
    if (alsText(r.detail)) aus.detail = alsText(r.detail);
    return aus;
}

/** Seiten (ab 1) ohne lesbaren Text: weder Textebene noch Erkennung — etwa Scans ohne Dienst. */
export function seitenOhneText(modell: Modell): number[] {
    return modell.seiten.filter(s => s.quelle === 'leer' && s.bloecke.length === 0).map(s => s.nr);
}

/** Hängt die Endung des Formats an, wenn sie fehlt. */
export function mitEndung(name: string, format: ExportFormat): string {
    const n = name.trim();
    return new RegExp(`\\.${format}$`, 'i').test(n) ? n : `${n}.${format}`;
}

// ---------------------------------------------------------------------
// Fehler beim Export
// ---------------------------------------------------------------------

export type ExportFehlerGrund = 'netz' | 'server' | 'recht' | 'weg' | 'nichtFertig' | 'sonst';

export interface ExportFehler {
    grund: ExportFehlerGrund;
    wiederholbar: boolean;
    /** Übersetzter Satz des Gastgebers (`fehler.pdf.*`), falls vorhanden. */
    meldung?: string;
}

export function exportFehlerEinordnen(f: PdfHostFehler): ExportFehler {
    if (f.status === 0) return { grund: 'netz', wiederholbar: true };
    if (f.status === 404 || f.code === 'pdf.job_not_found') return { grund: 'weg', wiederholbar: false, meldung: f.meldung };
    if (f.status === 409 || f.code === 'pdf.job_not_ready') return { grund: 'nichtFertig', wiederholbar: true, meldung: f.meldung };
    if (f.status >= 500 || f.status === 408 || f.status === 429) return { grund: 'server', wiederholbar: true, meldung: f.meldung };
    if (f.status === 401 || f.status === 403) return { grund: 'recht', wiederholbar: false, meldung: f.meldung };
    return { grund: 'sonst', wiederholbar: false, meldung: f.meldung };
}

// ---------------------------------------------------------------------
// Der Ablauf als Hook
// ---------------------------------------------------------------------

export interface TabellenWahl {
    include: boolean;
    header_rows: number;
    column_types: SpaltenTyp[];
}

export interface ModellStand {
    laedt: boolean;
    fehler: boolean;
    daten: Modell | null;
}

export type ExportStand =
    | { art: 'ruhe' }
    | { art: 'laeuft' }
    | { art: 'fertig'; ergebnis: ExportErgebnis }
    | { art: 'fehlgeschlagen'; fehler: ExportFehler };

interface Optionen {
    host: PdfHost;
    fileId?: string;
    version?: number;
    sha256?: string;
    /** Gruppe sichtbar und Fähigkeit verfügbar. */
    verfuegbar: boolean;
    seitenzahl: number;
    /** Zahlformat zu Beginn — nach der Sprache der Oberfläche. */
    startGebiet: ZahlenGebiet;
    /** Nur für Tests: kürzerer Abfragetakt. */
    abfrageMs?: number;
    onWiedergefunden?: (auftrag: PdfAuftrag) => void;
    /** Die neue Datei ist da. */
    onExportiert?: (ergebnis: ExportErgebnis) => void;
    /** Das Rechte-Kennwort der Sitzung (nach Prüfung am Gastgeber): geht beim Anlegen mit, wenn die Rechte-Bits der PDF sonst sperren. */
    rechteKennwort?: string | null;
}

export function useExport({ host, fileId, version, sha256, verfuegbar, seitenzahl, startGebiet, abfrageMs, onWiedergefunden, onExportiert, rechteKennwort }: Optionen) {
    const kern = useAuftrag({ host, fileId, version, sha256, verfuegbar, art: 'analyse', abfrageMs, onWiedergefunden });
    const { auftragRef, startBeginnen, startVerworfen, uebernehmen, setMeldung, zuruecksetzen: kernZuruecksetzen } = kern;

    // Schritt 1: Ziel, Seiten, Sprache.
    const [ziel, setZiel] = useState<ExportZiel>('writer');
    const [seitenText, setSeitenText] = useState('');
    const [sprache, setSprache] = useState<OcrSprache>('deu+eng');
    const [startFehler, setStartFehler] = useState<StartFehler | null>(null);
    const [startVorgaenge] = useState(() => new Vorgaenge());
    const seiten = useMemo(() => seitenbereichLesen(seitenText, seitenzahl), [seitenText, seitenzahl]);

    const starten = useCallback(async () => {
        if (!host.analyseStarten || version === undefined || seiten === 'ungueltig') return;
        const befehl: AnalyseBefehl = {
            kind: 'analyse', expected_version: version, options: { pages: seiten, languages: sprache },
            ...(rechteKennwort ? { owner_password: rechteKennwort } : {}),
        };
        const s = startVorgaenge.schluesselFuer(befehl);
        setStartFehler(null);
        if (!startBeginnen()) return;
        try {
            const a = await host.analyseStarten(befehl, s);
            startVorgaenge.abschliessen();
            uebernehmen(a);
        } catch (e) {
            const fehler = startFehlerEinordnen(alsHostFehler(e));
            if (!fehler.wiederholbar) startVorgaenge.abschliessen();
            setStartFehler(fehler);
            startVerworfen();
        }
    }, [host, version, seiten, sprache, rechteKennwort, startVorgaenge, startBeginnen, uebernehmen, startVerworfen]);

    // Schritt 2: das Modell des fertigen Auftrags.
    const fertigerAuftrag = kern.auftrag.art === 'fertig' ? kern.auftrag.auftrag : null;
    const fertigeId = fertigerAuftrag?.id ?? null;
    const [modell, setModell] = useState<ModellStand>({ laedt: false, fehler: false, daten: null });
    const [modellRunde, setModellRunde] = useState(0);
    const [tabellen, setTabellen] = useState<Map<number, TabellenWahl>>(() => new Map());
    useEffect(() => {
        if (!fertigeId || !host.modellLaden) {
            setModell({ laedt: false, fehler: false, daten: null });
            return undefined;
        }
        let aus = false;
        setModell({ laedt: true, fehler: false, daten: null });
        host.modellLaden(fertigeId).then(roh => {
            if (aus) return;
            const daten = modellLesen(roh);
            setModell({ laedt: false, fehler: false, daten });
            // Vorschlag des Servers vorauswählen: alle übernehmen, Kopfzeilen und Typen wie erkannt.
            setTabellen(new Map(tabellenAus(daten).map(({ tabelle }) => [
                tabelle.index,
                { include: true, header_rows: Math.min(2, Math.max(0, tabelle.kopfzeilen)), column_types: [...tabelle.typvorschlag] },
            ])));
        }, () => { if (!aus) setModell({ laedt: false, fehler: true, daten: null }); });
        return () => { aus = true; };
    }, [fertigeId, host, modellRunde]);

    const tabelleSetzen = useCallback((index: number, aenderung: Partial<TabellenWahl>) => {
        setTabellen(alt => {
            const neu = new Map(alt);
            const bisher = neu.get(index);
            if (bisher) neu.set(index, { ...bisher, ...aenderung });
            return neu;
        });
    }, []);
    const spaltenTypSetzen = useCallback((index: number, spalte: number, typ: SpaltenTyp) => {
        setTabellen(alt => {
            const neu = new Map(alt);
            const bisher = neu.get(index);
            if (bisher) neu.set(index, { ...bisher, column_types: bisher.column_types.map((t, i) => (i === spalte ? typ : t)) });
            return neu;
        });
    }, []);

    // Schritt 3: Format, Zahlformat, CSV.
    const [format, setFormat] = useState<ExportFormat>('docx');
    const [gebiet, setGebiet] = useState<ZahlenGebiet>(startGebiet);
    const [csv, setCsv] = useState<{ delimiter: string; table: number | null }>({ delimiter: ';', table: null });
    const zielSetzen = useCallback((z: ExportZiel) => {
        setZiel(z);
        setFormat(FORMATE[z][0]);
    }, []);

    const uebernommene = useMemo(() => [...tabellen.entries()].filter(([, w]) => w.include).map(([index]) => index), [tabellen]);

    /**
     * Der Rumpf ohne Ziel — oder der Grund, warum er noch nicht geht.
     * Im Writer bleibt jede Zelle Text: Die Person hat dort keinen Typ
     * gewählt, und Zahl wird nur, was gewählt wurde.
     */
    const rumpf = useMemo((): { befehl: Omit<ExportBefehl, 'destination'> } | { fehler: 'keinModell' | 'keineTabelle' | 'csvTabelle' } => {
        if (!modell.daten) return { fehler: 'keinModell' };
        const alleTabellen = [...tabellen.entries()].map(([index, w]) => ({
            index,
            include: ziel === 'writer' ? true : w.include,
            header_rows: w.header_rows,
            column_types: ziel === 'writer' ? w.column_types.map(() => 'text' as const) : w.column_types,
        }));
        const befehl: Omit<ExportBefehl, 'destination'> = { format, tables: alleTabellen, number_locale: gebiet };
        if (ziel === 'tabelle') {
            if (!uebernommene.length) return { fehler: 'keineTabelle' };
            if (format === 'csv') {
                const table = uebernommene.length === 1 ? uebernommene[0] : csv.table;
                if (table === null || !uebernommene.includes(table)) return { fehler: 'csvTabelle' };
                befehl.csv = { delimiter: csv.delimiter, table };
            }
        }
        return { befehl };
    }, [modell.daten, tabellen, ziel, format, gebiet, csv, uebernommene]);

    // Ausgabe: derselbe Rumpf → derselbe Schlüssel (keine zweite Datei nach einem Netzfehler).
    const [exportStand, setExportStand] = useState<ExportStand>({ art: 'ruhe' });
    const [exportVorgaenge] = useState(() => new Vorgaenge());
    const letzter = useRef<ExportBefehl | null>(null);
    const exportiert = useRef(onExportiert);
    exportiert.current = onExportiert;

    const exportieren = useCallback(async (befehl: ExportBefehl): Promise<boolean> => {
        const id = auftragRef.current.art === 'fertig' ? auftragRef.current.auftrag.id : null;
        if (!id || !host.exportieren) return false;
        const s = exportVorgaenge.schluesselFuer(befehl);
        letzter.current = befehl;
        setExportStand({ art: 'laeuft' });
        try {
            const ergebnis = await host.exportieren(id, befehl, s);
            exportVorgaenge.abschliessen();
            setExportStand({ art: 'fertig', ergebnis });
            exportiert.current?.(ergebnis);
            return true;
        } catch (e) {
            const fehler = exportFehlerEinordnen(alsHostFehler(e));
            if (!fehler.wiederholbar) exportVorgaenge.abschliessen();
            setExportStand({ art: 'fehlgeschlagen', fehler });
            return false;
        }
    }, [host, exportVorgaenge, auftragRef]);

    /** „Erneut versuchen“: derselbe Befehl, derselbe Schlüssel. */
    const erneut = useCallback(() => (letzter.current ? exportieren(letzter.current) : Promise.resolve(false)), [exportieren]);

    /** Zurück zu Schritt 1 — die Wahl von Ziel, Seiten und Format bleibt. */
    const zuruecksetzen = useCallback(() => {
        kernZuruecksetzen();
        setStartFehler(null);
        setExportStand({ art: 'ruhe' });
        letzter.current = null;
    }, [kernZuruecksetzen]);

    // Eine neue Fassung macht die Analyse ungültig: Sie gehört zur alten.
    const letzteVersion = useRef(version);
    useEffect(() => {
        if (letzteVersion.current === version) return;
        letzteVersion.current = version;
        if (auftragRef.current.art === 'keiner') return;
        zuruecksetzen();
        setMeldung({ art: 'info', schluessel: 'fassungNeu' });
    }, [version, auftragRef, zuruecksetzen, setMeldung]);

    return {
        ziel, zielSetzen, seitenText, setSeitenText, seiten, sprache, setSprache,
        auftrag: kern.auftrag, meldung: kern.meldung, startFehler,
        starten, abbrechen: kern.abbrechen, zuruecksetzen,
        modell, modellErneut: () => setModellRunde(r => r + 1), fertigerAuftrag,
        tabellen, tabelleSetzen, spaltenTypSetzen, uebernommene,
        format, setFormat, gebiet, setGebiet, csv, setCsv,
        rumpf, exportStand, exportieren, erneut,
    };
}

export type Export = ReturnType<typeof useExport>;

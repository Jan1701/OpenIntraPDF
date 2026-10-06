// SPDX-License-Identifier: Apache-2.0
//
// OpenIntraPDF — der Arbeitsplatz (Etappe 1: Lesen, Seiten verwalten,
// sicher speichern; Etappe 2: Kommentieren).
//
// Aufbau nach Konzept Kap. 02 und Vertrag Etappe 7: oben Name und
// Schließen, darunter das Werkzeugband (Schnellbereich mit Speichern, Drucken,
// Rückgängig, Wiederholen und Lesen|Bearbeiten; Reiter Datei, Start,
// Kommentieren, Seiten, Werkzeuge, Ansicht); links Seiten, Lesezeichen und
// Suche; in der Mitte das Dokument; rechts das Arbeitsfach mit NUR
// funktionierenden Gruppen, die ein Werkzeugband-Knopf anfordert; unten der
// Speicherzustand. Welche Reiter und Knöpfe es gibt, sagt werkzeugbandAufbau.tsx.
//
// „Lesen“ und „Bearbeiten“ sind Bedienmodi, keine Rechte. Bearbeiten gibt es
// nur, wenn der Gastgeber speichern kann UND der Server `access: edit`
// meldet; beim Speichern prüft der Server das Recht ohnehin erneut. Lesen
// erzeugt nichts: kein Entwurf, kein Schreibauftrag, keine Fassung.
//
// Kommentieren ist kein eigener Modus: Die Werkzeuge liegen rechts in der
// Gruppe „Kommentieren“ und wirken in der Leseansicht — mit Recht `comment`
// oder `edit`, wenn der Server `capabilities.annotations` als verfügbar
// meldet. Ein Gastgeber ohne `speichern` (Wiki) bekommt nie Werkzeuge.
//
// Der Entwurf besteht aus Seitenplan und Anmerkungen (entwurf.ts) mit einer
// gemeinsamen Historie. Gespeichert wird nie ein im Browser gebautes PDF,
// sondern der Entwurf als Befehl — der Server baut aus der Basis, die er
// selbst lädt (Vertrag Etappe 1, „Ein Schreibweg“).
//
// Text erkennen (Etappe 3) ist ein Auftrag auf dem Server (texterkennung.ts).
// Sein Ergebnis erscheint als Vorschau in der Leseansicht — deutlich als
// „noch nicht gespeichert“ gekennzeichnet — und wird erst durch „Als neue
// Fassung“ oder „Als neue Datei“ zu etwas, das andere sehen. Solange ein
// Auftrag läuft oder sein Ergebnis wartet, ruhen Seiten- und
// Kommentarwerkzeuge: beides zugleich ließe sich nicht zusammenführen.
//
// Exportieren (Etappe 4, exportieren.ts) liest die GESPEICHERTE Fassung und
// legt eine neue Datei an; das PDF bleibt. Ein offener Entwurf sperrt den
// Export deshalb nicht — er ist nur nicht darin, und die Gruppe sagt das.
//
// Dateien binden (binden.ts) ebenso: mehrere Drive-Dateien, die geöffnete
// zuerst, werden in gewählter Reihenfolge zu einer NEUEN Datei; die
// Quellen bleiben getrennt erhalten. Lesen genügt.

import './openintrapdf.css';
import { Children, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as TastenEreignis, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, LoaderCircle, PanelLeftOpen, Printer, Redo2, Save, Undo2, X } from 'lucide-react';
import {
    anmerkungenZuBefehl, entfallendeAnmerkungen, FARBEN, hexZuRgb, MIT_STAERKE, naechsteKennung, neueJeQuelle,
    STAERKEN, TEXTMARKIERUNGEN,
} from './anmerkungen';
import type { NeueAnmerkung } from './anmerkungen';
import { useBinden } from './binden';
import { BindenWerkzeug } from './BindenWerkzeug';
import { Dialog } from './Dialog';
import { DruckDialog } from './DruckDialog';
import type { DruckWahl } from './DruckDialog';
import { EigenschaftenDialog } from './EigenschaftenDialog';
import type { EigenschaftenDokument } from './eigenschaften';
import { ausfuehren, eigenschaftenUnveraendert, istUnveraendert, naechstesVor, naechstesZurueck, rueckgaengig, verlaufStarten, wiederholen } from './entwurf';
import type { EntwurfBefehl, Verlauf } from './entwurf';
import { mitEndung, useExport } from './exportieren';
import { ExportWerkzeug } from './ExportWerkzeug';
import { FassungenWerkzeug } from './FassungenWerkzeug';
import type { FassungenStand } from './FassungenWerkzeug';
import { KennwortDialog } from './KennwortDialog';
import { KommentarEinstellungen } from './KommentarEinstellungen';
import { KommentarListe } from './KommentarListe';
import { erledigteKennungen, kommentareSammeln, linksSammeln } from './kommentare';
import type { Kommentar, LinkEintrag } from './kommentare';
import { LinkDialog, LinkLoeschenDialog } from './LinkDialog';
import type { LinkZiel } from './LinkDialog';
import type { Stil } from './koordinaten';
import { Leseansicht } from './Leseansicht';
import type { LeseSteuerung, SuchOptionen, ZoomWert } from './Leseansicht';
import { leereSeitenSuchen } from './leereSeiten';
import type { LeerKandidat, PruefDokument } from './leereSeiten';
import { leinwandRastern } from './rastern';
import { MiniaturDienst } from './miniaturen';
import { pdfjsLaden, viewerStilEinhaengen } from './pdfjsLaden';
import type { PdfBibliothek } from './pdfjsLaden';
import { POSTIT_FARBEN, POSTIT_SCHRIFT, postitFarbeLesen, postitFarbeMerken } from './postit';
import { BandFarbfelder, BandStaerken, Werkzeugband, usePdfWerkzeugbandDarstellung } from './Werkzeugband';
import { rechteAusFlags } from './rechte';
import type { DokumentRechte } from './rechte';
import { reiterBauen } from './werkzeugbandAufbau';
import type { FachKnopf, WerkzeugbandLage, WerkzeugbandReiterId } from './werkzeugbandAufbau';
import { SchutzDialog } from './SchutzDialog';
import { SeitenAusDateiDialog } from './SeitenAusDateiDialog';
import type { QuellStand } from './SeitenAusDateiDialog';
import { SeitenRaster } from './SeitenRaster';
import { Seitenleiste } from './Seitenleiste';
import type { Lesezeichen, LinksReiter, SuchStand } from './Seitenleiste';
import { SeitenWerkzeug } from './SeitenWerkzeug';
import { istUnveraendert as planUnveraendert, LEERE_QUELLE, neueNummern, planErstellen, planQuellen, planZuSeiten, verbleibend } from './seitenplan';
import type { Drehung, EinfuegeEintrag, LeerFormat, PlanEintrag } from './seitenplan';
import { useSpeichern, Vorgaenge } from './speichern';
import type { SpeicherStand } from './speichern';
import { stempelAngabe, stempelWahlLesen, stempelWahlMerken } from './stempel';
import type { StempelId, StempelWahl } from './stempel';
import { useTexterkennung } from './texterkennung';
import type { StartFehler } from './texterkennung';
import { TexterkennungWerkzeug } from './TexterkennungWerkzeug';
import { OpenintraPdfZeichen } from './Logo';
import { useThema } from './thema';
import { alsHostFehler, PdfHostFehler } from './typen';
import type {
    AnmerkungsArt, AuftragVeroeffentlichen, BindeErgebnis, CommitBefehl, CommitErgebnis, CommitZiel, DateiWahl, DruckBefehl, ExportErgebnis, ExtraktBefehl,
    ExtraktErgebnis, PdfFassung, PdfHost, PdfInfo, PdfZiel, SchutzBefehl, SeitenLage, ZielZweck,
} from './typen';
import { Arbeitsfach, Hinweis } from './Werkzeugleiste';
import type { WerkzeugGruppe } from './Werkzeugleiste';
import { dateiAnbieten, mitPdfEndung, namensStamm, pdfDrucken } from './hilfen';
import { abschnitt, eingabe, hauptKnopf, knopf, leise, rahmenKnopf, symbolKnopf, warnKnopf } from './stil';

export interface PdfArbeitsplatzProps {
    host: PdfHost;
    /** Anzeigename, bis die Info des Gastgebers da ist. */
    name: string;
    onClose: () => void;
    /** Nach erfolgreichem Speichern (neue Fassung oder neue Datei). */
    onGespeichert?: (ergebnis: CommitErgebnis, ziel: CommitZiel['kind']) => void;
    /** Nach erfolgreichem Extrahieren/Teilen. */
    onExtrahiert?: (ergebnis: ExtraktErgebnis) => void;
    /** Nach erfolgreichem Export (Etappe 4): eine neue Datei liegt im Ziel. */
    onExportiert?: (ergebnis: ExportErgebnis) => void;
    /** Nach erfolgreichem Binden: die gebundene Datei liegt im Ziel. */
    onGebunden?: (ergebnis: BindeErgebnis) => void;
    /** Darstellung des Gastgebers. Gesetzt, folgt der Arbeitsplatz ihr (auch bei
     *  Wechsel im offenen Dokument) und zeigt keinen eigenen Schalter. */
    thema?: 'hell' | 'dunkel';
    /**
     * Befehle von außen (Etappe 6: das Ablage-Menü der Desktop-App). Sie
     * lösen genau das aus, was die Knöpfe des Arbeitsplatzes auslösen —
     * samt Rückfrage bei offenem Entwurf und Sperren, wenn nichts zu tun ist.
     */
    befehle?: Ref<PdfArbeitsplatzBefehle>;
}

/** Was ein Gastgeber dem Arbeitsplatz von außen befehlen kann. */
export interface PdfArbeitsplatzBefehle {
    /** Wie der Schließen-Knopf: fragt bei offenem Entwurf nach. */
    schliessen(): void;
    /** Wie Strg/Cmd+S: speichert Entwurf oder OCR-Vorschau, sonst nichts. */
    speichern(): void;
    /** Wie der Drucken-Knopf (nur mit `host.drucken`): öffnet den Druckdialog. */
    drucken(): void;
    /** Wie der Herunterladen-Knopf. */
    kopie(): void;
}

type LadeStand =
    | { art: 'laedt' }
    | { art: 'fertig' }
    | { art: 'passwort'; falsch: boolean }
    | { art: 'fehler'; meldung: string };

type Geladen = { bibliothek: PdfBibliothek; dokument: PDFDocumentProxy; aufgabe: PDFDocumentLoadingTask };

type OffenerDialog =
    | { art: 'schliessen' }
    | { art: 'leer'; kandidaten: LeerKandidat[] }
    /** Text erkennen soll starten, aber ein Entwurf ist offen. */
    | { art: 'ocrEntwurf' }
    /** Eigenschaften anzeigen (Etappe 7). */
    | { art: 'eigenschaften' }
    /** Rückfrage vor dem Wiederherstellen einer Fassung (Etappe 8). */
    | { art: 'fassungWiederherstellen'; fassung: PdfFassung }
    /** Druckdialog mit Seitenbereich (Etappe 8). */
    | { art: 'drucken' }
    /** Seiten aus einer anderen Datei (Etappe 9): eine Datei nach der anderen. */
    | { art: 'seitenAusDatei'; datei: DateiWahl; rest: DateiWahl[]; stand: QuellStand }
    /** Kennwortschutz (Etappe 9): geschützte Kopie, Kennwort entfernen, Rechte-Kennwort. */
    | { art: 'schutz' }
    | { art: 'kennwortEntfernen' }
    | { art: 'rechteKennwort' }
    /** Links (Etappe 9): Ziel eines neuen Links erfragen; einen vorhandenen löschen. */
    | { art: 'linkNeu'; page: number; rect: NeueAnmerkung['rect'] }
    | { art: 'linkLoeschen'; id: string; page: number; ziel: string }
    | null;

/** Das Ergebnis eines OCR-Auftrags als zweites Dokument in der Leseansicht. */
type Vorschau = {
    id: string;
    laedt: boolean;
    fehler: boolean;
    dokument: PDFDocumentProxy | null;
    aufgabe: PDFDocumentLoadingTask | null;
};

/** Eine frühere Fassung, nur zum Ansehen in der Leseansicht (Etappe 8). */
type FassungAnsicht = {
    version: number;
    laedt: boolean;
    fehler: boolean;
    dokument: PDFDocumentProxy | null;
    aufgabe: PDFDocumentLoadingTask | null;
};

const ZOOM_STUFEN = [50, 75, 100, 125, 150, 200, 300, 400];

/** Namen der Strichstärken im Katalog (`openintrapdf.kommentare.staerke.*`), wie in KommentarWerkzeuge. */
const STAERKE_NAME: Record<number, string> = { 1: 'duenn', 2: 'mittel', 4: 'dick' };

function istEingabe(ziel: EventTarget | null): boolean {
    const el = ziel as HTMLElement | null;
    if (!el?.tagName) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function PdfArbeitsplatz({ host, name, onClose, onGespeichert, onExtrahiert, onExportiert, onGebunden, thema: themaVorgabe, befehle }: PdfArbeitsplatzProps) {
    const { t, i18n } = useTranslation();
    const tRef = useRef(t);
    tRef.current = t;
    const thema = useThema(themaVorgabe);
    const wurzel = useRef<HTMLDivElement>(null);
    const steuerung = useRef<LeseSteuerung | null>(null);
    const suchfeld = useRef<HTMLInputElement>(null);

    // --------------------------------------------------------------
    // Laden
    // --------------------------------------------------------------
    const [geladen, setGeladen] = useState<Geladen | null>(null);
    const [ladeStand, setLadeStand] = useState<LadeStand>({ art: 'laedt' });
    const [ladeRunde, setLadeRunde] = useState(0);
    const [info, setInfo] = useState<PdfInfo | undefined>();
    const [basis, setBasis] = useState<{ version?: number; sha256?: string }>({});
    const [passwort, setPasswort] = useState('');
    const passwortAntwort = useRef<((pw: string) => void) | null>(null);
    const passwortAbbruch = useRef<(() => void) | null>(null);
    // Kennwortschutz (Etappe 9): das Kennwort, mit dem die Datei geöffnet
    // wurde (nur im Speicher, für „Kennwort entfernen“ und Commits an einer
    // Datei mit Öffnen-Kennwort); die Rechte der PDF aus pdf.js; das
    // Rechte-Kennwort, das sie für diese Sitzung aufhebt.
    const oeffnenKennwort = useRef('');
    const [rechte, setRechte] = useState<DokumentRechte | null>(null);
    const [rechteKennwort, setRechteKennwort] = useState<string | null>(null);
    // Die laufende Prüfung eines eingegebenen Rechte-Kennworts am Gastgeber (#247).
    const [rechtePruefung, setRechtePruefung] = useState<{ laeuft: boolean; fehler: string | null }>({ laeuft: false, fehler: null });

    const [verlauf, setVerlauf] = useState<Verlauf>(() => verlaufStarten([]));
    // Spiegel des Verlaufs für Befehle, die im selben Umlauf mehrfach kommen
    // (eine Textauswahl über zwei Seiten ergibt zwei Anmerkungen): Jeder
    // Befehl baut auf dem Stand des vorigen auf, nicht auf dem der Anzeige.
    const verlaufRef = useRef(verlauf);
    const verlaufSetzen = (v: Verlauf) => {
        verlaufRef.current = v;
        setVerlauf(v);
    };
    const [auswahl, setAuswahl] = useState<Set<string>>(() => new Set());
    const [anker, setAnker] = useState<string | null>(null);
    const [fokus, setFokus] = useState<string | null>(null);
    const [seite, setSeite] = useState(1);

    // Kommentieren: Werkzeug, Farben, Strichstärke, Fokusziel einer neuen Notiz.
    const [werkzeug, setWerkzeugWahl] = useState<AnmerkungsArt | null>(null);
    // Markieren und Zeichnen merken sich je eine Farbe: Gelb für Text, Rot für Formen.
    const [farben, setFarben] = useState({ markieren: FARBEN[0].hex, zeichnen: FARBEN[3].hex });
    const [staerke, setStaerke] = useState<number>(2);
    const [fokusZiel, setFokusZiel] = useState<string | null>(null);
    // Post-it und Stempel (Etappe 5) merken sich ihre Wahl pro Person und Browser.
    const [postitFarbe, setPostitFarbeIntern] = useState(postitFarbeLesen);
    const postitFarbeSetzen = (hex: string) => {
        setPostitFarbeIntern(hex);
        postitFarbeMerken(hex);
    };
    const [stempelWahl, setStempelWahlIntern] = useState<StempelWahl>(stempelWahlLesen);
    const stempelWahlSetzen = (w: StempelWahl) => {
        setStempelWahlIntern(w);
        stempelWahlMerken(w);
    };
    // Ein gerade gesetzter, noch leerer Zettel — Esc nimmt ihn wieder weg.
    const [frischerZettel, setFrischerZettel] = useState<string | null>(null);
    // Zeiger in der Leseansicht (Etappe 7): Text auswählen oder Hand. In
    // einem Anmerkungswerkzeug gilt weiter dessen Zeiger.
    const [zeiger, setZeigerIntern] = useState<'text' | 'hand'>('text');
    const zeigerSetzen = (z: 'text' | 'hand') => {
        if (z === 'text' && sperren.kopieren) return;
        setZeigerIntern(z);
        ansagen(t(z === 'hand' ? 'openintrapdf.werkzeugband.knopf.zeigerHandAn' : 'openintrapdf.werkzeugband.knopf.zeigerTextAn'));
    };
    // Anmerkungen ein/aus (Etappe 7): nur die Anzeige; der Entwurf bleibt,
    // und ein gewähltes Werkzeug blendet sie wieder ein.
    const [anmerkungenSichtbar, setAnmerkungenSichtbar] = useState(true);
    // Dunkles Dokument (Etappe 7): nur die Seitendarstellung, unabhängig vom Thema.
    const [dunklesDokument, setDunklesDokument] = useState(false);
    const anmerkungenUmschalten = () => {
        const neu = !anmerkungenSichtbar;
        setAnmerkungenSichtbar(neu);
        ansagen(t(neu ? 'openintrapdf.werkzeugband.knopf.anmerkungenEingeblendet' : 'openintrapdf.werkzeugband.knopf.anmerkungenAusgeblendet'));
    };

    useEffect(() => {
        let verworfen = false;
        let uebernommen = false;
        let aufgabe: PDFDocumentLoadingTask | null = null;
        let ohnePasswort = false;
        setLadeStand({ art: 'laedt' });
        (async () => {
            try {
                const [bibliothek, ladung] = await Promise.all([pdfjsLaden(), host.laden()]);
                if (verworfen) return;
                let neueInfo = ladung.info;
                if (!neueInfo && host.info) neueInfo = await host.info().catch(() => undefined);
                if (verworfen) return;
                const task = bibliothek.pdfjs.getDocument({ data: new Uint8Array(ladung.daten), enableXfa: false });
                aufgabe = task;
                task.onPassword = (antworten: (pw: string) => void, grund: number) => {
                    if (verworfen) return;
                    passwortAntwort.current = antworten;
                    passwortAbbruch.current = () => {
                        ohnePasswort = true;
                        void task.destroy();
                    };
                    setLadeStand({ art: 'passwort', falsch: grund === bibliothek.pdfjs.PasswordResponses.INCORRECT_PASSWORD });
                };
                const dokument = await task.promise;
                if (verworfen) return;
                // Rechte der PDF (Etappe 9): pdf.js liest sie aus dem Encrypt-Wörterbuch; null = keine Einschränkung.
                const flags = await (dokument as { getPermissions?: () => Promise<Iterable<number> | null> }).getPermissions?.().catch(() => null);
                if (verworfen) return;
                uebernommen = true;
                setRechte(rechteAusFlags(flags));
                setGeladen({ bibliothek, dokument, aufgabe: task });
                setInfo(neueInfo);
                setBasis({ version: ladung.version ?? neueInfo?.version, sha256: ladung.sha256 ?? neueInfo?.sha256 });
                verlaufSetzen(verlaufStarten(planErstellen(dokument.numPages)));
                setAuswahl(new Set());
                setAnker(null);
                setFokus(null);
                setSeite(1);
                setWerkzeugWahl(null);
                setFokusZiel(null);
                setLadeStand({ art: 'fertig' });
            } catch (e) {
                if (verworfen) return;
                setLadeStand({ art: 'fehler', meldung: ohnePasswort ? tRef.current('openintrapdf.laden.ohnePasswort') : ladeFehlertext(e, tRef.current) });
            }
        })();
        return () => {
            verworfen = true;
            if (aufgabe && !uebernommen) void aufgabe.destroy();
        };
    }, [host, ladeRunde]);

    // Das Dokument aufräumen, sobald es ersetzt wird oder das Fenster zugeht —
    // sonst laufen Worker und Speicher weiter.
    useEffect(() => {
        const aufgabe = geladen?.aufgabe;
        return () => { void aufgabe?.destroy(); };
    }, [geladen]);

    // Die Stilvorlage des pdf.js-Viewers gilt nur, solange der Arbeitsplatz offen ist.
    useEffect(() => (geladen ? viewerStilEinhaengen(geladen.bibliothek.viewerStil) : undefined), [geladen]);

    const dokument = geladen?.dokument ?? null;
    const seitenzahl = dokument?.numPages ?? 0;
    // Im Effekt statt in useMemo: StrictMode hängt Effekte zur Probe aus und
    // wieder ein — ein im Aufräumen beendeter, aber gemerkter Dienst bliebe
    // sonst tot zurück, und keine Miniatur zeichnete sich mehr.
    const [miniaturen, setMiniaturen] = useState<MiniaturDienst | null>(null);
    useEffect(() => {
        if (!dokument) return undefined;
        const dienst = new MiniaturDienst(dokument);
        setMiniaturen(dienst);
        return () => {
            dienst.beenden();
            setMiniaturen(alt => (alt === dienst ? null : alt));
        };
    }, [dokument]);

    // Fokus in den Arbeitsplatz, damit die Tasten sofort wirken.
    useEffect(() => { wurzel.current?.focus(); }, []);

    // --------------------------------------------------------------
    // Rechte und Modus
    // --------------------------------------------------------------
    const anzeigename = info?.name || name;
    const zugriff = info?.access;
    const seitenStand = info?.capabilities?.pages?.state ?? 'available';
    const signiert = seitenStand === 'blocked_by_document';
    const darfGrundsaetzlich = !!host.speichern && zugriff === 'edit';
    const [rechts, setRechts] = useState<{ sichtbar: boolean; gruppe: string | null }>({ sichtbar: true, gruppe: null });
    // Werkzeugband: gewählter Reiter (Start beim Öffnen) und die Darstellung des Bandes (eingeklappt, klassisch, einzeilig).
    const [reiter, setReiter] = useState<WerkzeugbandReiterId>('start');
    const werkzeugbandDarstellung = usePdfWerkzeugbandDarstellung();

    // Text erkennen (Etappe 3): nur mit Recht edit und nur, wenn der
    // Gastgeber Aufträge kennt (das Wiki kennt keine). `requires_worker`
    // zeigt die Gruppe mit dem Grund; andere Zustände lassen sie weg.
    const ocrFaehigkeit = info?.capabilities?.ocr;
    const ocrGruppe = darfGrundsaetzlich && !!host.ocrStarten && !!ocrFaehigkeit
        && (ocrFaehigkeit.state === 'available' || ocrFaehigkeit.state === 'requires_worker');
    const ocrVerfuegbar = ocrGruppe && ocrFaehigkeit?.state === 'available' && !!dokument;
    const ocr = useTexterkennung({
        host, fileId: info?.file_id, version: basis.version, sha256: basis.sha256, verfuegbar: ocrVerfuegbar, rechteKennwort,
        onWiedergefunden: () => setRechts({ sichtbar: true, gruppe: 'ocr' }),
    });
    const ocrSperrt = ocr.aktiv ? t('openintrapdf.ocr.sperrtWerkzeuge') : null;

    // Fassungen (Etappe 8): Solange eine frühere Fassung angesehen wird,
    // ruhen Speichern, Kommentieren und Seiten — sie gälten der aktuellen.
    const [fassungWahl, setFassungWahl] = useState<PdfFassung | null>(null);
    const fassungOffen = !!fassungWahl;
    const fassungSperrt = fassungOffen ? t('openintrapdf.fassungen.sperrt') : null;

    // Sperren aus den Rechten der PDF (Etappe 9), solange das Rechte-Kennwort fehlt.
    const sperren = rechte && !rechteKennwort
        ? { drucken: !rechte.drucken, kopieren: !rechte.kopieren, aendern: !rechte.aendern, kommentieren: !rechte.kommentieren }
        : { drucken: false, kopieren: false, aendern: false, kommentieren: false };
    const sperrText = {
        drucken: sperren.drucken ? t('openintrapdf.schutz.gesperrtDrucken') : null,
        kopieren: sperren.kopieren ? t('openintrapdf.schutz.gesperrtKopieren') : null,
    };

    let bearbeitenGesperrt: string | null = null;
    if (darfGrundsaetzlich) {
        if (fassungSperrt) bearbeitenGesperrt = fassungSperrt;
        else if (ocrSperrt) bearbeitenGesperrt = ocrSperrt;
        else if (sperren.aendern) bearbeitenGesperrt = t('openintrapdf.schutz.gesperrtAendern');
        else if (basis.version === undefined || !basis.sha256) bearbeitenGesperrt = t('openintrapdf.modus.fassungUnbekannt');
        else if (signiert && !host.zielWaehlen) bearbeitenGesperrt = t('openintrapdf.modus.nurKopieOhneZiel');
        else if (seitenStand !== 'available' && !signiert) bearbeitenGesperrt = t(`openintrapdf.faehigkeit.${seitenStand}`);
    }
    const bearbeitenMoeglich = darfGrundsaetzlich && !bearbeitenGesperrt && !!dokument;
    const [modusWahl, setModusWahl] = useState<'lesen' | 'bearbeiten'>('lesen');
    const modus = bearbeitenMoeglich ? modusWahl : 'lesen';
    const lesen = modus === 'lesen';

    // Kommentieren: Recht comment oder edit, und der Server meldet die
    // Fähigkeit UND gibt sie frei. Fehlt `capabilities.annotations` ganz
    // (älterer Server), gibt es keine Werkzeuge und keinen Hinweis.
    const anmerkungsFaehigkeit = info?.capabilities?.annotations;
    const kommentierenGrundsaetzlich = !!host.speichern && (zugriff === 'comment' || zugriff === 'edit') && !!anmerkungsFaehigkeit;
    let kommentierenGesperrt: string | null = null;
    if (kommentierenGrundsaetzlich) {
        if (fassungSperrt) kommentierenGesperrt = fassungSperrt;
        else if (ocrSperrt) kommentierenGesperrt = ocrSperrt;
        else if (sperren.kommentieren) kommentierenGesperrt = t('openintrapdf.schutz.gesperrtKommentieren');
        else if (anmerkungsFaehigkeit?.state !== 'available') {
            kommentierenGesperrt = t('openintrapdf.kommentare.gesperrt', { grund: anmerkungsFaehigkeit?.reason || anmerkungsFaehigkeit?.state });
        }
    }
    const kommentierenMoeglich = kommentierenGrundsaetzlich && !kommentierenGesperrt
        && basis.version !== undefined && !!basis.sha256 && !!dokument;
    const darfSchreiben = darfGrundsaetzlich || kommentierenGrundsaetzlich;

    const entwurf = verlauf.stand;
    const plan = entwurf.plan;
    const anmerkungen = entwurf.anmerkungen;
    const eigenschaftenEntwurf = entwurf.eigenschaften;
    const planGeaendert = !!dokument && bearbeitenMoeglich && !planUnveraendert(plan, seitenzahl);
    const entwurfOffen = !!dokument && (bearbeitenMoeglich || kommentierenMoeglich) && !istUnveraendert(entwurf, seitenzahl);
    const nummern = useMemo(() => neueNummern(plan), [plan]);
    const bleiben = nummern.size;
    const entferntAnzahl = plan.length - bleiben;
    const gewaehlt = useMemo(() => plan.filter(e => auswahl.has(e.id)).map(e => e.id), [plan, auswahl]);

    // --------------------------------------------------------------
    // Ansagen für Screenreader
    // --------------------------------------------------------------
    const [ansage, setAnsage] = useState('');
    const ansagen = useCallback((text: string) => {
        // Gleicher Text zweimal hintereinander würde nicht vorgelesen.
        setAnsage(a => (a === text ? `${text} ` : text));
    }, []);

    // --------------------------------------------------------------
    // Exportieren (Etappe 4): Lesen genügt, das Ziel ist eine neue Datei.
    // Die Gruppe gibt es nur, wenn der Gastgeber die drei Methoden und ein
    // Ziel kennt (das Wiki kennt keines) und der Server die Fähigkeit
    // nennt; einen anderen Zustand als `available` erklärt sie.
    // --------------------------------------------------------------
    const exportFaehigkeit = info?.capabilities?.export;
    const exportGruppe = !!host.analyseStarten && !!host.modellLaden && !!host.exportieren && !!host.zielWaehlen && !!exportFaehigkeit;
    const exportVerfuegbar = exportGruppe && exportFaehigkeit?.state === 'available' && !!dokument;
    const exp = useExport({
        host, fileId: info?.file_id, version: basis.version, sha256: basis.sha256, verfuegbar: exportVerfuegbar, seitenzahl, rechteKennwort,
        startGebiet: (i18n.resolvedLanguage ?? i18n.language ?? 'de').startsWith('de') ? 'de' : 'en',
        onWiedergefunden: () => setRechts({ sichtbar: true, gruppe: 'export' }),
        onExportiert: ergebnis => {
            ansagen(t('openintrapdf.export.erfolg', { name: ergebnis.name }));
            onExportiert?.(ergebnis);
        },
    });

    // --------------------------------------------------------------
    // Dateien binden: Lesen genügt, das Ergebnis ist eine neue Datei.
    // Die Gruppe gibt es nur, wenn der Gastgeber binden, Dateien wählen
    // und ein Ziel erfragen kann (das Wiki kann nichts davon) und die Info
    // der geöffneten Datei da ist — sie ist die erste Quelle.
    // --------------------------------------------------------------
    const bindenGruppe = !!host.binden && !!host.dateienWaehlen && !!host.zielWaehlen && !!info;
    const bindenErste = useMemo(
        () => (info ? { id: info.file_id, name: info.name || name, version: basis.version, info } : null),
        [info, name, basis.version],
    );
    const binden = useBinden({
        host, erste: bindenErste, verfuegbar: bindenGruppe && !!dokument,
        vorschlagName: stamm => t('openintrapdf.binden.vorschlagName', { name: stamm }),
        onGebunden: ergebnis => {
            ansagen(t('openintrapdf.binden.erfolg', { name: ergebnis.name }));
            onGebunden?.(ergebnis);
        },
    });

    // --------------------------------------------------------------
    // Linke und rechte Leiste
    // --------------------------------------------------------------
    const [links, setLinks] = useState<{ offen: boolean; reiter: LinksReiter }>(() => ({
        offen: typeof window === 'undefined' || window.innerWidth >= 900,
        reiter: 'seiten',
    }));

    const modusSetzen = (neu: 'lesen' | 'bearbeiten') => {
        if (neu === 'bearbeiten' && !bearbeitenMoeglich) return;
        setModusWahl(neu);
        if (neu === 'bearbeiten') {
            // Im Seitenraster gibt es keine Stellen — ein Zeichenwerkzeug wäre dort ohne Sinn.
            setWerkzeugWahl(null);
            setRechts({ sichtbar: true, gruppe: 'seiten' });
            // Wer noch nichts Passendes gewählt hat, landet auf dem Reiter Seiten
            // (Vertrag Etappe 7): Start und Kommentieren wirken nur in der Leseansicht.
            setReiter(r => (r === 'start' || r === 'kommentieren' ? 'seiten' : r));
            ansagen(t('openintrapdf.modus.bearbeitenAn'));
        } else {
            setRechts(r => (r.gruppe === 'seiten' ? { ...r, gruppe: null } : r));
            setReiter(r => (r === 'seiten' ? 'start' : r));
            ansagen(t('openintrapdf.modus.lesenAn'));
        }
    };

    // --------------------------------------------------------------
    // Lesen: Seite, Zoom, Suche
    // --------------------------------------------------------------
    const [seitenEingabe, setSeitenEingabe] = useState('1');
    useEffect(() => setSeitenEingabe(String(seite)), [seite]);
    const [zoom, setZoom] = useState<{ prozent: number; vorgabe: string | null }>({ prozent: 100, vorgabe: 'page-width' });
    const [suche, setSuche] = useState<SuchStand>({ text: '', aktuell: 0, gesamt: 0 });
    const [trefferJeSeite, setTrefferJeSeite] = useState<number[]>([]);
    // Suchoptionen (Etappe 7): eine Änderung sucht mit dem stehenden Text neu.
    const [suchOptionen, setSuchOptionen] = useState<SuchOptionen>({ caseSensitive: false, entireWord: false });
    const suchOptionenSetzen = (o: SuchOptionen) => {
        setSuchOptionen(o);
        if (suche.text) {
            setSuche(alt => ({ ...alt, aktuell: 0, gesamt: 0, zustand: 'sucht' }));
            steuerung.current?.suchen(suche.text, 'neu', o);
        }
    };

    const zuSeite = (n: number) => steuerung.current?.zuSeite(Math.max(1, Math.min(seitenzahl, n)));
    const zoomen = (w: ZoomWert) => steuerung.current?.zoom(w);

    const sucheOeffnen = () => {
        if (!lesen) modusSetzen('lesen');
        setLinks({ offen: true, reiter: 'suche' });
        window.requestAnimationFrame(() => {
            suchfeld.current?.focus();
            suchfeld.current?.select();
        });
    };
    const sucheSchliessen = () => {
        steuerung.current?.sucheBeenden();
        setSuche({ text: '', aktuell: 0, gesamt: 0 });
        setTrefferJeSeite([]);
        setLinks(l => ({ ...l, reiter: 'seiten' }));
        wurzel.current?.focus();
    };
    const suchtextSetzen = (text: string) => {
        setSuche({ text, aktuell: 0, gesamt: 0, zustand: text ? 'sucht' : undefined });
        if (text) steuerung.current?.suchen(text, 'neu', suchOptionen);
        else {
            steuerung.current?.sucheBeenden();
            setTrefferJeSeite([]);
        }
    };

    const lesezeichenLaden = useCallback(async () => {
        if (!dokument) return null;
        return (await dokument.getOutline()) as unknown as Lesezeichen[] | null;
    }, [dokument]);

    const lesezeichenWaehlen = (l: Lesezeichen) => {
        if (l.url) {
            window.open(l.url, '_blank', 'noopener,noreferrer');
            return;
        }
        steuerung.current?.zuZiel(l.dest);
    };

    // --------------------------------------------------------------
    // Kommentare (lesend)
    // --------------------------------------------------------------
    // Der gelesene Bestand bleibt hier liegen (Etappe 8): Aus ihm und dem
    // Entwurf folgt, welche Anmerkungen erledigt sind — die Leseansicht
    // blendet sie auf Wunsch aus, auch wenn die Liste gerade zu ist.
    const [bestand, setBestand] = useState<Kommentar[] | null>(null);
    const kommentarLader = useMemo(() => {
        setBestand(null);
        if (!dokument) return null;
        let laufend: Promise<Kommentar[]> | null = null;
        return (fortschritt: (seite: number, gesamt: number) => void) => {
            laufend ??= kommentareSammeln(dokument as unknown as Parameters<typeof kommentareSammeln>[0], { fortschritt })
                .then(l => { setBestand(l); return l; });
            return laufend;
        };
    }, [dokument]);
    // „Erledigte auf der Seite ausblenden“ — nur Anzeige, nichts wird gespeichert.
    const [erledigteAusblenden, setErledigteAusblenden] = useState(false);
    useEffect(() => {
        if (erledigteAusblenden && kommentarLader && !bestand) void kommentarLader(() => undefined).catch(() => undefined);
    }, [erledigteAusblenden, kommentarLader, bestand]);
    const verborgen = useMemo(
        () => (erledigteAusblenden && bestand ? erledigteKennungen(bestand, anmerkungen.status) : []),
        [erledigteAusblenden, bestand, anmerkungen.status],
    );

    const zuKommentar = (seite: number, rechteck?: number[]) => {
        const springen = () => steuerung.current?.zuStelle(seite, rechteck);
        if (!lesen) {
            modusSetzen('lesen');
            window.setTimeout(springen, 60);
        } else springen();
        ansagen(t('openintrapdf.kommentare.gesprungen', { seite }));
    };

    /**
     * Zur Stelle eines Blocks der Exportvorschau. Seine Lage liegt im
     * angezeigten Seitenraum (Ursprung oben links, Punkte); die Leseansicht
     * will den PDF-Benutzerraum — die Umrechnung macht der Viewport von
     * pdf.js, keine eigene Formel (Konzept Kap. 04).
     */
    const zuBlock = async (seiteNr: number, lage: SeitenLage | null) => {
        let rechteck: number[] | undefined;
        if (lage && geladen) {
            try {
                const vp = (await geladen.dokument.getPage(seiteNr)).getViewport({ scale: 1 });
                if (typeof vp.convertToPdfPoint === 'function') {
                    const a = vp.convertToPdfPoint(lage[0], lage[1]);
                    const b = vp.convertToPdfPoint(lage[2], lage[3]);
                    rechteck = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
                }
            } catch { /* Ohne Lage springt die Ansicht nur zur Seite. */ }
        }
        const springen = () => steuerung.current?.zuStelle(seiteNr, rechteck);
        if (!lesen) {
            modusSetzen('lesen');
            window.setTimeout(springen, 60);
        } else springen();
        ansagen(t('openintrapdf.export.gesprungen', { seite: seiteNr }));
    };

    // --------------------------------------------------------------
    // Kommentieren: Werkzeugwahl und Stil
    // --------------------------------------------------------------
    const farbGruppe = werkzeug && (TEXTMARKIERUNGEN.includes(werkzeug) || werkzeug === 'note') ? 'markieren' : 'zeichnen';
    const farbe = farben[farbGruppe];
    const sprache = i18n.resolvedLanguage || i18n.language || 'de';
    // Was der Stempel trägt: Label aus dem Katalog (schon großgeschrieben) oder
    // der eigene Text; `null`, wenn bei „Eigener Text“ nichts steht.
    const stempel = useMemo(
        () => stempelAngabe(stempelWahl, (id: StempelId) => t(`openintrapdf.stempel.label.${id}`), sprache),
        [stempelWahl, sprache, t],
    );
    const stil: Stil = useMemo(() => {
        if (werkzeug === 'sticky') return { color: hexZuRgb(postitFarbe), width: staerke, font_size: POSTIT_SCHRIFT };
        if (werkzeug === 'stamp') return { color: hexZuRgb(stempelWahl.farbe), width: staerke, font_size: 12, ...(stempel ? { stamp: stempel } : {}) };
        return { color: hexZuRgb(farbe), width: staerke, font_size: 12 };
    }, [werkzeug, farbe, staerke, postitFarbe, stempelWahl.farbe, stempel]);
    // Zweite Zeile eines Stempels mit „Name und Datum“ in der Vorschau: der
    // Name aus dem Gastgeber, sonst „Name“, dazu das heutige Datum in der
    // Sprache der Oberfläche. Gespeichert wird, was der Server setzt.
    const personName = host.person?.name;
    const unterschrift = useMemo(() => {
        let datum: string;
        try {
            datum = new Intl.DateTimeFormat(sprache, { dateStyle: 'medium' }).format(new Date());
        } catch {
            datum = new Date().toISOString().slice(0, 10);
        }
        return `${personName || t('openintrapdf.stempel.namePlatzhalter')} · ${datum}`;
    }, [personName, sprache, t]);

    const werkzeugSetzen = (w: AnmerkungsArt | null) => {
        setWerkzeugWahl(w);
        if (!w) return;
        setAnmerkungenSichtbar(true);
        // Werkzeuge wirken in der Leseansicht; das Seitenraster kennt keine Stellen.
        if (!lesen) modusSetzen('lesen');
        setRechts({ sichtbar: true, gruppe: 'kommentare' });
        ansagen(t('openintrapdf.kommentare.werkzeugAn', { werkzeug: t(`openintrapdf.kommentare.werkzeug.${w}`) }));
    };

    // --------------------------------------------------------------
    // Entwurf: Befehle, Rückgängig, Wiederholen
    // --------------------------------------------------------------
    const [seitenMeldung, setSeitenMeldung] = useState<string | null>(null);
    // Fehler einer Aktion außerhalb des Speicherns (Drucken, Herunterladen, Fassung wiederherstellen).
    const [aktionsFehler, setAktionsFehler] = useState<string | null>(null);

    const speicher = useSpeichern({
        host,
        onErfolg: (ergebnis, befehl) => {
            if (befehl.destination.kind === 'new_version') {
                ansagen(t('openintrapdf.zustand.gespeichertFassung', { version: ergebnis.version }));
                setLadeRunde(r => r + 1);
            } else {
                ansagen(t('openintrapdf.zustand.gespeichertDatei', { name: ergebnis.name }));
                // Das Original bleibt, wie es war; der Entwurf steckt jetzt in der neuen Datei.
                verlaufSetzen(verlaufStarten(planErstellen(seitenzahl)));
                setAuswahl(new Set());
            }
            onGespeichert?.(ergebnis, befehl.destination.kind);
        },
    });

    const befehl = (b: EntwurfBefehl) => {
        if ('ids' in b && !b.ids.length) return;
        const vorher = verlaufRef.current;
        const r = ausfuehren(vorher, b);
        if (r.ergebnis === 'letzteSeite') {
            setSeitenMeldung(t('openintrapdf.seiten.letzteSeite'));
            ansagen(t('openintrapdf.seiten.letzteSeite'));
            return;
        }
        if (r.ergebnis !== 'ok') return;
        verlaufSetzen(r.verlauf);
        setSeitenMeldung(null);
        if (speicher.stand.art === 'fehlgeschlagen') speicher.zuruecksetzen();
        // Tippen in einer Notiz wird nicht angesagt — jeder Buchstabe wäre einer zu viel.
        if (b.art === 'anmerkungText') return;
        const anzahl = 'ids' in b ? b.ids.length : b.art === 'einfuegen' ? b.eintraege.length : 1;
        let ansage = t(`openintrapdf.befehl.${b.art}`, { count: anzahl });
        if (b.art === 'entfernen') {
            const entfallen = entfallendeAnmerkungen(r.verlauf.stand.plan, r.verlauf.stand.anmerkungen)
                - entfallendeAnmerkungen(vorher.stand.plan, vorher.stand.anmerkungen);
            if (entfallen > 0) ansage += ` ${t('openintrapdf.befehl.anmerkungenEntfallen', { count: entfallen })}`;
        }
        ansagen(ansage);
    };

    const zurueck = () => {
        const b = naechstesZurueck(verlauf);
        if (!b) return;
        verlaufSetzen(rueckgaengig(verlauf));
        ansagen(t('openintrapdf.befehl.rueckgaengig', { schritt: t(`openintrapdf.befehl.name.${b.art}`) }));
    };
    const vor = () => {
        const b = naechstesVor(verlauf);
        if (!b) return;
        verlaufSetzen(wiederholen(verlauf));
        ansagen(t('openintrapdf.befehl.wiederholt', { schritt: t(`openintrapdf.befehl.name.${b.art}`) }));
    };

    /** Eine neue Anmerkung aus Werkzeug und Geste (Leseansicht). */
    const anmerkungNeu = (a: Omit<NeueAnmerkung, 'client_id'>) => {
        if (a.kind === 'link') {
            // Erst das Ziel aus dem Dialog, dann der Befehl (Etappe 9).
            setDialog({ art: 'linkNeu', page: a.page, rect: a.rect });
            return;
        }
        const client_id = naechsteKennung(verlaufRef.current.stand.anmerkungen);
        befehl({ art: 'anmerkungNeu', anmerkung: { ...a, client_id } });
        setRechts({ sichtbar: true, gruppe: 'kommentare' });
        // Notiz, Textfeld und Post-it brauchen Text: Fokus ins Feld, das Werkzeug ist damit erledigt.
        if (a.kind === 'note' || a.kind === 'freetext' || a.kind === 'sticky') {
            setFokusZiel(client_id);
            setWerkzeugWahl(null);
        }
        // Ein Stempel ist mit dem Klick fertig — einer je Klick, nicht versehentlich zwei.
        if (a.kind === 'stamp') setWerkzeugWahl(null);
        setFrischerZettel(a.kind === 'sticky' ? client_id : null);
    };

    // --------------------------------------------------------------
    // Links (Etappe 9): Ziel aus dem Dialog, gespeicherte Links zum Löschen
    // --------------------------------------------------------------
    const linkAnlegen = (page: number, rect: NeueAnmerkung['rect'], ziel: LinkZiel) => {
        setDialog(null);
        const client_id = naechsteKennung(verlaufRef.current.stand.anmerkungen);
        befehl({ art: 'anmerkungNeu', anmerkung: { client_id, page, kind: 'link', rect, contents: '', color: [0, 0, 1], reply_to: null, ...ziel } });
        ansagen(t('openintrapdf.link.angelegt'));
    };
    // Die gespeicherten Links des Dokuments — gelesen, sobald das Link-Werkzeug gewählt ist.
    const [linksBestand, setLinksBestand] = useState<LinkEintrag[] | null>(null);
    useEffect(() => { setLinksBestand(null); }, [dokument]);
    useEffect(() => {
        if (werkzeug !== 'link' || !dokument || linksBestand) return undefined;
        const abbruch = new AbortController();
        linksSammeln(dokument as unknown as Parameters<typeof linksSammeln>[0], abbruch.signal)
            .then(l => { if (!abbruch.signal.aborted) setLinksBestand(l); }, () => undefined);
        return () => abbruch.abort();
    }, [werkzeug, dokument, linksBestand]);
    const linkZielText = (l: { url?: string; uri?: string; dest?: unknown; page_target?: number }) => {
        const adresse = l.url ?? l.uri;
        if (adresse) return t('openintrapdf.link.zielWeb', { adresse });
        if (l.page_target !== undefined) return t('openintrapdf.link.zielSeite', { seite: l.page_target + 1 });
        if (l.dest !== undefined) return t('openintrapdf.link.zielDokument');
        return t('openintrapdf.link.zielUnbekannt');
    };
    const geloeschteLinks = useMemo(() => new Set(Object.keys(anmerkungen.geloescht)), [anmerkungen.geloescht]);
    const linkLoeschen = (id: string, page: number) => {
        setDialog(null);
        befehl({ art: 'anmerkungLoeschen', ziel: id, page });
    };

    /** Esc auf einem gerade gesetzten, noch leeren Zettel nimmt ihn wieder weg. */
    const leerenZettelVerwerfen = (): boolean => {
        if (!frischerZettel) return false;
        setFrischerZettel(null);
        const z = anmerkungen.neue.find(a => a.client_id === frischerZettel);
        if (!z || z.kind !== 'sticky' || z.contents.trim()) return false;
        befehl({ art: 'anmerkungLoeschen', ziel: z.client_id, page: z.page });
        ansagen(t('openintrapdf.postit.leerVerworfen'));
        return true;
    };

    /** Antwort auf einen Listeneintrag: eine Notiz an derselben Stelle mit `reply_to`. */
    const antworten = (auf: { id: string; page: number; rect: number[] | undefined }) => {
        const client_id = naechsteKennung(verlaufRef.current.stand.anmerkungen);
        const r = auf.rect;
        const rect: NeueAnmerkung['rect'] = r && r.length >= 4 ? [r[0], r[1], r[2], r[3]] : [0, 0, 20, 20];
        befehl({
            art: 'anmerkungNeu',
            anmerkung: { client_id, page: auf.page, kind: 'note', rect, contents: '', color: hexZuRgb(farben.markieren), reply_to: auf.id },
        });
        setFokusZiel(client_id);
    };

    const auswahlSetzen = (ids: Set<string>, neuerAnker?: string) => {
        setAuswahl(ids);
        if (neuerAnker !== undefined) setAnker(neuerAnker);
    };

    const vorSeite = (nummer: number) => {
        const ziel = verbleibend(plan)[nummer - 1]?.id ?? null;
        befehl({ art: 'verschieben', ids: gewaehlt, vor: ziel });
    };

    /**
     * Der Nachbar für neue Seiten (Etappe 9): der zuletzt gewählte Eintrag,
     * sonst der Eintrag mit dem Fokus, sonst die aktuelle Seite der
     * Leseansicht, sonst die letzte Seite des Entwurfs.
     */
    const nachbarEintrag = () => {
        const p = verlaufRef.current.stand.plan;
        return (gewaehlt.length ? p.find(e => e.id === gewaehlt[gewaehlt.length - 1]) : undefined)
            ?? (fokus ? p.find(e => e.id === fokus) : undefined)
            ?? p.find(e => e.quelle === seite - 1 && !e.entfernt)
            ?? p[p.length - 1];
    };

    /** Format und Drehung eines Eintrags, wie die leere Seite sie übernimmt: Seitenbox aus pdf.js, Drehung samt Entwurf. */
    const seitenFormat = async (e: PlanEintrag): Promise<{ format: LeerFormat; drehung: Drehung }> => {
        if (e.leer) return { format: e.leer, drehung: e.drehung };
        // Eine fremde Seite ist nicht geladen: A4 hoch, mit ihrer Drehung.
        if (e.fremd) return { format: { breite: 595, hoehe: 842 }, drehung: e.drehung };
        const s = await dokument!.getPage(e.quelle + 1);
        const view = (s as { view?: ArrayLike<number> }).view;
        const breite = view && view.length >= 4 ? Math.abs(Number(view[2]) - Number(view[0])) : 595;
        const hoehe = view && view.length >= 4 ? Math.abs(Number(view[3]) - Number(view[1])) : 842;
        const grad = ((((s.rotate ?? 0) + e.drehung) % 360) + 360) % 360;
        return {
            format: { breite: Math.round(breite * 100) / 100 || 595, hoehe: Math.round(hoehe * 100) / 100 || 842 },
            drehung: (grad === 90 || grad === 180 || grad === 270 ? grad : 0) as Drehung,
        };
    };

    /** Leere Seite nach dem Nachbarn einfügen und die neue Seite wählen. */
    const leereSeite = async () => {
        const nachbar = nachbarEintrag();
        if (!dokument || !nachbar) return;
        let wahl: { format: LeerFormat; drehung: Drehung };
        try {
            wahl = await seitenFormat(nachbar);
        } catch {
            wahl = { format: { breite: 595, hoehe: 842 }, drehung: 0 };
        }
        befehl({ art: 'leereSeite', nach: nachbar.id, format: wahl.format, drehung: wahl.drehung });
        neueWaehlen(nachbar.id, 1);
    };

    /** Die `anzahl` Einträge hinter `nach` (bzw. am Anfang) wählen und den ersten fokussieren — frisch eingefügt. */
    const neueWaehlen = (nach: string | null, anzahl: number) => {
        const p = verlaufRef.current.stand.plan;
        const ab = nach === null ? 0 : p.findIndex(e => e.id === nach) + 1;
        const neue = p.slice(ab, ab + anzahl);
        if (!neue.length) return;
        auswahlSetzen(new Set(neue.map(e => e.id)), neue[0].id);
        setFokus(neue[0].id);
    };

    // --------------------------------------------------------------
    // Zwischenablage des Dokuments (Etappe 9): nur im Arbeitsplatz, nie
    // die des Systems. Ausschneiden + Einfügen verschiebt, Kopieren +
    // Einfügen verdoppelt an anderer Stelle. Ein neu geladenes Dokument
    // leert sie — die Seitennummern darin gälten der alten Fassung.
    // --------------------------------------------------------------
    const [zwischenablage, setZwischenablage] = useState<{ eintraege: EinfuegeEintrag[]; ausgeschnitten: string[] | null }>({ eintraege: [], ausgeschnitten: null });
    useEffect(() => { setZwischenablage({ eintraege: [], ausgeschnitten: null }); }, [geladen]);
    const alsEinfuegeEintrag = (e: PlanEintrag): EinfuegeEintrag => ({
        quelle: e.quelle, drehung: e.drehung, ...(e.leer ? { leer: e.leer } : {}), ...(e.fremd ? { fremd: e.fremd } : {}),
    });
    const ausgeschnitten = useMemo(() => new Set(zwischenablage.ausgeschnitten ?? []), [zwischenablage.ausgeschnitten]);
    const zwischenablageBefehl = (art: 'kopieren' | 'ausschneiden' | 'einfuegen') => {
        const p = verlaufRef.current.stand.plan;
        if (art === 'kopieren' || art === 'ausschneiden') {
            const eintraege = p.filter(e => auswahl.has(e.id));
            if (!eintraege.length) return;
            setZwischenablage({ eintraege: eintraege.map(alsEinfuegeEintrag), ausgeschnitten: art === 'ausschneiden' ? eintraege.map(e => e.id) : null });
            ansagen(t(art === 'kopieren' ? 'openintrapdf.befehl.kopiert' : 'openintrapdf.befehl.ausgeschnitten', { count: eintraege.length }));
            return;
        }
        if (!zwischenablage.eintraege.length) return;
        const nachbar = nachbarEintrag();
        const geschnitten = zwischenablage.ausgeschnitten;
        if (geschnitten && geschnitten.every(id => p.some(e => e.id === id))) {
            // Verschieben: vor den Eintrag hinter dem Nachbarn (`null` = ans Ende).
            const i = nachbar ? p.findIndex(e => e.id === nachbar.id) : -1;
            befehl({ art: 'verschieben', ids: geschnitten, vor: p[i + 1]?.id ?? null });
            setZwischenablage({ eintraege: [], ausgeschnitten: null });
            auswahlSetzen(new Set(geschnitten), geschnitten[0]);
            return;
        }
        befehl({ art: 'einfuegen', nach: nachbar?.id ?? null, eintraege: zwischenablage.eintraege });
        neueWaehlen(nachbar?.id ?? null, zwischenablage.eintraege.length);
    };

    // --------------------------------------------------------------
    // Seiten aus einer anderen Datei (Etappe 9): Wähler des Gastgebers,
    // dann je Datei der Dialog mit Seitenbereich; die Seiten landen als
    // fremde Einträge im Plan und beim Speichern als `sources`.
    // --------------------------------------------------------------
    const quelleOeffnen = (datei: DateiWahl, rest: DateiWahl[]) => {
        setDialog({ art: 'seitenAusDatei', datei, rest, stand: { art: 'laedt' } });
        const stand = (neu: QuellStand) => setDialog(d => (d?.art === 'seitenAusDatei' && d.datei.id === datei.id ? { ...d, stand: neu } : d));
        host.quelleInfo!(datei.id).then(info => stand({ art: 'fertig', info }), () => stand({ art: 'fehler' }));
    };
    const seitenAusDatei = async () => {
        if (!host.dateienWaehlen || !host.quelleInfo) return;
        setHostDialog(true);
        let gewaehlteDateien: DateiWahl[] = [];
        try {
            gewaehlteDateien = await host.dateienWaehlen();
        } finally {
            setHostDialog(false);
            wurzel.current?.focus();
        }
        if (gewaehlteDateien.length) quelleOeffnen(gewaehlteDateien[0], gewaehlteDateien.slice(1));
    };
    const quelleEinfuegen = (datei: DateiWahl, rest: DateiWahl[], seiten: number[], info: PdfInfo) => {
        const nachbar = nachbarEintrag();
        const fremd = { datei: datei.id, name: info.name || datei.name, ...(info.version ? { version: info.version } : {}) };
        befehl({
            art: 'einfuegen', nach: nachbar?.id ?? null,
            eintraege: seiten.map(seiteNr => ({ quelle: LEERE_QUELLE, drehung: 0 as Drehung, fremd: { ...fremd, seite: seiteNr } })),
        });
        neueWaehlen(nachbar?.id ?? null, seiten.length);
        if (rest.length) quelleOeffnen(rest[0], rest.slice(1));
        else setDialog(null);
    };

    // --------------------------------------------------------------
    // Ziel wählen (Dialog des Gastgebers)
    // --------------------------------------------------------------
    const [hostDialog, setHostDialog] = useState(false);
    const zielErfragen = async (zweck: ZielZweck, vorschlag: string): Promise<PdfZiel | null> => {
        if (!host.zielWaehlen) return null;
        setHostDialog(true);
        try {
            return await host.zielWaehlen({ zweck, name: vorschlag });
        } finally {
            setHostDialog(false);
            wurzel.current?.focus();
        }
    };

    /** Export (Etappe 4): Ziel erfragen, Name mit Endung des Formats, dann ausgeben. */
    const exportZielUndAusgeben = async () => {
        if (!('befehl' in exp.rumpf)) return;
        const { befehl } = exp.rumpf;
        const ziel = await zielErfragen('exportieren', `${namensStamm(anzeigename)}.${befehl.format}`);
        if (!ziel) return;
        await exp.exportieren({ ...befehl, destination: { ...ziel, name: mitEndung(ziel.name, befehl.format) } });
    };

    /** Binden: Zielordner (und endgültigen Namen) erfragen, dann den Befehl schicken. */
    const bindenZielUndAusfuehren = async () => {
        if (binden.pruefung) return;
        const ziel = await zielErfragen('binden', mitPdfEndung(binden.name));
        if (!ziel) return;
        await binden.binden({ ...ziel, name: mitPdfEndung(ziel.name) });
    };

    // --------------------------------------------------------------
    // Text erkennen: Vorschau des Ergebnisses
    // --------------------------------------------------------------
    // Ein zweites pdf.js-Dokument, das die Leseansicht statt des Originals
    // zeigt, bis gespeichert oder verworfen wird. Die Bytes werden bei jedem
    // Lauf frisch geholt — pdf.js übernimmt den Puffer und leert ihn.
    const fertigerAuftrag = ocr.auftrag.art === 'fertig' ? ocr.auftrag.auftrag.id : null;
    const [vorschau, setVorschau] = useState<Vorschau | null>(null);
    const [vorschauRunde, setVorschauRunde] = useState(0);
    useEffect(() => {
        if (!fertigerAuftrag || !geladen || !host.ergebnisLaden) {
            setVorschau(null);
            return undefined;
        }
        let verworfen = false;
        let uebernommen = false;
        let aufgabe: PDFDocumentLoadingTask | null = null;
        setVorschau({ id: fertigerAuftrag, laedt: true, fehler: false, dokument: null, aufgabe: null });
        (async () => {
            try {
                const daten = await host.ergebnisLaden!(fertigerAuftrag);
                if (verworfen) return;
                const task = geladen.bibliothek.pdfjs.getDocument({ data: new Uint8Array(daten), enableXfa: false });
                aufgabe = task;
                const ergebnis = await task.promise;
                if (verworfen) return;
                uebernommen = true;
                setVorschau({ id: fertigerAuftrag, laedt: false, fehler: false, dokument: ergebnis, aufgabe: task });
            } catch {
                if (!verworfen) setVorschau({ id: fertigerAuftrag, laedt: false, fehler: true, dokument: null, aufgabe: null });
            }
        })();
        return () => {
            verworfen = true;
            if (aufgabe && !uebernommen) void aufgabe.destroy();
        };
    }, [fertigerAuftrag, geladen, host, vorschauRunde]);
    useEffect(() => {
        const aufgabe = vorschau?.aufgabe;
        return () => { void aufgabe?.destroy(); };
    }, [vorschau?.aufgabe]);
    const vorschauOffen = !!vorschau?.dokument;

    // --------------------------------------------------------------
    // Fassungen (Etappe 8): Liste im Arbeitsfach, eine Fassung nur ansehen
    // --------------------------------------------------------------
    const fassungenMoeglich = !!host.fassungen && !!host.fassungLaden && !!dokument;
    const [fassungen, setFassungen] = useState<FassungenStand | null>(null);
    const fassungenOffen = rechts.sichtbar && rechts.gruppe === 'fassungen';
    useEffect(() => {
        if (!fassungenOffen || !host.fassungen || !dokument) return undefined;
        let aus = false;
        setFassungen({ art: 'laedt' });
        host.fassungen().then(
            liste => { if (!aus) setFassungen({ art: 'fertig', liste }); },
            () => { if (!aus) setFassungen({ art: 'fehler' }); },
        );
        return () => { aus = true; };
    }, [fassungenOffen, host, dokument, basis.version]);

    // Ein neues Dokument (neu geladen nach Speichern oder Wiederherstellen) beendet das Ansehen.
    useEffect(() => { setFassungWahl(null); }, [geladen]);
    const [fassungAnsicht, setFassungAnsicht] = useState<FassungAnsicht | null>(null);
    useEffect(() => {
        if (!fassungWahl || !geladen || !host.fassungLaden) {
            setFassungAnsicht(null);
            return undefined;
        }
        const version = fassungWahl.version;
        let verworfen = false;
        let uebernommen = false;
        let aufgabe: PDFDocumentLoadingTask | null = null;
        setFassungAnsicht({ version, laedt: true, fehler: false, dokument: null, aufgabe: null });
        (async () => {
            try {
                const daten = await host.fassungLaden!(version);
                if (verworfen) return;
                const task = geladen.bibliothek.pdfjs.getDocument({ data: new Uint8Array(daten), enableXfa: false });
                aufgabe = task;
                const ergebnis = await task.promise;
                if (verworfen) return;
                uebernommen = true;
                setFassungAnsicht({ version, laedt: false, fehler: false, dokument: ergebnis, aufgabe: task });
            } catch {
                if (!verworfen) setFassungAnsicht({ version, laedt: false, fehler: true, dokument: null, aufgabe: null });
            }
        })();
        return () => {
            verworfen = true;
            if (aufgabe && !uebernommen) void aufgabe.destroy();
        };
    }, [fassungWahl, geladen, host]);
    useEffect(() => {
        const aufgabe = fassungAnsicht?.aufgabe;
        return () => { void aufgabe?.destroy(); };
    }, [fassungAnsicht?.aufgabe]);
    const fassungDatum = useMemo(() => {
        if (!fassungWahl) return '';
        const d = new Date(fassungWahl.created_at);
        if (Number.isNaN(d.getTime())) return fassungWahl.created_at;
        try {
            return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'de', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
        } catch {
            return d.toISOString();
        }
    }, [fassungWahl, i18n.resolvedLanguage, i18n.language]);
    const fassungAnsehen = (f: PdfFassung) => {
        setFassungWahl(f);
        setWerkzeugWahl(null);
        if (!lesen) modusSetzen('lesen');
        ansagen(t('openintrapdf.fassungen.hinweis', { version: f.version, datum: fassungDatum }));
    };
    const [fassungStellt, setFassungStellt] = useState(false);
    const fassungWiederherstellen = async (f: PdfFassung) => {
        if (!host.fassungWiederherstellen) return;
        setFassungStellt(true);
        setAktionsFehler(null);
        try {
            await host.fassungWiederherstellen(f.version);
            setFassungWahl(null);
            ansagen(t('openintrapdf.fassungen.wiederhergestellt', { version: f.version }));
            setLadeRunde(r => r + 1);
        } catch (e) {
            const fehler = alsHostFehler(e);
            setAktionsFehler(fehler.meldung || t('openintrapdf.fassungen.wiederherstellenFehler'));
        } finally {
            setFassungStellt(false);
        }
    };

    // Die Suche gehört zum Dokument; wechselt es, fängt sie neu an.
    useEffect(() => {
        setSuche({ text: '', aktuell: 0, gesamt: 0 });
        setTrefferJeSeite([]);
    }, [vorschauOffen, fassungOffen]);

    // Veröffentlichen des Ergebnisses: dieselben Zustände und Fehler wie
    // beim Speichern (412, 422, 429, 503), nur über die Route des Auftrags.
    const ocrSpeicher = useSpeichern({
        host,
        sendenUeber: (befehl, schluessel) => {
            if (!fertigerAuftrag || !host.auftragVeroeffentlichen) return Promise.reject(new PdfHostFehler(0, 'network'));
            const rumpf: AuftragVeroeffentlichen = { destination: befehl.destination };
            if (befehl.accept_losses) rumpf.accept_losses = befehl.accept_losses;
            return host.auftragVeroeffentlichen(fertigerAuftrag, rumpf, schluessel);
        },
        onErfolg: (ergebnis, befehl) => {
            if (fertigerAuftrag) ocr.abschliessen(fertigerAuftrag);
            if (befehl.destination.kind === 'new_version') {
                ansagen(t('openintrapdf.zustand.gespeichertFassung', { version: ergebnis.version }));
                setLadeRunde(r => r + 1);
            } else ansagen(t('openintrapdf.zustand.gespeichertDatei', { name: ergebnis.name }));
            onGespeichert?.(ergebnis, befehl.destination.kind);
        },
    });
    // Zwei Speicherwege, eine Zustandsanzeige: Sie zeigt den, der zuletzt etwas getan hat.
    const aktiverSpeicher = ocrSpeicher.stand.art !== 'ruhe' ? ocrSpeicher : speicher;
    const stand = aktiverSpeicher.stand;

    // Nichts erkannt: Speichern braechte eine Fassung ohne Nutzen, es bleibt
    // nur Verwerfen (Dev-Probe 29.09.2026).
    const vorschauSpeicherbar = vorschauOffen && ocr.auftrag.art === 'fertig'
        && (ocr.auftrag.auftrag.result?.meta?.pages_recognized?.length ?? 0) > 0;
    const ocrSpeichernAls = async (art: 'fassung' | 'datei'): Promise<boolean> => {
        if (!vorschauSpeicherbar || basis.version === undefined || !basis.sha256) return false;
        let destination: CommitZiel = { kind: 'new_version' };
        if (art === 'datei' || signiert) {
            const ziel = await zielErfragen('neue_datei', t('openintrapdf.ocr.vorschlagName', { name: namensStamm(anzeigename) }));
            if (!ziel) return false;
            destination = { kind: 'new_file', drive_id: ziel.drive_id, folder_id: ziel.folder_id, name: mitPdfEndung(ziel.name) };
        }
        speicher.zuruecksetzen();
        return ocrSpeicher.senden({ expected_version: basis.version, expected_sha256: basis.sha256, destination });
    };
    const ocrVerwerfen = () => {
        ocrSpeicher.zuruecksetzen();
        ocr.verwerfen();
        ansagen(t('openintrapdf.ocr.verworfen'));
    };

    // --------------------------------------------------------------
    // Speichern
    // --------------------------------------------------------------
    const speichernAls = async (art: 'fassung' | 'datei'): Promise<boolean> => {
        if (vorschauOffen) return ocrSpeichernAls(art);
        if (!(bearbeitenMoeglich || kommentierenMoeglich) || !entwurfOffen || basis.version === undefined || !basis.sha256) return false;
        // Recht comment: nur Anmerkungen, nur als neue Fassung (Vertrag Etappe 2).
        if (art === 'datei' && !bearbeitenMoeglich) return false;
        let destination: CommitZiel = { kind: 'new_version' };
        if (art === 'datei' || (signiert && bearbeitenMoeglich)) {
            const ziel = await zielErfragen('neue_datei', t('openintrapdf.ziel.vorschlagBearbeitet', { name: namensStamm(anzeigename) }));
            if (!ziel) return false;
            destination = { kind: 'new_file', drive_id: ziel.drive_id, folder_id: ziel.folder_id, name: mitPdfEndung(ziel.name) };
        }
        const rumpf: CommitBefehl = { expected_version: basis.version, expected_sha256: basis.sha256, destination };
        // `pages` nur, wenn sich der Plan geändert hat — ein unveränderter Plan
        // hieße für den Server: alle Seiten neu bauen, ohne Grund.
        if (bearbeitenMoeglich && planGeaendert) {
            rumpf.pages = planZuSeiten(plan, seitenzahl);
            const { sources } = planQuellen(plan);
            if (sources.length) rumpf.sources = sources;
        }
        const anmerkungsBefehle = anmerkungenZuBefehl(anmerkungen, plan);
        if (anmerkungsBefehle) rumpf.annotations = anmerkungsBefehle;
        // Eigenschaften (Etappe 8) nur mit edit — der Dialog bietet sie nur dort an.
        if (bearbeitenMoeglich && !eigenschaftenUnveraendert(eigenschaftenEntwurf)) rumpf.properties = { ...eigenschaftenEntwurf };
        if (!rumpf.pages && !rumpf.annotations && !rumpf.properties) return false;
        kennwoerterAnhaengen(rumpf);
        ocrSpeicher.zuruecksetzen();
        return speicher.senden(rumpf);
    };

    /** Kennwörter (Etappe 9) an einen Commit oder eine Druckfassung hängen: nur, wenn die Datei sie braucht. */
    const kennwoerterAnhaengen = (rumpf: { password?: string; owner_password?: string }) => {
        if (oeffnenKennwort.current) rumpf.password = oeffnenKennwort.current;
        if (rechteKennwort) rumpf.owner_password = rechteKennwort;
    };

    // Lehnt der Server das Rechte-Kennwort ab, gelten die Sperren wieder —
    // einmal je Fehlschlag, damit ein neu eingegebenes Kennwort stehen bleibt.
    const letzterRechteFehler = useRef<SpeicherStand | null>(null);
    useEffect(() => {
        const st = speicher.stand;
        if (st.art !== 'fehlgeschlagen' || st === letzterRechteFehler.current) return;
        if (st.code !== 'pdf.permission_restricted' && st.code !== 'pdf.wrong_password') return;
        letzterRechteFehler.current = st;
        if (rechteKennwort) {
            setRechteKennwort(null);
            ansagen(t('openintrapdf.schutz.abgelehnt'));
        }
    }, [speicher.stand, rechteKennwort, ansagen, t]);
    // Dasselbe beim Start eines Auftrags (Analyse, Texterkennung): Weist der
    // Server das mitgeschickte Rechte-Kennwort ab, ist es für die Sitzung weg.
    const letzterStartRechteFehler = useRef<StartFehler | null>(null);
    useEffect(() => {
        const f = [ocr.startFehler, exp.startFehler].find(x => x?.grund === 'rechteKennwort') ?? null;
        if (!f || f === letzterStartRechteFehler.current) return;
        letzterStartRechteFehler.current = f;
        if (rechteKennwort) {
            setRechteKennwort(null);
            ansagen(t('openintrapdf.schutz.abgelehnt'));
        }
    }, [ocr.startFehler, exp.startFehler, rechteKennwort, ansagen, t]);

    // --------------------------------------------------------------
    // Kennwortschutz (Etappe 9): geschützte Kopie, Kennwort entfernen,
    // Rechte-Kennwort für die Sitzung
    // --------------------------------------------------------------
    const geschuetztHerunterladen = async (b: Omit<SchutzBefehl, 'expected_version'>) => {
        setDialog(null);
        if (!host.geschuetzt || basis.version === undefined) return;
        setAktion('herunterladen');
        setAktionsFehler(null);
        try {
            const daten = await host.geschuetzt({ ...b, expected_version: basis.version });
            dateiAnbieten(new Blob([daten], { type: 'application/pdf' }), t('openintrapdf.schutz.dateiname', { name: namensStamm(anzeigename) }));
            ansagen(t('openintrapdf.schutz.erfolg'));
        } catch (e) {
            const f = alsHostFehler(e);
            setAktionsFehler(f.meldung || t('openintrapdf.schutz.fehler'));
        } finally {
            setAktion(null);
        }
    };
    const kennwortEntfernen = (kennwort: string) => {
        setDialog(null);
        if (basis.version === undefined || !basis.sha256) return;
        ocrSpeicher.zuruecksetzen();
        // Den Schutz nimmt nur das Rechte-Kennwort (#248): Ist es für die Sitzung
        // bekannt, geht es mit — das Feld des Dialogs darf dann das Öffnen-Kennwort sein.
        void speicher.senden({
            expected_version: basis.version, expected_sha256: basis.sha256, destination: { kind: 'new_version' },
            decrypt: { password: kennwort }, ...(rechteKennwort ? { owner_password: rechteKennwort } : {}),
        });
    };
    const rechteKennwortSetzen = async (kennwort: string) => {
        // Erst der Gastgeber (#247): Die Sperren fallen nur für ein Kennwort, das
        // der Server als Rechte-Kennwort der Datei bestätigt hat — nicht für
        // irgendeine Eingabe.
        if (!host.rechteKennwortPruefen) return;
        setRechtePruefung({ laeuft: true, fehler: null });
        try {
            await host.rechteKennwortPruefen(kennwort);
        } catch (e) {
            const f = alsHostFehler(e);
            setRechtePruefung({ laeuft: false, fehler: f.code === 'pdf.wrong_password' ? t('fehler.pdf.wrong_password') : f.meldung || t('openintrapdf.schutz.pruefungFehler') });
            return;
        }
        setRechtePruefung({ laeuft: false, fehler: null });
        setDialog(null);
        setRechteKennwort(kennwort);
        ansagen(t('openintrapdf.schutz.aufgehoben'));
    };
    const rechteKennwortDialog = () => {
        setRechtePruefung({ laeuft: false, fehler: null });
        setDialog({ art: 'rechteKennwort' });
    };
    const speichernStandard = () => speichernAls(signiert && bearbeitenMoeglich ? 'datei' : 'fassung');

    const neuLadenVerwerfen = () => {
        if (vorschauOffen) ocr.verwerfen();
        aktiverSpeicher.zuruecksetzen();
        setLadeRunde(r => r + 1);
        ansagen(t('openintrapdf.konflikt.neuGeladen'));
    };

    // Beim Verlassen der Seite mit offenem Entwurf fragt der Browser nach.
    useEffect(() => {
        if (!entwurfOffen) return;
        const warnen = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warnen);
        return () => window.removeEventListener('beforeunload', warnen);
    }, [entwurfOffen]);

    // --------------------------------------------------------------
    // Leere Seiten prüfen
    // --------------------------------------------------------------
    const [leer, setLeer] = useState({ laeuft: false, erledigt: 0, gesamt: 0, meldung: null as string | null });
    const leerAbbruch = useRef<AbortController | null>(null);
    useEffect(() => () => leerAbbruch.current?.abort(), []);

    const leerPruefen = async () => {
        if (!dokument) return;
        // Neue leere Seiten sind gewollt leer, fremde nicht geladen — beide stehen nicht zur Prüfung.
        const eintraege = verbleibend(plan).filter(e => e.quelle >= 0);
        const abbruch = new AbortController();
        leerAbbruch.current = abbruch;
        setLeer({ laeuft: true, erledigt: 0, gesamt: eintraege.length, meldung: null });
        try {
            const kandidaten = await leereSeitenSuchen(dokument as unknown as PruefDokument, eintraege, leinwandRastern, {
                signal: abbruch.signal,
                fortschritt: (erledigt, gesamt) => setLeer(l => ({ ...l, erledigt, gesamt })),
            });
            const meldung = kandidaten.length
                ? t('openintrapdf.leer.gefunden', { count: kandidaten.length })
                : t('openintrapdf.leer.keine');
            setLeer({ laeuft: false, erledigt: 0, gesamt: 0, meldung });
            ansagen(meldung);
            if (kandidaten.length) setDialog({ art: 'leer', kandidaten });
        } catch (e) {
            const abgebrochen = (e as { name?: string })?.name === 'AbortError';
            setLeer({ laeuft: false, erledigt: 0, gesamt: 0, meldung: t(abgebrochen ? 'openintrapdf.leer.abgebrochen' : 'openintrapdf.leer.fehler') });
        } finally {
            if (leerAbbruch.current === abbruch) leerAbbruch.current = null;
        }
    };

    // --------------------------------------------------------------
    // Extrahieren und Teilen (legt sofort neue Dateien an)
    // --------------------------------------------------------------
    const [extrakt, setExtrakt] = useState({ laeuft: false, meldung: null as string | null, fehler: false });
    const [extraktVorgaenge] = useState(() => new Vorgaenge());

    const extrahieren = async (art: 'one' | 'each') => {
        if (!host.extrahieren) return;
        // Leere und fremde Seiten des Entwurfs gibt es in der gespeicherten Fassung noch nicht.
        const quellen = plan.filter(e => auswahl.has(e.id) && e.quelle >= 0).map(e => e.quelle);
        const seiten = art === 'each' ? [...new Set(quellen)] : quellen;
        if (!seiten.length) return;
        const stamm = namensStamm(anzeigename);
        const ziel = await zielErfragen(
            art === 'each' ? 'teilen' : 'extrahieren',
            art === 'each' ? `${stamm}.pdf` : t('openintrapdf.ziel.vorschlagAuszug', { name: stamm }),
        );
        if (!ziel) return;
        const auftrag: ExtraktBefehl = { pages: seiten, mode: art, destination: { ...ziel, name: mitPdfEndung(ziel.name) } };
        const schluessel = extraktVorgaenge.schluesselFuer(auftrag);
        setExtrakt({ laeuft: true, meldung: null, fehler: false });
        try {
            const ergebnis = await host.extrahieren(auftrag, schluessel);
            extraktVorgaenge.abschliessen();
            const meldung = t('openintrapdf.extrakt.fertig', { count: ergebnis.files.length, namen: ergebnis.files.map(f => f.name).join(', ') });
            setExtrakt({ laeuft: false, meldung, fehler: false });
            ansagen(meldung);
            onExtrahiert?.(ergebnis);
        } catch (e) {
            const f = alsHostFehler(e);
            const wiederholbar = f.status === 0 || f.status >= 500;
            if (!wiederholbar) extraktVorgaenge.abschliessen();
            const meldung = f.meldung || t(wiederholbar ? 'openintrapdf.extrakt.netz' : 'openintrapdf.extrakt.fehler');
            setExtrakt({ laeuft: false, meldung, fehler: true });
            ansagen(meldung);
        }
    };

    // --------------------------------------------------------------
    // Drucken, Herunterladen, Schließen
    // --------------------------------------------------------------
    const [aktion, setAktion] = useState<null | 'drucken' | 'herunterladen'>(null);
    const ausgeben = async (art: 'drucken' | 'herunterladen') => {
        setAktion(art);
        setAktionsFehler(null);
        try {
            if (art === 'drucken') await host.drucken?.();
            else await host.herunterladen?.();
        } catch (e) {
            const f = alsHostFehler(e);
            setAktionsFehler(f.meldung || t(`openintrapdf.aktion.${art}Fehler`));
        } finally {
            setAktion(null);
        }
    };

    const [dialog, setDialog] = useState<OffenerDialog>(null);

    // Drucken (Etappe 8): Der Knopf öffnet den Dialog. Alle Seiten mit
    // Anmerkungen gehen den heutigen Weg des Gastgebers; sonst baut der
    // Gastgeber die Teil-PDF, die hier im versteckten Rahmen oder über
    // seinen eigenen Druckweg (Desktop) gedruckt wird.
    const druckenOeffnen = () => {
        if (!host.drucken || !dokument || aktion !== null || sperren.drucken) return;
        setDialog({ art: 'drucken' });
    };
    const drucken = async (wahl: DruckWahl) => {
        setDialog(null);
        if (!wahl.seiten && wahl.anmerkungen) {
            await ausgeben('drucken');
            return;
        }
        if (!host.druckfassung || basis.version === undefined) return;
        setAktion('drucken');
        setAktionsFehler(null);
        try {
            const seiten = wahl.seiten ?? Array.from({ length: seitenzahl }, (_, i) => i);
            // Kennwörter (#247): Der Server prüft das Druckrecht der Datei und schützt die Kopie wieder.
            const befehl: DruckBefehl = { pages: seiten, annotations: wahl.anmerkungen, expected_version: basis.version };
            kennwoerterAnhaengen(befehl);
            const daten = await host.druckfassung(befehl);
            const name = `${namensStamm(anzeigename)} – ${t('openintrapdf.druck.titel')}.pdf`;
            if (host.bytesDrucken) await host.bytesDrucken(daten, name);
            else await pdfDrucken(new Blob([daten], { type: 'application/pdf' }));
        } catch (e) {
            const f = alsHostFehler(e);
            setAktionsFehler(f.meldung || t('openintrapdf.druck.teilFehler'));
        } finally {
            setAktion(null);
        }
    };
    const schnelldruck = async () => {
        if (!host.schnelldruck || !dokument || aktion !== null || sperren.drucken) return;
        setAktion('drucken');
        setAktionsFehler(null);
        try {
            await host.schnelldruck();
            ansagen(t('openintrapdf.druck.schnelldruckGestartet'));
        } catch (e) {
            const f = alsHostFehler(e);
            setAktionsFehler(f.meldung || t('openintrapdf.druck.schnelldruckFehler'));
        } finally {
            setAktion(null);
        }
    };
    const schliessen = () => {
        if (entwurfOffen) setDialog({ art: 'schliessen' });
        else onClose();
    };

    // Befehle von außen (Menü der Desktop-App): dieselben Wege wie die
    // Knöpfe und Tasten, mit denselben Sperren.
    useImperativeHandle(befehle, () => ({
        schliessen,
        speichern: () => {
            if ((entwurfOffen || vorschauOffen) && stand.art !== 'speichert' && !fassungOffen) void speichernStandard();
        },
        drucken: druckenOeffnen,
        kopie: () => {
            if (host.herunterladen && aktion === null) void ausgeben('herunterladen');
        },
    }));

    // --------------------------------------------------------------
    // Tastatur
    // --------------------------------------------------------------
    const passwortAbbrechen = () => {
        passwortAbbruch.current?.();
        passwortAntwort.current = null;
    };

    const escape = () => {
        if (stand.art === 'verlust') { aktiverSpeicher.zuruecksetzen(); return; }
        if (binden.stand.art === 'verlust') { binden.zuruecksetzen(); return; }
        if (dialog) { setDialog(null); return; }
        if (ladeStand.art === 'passwort') { passwortAbbrechen(); return; }
        // Esc beendet zuerst das Werkzeug (Konzept Kap. 02).
        if (werkzeug) {
            setWerkzeugWahl(null);
            ansagen(t('openintrapdf.kommentare.werkzeugAus'));
            return;
        }
        if (leerenZettelVerwerfen()) return;
        if (links.offen && links.reiter === 'suche' && lesen) { sucheSchliessen(); return; }
        if (rechts.sichtbar && rechts.gruppe) { setRechts(r => ({ ...r, gruppe: null })); return; }
        if (!lesen && auswahl.size) { setAuswahl(new Set()); return; }
        schliessen();
    };

    const taste = (e: TastenEreignis<HTMLDivElement>) => {
        // Solange der Gastgeber einen eigenen Dialog zeigt, gehören ihm die Tasten.
        if (hostDialog || e.defaultPrevented) return;
        const strg = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (e.key === 'Escape') {
            e.preventDefault();
            escape();
            return;
        }
        if (dialog || stand.art === 'verlust' || binden.stand.art === 'verlust' || ladeStand.art === 'passwort') return;
        const inEingabe = istEingabe(e.target);
        if (strg && !e.altKey && k === 'f') {
            e.preventDefault();
            sucheOeffnen();
            return;
        }
        if (strg && k === 's') {
            e.preventDefault();
            if ((entwurfOffen || vorschauOffen) && stand.art !== 'speichert' && !fassungOffen) void speichernStandard();
            return;
        }
        // In einem Eingabefeld gehört Strg+Z dem Feld selbst.
        if (darfSchreiben && !inEingabe && strg && (k === 'z' || k === 'y')) {
            e.preventDefault();
            if (k === 'y' || e.shiftKey) vor();
            else zurueck();
            return;
        }
        if (!lesen || inEingabe || strg || e.altKey) return;
        let erledigt = true;
        switch (e.key) {
            case 'h':
            case 'H':
                zeigerSetzen('hand');
                break;
            case 'v':
            case 'V':
                zeigerSetzen('text');
                break;
            case 'ArrowRight':
            case 'PageDown':
                steuerung.current?.blaettern(1);
                break;
            case 'ArrowLeft':
            case 'PageUp':
                steuerung.current?.blaettern(-1);
                break;
            case 'Home':
                zuSeite(1);
                break;
            case 'End':
                zuSeite(seitenzahl);
                break;
            case '+':
            case '=':
                zoomen('mehr');
                break;
            case '-':
                zoomen('weniger');
                break;
            default:
                erledigt = false;
        }
        if (erledigt) e.preventDefault();
    };

    // --------------------------------------------------------------
    // Werkzeuggruppen rechts
    // --------------------------------------------------------------
    const drehungImEntwurf = plan.some(e => auswahl.has(e.id) && e.drehung !== 0);
    // Je entferntem Eintrag: wie viele Entwurfsanmerkungen mit ihm entfallen —
    // nur, wenn KEIN verbleibender Eintrag mehr auf dieselbe Quelle zeigt.
    const entfallend = useMemo(() => {
        const m = new Map<string, number>();
        const jeQuelle = neueJeQuelle(anmerkungen);
        for (const e of plan) {
            if (!e.entfernt) continue;
            const n = jeQuelle.get(e.quelle);
            if (n && !plan.some(x => x.quelle === e.quelle && !x.entfernt)) m.set(e.id, n);
        }
        return m;
    }, [plan, anmerkungen]);
    const anmerkungenBeiEntfernen = entfallendeAnmerkungen(plan, anmerkungen, gewaehlt) - entfallendeAnmerkungen(plan, anmerkungen);
    const gruppen: WerkzeugGruppe[] = [];
    // Das Seitenwerkzeug gehört zum Seitenraster, also zum Bearbeiten.
    if (bearbeitenMoeglich && !lesen) {
        gruppen.push({
            id: 'seiten',
            titel: t('openintrapdf.werkzeuge.seiten'),
            inhalt: (
                <>
                    {seitenMeldung && <div className="mb-3" role="alert"><Hinweis art="warnung">{seitenMeldung}</Hinweis></div>}
                    <SeitenWerkzeug
                        gewaehlt={gewaehlt}
                        gewaehltEntfernt={plan.filter(e => auswahl.has(e.id) && e.entfernt).length}
                        verbleibend={bleiben}
                        onBefehl={befehl}
                        onVorSeite={vorSeite}
                        leer={leer}
                        onLeerAbbrechen={() => leerAbbruch.current?.abort()}
                        extrahierenMoeglich={!!host.extrahieren && !!host.zielWaehlen}
                        extrakt={extrakt}
                        drehungImEntwurf={drehungImEntwurf}
                        anmerkungenBeiEntfernen={anmerkungenBeiEntfernen}
                    />
                </>
            ),
        });
    }
    if (kommentarLader && (kommentierenGrundsaetzlich || info?.inspection?.annotations !== 0 || anmerkungen.neue.length > 0)) {
        const listenEntwurf = kommentierenMoeglich && (zugriff === 'comment' || zugriff === 'edit') ? {
            anmerkungen, zugriff, fokus: fokusZiel, onFokusErledigt: () => setFokusZiel(null), onBefehl: befehl, onAntworten: antworten,
        } : undefined;
        gruppen.push({
            id: 'kommentare',
            titel: t(kommentierenMoeglich ? 'openintrapdf.werkzeuge.kommentieren' : 'openintrapdf.werkzeuge.kommentare'),
            inhalt: (
                <div className="space-y-4">
                    {kommentierenMoeglich && (
                        <KommentarEinstellungen werkzeug={werkzeug} stempel={stempelWahl} onStempel={stempelWahlSetzen} sprache={sprache} />
                    )}
                    <KommentarListe laden={kommentarLader} onZuStelle={zuKommentar} entwurf={listenEntwurf} gesperrt={kommentierenGesperrt ?? undefined}
                        erledigteAusblenden={{ an: erledigteAusblenden, setzen: setErledigteAusblenden }} />
                </div>
            ),
        });
    }
    if (bindenGruppe) {
        gruppen.push({
            id: 'binden',
            titel: t('openintrapdf.binden.titel'),
            inhalt: (
                <BindenWerkzeug b={binden} entwurfOffen={entwurfOffen} onBinden={() => void bindenZielUndAusfuehren()} onAnsage={ansagen} />
            ),
        });
    }
    if (ocrGruppe) {
        gruppen.push({
            id: 'ocr',
            titel: t('openintrapdf.ocr.titel'),
            inhalt: (
                <TexterkennungWerkzeug
                    fehltBaustein={ocrFaehigkeit?.state !== 'available'}
                    ocr={ocr}
                    miniaturen={miniaturen}
                    vorschau={vorschau ? { laedt: vorschau.laedt, fehler: vorschau.fehler } : null}
                    onVorschauErneut={() => setVorschauRunde(r => r + 1)}
                    onStarten={() => {
                        // Erst der Entwurf, dann die Erkennung — beides zugleich ginge nicht zusammen.
                        if (entwurfOffen) setDialog({ art: 'ocrEntwurf' });
                        else void ocr.starten();
                    }}
                    onSpeichern={art => void ocrSpeichernAls(art)}
                    onVerwerfen={ocrVerwerfen}
                    speichert={stand.art === 'speichert'}
                    nurNeueDatei={signiert}
                    neueDateiMoeglich={!!host.zielWaehlen}
                />
            ),
        });
    }
    if (fassungenMoeglich) {
        gruppen.push({
            id: 'fassungen',
            titel: t('openintrapdf.fassungen.titel'),
            inhalt: (
                <FassungenWerkzeug
                    stand={fassungen}
                    aktuell={basis.version}
                    angesehen={fassungWahl?.version ?? null}
                    onAnsehen={fassungAnsehen}
                    onZurueck={() => setFassungWahl(null)}
                    onWiederherstellen={darfGrundsaetzlich && host.fassungWiederherstellen ? f => setDialog({ art: 'fassungWiederherstellen', fassung: f }) : undefined}
                    entwurfOffen={entwurfOffen}
                    stellt={fassungStellt}
                />
            ),
        });
    }
    if (exportGruppe) {
        gruppen.push({
            id: 'export',
            titel: t('openintrapdf.export.titel'),
            inhalt: (
                <ExportWerkzeug
                    nichtVerfuegbar={exportFaehigkeit?.state === 'available' ? null : exportFaehigkeit ?? null}
                    exp={exp}
                    version={basis.version}
                    entwurfOffen={entwurfOffen}
                    onZuStelle={(seite, lage) => void zuBlock(seite, lage)}
                    onExportieren={() => void exportZielUndAusgeben()}
                />
            ),
        });
    }
    /** Ein Werkzeugband-Knopf fordert ein Werkzeug im Arbeitsfach an — oder schließt es wieder. */
    const fachUmschalten = (id: string) => {
        setRechts(r => (r.sichtbar && r.gruppe === id ? { ...r, gruppe: null } : { sichtbar: true, gruppe: id }));
    };
    const fach = (id: string): FachKnopf => ({ offen: rechts.sichtbar && rechts.gruppe === id, oeffnen: () => fachUmschalten(id) });
    const arbeitsfachOffen = rechts.sichtbar && !!rechts.gruppe && gruppen.some(g => g.id === rechts.gruppe);
    const arbeitsfachUmschalten = () => setRechts(r => {
        if (r.sichtbar && r.gruppe && gruppen.some(g => g.id === r.gruppe)) return { ...r, sichtbar: false };
        return { sichtbar: true, gruppe: r.gruppe && gruppen.some(g => g.id === r.gruppe) ? r.gruppe : gruppen[0]?.id ?? null };
    });

    // --------------------------------------------------------------
    // Werkzeugband: Reiter aus der Lage bauen (werkzeugbandAufbau.tsx)
    // --------------------------------------------------------------
    const reiterWaehlen = (id: WerkzeugbandReiterId) => {
        // Der Reiter Seiten gehört zum Bearbeiten: Ein Klick im Lesen wechselt dorthin —
        // und wer Seiten zu einem anderen Reiter verlässt, verlässt den Seitenraster, als
        // hätte er „Lesen“ geklickt (Jan, 02.10.2026). Der Entwurf bleibt im Verlauf.
        if (id === 'seiten' && lesen && bearbeitenMoeglich) modusSetzen('bearbeiten');
        else if (id !== 'seiten' && reiter === 'seiten' && !lesen) modusSetzen('lesen');
        setReiter(id);
    };
    const speicherbar = (entwurfOffen || vorschauSpeicherbar) && stand.art !== 'speichert' && !fassungOffen;
    // Die Schreibknöpfe (Speichern, Rückgängig, Wiederholen) bleiben beim Ansehen
    // einer Fassung stehen, nur gesperrt — sonst spränge die Leiste.
    const speichernAngeboten = !lesen || kommentierenMoeglich || vorschauOffen || (fassungOffen && darfSchreiben);
    const neueDateiAngeboten = !!host.zielWaehlen && (bearbeitenMoeglich || vorschauOffen);
    // Der Reiter Kommentieren braucht die Fähigkeit dauerhaft; eine vorübergehende Sperre (OCR) nennt er.
    const kommentierenReiter = kommentierenGrundsaetzlich && anmerkungsFaehigkeit?.state === 'available';
    const kommentierenSperre = kommentierenGesperrt ?? (kommentierenMoeglich || !dokument ? null : t('openintrapdf.modus.fassungUnbekannt'));
    const gewaehltEntfernt = plan.filter(e => auswahl.has(e.id) && e.entfernt).length;
    const sucheOffen = lesen && links.offen && links.reiter === 'suche';
    const zoomAuswahl = zoom.vorgabe && ['auto', 'page-width', 'page-fit'].includes(zoom.vorgabe) ? zoom.vorgabe : String(zoom.prozent);
    const aussehen = werkzeug === 'stamp' ? null : (
        <>
            {werkzeug === 'sticky' ? (
                <BandFarbfelder titel={t('openintrapdf.postit.farbeTitel')} farben={POSTIT_FARBEN} wert={postitFarbe} onWert={postitFarbeSetzen}
                    namen={id => t(`openintrapdf.postit.farbe.${id}`)} />
            ) : (
                <BandFarbfelder titel={t('openintrapdf.kommentare.farbeTitel')} farben={FARBEN} wert={farbe}
                    onWert={hex => setFarben(f => ({ ...f, [farbGruppe]: hex }))} namen={id => t(`openintrapdf.kommentare.farbe.${id}`)} />
            )}
            {werkzeug !== 'sticky' && (!werkzeug || MIT_STAERKE.includes(werkzeug)) && (
                <BandStaerken titel={t('openintrapdf.kommentare.staerkeTitel')} staerken={STAERKEN} wert={staerke} onWert={setStaerke}
                    namen={s => t(`openintrapdf.kommentare.staerke.${STAERKE_NAME[s]}`)} />
            )}
        </>
    );
    const lage: WerkzeugbandLage = {
        t,
        lesen,
        dokument: !!dokument,
        datei: {
            neueFassung: speichernAngeboten && !signiert ? { gesperrt: !speicherbar, onClick: () => void speichernAls('fassung') } : null,
            neueDatei: speichernAngeboten && neueDateiAngeboten ? { gesperrt: !speicherbar, onClick: () => void speichernAls('datei') } : null,
            herunterladen: host.herunterladen ? { laeuft: aktion !== null, onClick: () => void ausgeben('herunterladen') } : null,
            drucken: host.drucken ? { laeuft: aktion !== null, gesperrt: sperrText.drucken, onClick: druckenOeffnen } : null,
            schnelldruck: host.schnelldruck ? { laeuft: aktion !== null, gesperrt: sperrText.drucken, onClick: () => void schnelldruck() } : null,
            geschuetzt: host.geschuetzt && dokument && basis.version !== undefined ? () => setDialog({ art: 'schutz' }) : null,
            kennwortEntfernen: darfGrundsaetzlich && !!info?.inspection?.encrypted && dokument && !fassungOffen && stand.art !== 'speichert'
                ? () => setDialog({ art: 'kennwortEntfernen' }) : null,
            rechteKennwort: rechte && !rechteKennwort && dokument && host.rechteKennwortPruefen ? rechteKennwortDialog : null,
            eigenschaften: dokument ? () => setDialog({ art: 'eigenschaften' }) : null,
            fassungen: fassungenMoeglich ? fach('fassungen') : null,
            schliessen,
        },
        navigation: {
            seite,
            seitenzahl,
            zuSeite,
            blaettern: richtung => steuerung.current?.blaettern(richtung),
            feld: (
                <form className="flex items-center gap-1 text-xs" onSubmit={e => {
                    e.preventDefault();
                    const n = Number(seitenEingabe);
                    if (Number.isInteger(n)) zuSeite(n);
                }}>
                    <label htmlFor="opdf-seite">{t('openintrapdf.fuss.seite')}</label>
                    <input id="opdf-seite" inputMode="numeric" value={seitenEingabe} disabled={!dokument || !lesen}
                        onChange={e => setSeitenEingabe(e.target.value.replace(/\D/g, ''))}
                        onBlur={() => setSeitenEingabe(String(seite))}
                        aria-label={t('openintrapdf.fuss.seiteVon', { seite, gesamt: seitenzahl })}
                        className={`${eingabe} h-7 w-12 text-center tabular-nums`} />
                    <span className="tabular-nums">{t('openintrapdf.fuss.von', { gesamt: seitenzahl })}</span>
                </form>
            ),
        },
        zoom: {
            zoomen,
            vorgabe: zoom.vorgabe,
            auswahl: (
                <select value={zoomAuswahl} disabled={!dokument || !lesen} aria-label={t('openintrapdf.fuss.zoom')}
                    onChange={e => {
                        const w = e.target.value;
                        zoomen(w === 'auto' || w === 'page-width' || w === 'page-fit' ? w : Number(w));
                    }}
                    className={`${eingabe} h-7 text-xs`}>
                    <option value="auto">{t('openintrapdf.fuss.automatisch')}</option>
                    <option value="page-width">{t('openintrapdf.fuss.seitenbreite')}</option>
                    <option value="page-fit">{t('openintrapdf.fuss.ganzeSeite')}</option>
                    {!ZOOM_STUFEN.includes(zoom.prozent) && !['auto', 'page-width', 'page-fit'].includes(zoomAuswahl) && (
                        <option value={String(zoom.prozent)}>{zoom.prozent} %</option>
                    )}
                    {ZOOM_STUFEN.map(z => <option key={z} value={String(z)}>{z} %</option>)}
                </select>
            ),
        },
        suche: { offen: sucheOffen, oeffnen: () => (sucheOffen ? sucheSchliessen() : sucheOeffnen()) },
        zeiger: { wert: sperren.kopieren ? 'hand' : zeiger, setzen: zeigerSetzen, gesperrt: sperrText.kopieren },
        kommentareLesen: !kommentierenReiter && gruppen.some(g => g.id === 'kommentare') ? fach('kommentare') : null,
        kommentieren: kommentierenReiter ? {
            gesperrt: kommentierenSperre,
            werkzeug,
            setWerkzeug: werkzeugSetzen,
            aussehen,
            liste: fach('kommentare'),
            anmerkungen: { sichtbar: anmerkungenSichtbar, umschalten: anmerkungenUmschalten },
        } : null,
        einfuegen: kommentierenReiter ? { gesperrt: kommentierenSperre, werkzeug, setWerkzeug: werkzeugSetzen } : null,
        seiten: darfGrundsaetzlich ? {
            bedienbar: bearbeitenMoeglich && !lesen,
            gesperrt: bearbeitenGesperrt ?? (bearbeitenMoeglich ? null : t('openintrapdf.laden.dokument')),
            keineAuswahl: gewaehlt.length === 0,
            alleEntfernt: gewaehlt.length > 0 && gewaehltEntfernt === gewaehlt.length,
            alleWaehlen: () => auswahlSetzen(new Set(plan.map(e => e.id)), plan[0]?.id),
            auswahlAufheben: () => setAuswahl(new Set()),
            drehen: grad => befehl({ art: 'drehen', ids: gewaehlt, grad }),
            entfernen: () => befehl({ art: 'entfernen', ids: gewaehlt }),
            wiederherstellen: () => befehl({ art: 'wiederherstellen', ids: gewaehlt }),
            duplizieren: () => befehl({ art: 'duplizieren', ids: gewaehlt }),
            nachVorn: () => befehl({ art: 'nachVorn', ids: gewaehlt }),
            nachHinten: () => befehl({ art: 'nachHinten', ids: gewaehlt }),
            leerLaeuft: leer.laeuft,
            leerPruefen: () => void leerPruefen(),
            extrahieren: host.extrahieren && host.zielWaehlen ? art => void extrahieren(art) : null,
            extraktLaeuft: extrakt.laeuft,
            leereSeite: () => void leereSeite(),
            seitenAusDatei: host.dateienWaehlen && host.quelleInfo ? () => void seitenAusDatei() : null,
            zwischenablage: {
                leer: zwischenablage.eintraege.length === 0,
                kopieren: () => zwischenablageBefehl('kopieren'),
                ausschneiden: () => zwischenablageBefehl('ausschneiden'),
                einfuegen: () => zwischenablageBefehl('einfuegen'),
            },
        } : null,
        werkzeuge: {
            ocr: ocrGruppe ? fach('ocr') : null,
            export: exportGruppe ? fach('export') : null,
            binden: bindenGruppe ? fach('binden') : null,
        },
        ansicht: {
            seitenleiste: lesen && dokument ? { offen: links.offen, umschalten: () => setLinks(l => ({ ...l, offen: !l.offen })) } : null,
            arbeitsfach: gruppen.length ? { offen: arbeitsfachOffen, umschalten: arbeitsfachUmschalten } : null,
            werkzeugband: { eingeklappt: werkzeugbandDarstellung.eingeklappt, umschalten: () => werkzeugbandDarstellung.einklappen(!werkzeugbandDarstellung.eingeklappt) },
            thema: thema.vorgegeben ? null : { wahl: thema.wahl, setzen: thema.setWahl },
            dunklesDokument: { an: dunklesDokument, umschalten: () => setDunklesDokument(d => !d) },
        },
    };
    const werkzeugband = reiterBauen(lage);
    const reiterWirksam = werkzeugband.reiter.some(r => r.id === reiter) ? reiter : 'start';

    const schnellbereich = (
        <>
            {speichernAngeboten && !signiert && (
                <button type="button" onClick={() => void speichernAls('fassung')} disabled={!speicherbar}
                    aria-label={t('openintrapdf.aktion.neueFassung')} title={t('openintrapdf.aktion.neueFassungTaste')}
                    className={`${hauptKnopf} h-8 px-2.5 ${neueDateiAngeboten ? 'rounded-r-none' : ''}`}>
                    <Save size={16} aria-hidden /> <span className="hidden sm:inline">{t('openintrapdf.aktion.speichern')}</span>
                </button>
            )}
            {speichernAngeboten && !signiert && neueDateiAngeboten && (
                <button type="button" onClick={() => void speichernAls('datei')} disabled={!speicherbar}
                    aria-label={t('openintrapdf.aktion.neueDatei')} title={t('openintrapdf.aktion.neueDatei')}
                    className={`${hauptKnopf} h-8 w-6 px-0 rounded-l-none border-l border-[var(--opdf-paneel)]/40`}>
                    <ChevronDown size={14} aria-hidden />
                </button>
            )}
            {speichernAngeboten && signiert && neueDateiAngeboten && (
                <button type="button" onClick={() => void speichernAls('datei')} disabled={!speicherbar}
                    aria-label={t('openintrapdf.aktion.neueDatei')} title={t('openintrapdf.aktion.neueDatei')} className={`${hauptKnopf} h-8 px-2.5`}>
                    <Save size={16} aria-hidden /> <span className="hidden sm:inline">{t('openintrapdf.aktion.neueDatei')}</span>
                </button>
            )}
            {host.drucken && (
                <button type="button" className={`${symbolKnopf} h-8 w-8`} onClick={druckenOeffnen} disabled={aktion !== null || !dokument || sperren.drucken}
                    aria-label={t('openintrapdf.aktion.drucken')} title={sperrText.drucken ?? t('openintrapdf.aktion.druckenHinweis')}>
                    {aktion === 'drucken' ? <LoaderCircle size={18} className="animate-spin" /> : <Printer size={18} />}
                </button>
            )}
            {speichernAngeboten && (
                <>
                    <button type="button" className={`${symbolKnopf} h-8 w-8`} onClick={zurueck} disabled={!naechstesZurueck(verlauf) || fassungOffen}
                        aria-label={t('openintrapdf.aktion.rueckgaengig')} title={t('openintrapdf.aktion.rueckgaengigTaste')}>
                        <Undo2 size={18} />
                    </button>
                    <button type="button" className={`${symbolKnopf} h-8 w-8`} onClick={vor} disabled={!naechstesVor(verlauf) || fassungOffen}
                        aria-label={t('openintrapdf.aktion.wiederholen')} title={t('openintrapdf.aktion.wiederholenTaste')}>
                        <Redo2 size={18} />
                    </button>
                </>
            )}
            {darfGrundsaetzlich && (
                <div className="ml-1 flex rounded-lg border border-[var(--opdf-linie)] bg-[var(--opdf-app)] p-0.5" role="group" aria-label={t('openintrapdf.modus.titel')}>
                    <button type="button" aria-pressed={lesen} onClick={() => modusSetzen('lesen')}
                        className={`h-7 px-3 rounded-md text-xs ${lesen ? 'bg-[var(--opdf-paneel)] text-[var(--opdf-akzent)] font-semibold shadow-sm' : ''}`}>
                        {t('openintrapdf.modus.lesen')}
                    </button>
                    <button type="button" aria-pressed={!lesen} onClick={() => modusSetzen('bearbeiten')}
                        disabled={!bearbeitenMoeglich} title={bearbeitenGesperrt ?? undefined}
                        className={`h-7 px-3 rounded-md text-xs disabled:opacity-45 disabled:cursor-not-allowed ${!lesen ? 'bg-[var(--opdf-paneel)] text-[var(--opdf-akzent)] font-semibold shadow-sm' : ''}`}>
                        {t('openintrapdf.modus.bearbeiten')}
                    </button>
                </div>
            )}
        </>
    );

    // --------------------------------------------------------------
    // Anzeige
    // --------------------------------------------------------------
    let zustandText: string;
    if (!dokument) zustandText = ladeStand.art === 'fehler' ? '' : t('openintrapdf.laden.dokument');
    else if (!darfSchreiben) zustandText = t('openintrapdf.zustand.nurLesen');
    else if (stand.art === 'speichert') zustandText = t('openintrapdf.zustand.speichert');
    else if (stand.art === 'konflikt') zustandText = t('openintrapdf.zustand.konflikt');
    else if (stand.art === 'fehlgeschlagen') zustandText = t('openintrapdf.zustand.fehlgeschlagen');
    else if (stand.art === 'verlust') zustandText = t('openintrapdf.zustand.verlust');
    else if (vorschauOffen) zustandText = t('openintrapdf.ocr.vorschauZustand');
    else if (entwurfOffen) zustandText = t('openintrapdf.zustand.entwurf');
    else if (stand.art === 'gespeichert') {
        zustandText = stand.neueDatei
            ? t('openintrapdf.zustand.gespeichertDatei', { name: stand.neueDatei })
            : t('openintrapdf.zustand.gespeichertFassung', { version: stand.version });
    } else zustandText = t('openintrapdf.zustand.unveraendert');
    const zustandFarbe = stand.art === 'fehlgeschlagen' || stand.art === 'konflikt'
        ? 'bg-[var(--opdf-fehler)]'
        : entwurfOffen || vorschauOffen || stand.art === 'speichert' || stand.art === 'verlust' ? 'bg-[var(--opdf-akzent)]' : 'bg-[var(--opdf-erfolg)]';

    const meta: string[] = [];
    if (basis.version !== undefined) meta.push(t('openintrapdf.kopf.fassung', { version: basis.version }));
    if (seitenzahl) meta.push(t('openintrapdf.kopf.seiten', { count: seitenzahl }));
    if (info?.access === 'view') meta.push(t('openintrapdf.kopf.nurLeserecht'));
    else if (info?.access === 'comment') meta.push(t('openintrapdf.kopf.kommentarrecht'));

    const bericht = stand.art === 'gespeichert' ? stand.bericht : undefined;
    const berichtsTeile: string[] = [];
    if ((bericht?.dropped_annotations ?? 0) > 0) {
        berichtsTeile.push(t('openintrapdf.verlust.anmerkungenEntfallen', { count: bericht?.dropped_annotations }));
    }
    for (const w of bericht?.warnings ?? []) berichtsTeile.push(t(`openintrapdf.warnung.${w}`, { defaultValue: w }));

    return (
        <div ref={wurzel} tabIndex={-1} onKeyDown={taste} data-theme={thema.wirksam}
            className="openintrapdf fixed inset-0 z-50 flex flex-col outline-none font-sans text-sm"
            role="dialog" aria-modal="true" aria-label={t('openintrapdf.titel', { name: anzeigename })}>

            {/* Kopfleiste */}
            {/* Kopf- und Reiterzeile liegen zusammen auf der Programmfläche, das Band darunter ist
                die Karte -- wie im Euro-Office-Theme „OpenIntra“ (Jan 02.10.2026). */}
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2 bg-[var(--opdf-app)]">
                <div className="flex items-center gap-2 shrink-0">
                    <OpenintraPdfZeichen className="h-8 w-8" />
                    <span className="hidden md:inline font-bold tracking-tight">OpenIntraPDF</span>
                </div>
                <div className="min-w-[8rem] flex-1 border-l border-[var(--opdf-linie)] pl-3">
                    <h1 className="truncate text-sm font-semibold" title={anzeigename}>{anzeigename}</h1>
                    {meta.length > 0 && <p className={`${leise} truncate`}>{meta.join(' · ')}</p>}
                </div>
                <button type="button" className={symbolKnopf} onClick={schliessen}
                    aria-label={t('openintrapdf.aktion.schliessen')} title={t('openintrapdf.aktion.schliessenTaste')}>
                    <X size={20} />
                </button>
            </header>

            {/* Werkzeugband: Schnellbereich, Reiter, Band (Vertrag Etappe 7) */}
            <Werkzeugband reiter={werkzeugband.reiter} datei={werkzeugband.datei} aktiv={reiterWirksam} onAktiv={reiterWaehlen}
                darstellung={werkzeugbandDarstellung} schnellbereich={schnellbereich} />

            {/* Hinweise, die man kennen muss, bevor man weiterarbeitet */}
            <Hinweiszeilen>
                {signiert && darfGrundsaetzlich && <Hinweis art="warnung">{t('openintrapdf.hinweis.signiert')}</Hinweis>}
                {fassungWahl && (
                    <Hinweis art="warnung">
                        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="font-semibold">{t('openintrapdf.fassungen.hinweis', { version: fassungWahl.version, datum: fassungDatum })}</span>
                            {fassungAnsicht?.laedt && <span>{t('openintrapdf.fassungen.laedtFassung', { version: fassungWahl.version })}</span>}
                            {fassungAnsicht?.fehler && <span>{t('openintrapdf.fassungen.ansehenFehler')}</span>}
                            <button type="button" className={rahmenKnopf} onClick={() => setFassungWahl(null)}>{t('openintrapdf.fassungen.zurueck')}</button>
                        </div>
                    </Hinweis>
                )}
                {bearbeitenGesperrt && !fassungOffen && <Hinweis art="info">{bearbeitenGesperrt}</Hinweis>}
                {lesen && planGeaendert && <Hinweis art="info">{t('openintrapdf.hinweis.entwurfVerborgen')}</Hinweis>}
                {aktionsFehler && <Hinweis art="fehler">{aktionsFehler}</Hinweis>}
                {stand.art === 'konflikt' && (
                    <Hinweis art="fehler">
                        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="font-semibold">{t('openintrapdf.zustand.konflikt')}</span>
                            <span>
                                {stand.aktuelleVersion
                                    ? t('openintrapdf.konflikt.textMitFassung', { version: stand.aktuelleVersion })
                                    : t('openintrapdf.konflikt.text')}
                            </span>
                            <span className="flex flex-wrap gap-2">
                                {host.zielWaehlen && (bearbeitenMoeglich || vorschauOffen) && (
                                    <button type="button" className={rahmenKnopf} onClick={() => void speichernAls('datei')}>
                                        {t('openintrapdf.konflikt.alsNeueDatei')}
                                    </button>
                                )}
                                <button type="button" className={rahmenKnopf} onClick={neuLadenVerwerfen}>
                                    {t('openintrapdf.konflikt.neuLaden')}
                                </button>
                            </span>
                        </div>
                    </Hinweis>
                )}
                {stand.art === 'fehlgeschlagen' && (
                    <Hinweis art="fehler">
                        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="font-semibold">{t('openintrapdf.zustand.fehlgeschlagen')}</span>
                            <span>{t(`openintrapdf.fehler.${stand.grund}`)}</span>
                            {stand.meldung && <span className="opacity-90">{stand.meldung}</span>}
                            {stand.wiederholbar && (
                                <button type="button" className={rahmenKnopf} onClick={() => void aktiverSpeicher.erneut()}>
                                    {t('openintrapdf.aktion.erneut')}
                                </button>
                            )}
                        </div>
                    </Hinweis>
                )}
                {stand.art === 'gespeichert' && !entwurfOffen && berichtsTeile.length > 0 && (
                    <Hinweis art="info">{t('openintrapdf.hinweis.bericht')} {berichtsTeile.join(' · ')}</Hinweis>
                )}
            </Hinweiszeilen>

            <div className="flex flex-1 min-h-0">
                {lesen && dokument && (links.offen ? (
                    <Seitenleiste
                        reiter={links.reiter}
                        onReiter={r => setLinks({ offen: true, reiter: r })}
                        onEinklappen={() => setLinks(l => ({ ...l, offen: false }))}
                        seitenzahl={seitenzahl}
                        aktuelleSeite={seite}
                        miniaturen={miniaturen}
                        onSeite={zuSeite}
                        lesezeichenLaden={lesezeichenLaden}
                        onLesezeichen={lesezeichenWaehlen}
                        suche={suche}
                        trefferJeSeite={trefferJeSeite}
                        suchfeld={suchfeld}
                        onSuchtext={suchtextSetzen}
                        onSuchen={art => { if (suche.text) steuerung.current?.suchen(suche.text, art, suchOptionen); }}
                        suchOptionen={suchOptionen}
                        onSuchOptionen={suchOptionenSetzen}
                    />
                ) : (
                    <div className="shrink-0 border-r border-[var(--opdf-linie)] bg-[var(--opdf-app)] p-1">
                        <button type="button" className={symbolKnopf} onClick={() => setLinks(l => ({ ...l, offen: true }))}
                            aria-label={t('openintrapdf.links.einblenden')} title={t('openintrapdf.links.einblenden')}>
                            <PanelLeftOpen size={18} />
                        </button>
                    </div>
                ))}

                <main className="relative flex flex-1 min-w-0 min-h-0 bg-[var(--opdf-lese)]">
                    {geladen && (
                        <Leseansicht
                            bibliothek={geladen.bibliothek}
                            dokument={fassungAnsicht?.dokument ?? vorschau?.dokument ?? geladen.dokument}
                            steuerung={steuerung}
                            sichtbar={lesen}
                            beschriftung={t('openintrapdf.dokument')}
                            onSeite={setSeite}
                            onZoom={(prozent, vorgabe) => setZoom({ prozent, vorgabe })}
                            onSuchstand={s => {
                                setSuche(alt => ({ ...alt, aktuell: s.aktuell, gesamt: s.gesamt, zustand: s.zustand ?? alt.zustand }));
                                setTrefferJeSeite(steuerung.current?.trefferJeSeite() ?? []);
                            }}
                            anmerkungen={kommentierenMoeglich ? {
                                entwurf: anmerkungen.neue, werkzeug, stil, onNeu: anmerkungNeu, unterschrift,
                                onRect: (ziel, page, rect) => befehl({ art: 'anmerkungRect', ziel, page, rect }),
                                links: {
                                    gespeichert: linksBestand ?? [], geloescht: geloeschteLinks, zielText: linkZielText,
                                    onKlick: (id, page, ziel) => setDialog({ art: 'linkLoeschen', id, page, ziel }),
                                },
                            } : undefined}
                            zeiger={werkzeug ? 'text' : sperren.kopieren ? 'hand' : zeiger}
                            textAuswahlGesperrt={sperren.kopieren}
                            anmerkungenAusgeblendet={!anmerkungenSichtbar}
                            dunkel={dunklesDokument}
                            verborgen={verborgen}
                        />
                    )}
                    {!lesen && dokument && (
                        <SeitenRaster
                            plan={plan}
                            nummern={nummern}
                            auswahl={auswahl}
                            fokus={fokus}
                            anker={anker}
                            miniaturen={miniaturen}
                            onFokus={setFokus}
                            onAuswahl={auswahlSetzen}
                            onBefehl={befehl}
                            entfallend={entfallend}
                            onZwischenablage={zwischenablageBefehl}
                            ausgeschnitten={ausgeschnitten}
                        />
                    )}
                    {ladeStand.art === 'laedt' && !dokument && (
                        <div className="absolute inset-0 flex items-center justify-center gap-3 text-[var(--opdf-gedaempft)]" role="status">
                            <LoaderCircle size={22} className="animate-spin" aria-hidden /> {t('openintrapdf.laden.dokument')}
                        </div>
                    )}
                    {ladeStand.art === 'fehler' && (
                        <div className="absolute inset-0 flex items-center justify-center p-6">
                            <div className="max-w-md text-center space-y-3" role="alert">
                                <p className="font-semibold text-[var(--opdf-fehler)]">{ladeStand.meldung}</p>
                                <div className="flex justify-center gap-2">
                                    <button type="button" className={rahmenKnopf} onClick={() => setLadeRunde(r => r + 1)}>{t('openintrapdf.aktion.erneut')}</button>
                                    <button type="button" className={knopf} onClick={onClose}>{t('openintrapdf.aktion.schliessen')}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>

                <Arbeitsfach
                    gruppen={gruppen}
                    aktiv={rechts.gruppe}
                    onAktiv={id => setRechts(r => ({ ...r, gruppe: id }))}
                    sichtbar={rechts.sichtbar}
                />
            </div>

            {/* Fußzeile: Seite und Zoom stehen seit Etappe 7 im Reiter Start; hier bleibt der Zustand. */}
            <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 border-t border-[var(--opdf-linie)] bg-[var(--opdf-paneel)] text-xs">
                {lesen ? (
                    seitenzahl > 0 && <span className="py-1 tabular-nums">{t('openintrapdf.fuss.seiteVon', { seite, gesamt: seitenzahl })}</span>
                ) : (
                    <span className="py-1">
                        {t('openintrapdf.fuss.entwurf', { count: bleiben })}
                        {entferntAnzahl > 0 && ` · ${t('openintrapdf.fuss.entfernt', { count: entferntAnzahl })}`}
                        {anmerkungen.neue.length > 0 && ` · ${t('openintrapdf.fuss.anmerkungen', { count: anmerkungen.neue.length })}`}
                        {auswahl.size > 0 && ` · ${t('openintrapdf.fuss.gewaehlt', { count: auswahl.size })}`}
                        {zwischenablage.eintraege.length > 0 && ` · ${t('openintrapdf.fuss.zwischenablage', { count: zwischenablage.eintraege.length })}`}
                    </span>
                )}
                <span className="flex-1" />
                {ladeStand.art === 'laedt' && dokument && (
                    <span className="inline-flex items-center gap-1 text-[var(--opdf-gedaempft)]">
                        <LoaderCircle size={12} className="animate-spin" aria-hidden /> {t('openintrapdf.laden.neu')}
                    </span>
                )}
                <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
                    <span className={`inline-block h-2 w-2 rounded-full ${zustandFarbe}`} aria-hidden />
                    {zustandText}
                </span>
            </footer>

            <div className="sr-only" role="status" aria-live="polite">{ansage}</div>

            {/* Dialoge */}
            {ladeStand.art === 'passwort' && (
                <Dialog titel={t('openintrapdf.passwort.titel')} onAbbrechen={passwortAbbrechen}
                    aktionen={<>
                        <button type="button" className={knopf} onClick={passwortAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                        <button type="submit" form="opdf-passwort" className={hauptKnopf}>{t('openintrapdf.passwort.oeffnen')}</button>
                    </>}>
                    <form id="opdf-passwort" onSubmit={e => {
                        e.preventDefault();
                        const antworten = passwortAntwort.current;
                        passwortAntwort.current = null;
                        setLadeStand({ art: 'laedt' });
                        oeffnenKennwort.current = passwort;
                        antworten?.(passwort);
                        setPasswort('');
                    }}>
                        <p className="mb-3">{t('openintrapdf.passwort.text')}</p>
                        {ladeStand.falsch && <p className="mb-2 text-[var(--opdf-fehler)]" role="alert">{t('openintrapdf.passwort.falsch')}</p>}
                        <label className="block">
                            <span className={`${abschnitt} block mb-1`}>{t('openintrapdf.passwort.feld')}</span>
                            <input type="password" data-autofocus autoComplete="off" value={passwort}
                                onChange={e => setPasswort(e.target.value)} className={`${eingabe} w-full`} />
                        </label>
                    </form>
                </Dialog>
            )}

            {dialog?.art === 'schliessen' && (
                <Dialog titel={t('openintrapdf.schliessen.titel')} onAbbrechen={() => setDialog(null)}
                    aktionen={<>
                        <button type="button" className={knopf} data-autofocus onClick={() => setDialog(null)}>{t('openintrapdf.schliessen.weiter')}</button>
                        <button type="button" className={rahmenKnopf} onClick={onClose}>{t('openintrapdf.schliessen.verwerfen')}</button>
                        <button type="button" className={hauptKnopf} onClick={async () => {
                            setDialog(null);
                            if (await speichernStandard()) onClose();
                        }}>
                            {signiert && bearbeitenMoeglich ? t('openintrapdf.aktion.neueDatei') : t('openintrapdf.schliessen.speichern')}
                        </button>
                    </>}>
                    <p>{t('openintrapdf.schliessen.text')}</p>
                </Dialog>
            )}

            {dialog?.art === 'leer' && (
                <LeerDialog
                    kandidaten={dialog.kandidaten.filter(k => plan.some(e => e.id === k.id && !e.entfernt))}
                    nummern={nummern}
                    bleiben={bleiben}
                    onAbbrechen={() => setDialog(null)}
                    onEntfernen={ids => {
                        setDialog(null);
                        befehl({ art: 'entfernen', ids });
                    }}
                />
            )}

            {dialog?.art === 'eigenschaften' && geladen && (
                <EigenschaftenDialog dokument={geladen.dokument as unknown as EigenschaftenDokument} name={anzeigename} dateigroesse={info?.size}
                    onSchliessen={() => setDialog(null)}
                    bearbeiten={bearbeitenMoeglich && !lesen ? {
                        entwurf: eigenschaftenEntwurf,
                        onUebernehmen: werte => befehl({ art: 'eigenschaften', werte }),
                    } : undefined}
                    bearbeitenHinweis={darfGrundsaetzlich && lesen && !fassungOffen ? t('openintrapdf.eigenschaften.bearbeitenHinweis') : undefined} />
            )}

            {dialog?.art === 'drucken' && (
                <DruckDialog
                    seitenzahl={seitenzahl}
                    aktuelleSeite={seite}
                    auswahl={!lesen ? plan.filter(e => auswahl.has(e.id) && !e.entfernt && e.quelle >= 0).map(e => e.quelle) : []}
                    teilbereichMoeglich={!!host.druckfassung && basis.version !== undefined}
                    laeuft={aktion !== null}
                    onDrucken={wahl => void drucken(wahl)}
                    onAbbrechen={() => setDialog(null)}
                />
            )}

            {dialog?.art === 'seitenAusDatei' && (
                <SeitenAusDateiDialog
                    datei={dialog.datei}
                    stand={dialog.stand}
                    onEinfuegen={(seiten, quellInfo) => quelleEinfuegen(dialog.datei, dialog.rest, seiten, quellInfo)}
                    onAbbrechen={() => setDialog(null)}
                />
            )}

            {dialog?.art === 'linkNeu' && (
                <LinkDialog seitenzahl={seitenzahl} vorschlagSeite={seite}
                    onAnlegen={ziel => linkAnlegen(dialog.page, dialog.rect, ziel)} onAbbrechen={() => setDialog(null)} />
            )}

            {dialog?.art === 'linkLoeschen' && (
                <LinkLoeschenDialog ziel={dialog.ziel} entwurf={dialog.id.startsWith('tmp-')}
                    onLoeschen={() => linkLoeschen(dialog.id, dialog.page)} onAbbrechen={() => setDialog(null)} />
            )}

            {dialog?.art === 'schutz' && (
                <SchutzDialog laeuft={aktion !== null} onHerunterladen={b => void geschuetztHerunterladen(b)} onAbbrechen={() => setDialog(null)} />
            )}

            {dialog?.art === 'kennwortEntfernen' && (
                <KennwortDialog titel={t('openintrapdf.schutz.kennwortEntfernen')} text={t('openintrapdf.schutz.kennwortEntfernenText')}
                    knopfText={t('openintrapdf.schutz.kennwortEntfernenKnopf')} vorgabe={oeffnenKennwort.current}
                    onBestaetigen={kennwortEntfernen} onAbbrechen={() => setDialog(null)} />
            )}

            {dialog?.art === 'rechteKennwort' && (
                <KennwortDialog titel={t('openintrapdf.schutz.rechteKennwortEingeben')} text={t('openintrapdf.schutz.rechteKennwortText')}
                    knopfText={t('openintrapdf.schutz.rechteKennwortKnopf')} laeuft={rechtePruefung.laeuft} fehler={rechtePruefung.fehler}
                    onBestaetigen={k => void rechteKennwortSetzen(k)} onAbbrechen={() => setDialog(null)} />
            )}

            {dialog?.art === 'fassungWiederherstellen' && (
                <Dialog titel={t('openintrapdf.fassungen.dialogTitel')} onAbbrechen={() => setDialog(null)}
                    aktionen={<>
                        <button type="button" className={knopf} data-autofocus onClick={() => setDialog(null)}>{t('openintrapdf.aktion.abbrechen')}</button>
                        <button type="button" className={hauptKnopf} onClick={() => {
                            const f = dialog.fassung;
                            setDialog(null);
                            void fassungWiederherstellen(f);
                        }}>
                            {t('openintrapdf.fassungen.dialogKnopf')}
                        </button>
                    </>}>
                    <p>{t('openintrapdf.fassungen.dialogText', { version: dialog.fassung.version })}</p>
                </Dialog>
            )}

            {dialog?.art === 'ocrEntwurf' && (
                <Dialog titel={t('openintrapdf.ocr.entwurfTitel')} onAbbrechen={() => setDialog(null)}
                    aktionen={<>
                        <button type="button" className={knopf} data-autofocus onClick={() => setDialog(null)}>{t('openintrapdf.aktion.abbrechen')}</button>
                        <button type="button" className={rahmenKnopf} onClick={() => {
                            setDialog(null);
                            verlaufSetzen(verlaufStarten(planErstellen(seitenzahl)));
                            setAuswahl(new Set());
                            void ocr.starten();
                        }}>
                            {t('openintrapdf.ocr.entwurfVerwerfen')}
                        </button>
                        <button type="button" className={hauptKnopf} onClick={() => {
                            setDialog(null);
                            void speichernStandard();
                        }}>
                            {t('openintrapdf.ocr.entwurfSpeichern')}
                        </button>
                    </>}>
                    <p>{t('openintrapdf.ocr.entwurfText')}</p>
                </Dialog>
            )}

            {stand.art === 'verlust' && (
                <Dialog breit titel={t('openintrapdf.verlust.titel')} onAbbrechen={aktiverSpeicher.zuruecksetzen}
                    aktionen={<>
                        <button type="button" className={knopf} data-autofocus onClick={aktiverSpeicher.zuruecksetzen}>{t('openintrapdf.aktion.abbrechen')}</button>
                        <button type="button" className={warnKnopf} onClick={() => void aktiverSpeicher.verlusteAnnehmen()}>
                            {t('openintrapdf.verlust.annehmen')}
                        </button>
                    </>}>
                    <p className="mb-3">{t('openintrapdf.verlust.text')}</p>
                    <BerichtTabelle bericht={stand.bericht} klassen={stand.klassen} />
                    <p className={`${leise} mt-3`}>{t('openintrapdf.verlust.hinweis')}</p>
                </Dialog>
            )}

            {binden.stand.art === 'verlust' && (
                <Dialog breit titel={t('openintrapdf.binden.verlustTitel')} onAbbrechen={binden.zuruecksetzen}
                    aktionen={<>
                        <button type="button" className={knopf} data-autofocus onClick={binden.zuruecksetzen}>{t('openintrapdf.aktion.abbrechen')}</button>
                        <button type="button" className={warnKnopf} onClick={() => void binden.verlusteAnnehmen()}>
                            {t('openintrapdf.binden.verlustAnnehmen')}
                        </button>
                    </>}>
                    <p className="mb-3">{t('openintrapdf.binden.verlustText')}</p>
                    <BerichtTabelle bericht={binden.stand.bericht} klassen={binden.stand.klassen} />
                    <p className={`${leise} mt-3`}>{t('openintrapdf.binden.verlustHinweis')}</p>
                </Dialog>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Kleine Bausteine
// ---------------------------------------------------------------------

function Hinweiszeilen({ children }: { children: ReactNode }) {
    // toArray vergibt Schlüssel und wirft false/null heraus.
    const inhalt = Children.toArray(children);
    if (!inhalt.length) return null;
    return <div className="flex flex-col gap-2 px-3 sm:px-4 py-2 border-b border-[var(--opdf-linie)] bg-[var(--opdf-paneel)]">{inhalt}</div>;
}

function BerichtTabelle({ bericht, klassen }: { bericht: CommitErgebnis['report']; klassen?: string[] }) {
    const { t } = useTranslation();
    if (!bericht) return null;
    const zeilen: { schluessel: string; vorher?: number; nachher?: number }[] = [
        { schluessel: 'bookmarks', vorher: bericht.bookmarks_before, nachher: bericht.bookmarks_after },
        { schluessel: 'attachments', vorher: bericht.attachments_before, nachher: bericht.attachments_after },
        { schluessel: 'form_fields', vorher: bericht.form_fields_before, nachher: bericht.form_fields_after },
    ];
    return (
        <div>
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="text-left border-b border-[var(--opdf-linie)]">
                        <th className="py-1.5 font-semibold">{t('openintrapdf.verlust.bestandteil')}</th>
                        <th className="py-1.5 font-semibold text-right">{t('openintrapdf.verlust.vorher')}</th>
                        <th className="py-1.5 font-semibold text-right">{t('openintrapdf.verlust.nachher')}</th>
                    </tr>
                </thead>
                <tbody>
                    {zeilen.map(z => (
                        <tr key={z.schluessel} className={`border-b border-[var(--opdf-linie)] ${klassen?.includes(z.schluessel) ? 'text-[var(--opdf-fehler)] font-semibold' : ''}`}>
                            <td className="py-1.5">{t(`openintrapdf.verlust.klasse.${z.schluessel}`)}</td>
                            <td className="py-1.5 text-right tabular-nums">{z.vorher ?? '–'}</td>
                            <td className="py-1.5 text-right tabular-nums">{z.nachher ?? '–'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {(bericht.dropped_annotations ?? 0) > 0 && (
                <p className="mt-2">{t('openintrapdf.verlust.anmerkungenEntfallen', { count: bericht.dropped_annotations })}</p>
            )}
            {!!bericht.warnings?.length && (
                <ul className="mt-2 list-disc pl-5">
                    {bericht.warnings.map(w => <li key={w}>{t(`openintrapdf.warnung.${w}`, { defaultValue: w })}</li>)}
                </ul>
            )}
        </div>
    );
}


function LeerDialog({ kandidaten, nummern, bleiben, onAbbrechen, onEntfernen }: {
    kandidaten: LeerKandidat[];
    nummern: Map<string, number>;
    bleiben: number;
    onAbbrechen: () => void;
    onEntfernen: (ids: string[]) => void;
}) {
    const { t } = useTranslation();
    const [markiert, setMarkiert] = useState<Set<string>>(() => new Set());
    const zuViele = markiert.size >= bleiben;
    return (
        <Dialog breit titel={t('openintrapdf.leer.titel')} onAbbrechen={onAbbrechen}
            aktionen={<>
                <button type="button" className={knopf} onClick={onAbbrechen}>{t('openintrapdf.aktion.abbrechen')}</button>
                <button type="button" className={hauptKnopf} disabled={markiert.size === 0 || zuViele}
                    onClick={() => onEntfernen([...markiert])}>
                    {t('openintrapdf.leer.vormerken', { count: markiert.size })}
                </button>
            </>}>
            <p className="mb-3">{t('openintrapdf.leer.text')}</p>
            {zuViele && <div className="mb-3" role="alert"><Hinweis art="warnung">{t('openintrapdf.seiten.letzteSeite')}</Hinweis></div>}
            <ul className="grid gap-3 sm:grid-cols-2">
                {kandidaten.map(k => (
                    <li key={k.id}>
                        <label className="flex gap-3 items-start rounded-md border border-[var(--opdf-linie)] p-2 cursor-pointer hover:bg-[var(--opdf-weich)]">
                            <input type="checkbox" className="mt-1" checked={markiert.has(k.id)}
                                onChange={e => setMarkiert(m => {
                                    const n = new Set(m);
                                    if (e.target.checked) n.add(k.id);
                                    else n.delete(k.id);
                                    return n;
                                })} />
                            {k.vorschau
                                ? <img src={k.vorschau} alt="" className="w-16 border border-[var(--opdf-linie)] bg-white" />
                                : <span className="w-16 aspect-[1/1.414] border border-[var(--opdf-linie)] bg-white" aria-hidden />}
                            <span className="text-sm">
                                <span className="block font-semibold">
                                    {t('openintrapdf.leer.seite', { seite: nummern.get(k.id) ?? '–', original: k.quelle + 1 })}
                                </span>
                                <span className={leise}>
                                    {t(`openintrapdf.leer.grund.${k.grund}`, { anteil: (k.anteil * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) })}
                                </span>
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
        </Dialog>
    );
}

function ladeFehlertext(e: unknown, t: (k: string) => string): string {
    if (e instanceof PdfHostFehler) {
        if (e.meldung) return e.meldung;
        if (e.status === 404) return t('openintrapdf.laden.nichtGefunden');
        if (e.status === 0) return t('openintrapdf.laden.netz');
        return t('openintrapdf.laden.fehler');
    }
    const art = (e as { name?: string } | null)?.name;
    if (art === 'InvalidPDFException') return t('openintrapdf.laden.keinPdf');
    if (art === 'PasswordException') return t('openintrapdf.laden.ohnePasswort');
    return t('openintrapdf.laden.fehler');
}

export default PdfArbeitsplatz;

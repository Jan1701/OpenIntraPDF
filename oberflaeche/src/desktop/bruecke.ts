// SPDX-License-Identifier: Apache-2.0
//
// Die Brücke zur Go-Seite: die Bindungen von `App` (clients/openintrapdf-
// desktop/app.go), die Wails unter `window.go.main.App` einhängt, und die
// Ereignisse der Laufzeit (`window.runtime`).
//
// Bewusst von Hand getippt statt aus `wailsjs/` erzeugt: Die Namen hier
// MÜSSEN zu den Methoden von `App` passen — ein Tippfehler fällt beim
// ersten Aufruf auf, nicht erst irgendwann.
//
// Es gibt nur Fachfunktionen (Konzept Kap. 07): kein ReadFile, kein
// WriteFile, kein Exec. Die Webseite sieht Kennungen, nie Pfade.

import type {
    AnalyseBefehl, AuftragVeroeffentlichen, BindeBefehl, BindeErgebnis, CommitBefehl, CommitErgebnis, DateiWahl, DruckBefehl, ExportBefehl,
    ExportErgebnis, ExtraktBefehl, ExtraktErgebnis, OcrBefehl, PdfAuftrag, PdfInfo, PdfZiel, SeitenArten, ZielAnfrage,
} from '../openintrapdf/typen';

export interface Geoeffnet {
    id: string;
    name: string;
}

export interface ZuletztEintrag {
    schluessel: string;
    name: string;
    ordner: string;
    fehlt: boolean;
}

export interface StartInfo {
    person: string;
    /** Fassung des mitgelieferten Tesseract; leer, wenn es nicht läuft. */
    ocr: string;
    ocr_fehler?: string;
    zuletzt: ZuletztEintrag[];
    /** Eine Datei, die das System schon vor dem Start übergab. */
    geoeffnet: Geoeffnet | null;
    /** Es gibt einen Weg auf den Standarddrucker ohne Dialog (Etappe 8: Linux lp, macOS lpr). */
    schnelldruck?: boolean;
    /** Für das Info-Fenster (ueber.go): Fassung, Baunummer (leer ohne Bau), Urheber. */
    fassung?: string;
    bau?: string;
    urheber?: string;
    /** darwin, linux, windows (goruntime.GOOS); Windows druckt über die Webansicht. */
    system?: string;
}

/** Ein mitgeliefertes Teil im Lizenzdialog (lizenzen.go). */
export interface LizenzTeil {
    gruppe: 'ocr' | 'schrift' | 'go' | 'js' | string;
    name: string;
    fassung: string;
    lizenz: string;
    text: string;
}

export interface Lizenzauskunft {
    app: string;
    urheber: string;
    lizenz: string;
    text: string;
    teile: LizenzTeil[];
}

/** Ein Auftrag der Go-Seite: wie im Server, dazu, was zu rastern ist. */
export interface DesktopAuftrag extends PdfAuftrag {
    file_id: string;
    render_pages: number[];
    dpi: number;
}

export interface Bruecke {
    Start(): Promise<StartInfo>;
    OeffnenDialog(): Promise<Geoeffnet | null>;
    ZuletztOeffnen(schluessel: string): Promise<Geoeffnet>;
    Zuletzt(): Promise<ZuletztEintrag[]>;
    Schliessen(id: string): Promise<void>;
    /** Holt vor dem Laden den Stand der Platte (nach einem Konflikt: „Neu laden“). */
    Neuladen(id: string): Promise<void>;
    Info(id: string): Promise<PdfInfo>;
    Speichern(id: string, befehl: CommitBefehl, schluessel: string): Promise<CommitErgebnis>;
    Extrahieren(id: string, befehl: ExtraktBefehl, schluessel: string): Promise<ExtraktErgebnis>;
    ZielWaehlen(anfrage: ZielAnfrage): Promise<PdfZiel | null>;
    Seitenarten(id: string): Promise<SeitenArten>;
    AuftragStarten(id: string, befehl: OcrBefehl | AnalyseBefehl, schluessel: string): Promise<DesktopAuftrag>;
    Auftraege(fileId: string): Promise<DesktopAuftrag[]>;
    Auftrag(id: string): Promise<DesktopAuftrag>;
    AuftragAbbrechen(id: string): Promise<DesktopAuftrag>;
    SeiteLiefern(auftragId: string, seite: number, pngBase64: string, grund: string): Promise<void>;
    AuftragVeroeffentlichen(id: string, rumpf: AuftragVeroeffentlichen, schluessel: string): Promise<CommitErgebnis>;
    Modell(id: string): Promise<unknown>;
    Exportieren(id: string, befehl: ExportBefehl, schluessel: string): Promise<ExportErgebnis>;
    Binden(befehl: BindeBefehl, schluessel: string): Promise<BindeErgebnis>;
    DateienWaehlen(): Promise<DateiWahl[]>;
    QuelleInfo(id: string): Promise<PdfInfo>;
    KopieSichern(id: string): Promise<void>;
    Drucken(id: string): Promise<void>;
    /** Die Teil-PDF zum Drucken als Base64 (Etappe 8). */
    Druckfassung(id: string, befehl: DruckBefehl): Promise<string>;
    /** Fertige PDF-Bytes (Base64) über den Druckweg des Systems drucken. */
    BytesDrucken(name: string, inhaltBase64: string): Promise<void>;
    /** Ohne Dialog auf den Standarddrucker. */
    Schnelldruck(id: string): Promise<void>;
    /** Rechte-Kennwort einer geschützten Datei prüfen (#247): Fehler 422 pdf.wrong_password, sonst nichts. */
    RechteKennwortPruefen(id: string, kennwort: string): Promise<void>;
    /** Lizenz der App und aller mitgelieferten Teile (Hilfe → Lizenzen). */
    Lizenzen(): Promise<Lizenzauskunft>;
    /** Menütexte in der Sprache der App (menue.ts); die Go-Seite baut das Menü damit neu. */
    MenueSprache(texte: Record<string, string>): Promise<void>;
}

interface WailsFenster {
    go?: { main?: { App?: Bruecke } };
    runtime?: { EventsOn(name: string, cb: (...daten: unknown[]) => void): () => void };
}

/** Die Bindungen — oder ein Fehler, wenn die Seite nicht in der App läuft. */
export function bruecke(): Bruecke {
    const app = (globalThis as unknown as WailsFenster).go?.main?.App;
    if (!app) throw new Error('bruecke');
    return app;
}

/** Ein Ereignis der Go-Seite abonnieren; liefert das Abbestellen. */
export function ereignis(name: string, cb: (...daten: unknown[]) => void): () => void {
    const rt = (globalThis as unknown as WailsFenster).runtime;
    if (!rt) return () => undefined;
    return rt.EventsOn(name, cb);
}

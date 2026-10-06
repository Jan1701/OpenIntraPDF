// SPDX-License-Identifier: Apache-2.0
//
// OpenIntraPDF auf dem Schreibtisch: der Gastgeber, der den Arbeitsplatz
// mit lokalen Dateien verbindet (Vertrag Etappe 6). Er erfüllt `PdfHost`
// mit allen Methoden, die der Drive-Gastgeber anbietet — über die Wails-
// Bindungen der Go-Seite (bruecke.ts) statt über HTTP.
//
// Was im Drive der Server tut, tut hier die Go-Seite: Fassung = die
// geöffnete Datei, Speichern überschreibt atomar, Konflikte kommen als
// 412, Aufträge laufen als Goroutinen. EIN Unterschied: Die Seitenbilder
// für die Texterkennung rastert dieser Gastgeber selbst mit pdf.js und
// liefert sie der Go-Seite (der Auftrag nennt `render_pages` und `dpi`).
//
// Fehler der Go-Seite tragen Status, Code und Params als JSON im Text —
// daraus wird derselbe `PdfHostFehler`, den der Arbeitsplatz vom Server
// kennt, mit dem übersetzten Satz aus `fehler.<code>`, falls es ihn gibt.

import i18n from 'i18next';
import { PdfHostFehler } from '../openintrapdf/typen';
import type {
    AnalyseBefehl, AuftragVeroeffentlichen, BindeBefehl, CommitBefehl, DruckBefehl, ExportBefehl, ExtraktBefehl, OcrBefehl, PdfHost,
    PdfLadung, ZielAnfrage,
} from '../openintrapdf/typen';
import type { Bruecke, DesktopAuftrag } from './bruecke';
import type { Rasterer } from './rastern';

/** Macht aus einem Bindungsfehler einen PdfHostFehler. */
export function hostFehler(e: unknown): PdfHostFehler {
    if (e instanceof PdfHostFehler) return e;
    const text = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    try {
        const roh = JSON.parse(text) as { status?: unknown; code?: unknown; params?: unknown };
        if (roh && typeof roh === 'object' && typeof roh.code === 'string') {
            const status = Number(roh.status) || 0;
            const params = roh.params && typeof roh.params === 'object' ? (roh.params as Record<string, unknown>) : {};
            const schluessel = `fehler.${roh.code}`;
            const meldung = i18n.exists(schluessel) ? i18n.t(schluessel, params as Record<string, string>) : undefined;
            return new PdfHostFehler(status, roh.code, params, meldung);
        }
    } catch {
        // kein JSON: ein Fehler der Brücke selbst
    }
    return new PdfHostFehler(0, 'network', {}, text || undefined);
}

/** `fn` aufrufen und Bindungsfehler in PdfHostFehler wandeln. */
async function ruf<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (e) {
        throw hostFehler(e);
    }
}

/** Die Bytes einer Kennung vom Asset-Server holen. */
async function bytesHolen(pfad: string): Promise<Response> {
    let antwort: Response;
    try {
        antwort = await fetch(pfad, { cache: 'no-store' });
    } catch (e) {
        throw new PdfHostFehler(0, 'network', {}, e instanceof Error ? e.message : undefined);
    }
    if (!antwort.ok) throw new PdfHostFehler(antwort.status, antwort.status === 404 ? 'drive.not_found' : `http_${antwort.status}`);
    return antwort;
}

/** Base64 ↔ Bytes für die Druckfassung (Wails reicht Bindungsergebnisse als JSON durch). */
export function base64ZuBytes(text: string): ArrayBuffer {
    const roh = atob(text);
    const aus = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) aus[i] = roh.charCodeAt(i);
    return aus.buffer;
}

export function bytesZuBase64(daten: ArrayBuffer): string {
    const bytes = new Uint8Array(daten);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/** Ein ETag ist nur dann eine Prüfsumme, wenn er wie eine SHA-256 aussieht. */
function sha256AusEtag(etag: string | null): string | undefined {
    const wert = etag?.replace(/^W\//, '').replace(/"/g, '').trim().toLowerCase();
    return wert && /^[0-9a-f]{64}$/.test(wert) ? wert : undefined;
}

export interface DesktopHostOptionen {
    /** Rasterer für die Seitenbilder der Aufträge (Test: Attrappe). */
    rasterer: () => Rasterer;
    /** Die angemeldete Person (voller Name aus os/user). */
    person?: string;
    /** Wird gerufen, wenn das Rastern einer Seite scheiterte (nur Protokoll). */
    onRasterFehler?: (auftragId: string, seite: number, fehler: unknown) => void;
    /** Die Go-Seite kennt einen Weg auf den Standarddrucker ohne Dialog (Etappe 8). */
    schnelldruck?: boolean;
}

/**
 * Baut den Gastgeber für eine geöffnete Datei. Eigene Funktion, damit
 * Tests ihn mit einer Brücken-Attrappe prüfen können.
 */
export function desktopHost(id: string, b: Bruecke, optionen: DesktopHostOptionen): PdfHost {
    const dateiPfad = `./datei/${encodeURIComponent(id)}`;
    const person = optionen.person?.trim();

    /**
     * Die Seitenbilder eines Auftrags rastern und liefern — im Hintergrund,
     * nicht awaited: Der Arbeitsplatz fragt den Auftrag ohnehin alle zwei
     * Sekunden ab. Vor jeder Seite wird nachgesehen, ob der Auftrag noch
     * läuft (Abbruch), und ein gescheitertes Rastern wird gemeldet, damit
     * der Auftrag nicht ewig wartet.
     */
    const rastern = async (auftrag: DesktopAuftrag): Promise<void> => {
        if (!auftrag.render_pages?.length) return;
        const r = optionen.rasterer();
        try {
            const daten = await (await bytesHolen(dateiPfad)).arrayBuffer();
            await r.laden(daten);
            for (const seite of auftrag.render_pages) {
                const stand = await b.Auftrag(auftrag.id).catch(() => null);
                if (!stand || (stand.state !== 'running' && stand.state !== 'queued')) return;
                let png = '';
                try {
                    png = await r.rastern(seite, auftrag.dpi);
                } catch (e) {
                    optionen.onRasterFehler?.(auftrag.id, seite, e);
                    await b.SeiteLiefern(auftrag.id, seite, '', 'render_failed').catch(() => undefined);
                    return;
                }
                await b.SeiteLiefern(auftrag.id, seite, png, '');
            }
        } catch (e) {
            optionen.onRasterFehler?.(auftrag.id, -1, e);
        } finally {
            r.schliessen();
        }
    };

    const auftragStarten = async (befehl: OcrBefehl | AnalyseBefehl, schluessel: string): Promise<DesktopAuftrag> => {
        const a = await ruf(() => b.AuftragStarten(id, befehl, schluessel));
        // Nur ein frisch laufender Auftrag braucht Bilder; eine Wiederholung
        // mit demselben Schlüssel bekommt den alten Auftrag zurück, der sie
        // schon hat.
        if ((a.state === 'running' || a.state === 'queued') && a.progress?.done === 0 && a.render_pages?.length) {
            void rastern(a);
        }
        return a;
    };

    return {
        info: () => ruf(() => b.Info(id)),

        ...(person ? { person: { name: person } } : {}),

        async laden(): Promise<PdfLadung> {
            const info = await ruf(() => b.Info(id)).catch(() => undefined);
            const antwort = await bytesHolen(dateiPfad);
            const kopfVersion = Number(antwort.headers.get('X-File-Version')) || undefined;
            const kopfSha = sha256AusEtag(antwort.headers.get('ETag'));
            const daten = await antwort.arrayBuffer();
            return { daten, info, version: kopfVersion ?? info?.version, sha256: kopfSha ?? info?.sha256 };
        },

        // Kein herunterladen: Die Datei liegt schon auf der Platte; „Kopie
        // sichern unter …“ steht im Menü Ablage (App.tsx, Jan 01.10.2026).
        drucken: () => ruf(() => b.Drucken(id)),

        // Drucken mit Seitenbereich (Etappe 8): Die Go-Seite baut die
        // Teil-PDF und druckt die Bytes über ihren Druckweg.
        druckfassung: async (befehl: DruckBefehl) => base64ZuBytes(await ruf(() => b.Druckfassung(id, befehl))),
        bytesDrucken: (daten: ArrayBuffer, name: string) => ruf(() => b.BytesDrucken(name, bytesZuBase64(daten))),
        ...(optionen.schnelldruck ? { schnelldruck: () => ruf(() => b.Schnelldruck(id)) } : {}),

        // Rechte-Kennwort pruefen (#247): derselbe Go-Kern wie im Server.
        rechteKennwortPruefen: (kennwort: string) => ruf(() => b.RechteKennwortPruefen(id, kennwort)),

        speichern: (befehl: CommitBefehl, schluessel: string) => ruf(() => b.Speichern(id, befehl, schluessel)),
        extrahieren: (befehl: ExtraktBefehl, schluessel: string) => ruf(() => b.Extrahieren(id, befehl, schluessel)),
        zielWaehlen: (anfrage: ZielAnfrage) => ruf(() => b.ZielWaehlen(anfrage)),

        // Texterkennung (Etappe 3) — Aufträge der Go-Seite.
        seitenarten: () => ruf(() => b.Seitenarten(id)),
        ocrStarten: (befehl: OcrBefehl, schluessel: string) => auftragStarten(befehl, schluessel),
        auftraege: (fileId: string) => ruf(() => b.Auftraege(fileId)),
        auftrag: (auftragId: string) => ruf(() => b.Auftrag(auftragId)),
        async auftragAbbrechen(auftragId: string) {
            await ruf(() => b.AuftragAbbrechen(auftragId));
        },
        async ergebnisLaden(auftragId: string) {
            return (await bytesHolen(`./auftrag/${encodeURIComponent(auftragId)}/ergebnis`)).arrayBuffer();
        },
        auftragVeroeffentlichen: (auftragId: string, rumpf: AuftragVeroeffentlichen, schluessel: string) =>
            ruf(() => b.AuftragVeroeffentlichen(auftragId, rumpf, schluessel)),

        // Exportieren (Etappe 4).
        analyseStarten: (befehl: AnalyseBefehl, schluessel: string) => auftragStarten(befehl, schluessel),
        modellLaden: (auftragId: string) => ruf(() => b.Modell(auftragId)),
        exportieren: (auftragId: string, befehl: ExportBefehl, schluessel: string) => ruf(() => b.Exportieren(auftragId, befehl, schluessel)),

        // Dateien binden.
        binden: (befehl: BindeBefehl, schluessel: string) => ruf(() => b.Binden(befehl, schluessel)),
        dateienWaehlen: () => ruf(() => b.DateienWaehlen()),
        quelleInfo: (quelleId: string) => ruf(() => b.QuelleInfo(quelleId)),
    };
}

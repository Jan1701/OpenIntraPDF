// SPDX-License-Identifier: Apache-2.0
//
// Eigenschaften eines Dokuments (Etappe 7, nur anzeigen): Titel, Autor,
// Thema, Stichwörter, Ersteller, Produzent, PDF-Version, Erstell- und
// Änderungsdatum aus `getMetadata()` von pdf.js, die Seitenzahl, die Größe
// der ersten Seite aus `getPage(1).view` und die Dateigröße, wenn der
// Gastgeber sie kennt. Reine Werte und Funktionen; die Darstellung macht
// EigenschaftenDialog.tsx. Bearbeiten folgt in Etappe 8.

import { pdfDatum } from './hilfen';

export interface Eigenschaften {
    titel?: string;
    autor?: string;
    thema?: string;
    stichwoerter?: string;
    ersteller?: string;
    produzent?: string;
    pdfVersion?: string;
    erstellt: Date | null;
    geaendert: Date | null;
    seiten: number;
    /** Größe der ersten Seite in PDF-Punkten (MediaBox bzw. CropBox). */
    ersteSeite: { breitePt: number; hoehePt: number } | null;
    /** Bytes, wenn bekannt. */
    dateigroesse?: number;
}

/** Was von pdf.js gebraucht wird — so wenig, dass Tests es nachstellen können. */
export interface EigenschaftenDokument {
    numPages: number;
    getMetadata(): Promise<unknown>;
    getPage(nummer: number): Promise<{ view?: ArrayLike<number> }>;
}

/** Ein Punkt sind 1/72 Zoll. */
export function ptZuMm(pt: number): number {
    return (pt * 25.4) / 72;
}

function text(wert: unknown): string | undefined {
    if (typeof wert !== 'string') return undefined;
    const t = wert.trim();
    return t ? t : undefined;
}

export async function eigenschaftenLesen(dokument: EigenschaftenDokument, dateigroesse?: number): Promise<Eigenschaften> {
    // Metadaten und erste Seite unabhängig voneinander — fehlt eines, bleibt das andere.
    const [meta, seite] = await Promise.all([
        dokument.getMetadata().catch(() => null),
        dokument.getPage(1).catch(() => null),
    ]);
    const info = ((meta as { info?: Record<string, unknown> } | null)?.info ?? {}) as Record<string, unknown>;
    const view = seite?.view;
    const ersteSeite = view && view.length >= 4
        ? { breitePt: Math.abs(Number(view[2]) - Number(view[0])), hoehePt: Math.abs(Number(view[3]) - Number(view[1])) }
        : null;
    return {
        titel: text(info.Title),
        autor: text(info.Author),
        thema: text(info.Subject),
        stichwoerter: text(info.Keywords),
        ersteller: text(info.Creator),
        produzent: text(info.Producer),
        pdfVersion: text(info.PDFFormatVersion),
        erstellt: pdfDatum(info.CreationDate),
        geaendert: pdfDatum(info.ModDate),
        seiten: dokument.numPages,
        ersteSeite: ersteSeite && Number.isFinite(ersteSeite.breitePt) && Number.isFinite(ersteSeite.hoehePt) ? ersteSeite : null,
        dateigroesse: typeof dateigroesse === 'number' && dateigroesse >= 0 ? dateigroesse : undefined,
    };
}

/** „1.234 Bytes“, „12,3 KB“, „4,8 MB“ in der Sprache der Oberfläche. */
export function groesseText(bytes: number, sprache: string): string {
    const zahl = (n: number, stellen: number) => {
        try {
            return n.toLocaleString(sprache, { maximumFractionDigits: stellen, minimumFractionDigits: 0 });
        } catch {
            return n.toFixed(stellen);
        }
    };
    if (bytes < 1024) return `${zahl(bytes, 0)} Bytes`;
    if (bytes < 1024 * 1024) return `${zahl(bytes / 1024, 1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${zahl(bytes / (1024 * 1024), 1)} MB`;
    return `${zahl(bytes / (1024 * 1024 * 1024), 2)} GB`;
}

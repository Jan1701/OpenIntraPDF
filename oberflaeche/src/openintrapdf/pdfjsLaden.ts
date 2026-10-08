// SPDX-License-Identifier: Apache-2.0
//
// pdf.js und seine Viewer-Bausteine nachladen.
//
// ⚠️ Die Reihenfolge ist hier keine Stilfrage.
//
// `pdfjs-dist/web/pdf_viewer.mjs` (PDFViewer, EventBus, PDFFindController …)
// importiert pdf.js NICHT, sondern greift beim Laden auf `globalThis.pdfjsLib`
// zu und zerlegt es sofort in seine Bestandteile. Steht das Objekt dann noch
// nicht da, bricht das Modul beim Auswerten ab. Deshalb:
//
//   1. pdf.js laden, Worker setzen,
//   2. `globalThis.pdfjsLib` setzen,
//   3. ERST DANN den Viewer laden — als eigener, nachträglicher Import.
//
// Ein gewöhnlicher statischer Import beider Module reicht nicht: Im Bündel
// landet der Viewer (vite.config.ts) in einem eigenen Teil, und Teile werden
// vollständig ausgewertet, bevor der Code läuft, der sie importiert.
//
// Die Stilvorlage des Viewers (Textebene, Anmerkungsebene, Suchtreffer) kommt
// als Zeichenkette und wird nur eingehängt, solange ein Arbeitsplatz offen
// ist: Sie setzt u. a. `color-scheme` auf :root und soll danach nicht in
// OIH weiterwirken.

import type * as PdfjsModul from 'pdfjs-dist';
import type * as ViewerModul from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerAdresse from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type Pdfjs = typeof PdfjsModul;
export type PdfViewerBausteine = typeof ViewerModul;

export interface PdfBibliothek {
    pdfjs: Pdfjs;
    viewer: PdfViewerBausteine;
    /** Inhalt von pdf_viewer.css. */
    viewerStil: string;
    /**
     * Gehört in JEDEN getDocument-Aufruf: wo pdf.js seine Hilfsdateien findet
     * (vite.pdfjs-dateien.ts). Ohne `wasmUrl` bleiben Fax-/JBIG2-Scans und
     * JPEG-2000-Bilder leer (07.10.2026, work).
     */
    dokumentOptionen: PdfjsHilfen;
}

/** Die Adressen der pdf.js-Hilfsdateien für getDocument. */
export interface PdfjsHilfen {
    wasmUrl: string;
    cMapUrl: string;
    cMapPacked: true;
    standardFontDataUrl: string;
    iccUrl: string;
}

/**
 * Adressen relativ zur Seite: Im Hub liegt sie unter /, in der Desktop-App
 * unter dem Asset-Server der App — beide liefern pdfjs/… mit aus. Ein
 * Schrägstrich am Ende ist Pflicht, pdf.js hängt die Dateinamen an.
 */
export function pdfjsHilfen(basis: string = document.baseURI): PdfjsHilfen {
    const ordner = (name: string) => new URL(`pdfjs/${name}/`, basis).href;
    return {
        wasmUrl: ordner('wasm'),
        cMapUrl: ordner('cmaps'),
        cMapPacked: true,
        standardFontDataUrl: ordner('standard_fonts'),
        iccUrl: ordner('iccs'),
    };
}

/**
 * XFA-Formulare nur ansehen (seit 2345): pdf.js zeichnet ihre Felder als
 * echte Eingabefelder, aber OpenIntraPDF kann ein ausgefülltes XFA-Formular
 * nicht speichern. Wer hineintippt, verlöre seine Eingaben stillschweigend --
 * deshalb nehmen die Felder keine Maus mehr an (der Hinweisstreifen sagt,
 * womit man sie ausfüllt).
 */
const XFA_NUR_ANSICHT = `
.xfaLayer input, .xfaLayer textarea, .xfaLayer select, .xfaLayer button { pointer-events: none; }
`;

let geladen: Promise<PdfBibliothek> | null = null;

export function pdfjsLaden(): Promise<PdfBibliothek> {
    geladen ??= (async () => {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerAdresse;
        (globalThis as unknown as { pdfjsLib: Pdfjs }).pdfjsLib = pdfjs;
        const [viewer, stil] = await Promise.all([
            import('pdfjs-dist/web/pdf_viewer.mjs'),
            import('pdfjs-dist/web/pdf_viewer.css?inline'),
        ]);
        return { pdfjs, viewer, viewerStil: stil.default + XFA_NUR_ANSICHT, dokumentOptionen: pdfjsHilfen() };
    })().catch(fehler => {
        // Ein gescheiterter Versuch (Netz weg) darf den nächsten nicht sperren.
        geladen = null;
        throw fehler;
    });
    return geladen;
}

// ---------------------------------------------------------------------
// Stilvorlage: eingehängt, solange mindestens ein Arbeitsplatz offen ist
// ---------------------------------------------------------------------

let stilNutzer = 0;
let stilElement: HTMLStyleElement | null = null;

export function viewerStilEinhaengen(css: string): () => void {
    stilNutzer++;
    if (!stilElement) {
        stilElement = document.createElement('style');
        stilElement.dataset.openintrapdf = 'pdf-viewer';
        stilElement.textContent = css;
        document.head.appendChild(stilElement);
    }
    return () => {
        stilNutzer--;
        if (stilNutzer <= 0 && stilElement) {
            stilElement.remove();
            stilElement = null;
            stilNutzer = 0;
        }
    };
}

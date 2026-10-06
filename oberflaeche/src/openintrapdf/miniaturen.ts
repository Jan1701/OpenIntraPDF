// SPDX-License-Identifier: Apache-2.0
//
// Seitenminiaturen: klein, der Reihe nach, mit kleinem Zwischenspeicher.
//
// Bei einem Dokument mit 800 Seiten darf das Öffnen nicht 800 Seiten
// rendern. Eine Miniatur wird erst angefordert, wenn sie ins Bild rückt
// (IntersectionObserver in Miniatur.tsx); gerendert wird höchstens
// `GLEICHZEITIG` auf einmal, und der Zwischenspeicher hält nur die zuletzt
// gebrauchten Bilder. Wer wieder hochscrollt, wartet kurz — das ist der
// Preis dafür, dass der Speicher nicht mit dem Dokument wächst.

import type { PDFDocumentProxy } from 'pdfjs-dist';

type ZeichenDokument = Pick<PDFDocumentProxy, 'getPage'>;

export const MINIATUR_BREITE = 150;
const GLEICHZEITIG = 2;
const SPEICHER_GRENZE = 80;

export interface MiniaturBild {
    adresse: string;
    breite: number;
    hoehe: number;
}

interface Auftrag {
    schluessel: string;
    quelle: number;
    drehung: number;
    erfuellen: (b: MiniaturBild) => void;
    ablehnen: (f: unknown) => void;
    signal?: AbortSignal;
}

export class MiniaturDienst {
    private readonly dokument: ZeichenDokument;
    private readonly speicher = new Map<string, MiniaturBild>();
    private readonly laufend = new Map<string, Promise<MiniaturBild>>();
    private readonly warteschlange: Auftrag[] = [];
    private aktiv = 0;
    private beendet = false;

    constructor(dokument: ZeichenDokument) {
        this.dokument = dokument;
    }

    /** Sofort vorhandenes Bild, ohne etwas anzustoßen. */
    vorhanden(quelle: number, drehung: number): MiniaturBild | undefined {
        const s = `${quelle}:${drehung}`;
        const bild = this.speicher.get(s);
        if (bild) {
            // Zuletzt benutzt ans Ende — so fällt zuerst heraus, was lange keiner sah.
            this.speicher.delete(s);
            this.speicher.set(s, bild);
        }
        return bild;
    }

    holen(quelle: number, drehung: number, signal?: AbortSignal): Promise<MiniaturBild> {
        const schluessel = `${quelle}:${drehung}`;
        const bild = this.vorhanden(quelle, drehung);
        if (bild) return Promise.resolve(bild);
        const offen = this.laufend.get(schluessel);
        if (offen) return offen;
        const versprechen = new Promise<MiniaturBild>((erfuellen, ablehnen) => {
            const auftrag: Auftrag = { schluessel, quelle, drehung, erfuellen, ablehnen, signal };
            this.warteschlange.push(auftrag);
            // Rückt die Miniatur aus dem Bild, bevor sie dran war, fliegt der
            // Auftrag sofort aus der Schlange — schnelles Durchscrollen soll
            // keine hundert veralteten Aufträge hinterlassen.
            signal?.addEventListener('abort', () => {
                const i = this.warteschlange.indexOf(auftrag);
                if (i >= 0) {
                    this.warteschlange.splice(i, 1);
                    ablehnen(new DOMException('abgebrochen', 'AbortError'));
                }
            }, { once: true });
        });
        this.laufend.set(schluessel, versprechen);
        versprechen.then(() => this.laufend.delete(schluessel), () => this.laufend.delete(schluessel));
        this.weiter();
        return versprechen;
    }

    beenden(): void {
        this.beendet = true;
        for (const a of this.warteschlange.splice(0)) a.ablehnen(new DOMException('beendet', 'AbortError'));
        this.speicher.clear();
    }

    private weiter(): void {
        while (!this.beendet && this.aktiv < GLEICHZEITIG && this.warteschlange.length) {
            // Neueste Anforderung zuerst: Das ist, was gerade ins Bild gescrollt wurde.
            const auftrag = this.warteschlange.pop()!;
            this.aktiv++;
            this.zeichnen(auftrag.quelle, auftrag.drehung)
                .then(bild => {
                    this.ablegen(auftrag.schluessel, bild);
                    auftrag.erfuellen(bild);
                }, auftrag.ablehnen)
                .finally(() => {
                    this.aktiv--;
                    this.weiter();
                });
        }
    }

    private ablegen(schluessel: string, bild: MiniaturBild): void {
        if (this.beendet) return;
        this.speicher.set(schluessel, bild);
        while (this.speicher.size > SPEICHER_GRENZE) {
            const aeltester = this.speicher.keys().next().value;
            if (aeltester === undefined) break;
            this.speicher.delete(aeltester);
        }
    }

    private async zeichnen(quelle: number, drehung: number): Promise<MiniaturBild> {
        const seite = await this.dokument.getPage(quelle + 1);
        const roh = seite.getViewport({ scale: 1, rotation: (seite.rotate + drehung) % 360 });
        const massstab = MINIATUR_BREITE / Math.max(1, roh.width);
        const blick = seite.getViewport({ scale: massstab, rotation: (seite.rotate + drehung) % 360 });
        const leinwand = document.createElement('canvas');
        leinwand.width = Math.max(1, Math.floor(blick.width));
        leinwand.height = Math.max(1, Math.floor(blick.height));
        await seite.render({ canvas: leinwand, viewport: blick }).promise;
        const bild = { adresse: leinwand.toDataURL('image/png'), breite: leinwand.width, hoehe: leinwand.height };
        // Die Leinwand selbst wird nicht mehr gebraucht; Speicher sofort freigeben.
        leinwand.width = 0;
        leinwand.height = 0;
        return bild;
    }
}

// SPDX-License-Identifier: Apache-2.0
//
// Kleine Helfer ohne React: Schlüssel, Herunterladen, Drucken, Namen.

/**
 * Ein Idempotency-Key für genau einen Speichervorgang.
 *
 * `crypto.randomUUID` gibt es nur in sicheren Umgebungen (https,
 * localhost). Ein OIH im LAN läuft aber auch mal über http — dort baut
 * `getRandomValues` (überall vorhanden) eine gleichwertige UUID v4.
 */
export function neuerSchluessel(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Bietet einen Blob als Datei zum Speichern an. */
export function dateiAnbieten(blob: Blob, name: string): void {
    const adresse = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = adresse;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Sofortiges Freigeben bricht in manchen Browsern den Download ab.
    setTimeout(() => URL.revokeObjectURL(adresse), 30_000);
}

/**
 * Druckt ein PDF über den Druckdialog des Browsers.
 *
 * Bewusst KEIN Rendern über pdf.js: Das hieße, jede Seite in ein Bild zu
 * verwandeln — eine heimliche Rasterung, die das Konzept ausschließt
 * (Kap. 01, Drucken). Der Browser druckt das PDF selbst, in voller Qualität.
 *
 * Ein unsichtbarer Rahmen statt eines neuen Fensters: `window.open` nach
 * einem `await` fällt gern dem Popup-Blocker zum Opfer. Klappt der Rahmen
 * nicht (Safari druckt PDFs darin nicht zuverlässig), öffnet sich das PDF
 * in einem neuen Reiter, wo der Druck von Hand geht.
 */
export function pdfDrucken(blob: Blob): Promise<void> {
    const adresse = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const rahmen = document.createElement('iframe');
    rahmen.setAttribute('aria-hidden', 'true');
    rahmen.tabIndex = -1;
    rahmen.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    const aufraeumen = () => {
        rahmen.remove();
        URL.revokeObjectURL(adresse);
    };
    return new Promise(resolve => {
        rahmen.onload = () => {
            try {
                rahmen.contentWindow?.focus();
                rahmen.contentWindow?.print();
            } catch {
                window.open(adresse, '_blank', 'noopener');
            }
            resolve();
            // Der Druckdialog hält den Rahmen noch; großzügig warten.
            setTimeout(aufraeumen, 120_000);
        };
        rahmen.src = adresse;
        document.body.appendChild(rahmen);
    });
}

/** Dateiname ohne Endung `.pdf`. */
export function namensStamm(name: string): string {
    return name.replace(/\.pdf$/i, '');
}

/** Hängt `.pdf` an, wenn es fehlt. */
export function mitPdfEndung(name: string): string {
    const n = name.trim();
    return /\.pdf$/i.test(n) ? n : `${n}.pdf`;
}

/**
 * Datum aus einem PDF-Datumsfeld (`D:20260929140800+02'00'`).
 * Unlesbares ergibt `null` — eine Anmerkung ohne Datum ist kein Fehler.
 */
export function pdfDatum(wert: unknown): Date | null {
    if (typeof wert !== 'string') return null;
    const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(wert);
    if (!m) return null;
    const [, j, mo = '01', t = '01', h = '00', mi = '00', s = '00', zone, zh = '00', zm = '00'] = m;
    const ohneZone = Date.UTC(+j, +mo - 1, +t, +h, +mi, +s);
    if (!Number.isFinite(ohneZone)) return null;
    let versatz = 0;
    if (zone === '+' || zone === '-') versatz = (zone === '+' ? 1 : -1) * ((+zh * 60) + +zm) * 60_000;
    // Ohne Zonenangabe gilt Ortszeit — wie im PDF-Standard vorgesehen.
    if (!zone) return new Date(+j, +mo - 1, +t, +h, +mi, +s);
    return new Date(ohneZone - versatz);
}

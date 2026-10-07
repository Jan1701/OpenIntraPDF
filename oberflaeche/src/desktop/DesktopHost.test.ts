// SPDX-License-Identifier: Apache-2.0
//
// Der Desktop-Gastgeber gegen eine Brücken-Attrappe: Laden über den
// Asset-Server, Fehlerform der Go-Seite, Rastern und Liefern der
// Seitenbilder eines Auftrags samt Abbruch. Alle Daten sind erfunden.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const druck = vi.hoisted(() => ({ pdfDrucken: vi.fn(async (_blob: Blob) => undefined) }));
vi.mock('../openintrapdf/hilfen', async (original) => ({ ...(await original<typeof import('../openintrapdf/hilfen')>()), pdfDrucken: druck.pdfDrucken }));
import { PdfHostFehler } from '../openintrapdf/typen';
import type { CommitBefehl, OcrBefehl } from '../openintrapdf/typen';
import { base64ZuBytes, bytesZuBase64, desktopHost, hostFehler } from './DesktopHost';
import type { Bruecke, DesktopAuftrag } from './bruecke';
import type { Rasterer } from './rastern';

function auftrag(ueber: Partial<DesktopAuftrag> = {}): DesktopAuftrag {
    return {
        id: 'a1', file_id: 'f1', kind: 'ocr', state: 'running', progress: { done: 0, total: 2 },
        render_pages: [0, 1], dpi: 300, ...ueber,
    };
}

/** Eine Brücke, die alles protokolliert und einfache Antworten gibt. */
function bruecke(ueber: Partial<Bruecke> = {}): Bruecke & { aufrufe: string[] } {
    const aufrufe: string[] = [];
    const merken = <T,>(name: string, wert: T) => vi.fn(async (...args: unknown[]) => { aufrufe.push(`${name}(${args.map(a => JSON.stringify(a)).join(',')})`); return wert; });
    return {
        aufrufe,
        Start: merken('Start', { person: 'Erika', ocr: '5.5.3', zuletzt: [], geoeffnet: null }),
        OeffnenDialog: merken('OeffnenDialog', null),
        ZuletztOeffnen: merken('ZuletztOeffnen', { id: 'f1', name: 'Probe.pdf' }),
        Zuletzt: merken('Zuletzt', []),
        Schliessen: merken('Schliessen', undefined),
        Neuladen: merken('Neuladen', undefined),
        Info: merken('Info', { file_id: 'f1', name: 'Probe.pdf', version: 3, sha256: 'a'.repeat(64), access: 'edit' as const }),
        Speichern: merken('Speichern', { file_id: 'f1', version: 4, sha256: 'b'.repeat(64), name: 'Probe.pdf' }),
        Extrahieren: merken('Extrahieren', { files: [] }),
        ZielWaehlen: merken('ZielWaehlen', null),
        Seitenarten: merken('Seitenarten', { version: 3, pages: [] }),
        AuftragStarten: merken('AuftragStarten', auftrag()),
        Auftraege: merken('Auftraege', []),
        Auftrag: merken('Auftrag', auftrag()),
        AuftragAbbrechen: merken('AuftragAbbrechen', auftrag({ state: 'cancelled' })),
        SeiteLiefern: merken('SeiteLiefern', undefined),
        AuftragVeroeffentlichen: merken('AuftragVeroeffentlichen', { file_id: 'f1', version: 4, sha256: 'c'.repeat(64), name: 'Probe.pdf' }),
        Modell: merken('Modell', { source: {}, warnings: [], pages: [] }),
        Exportieren: merken('Exportieren', { file_id: '', name: 'Probe.docx' }),
        Binden: merken('Binden', { file_id: '', name: 'Gebunden.pdf', version: 1 }),
        DateienWaehlen: merken('DateienWaehlen', []),
        QuelleInfo: merken('QuelleInfo', { file_id: 'f2', name: 'Zwei.pdf', version: 1, sha256: '', access: 'edit' as const }),
        KopieSichern: merken('KopieSichern', undefined),
        Drucken: merken('Drucken', undefined),
        Druckfassung: merken('Druckfassung', btoa('%PDF-1.7 Teil')),
        BytesDrucken: merken('BytesDrucken', undefined),
        Schnelldruck: merken('Schnelldruck', undefined),
        RechteKennwortPruefen: merken('RechteKennwortPruefen', undefined),
        Lizenzen: merken('Lizenzen', { app: 'OpenIntraPDF', urheber: '', lizenz: 'Apache-2.0', text: '', teile: [] }),
        MenueSprache: merken('MenueSprache', undefined),
        ...ueber,
    };
}

/** Ein Rasterer, der je Seite „png<seite>“ liefert (Base64 von Text). */
function rasterer(protokoll: string[]): () => Rasterer {
    return () => ({
        laden: vi.fn(async () => { protokoll.push('laden'); }),
        rastern: vi.fn(async (seite: number) => { protokoll.push(`rastern ${seite}`); return btoa(`png${seite}`); }),
        schliessen: vi.fn(() => { protokoll.push('schliessen'); }),
    });
}

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (adresse: string) => {
        if (adresse === './datei/f1') {
            return new Response(bytes, { status: 200, headers: { 'X-File-Version': '3', ETag: `"${'a'.repeat(64)}"` } });
        }
        if (adresse === './auftrag/a1/ergebnis') return new Response(bytes, { status: 200 });
        return new Response('', { status: 404 });
    }));
});
afterEach(() => vi.unstubAllGlobals());

const bis = async (bedingung: () => boolean) => {
    for (let i = 0; i < 50 && !bedingung(); i++) await new Promise(r => setTimeout(r, 5));
    expect(bedingung()).toBe(true);
};

describe('hostFehler', () => {
    it('liest Status, Code und Params aus dem JSON der Go-Seite', () => {
        const f = hostFehler(new Error('{"status":412,"code":"pdf.version_conflict","params":{"current_version":5}}'));
        expect(f).toBeInstanceOf(PdfHostFehler);
        expect(f.status).toBe(412);
        expect(f.code).toBe('pdf.version_conflict');
        expect(f.aktuelleVersion).toBe(5);
    });

    it('macht aus allem anderen einen Netzfehler mit Text', () => {
        const f = hostFehler(new Error('Verbindung weg'));
        expect(f.status).toBe(0);
        expect(f.code).toBe('network');
        expect(f.meldung).toBe('Verbindung weg');
    });
});

describe('desktopHost', () => {
    it('lädt Bytes und Info über Kennung, mit Fassung und Prüfsumme aus den Köpfen', async () => {
        const b = bruecke();
        const host = desktopHost('f1', b, { rasterer: rasterer([]), person: 'Erika Musterfrau' });
        const ladung = await host.laden();
        expect(new Uint8Array(ladung.daten)).toEqual(bytes);
        expect(ladung.version).toBe(3);
        expect(ladung.sha256).toBe('a'.repeat(64));
        expect(ladung.info?.name).toBe('Probe.pdf');
        expect(host.person).toEqual({ name: 'Erika Musterfrau' });
        // Erst den Stand der Platte holen, dann Info (Review 07.10.2026: „Neu laden“ bekam alte Bytes).
        expect(b.aufrufe.slice(0, 2)).toEqual(['Neuladen("f1")', 'Info("f1")']);
    });

    it('scheitert Neuladen (Datei ist kein PDF mehr), scheitert das Laden mit der Meldung der Go-Seite', async () => {
        const b = bruecke({ Neuladen: vi.fn(async () => { throw new Error('{"status":422,"code":"pdf.not_pdf"}'); }) });
        const host = desktopHost('f1', b, { rasterer: rasterer([]) });
        await expect(host.laden()).rejects.toMatchObject({ status: 422, code: 'pdf.not_pdf' });
    });

    it('reicht Speichern mit Schlüssel durch und übersetzt einen 412', async () => {
        const befehl: CommitBefehl = { expected_version: 3, expected_sha256: 'a'.repeat(64), pages: [{ source: 0, rotate: 90 }], destination: { kind: 'new_version' } };
        const b = bruecke();
        const host = desktopHost('f1', b, { rasterer: rasterer([]) });
        const erg = await host.speichern!(befehl, 'k1');
        expect(erg.version).toBe(4);
        expect(b.aufrufe.at(-1)).toBe(`Speichern("f1",${JSON.stringify(befehl)},"k1")`);

        const b2 = bruecke({ Speichern: vi.fn(async () => { throw new Error('{"status":412,"code":"pdf.version_conflict","params":{"current_version":9}}'); }) });
        const host2 = desktopHost('f1', b2, { rasterer: rasterer([]) });
        await expect(host2.speichern!(befehl, 'k2')).rejects.toMatchObject({ status: 412, code: 'pdf.version_conflict' });
    });

    it('rastert nach dem Start eines Auftrags jede Seite und liefert sie der Go-Seite', async () => {
        const protokoll: string[] = [];
        const b = bruecke();
        const host = desktopHost('f1', b, { rasterer: rasterer(protokoll) });
        const befehl: OcrBefehl = { kind: 'ocr', expected_version: 3, options: { pages: [0, 1], languages: 'deu+eng' } };
        const a = await host.ocrStarten!(befehl, 'k1');
        expect(a.id).toBe('a1');
        await bis(() => protokoll.includes('schliessen'));
        expect(protokoll).toEqual(['laden', 'rastern 0', 'rastern 1', 'schliessen']);
        expect(b.aufrufe.filter(s => s.startsWith('SeiteLiefern'))).toEqual([
            `SeiteLiefern("a1",0,"${btoa('png0')}","")`,
            `SeiteLiefern("a1",1,"${btoa('png1')}","")`,
        ]);
    });

    it('hört auf zu rastern, sobald der Auftrag nicht mehr läuft', async () => {
        const protokoll: string[] = [];
        let abfragen = 0;
        const b = bruecke({
            Auftrag: vi.fn(async () => auftrag({ state: ++abfragen === 1 ? 'running' : 'cancelled' })),
        });
        const host = desktopHost('f1', b, { rasterer: rasterer(protokoll) });
        await host.ocrStarten!({ kind: 'ocr', expected_version: 3, options: { pages: [0, 1], languages: 'deu' } }, 'k1');
        await bis(() => protokoll.includes('schliessen'));
        expect(protokoll).toEqual(['laden', 'rastern 0', 'schliessen']);
        expect(b.aufrufe.filter(s => s.startsWith('SeiteLiefern'))).toHaveLength(1);
    });

    it('meldet ein gescheitertes Rastern statt den Auftrag hängen zu lassen', async () => {
        const protokoll: string[] = [];
        const kaputt = (): Rasterer => ({
            laden: vi.fn(async () => undefined),
            rastern: vi.fn(async () => { throw new Error('keine Leinwand'); }),
            schliessen: vi.fn(() => { protokoll.push('schliessen'); }),
        });
        const b = bruecke();
        const host = desktopHost('f1', b, { rasterer: kaputt });
        await host.ocrStarten!({ kind: 'ocr', expected_version: 3, options: { pages: [0, 1], languages: 'deu' } }, 'k1');
        await bis(() => protokoll.includes('schliessen'));
        expect(b.aufrufe.filter(s => s.startsWith('SeiteLiefern'))).toEqual(['SeiteLiefern("a1",0,"","render_failed")']);
    });

    it('rastert nicht noch einmal, wenn eine Wiederholung den alten Auftrag zurückbekommt', async () => {
        const protokoll: string[] = [];
        const b = bruecke({ AuftragStarten: vi.fn(async () => auftrag({ progress: { done: 1, total: 2 } })) });
        const host = desktopHost('f1', b, { rasterer: rasterer(protokoll) });
        await host.ocrStarten!({ kind: 'ocr', expected_version: 3, options: { pages: [0, 1], languages: 'deu' } }, 'k1');
        await new Promise(r => setTimeout(r, 20));
        expect(protokoll).toEqual([]);
    });

    it('holt das Ergebnis eines Auftrags über den Asset-Server und die übrigen Wege über die Brücke', async () => {
        const b = bruecke();
        const host = desktopHost('f1', b, { rasterer: rasterer([]) });
        expect(new Uint8Array(await host.ergebnisLaden!('a1'))).toEqual(bytes);
        await host.drucken!();
        await host.auftragAbbrechen!('a1');
        expect(await host.dateienWaehlen!()).toEqual([]);
        expect(b.aufrufe).toEqual(expect.arrayContaining(['Drucken("f1")', 'AuftragAbbrechen("a1")', 'DateienWaehlen()']));
    });

    it('bietet kein Herunterladen an — die Datei liegt schon auf der Platte (Jan, 01.10.2026)', () => {
        const host = desktopHost('f1', bruecke(), { rasterer: rasterer([]) });
        expect(host.herunterladen).toBeUndefined();
    });
});

describe('Drucken mit Seitenbereich und Schnelldruck (Etappe 8)', () => {
    it('druckfassung holt die Teil-PDF als Base64 und liefert Bytes; bytesDrucken gibt sie als Base64 an die Go-Seite', async () => {
        const b = bruecke();
        const h = desktopHost('f1', b, { rasterer: rasterer([]) });
        const bytes = await h.druckfassung!({ pages: [2, 0], annotations: false, expected_version: 3 });
        expect(new TextDecoder().decode(bytes)).toBe('%PDF-1.7 Teil');
        expect(b.aufrufe).toContain('Druckfassung("f1",{"pages":[2,0],"annotations":false,"expected_version":3})');
        await h.bytesDrucken!(new TextEncoder().encode('%PDF-1.7 X').buffer, 'Angebot – Drucken.pdf');
        expect(b.aufrufe).toContain(`BytesDrucken("Angebot – Drucken.pdf","${btoa('%PDF-1.7 X')}")`);
        // Hin und zurück verlustfrei, auch über 32 KiB.
        const gross = new Uint8Array(70000).map((_, i) => i % 251);
        expect(new Uint8Array(base64ZuBytes(bytesZuBase64(gross.buffer)))).toEqual(gross);
    });

    it('rechteKennwortPruefen (#247) fragt die Go-Seite; ihr Fehler wird ein PdfHostFehler', async () => {
        const b = bruecke();
        const h = desktopHost('f1', b, { rasterer: rasterer([]) });
        await h.rechteKennwortPruefen!('rechte-456');
        expect(b.aufrufe).toContain('RechteKennwortPruefen("f1","rechte-456")');
        const falsch = bruecke({ RechteKennwortPruefen: async () => { throw new Error(JSON.stringify({ status: 422, code: 'pdf.wrong_password', params: {} })); } });
        await expect(desktopHost('f1', falsch, { rasterer: rasterer([]) }).rechteKennwortPruefen!('falsch-789'))
            .rejects.toMatchObject({ status: 422, code: 'pdf.wrong_password' });
    });

    it('Windows (browserDruck): druckt über die Webansicht, nicht über die Go-Seite', async () => {
        druck.pdfDrucken.mockClear();
        const b = bruecke();
        const h = desktopHost('f1', b, { rasterer: rasterer([]), browserDruck: true });
        expect(h.bytesDrucken).toBeUndefined();
        await h.drucken!();
        expect(druck.pdfDrucken).toHaveBeenCalledTimes(1);
        expect(b.aufrufe.some(a => a.startsWith('Drucken('))).toBe(false);
        // Mac und Linux unverändert über die Go-Seite
        const m = desktopHost('f1', b, { rasterer: rasterer([]) });
        expect(m.bytesDrucken).toBeDefined();
        await m.drucken!();
        expect(b.aufrufe).toContain('Drucken("f1")');
    });

    it('schnelldruck gibt es nur, wenn die Go-Seite ihn meldet', async () => {
        const b = bruecke();
        expect(desktopHost('f1', b, { rasterer: rasterer([]) }).schnelldruck).toBeUndefined();
        const h = desktopHost('f1', b, { rasterer: rasterer([]), schnelldruck: true });
        await h.schnelldruck!();
        expect(b.aufrufe).toContain('Schnelldruck("f1")');
    });
});

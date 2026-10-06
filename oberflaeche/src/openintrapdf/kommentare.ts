// SPDX-License-Identifier: Apache-2.0
//
// Vorhandene Anmerkungen eines PDFs, gelesen aus `page.getAnnotations()`.
//
// Das ist der gespeicherte Bestand — Notizen, Markierungen, Stempel,
// Zeichnungen, auch aus Acrobat oder Foxit. Antworten hängen über
// `inReplyTo` an ihrer Ursprungsanmerkung; ein „erledigt“ steht im PDF als
// eigene Statusanmerkung (Text mit `State`/`StateModel`, siehe Vertrag
// Etappe 2), die hier als Statusmarke erkannt und nicht als Kommentar
// gezeigt wird. Was die Person NEU anlegt, steht nicht hier, sondern im
// Entwurf (anmerkungen.ts).

import { pdfDatum } from './hilfen';

/** pdf.js AnnotationType, soweit hier gebraucht. */
const TYP: Record<number, string> = {
    1: 'notiz',
    3: 'textfeld',
    4: 'linie',
    5: 'rechteck',
    6: 'kreis',
    7: 'form',
    8: 'form',
    9: 'hervorhebung',
    10: 'unterstreichung',
    11: 'unterstreichung',
    12: 'durchstreichung',
    13: 'stempel',
    14: 'einfuegung',
    15: 'zeichnung',
    17: 'anhang',
};

export interface Kommentar {
    /** pdf.js-Kennung der Anmerkung (`12R`); eindeutig im Dokument. */
    id: string;
    /** Objektnummer aus der Kennung; 0, wenn sie keine trägt. Ordnet Statusmarken ohne `M` (Etappe 8). */
    objNr: number;
    /** Seite ab 1 — im gespeicherten Dokument, also Quellseite + 1. */
    seite: number;
    art: string;
    autor: string;
    text: string;
    /** Änderungsdatum `M`, sonst Erstelldatum. */
    datum: Date | null;
    /** Nur `M` — maßgeblich für die Reihenfolge von Statusmarken (Etappe 8). */
    geaendert: Date | null;
    rechteck?: number[];
    /** Kennung der Anmerkung, auf die diese antwortet. */
    antwortAuf?: string;
    /** Gesetzt bei einer Statusmarke: `Completed`, `None`, `Accepted`, … */
    status?: string;
}

/** Rohform einer Anmerkung aus `page.getAnnotations()`, gekürzt. */
export interface RohAnmerkung {
    id?: string;
    annotationType?: number;
    rect?: number[];
    contentsObj?: { str?: string };
    titleObj?: { str?: string };
    modificationDate?: string | null;
    creationDate?: string | null;
    inReplyTo?: string | null;
    replyType?: string;
    state?: string | null;
    stateModel?: string | null;
}

/** Wandelt eine Anmerkung um — oder `null`, wenn sie kein Kommentar ist (Link, Formularfeld, Popup). */
export function alsKommentar(a: RohAnmerkung, seite: number): Kommentar | null {
    const art = a.annotationType !== undefined ? TYP[a.annotationType] : undefined;
    if (!art) return null;
    const id = a.id ?? `${seite}-${(a.rect ?? []).join(',')}`;
    const nr = /^(\d+)R$/.exec(id);
    const k: Kommentar = {
        id,
        objNr: nr ? Number(nr[1]) : 0,
        seite,
        art,
        autor: a.titleObj?.str?.trim() ?? '',
        text: a.contentsObj?.str?.trim() ?? '',
        datum: pdfDatum(a.modificationDate ?? a.creationDate ?? null),
        geaendert: pdfDatum(a.modificationDate ?? null),
        rechteck: a.rect,
    };
    // pdf.js liefert Antworten mit `RT /Group` als Teil der Gruppe; für die
    // Liste zählen beide Arten als Antwort auf die Ursprungsanmerkung.
    if (a.inReplyTo) k.antwortAuf = a.inReplyTo;
    if (a.state) k.status = a.state;
    return k;
}

/** Eine Statusmarke ist eine Antwort, die nur einen Status trägt (Vertrag: `StateModel /Review`). */
export const istStatusmarke = (k: Kommentar) => !!k.antwortAuf && !!k.status;

/**
 * Zustände, die eine Statusmarke tragen kann. Geschrieben werden nur
 * `completed` und `none`; `accepted`, `rejected` und `cancelled` kommen aus
 * Acrobat und werden mit eigenem Wort angezeigt (Vertrag Etappe 8).
 */
export type FadenZustand = 'completed' | 'none' | 'accepted' | 'rejected' | 'cancelled';

/** Der Status eines Fadens aus seiner neuesten Statusmarke. */
export interface FadenStatus {
    zustand: FadenZustand;
    /** Wer die Marke setzte (`T` der Statusmarke). */
    autor: string;
    /** Wann (`M` der Statusmarke, sonst ihr Erstelldatum). */
    datum: Date | null;
}

function alsZustand(status: string | undefined): FadenZustand {
    switch ((status ?? '').toLowerCase()) {
        case 'completed': return 'completed';
        case 'accepted': return 'accepted';
        case 'rejected': return 'rejected';
        case 'cancelled': return 'cancelled';
        default: return 'none';
    }
}

/**
 * Welche von zwei Statusmarken die neuere ist: nach `M`, und erst wenn
 * beide dasselbe `M` tragen (oder eines fehlt), nach der Objektnummer —
 * zwei Commits in derselben Sekunde unterscheidet nur sie.
 */
function neuer(a: Kommentar, b: Kommentar): boolean {
    if (a.geaendert && b.geaendert && a.geaendert.getTime() !== b.geaendert.getTime()) {
        return a.geaendert.getTime() > b.geaendert.getTime();
    }
    return a.objNr > b.objNr;
}

/**
 * Der Status einer gespeicherten Anmerkung aus ihren Statusmarken, oder
 * `null`, wenn es keine gibt. Maßgeblich ist die neueste Marke (Etappe 8).
 */
export function fadenStatus(alle: readonly Kommentar[], id: string): FadenStatus | null {
    let juengste: Kommentar | null = null;
    for (const k of alle) {
        if (istStatusmarke(k) && k.antwortAuf === id && (!juengste || neuer(k, juengste))) juengste = k;
    }
    return juengste ? { zustand: alsZustand(juengste.status), autor: juengste.autor, datum: juengste.datum } : null;
}

/**
 * Ob eine gespeicherte Anmerkung im PDF als erledigt gilt — für den
 * Entwurf, der nur `completed` und `none` kennt; alles andere ist offen.
 */
export function gespeicherterStatus(alle: readonly Kommentar[], id: string): 'completed' | 'none' {
    return fadenStatus(alle, id)?.zustand === 'completed' ? 'completed' : 'none';
}

/** Die Gruppen des Art-Filters (Etappe 8): Notiz, Markierung, Zeichnung, Stempel, Post-it. */
export type ArtGruppe = 'notiz' | 'markierung' | 'zeichnung' | 'stempel' | 'postit';

/**
 * Welche Art (Anzeigename aus TYP bzw. ART_NAME) in welche Filtergruppe
 * fällt. Ein gespeichertes Post-it ist ein FreeText und erscheint als
 * Textfeld — nur ein Entwurf kennt es als Post-it.
 */
export const ART_GRUPPE: Record<string, ArtGruppe> = {
    notiz: 'notiz', textfeld: 'notiz', einfuegung: 'notiz', anhang: 'notiz',
    hervorhebung: 'markierung', unterstreichung: 'markierung', durchstreichung: 'markierung',
    zeichnung: 'zeichnung', linie: 'zeichnung', pfeil: 'zeichnung', rechteck: 'zeichnung', kreis: 'zeichnung', form: 'zeichnung',
    stempel: 'stempel',
    postit: 'postit',
};

/**
 * Kennungen aller gespeicherten Anmerkungen, die zu einem ERLEDIGTEN Faden
 * gehören — Wurzel, Antworten (auch mittelbare) und Statusmarken —, damit
 * die Leseansicht sie ausblenden kann. `status` ist der Entwurf dazu, der
 * den gespeicherten Stand überlagert.
 */
export function erledigteKennungen(alle: readonly Kommentar[], status: Readonly<Record<string, { state: 'completed' | 'none' }>>): string[] {
    const aus: string[] = [];
    for (const k of alle) {
        if (k.antwortAuf || istStatusmarke(k)) continue;
        const stand = status[k.id]?.state ?? gespeicherterStatus(alle, k.id);
        if (stand !== 'completed') continue;
        const faden = new Set<string>([k.id]);
        let gewachsen = true;
        while (gewachsen) {
            gewachsen = false;
            for (const a of alle) {
                if (a.antwortAuf && faden.has(a.antwortAuf) && !faden.has(a.id)) {
                    faden.add(a.id);
                    gewachsen = true;
                }
            }
        }
        aus.push(...faden);
    }
    return aus;
}

/** pdf.js AnnotationType eines Links. */
export const TYP_LINK = 2;

/** Ein gespeicherter Link (Etappe 9), wie pdf.js ihn liefert: Web-Adresse oder Ziel im Dokument. */
export interface LinkEintrag {
    /** pdf.js-Kennung (`12R`). */
    id: string;
    /** Quellseite ab 0. */
    page: number;
    rect: number[];
    url?: string;
    /** Ziel im Dokument (benannt oder als Array) — nur, ob es eines gibt, zählt hier. */
    dest?: unknown;
}

/** Rohform eines Links aus `page.getAnnotations()`. */
export interface RohLink extends RohAnmerkung {
    url?: string;
    unsafeUrl?: string;
    dest?: unknown;
}

/** Wandelt eine Anmerkung in einen Link um — oder `null`, wenn sie keiner ist. */
export function alsLink(a: RohLink, seite: number): LinkEintrag | null {
    if (a.annotationType !== TYP_LINK || !a.id || !a.rect || a.rect.length < 4) return null;
    const l: LinkEintrag = { id: a.id, page: seite - 1, rect: a.rect };
    if (a.url) l.url = a.url;
    else if (a.unsafeUrl) l.url = a.unsafeUrl;
    if (a.dest !== undefined && a.dest !== null) l.dest = a.dest;
    return l;
}

interface Dokument {
    numPages: number;
    getPage(n: number): Promise<{ getAnnotations(p?: { intent?: string }): Promise<readonly RohAnmerkung[]> }>;
}

/** Sammelt die gespeicherten Links aller Seiten (Etappe 9). */
export async function linksSammeln(dokument: Dokument, signal?: AbortSignal): Promise<LinkEintrag[]> {
    const alle: LinkEintrag[] = [];
    for (let n = 1; n <= dokument.numPages; n++) {
        if (signal?.aborted) throw new DOMException('abgebrochen', 'AbortError');
        const seite = await dokument.getPage(n);
        for (const a of await seite.getAnnotations({ intent: 'display' })) {
            const l = alsLink(a as RohLink, n);
            if (l) alle.push(l);
        }
    }
    return alle;
}

/**
 * Sammelt die Kommentare aller Seiten, Seite für Seite. Bei großen
 * Dokumenten meldet `fortschritt`, wie weit es ist; `signal` bricht ab,
 * wenn die Liste zugeht.
 */
export async function kommentareSammeln(
    dokument: Dokument,
    optionen: { signal?: AbortSignal; fortschritt?: (seite: number, gesamt: number) => void } = {},
): Promise<Kommentar[]> {
    const alle: Kommentar[] = [];
    for (let n = 1; n <= dokument.numPages; n++) {
        if (optionen.signal?.aborted) throw new DOMException('abgebrochen', 'AbortError');
        const seite = await dokument.getPage(n);
        for (const a of await seite.getAnnotations({ intent: 'display' })) {
            const k = alsKommentar(a, n);
            if (k) alle.push(k);
        }
        optionen.fortschritt?.(n, dokument.numPages);
    }
    return alle;
}

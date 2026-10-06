// SPDX-License-Identifier: Apache-2.0
//
// Wer bekommt die Tasten, wenn mehrere Werkzeugbands auf einer Seite stehen
// (Hauptfenster und Verfasser der Mail)? Genau eines: das aktive.
//
// Jedes Werkzeugband mit Tastenbuchstaben meldet sich hier an; am Fenster hängt
// dann EIN Satz Zuhörer (keydown/keyup in der Fangphase, blur), solange
// mindestens eines angemeldet ist. Aktiv ist das oberste sichtbare der
// Reihe. Nach oben rückt ein Werkzeugband, wenn es neu erscheint oder wenn der
// Fokus oder ein Zeigerdruck in seinen Bereich fällt — liegen Bereiche
// ineinander (der Verfasser im Hauptfenster), gewinnt der innerste.
//
// Ohne Tastenbuchstaben meldet sich ein Werkzeugband gar nicht an und hängt
// nichts ans Fenster.

export interface TastenTeilnehmer {
    /** Der Bereich, in dem Fokus oder Zeiger dieses Werkzeugband aktiv machen. */
    bereich: () => HTMLElement | null;
    /** Das Werkzeugband selbst — unsichtbar (`hidden`, `inert`, `aria-hidden`) zählt es nicht. */
    wurzel: () => HTMLElement | null;
    taste: (e: KeyboardEvent) => void;
    loslassen: (e: KeyboardEvent) => void;
    /** Fokus weg vom Fenster oder ein anderes Werkzeugband ist jetzt aktiv: Einblendung aus. */
    verlassen: () => void;
}

const reihe: TastenTeilnehmer[] = [];
let zuletztAktiv: TastenTeilnehmer | null = null;

function sichtbar(t: TastenTeilnehmer): boolean {
    const w = t.wurzel();
    return !!w && w.isConnected && !w.closest('[hidden], [inert], [aria-hidden="true"]');
}

/** Das Werkzeugband, das gerade die Tasten bekommt; `null`, wenn keines. */
export function aktiverTeilnehmer(): TastenTeilnehmer | null {
    for (let i = reihe.length - 1; i >= 0; i--) {
        if (sichtbar(reihe[i])) return reihe[i];
    }
    return null;
}

/** Ein Wechsel des aktiven Werkzeugbands blendet beim bisherigen die Buchstaben aus. */
function wechselMelden() {
    const jetzt = aktiverTeilnehmer();
    if (zuletztAktiv && zuletztAktiv !== jetzt && reihe.includes(zuletztAktiv)) zuletztAktiv.verlassen();
    zuletztAktiv = jetzt;
}

function nachOben(t: TastenTeilnehmer) {
    const i = reihe.indexOf(t);
    if (i < 0 || i === reihe.length - 1) return;
    reihe.splice(i, 1);
    reihe.push(t);
}

/** Fokus oder Zeiger: das Werkzeugband mit dem innersten Bereich um das Ziel rückt nach oben. */
function beiBeruehrung(e: Event) {
    const ziel = e.target;
    if (!(ziel instanceof Node)) return;
    let bester: TastenTeilnehmer | null = null;
    let besterBereich: HTMLElement | null = null;
    for (const t of reihe) {
        const b = t.bereich();
        if (!b || !b.contains(ziel)) continue;
        // Gleicher oder engerer Bereich: der spätere (schon weiter oben) bzw. der innere gewinnt.
        if (!besterBereich || besterBereich.contains(b)) {
            bester = t;
            besterBereich = b;
        }
    }
    if (bester) nachOben(bester);
    wechselMelden();
}

function beiTaste(e: KeyboardEvent) {
    wechselMelden();
    aktiverTeilnehmer()?.taste(e);
}

function beiLoslassen(e: KeyboardEvent) {
    aktiverTeilnehmer()?.loslassen(e);
}

function beiVerlassen() {
    for (const t of reihe) t.verlassen();
}

function zuhoeren(an: boolean) {
    if (an) {
        window.addEventListener('keydown', beiTaste, true);
        window.addEventListener('keyup', beiLoslassen, true);
        window.addEventListener('blur', beiVerlassen);
        document.addEventListener('focusin', beiBeruehrung, true);
        document.addEventListener('pointerdown', beiBeruehrung, true);
    } else {
        window.removeEventListener('keydown', beiTaste, true);
        window.removeEventListener('keyup', beiLoslassen, true);
        window.removeEventListener('blur', beiVerlassen);
        document.removeEventListener('focusin', beiBeruehrung, true);
        document.removeEventListener('pointerdown', beiBeruehrung, true);
    }
}

/** Anmelden; das neue Werkzeugband steht oben. Liefert die Abmeldung. */
export function tastenAnmelden(t: TastenTeilnehmer): () => void {
    if (!reihe.length) zuhoeren(true);
    reihe.push(t);
    wechselMelden();
    return () => {
        const i = reihe.indexOf(t);
        if (i >= 0) reihe.splice(i, 1);
        if (zuletztAktiv === t) zuletztAktiv = null;
        if (!reihe.length) zuhoeren(false);
        wechselMelden();
    };
}

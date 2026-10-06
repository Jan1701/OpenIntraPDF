// SPDX-License-Identifier: Apache-2.0
//
// Das gemeinsame Werkzeugband: OpenIntraPDF, als Nächstes der Mailclient.
// Schnittstelle: Werkzeugband (Werkzeugband.tsx), Darstellung (darstellung.ts),
// Typen (typen.ts), Tastenbuchstaben (tastenbuchstaben.ts).

export { Werkzeugband } from './Werkzeugband';
export type { WerkzeugbandProps } from './Werkzeugband';
export { useWerkzeugbandDarstellung, TELEFON_BREITE } from './darstellung';
export { tastenVergeben, idZuTaste } from './tastenbuchstaben';
// Ein Element des Bandes außerhalb der Gruppen -- im Schnellbereich, etwa
// der Teilungsknopf „Neuer Termin ▾“ des Kalenders (K1). Nur innerhalb des
// Werkzeugbands (Schnellbereich, `rechts`): Menüs hängen an seiner Steuerung.
export { Element as WerkzeugbandElementAnzeige } from './Knoepfe';
export type { TastenQuelle } from './tastenbuchstaben';
export type {
    WerkzeugbandBandform, WerkzeugbandDarstellung, WerkzeugbandDarstellungWert, WerkzeugbandElement, WerkzeugbandGruppe, WerkzeugbandKnopf,
    WerkzeugbandKontrollkaestchen, WerkzeugbandMenueEintrag, WerkzeugbandReiter,
} from './typen';

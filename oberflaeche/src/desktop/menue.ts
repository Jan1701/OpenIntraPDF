// SPDX-License-Identifier: Apache-2.0
//
// Texte des nativen Menüs in der Sprache der App (06.10.2026).
//
// Jan: „das menue sollte in der systemsprache sein“. Die Sprache wählt
// sprache.ts nach dem System; die Texte stehen unter
// openintrapdf.desktop.menue.* in allen 26 Katalogen. Die Go-Seite
// (menue.go, MenueSprache) baut damit das Menü neu und benennt die
// englischen Standardmenüs von Wails um (rollen_darwin.go). Die Schlüssel
// hier sind die Schlüssel dort.

import type { TFunction } from 'i18next';

const APP = 'OpenIntraPDF';

/** Schlüssel unter openintrapdf.desktop.menue, die die Go-Seite kennt. */
export const MENUE_SCHLUESSEL = [
    'ueber', 'ausblenden', 'andereAusblenden', 'alleEinblenden', 'beenden',
    'ablage', 'datei', 'oeffnen', 'sichern', 'kopie', 'drucken', 'schliessen',
    'bearbeiten', 'widerrufen', 'wiederholen', 'ausschneiden', 'kopieren', 'einsetzen', 'einsetzenStil',
    'loeschen', 'allesAuswaehlen', 'sprachausgabe', 'sprechenStarten', 'sprechenStoppen',
    'fenster', 'dock', 'zoomen', 'vollbild',
    'hilfe', 'lizenzen', 'web',
] as const;

export interface Fassung {
    fassung?: string;
    bau?: string;
    urheber?: string;
}

/** Text des Info-Fensters: Beschreibung, Fassung, Urheber, Lizenz. */
export function ueberText(t: TFunction, f: Fassung): string {
    const weg = `${t('openintrapdf.desktop.menue.hilfe')} → ${t('openintrapdf.desktop.menue.lizenzen')}`;
    return [
        t('openintrapdf.desktop.ueber.text'),
        '',
        t('openintrapdf.desktop.ueber.fassung', { version: f.fassung ?? '', bau: f.bau || '–' }),
        f.urheber ?? '',
        '',
        t('openintrapdf.desktop.ueber.lizenz', { weg }),
    ].join('\n');
}

/** Alle Menütexte für MenueSprache, fertig eingesetzt. */
export function menueTexte(t: TFunction, f: Fassung): Record<string, string> {
    const texte: Record<string, string> = {};
    for (const k of MENUE_SCHLUESSEL) texte[k] = t(`openintrapdf.desktop.menue.${k}`, { app: APP });
    texte.ueberText = ueberText(t, f);
    return texte;
}

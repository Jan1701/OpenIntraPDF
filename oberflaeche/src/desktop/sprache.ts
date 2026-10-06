// SPDX-License-Identifier: Apache-2.0
//
// Sprache der App = Systemsprache, Rückfall Deutsch (Vertrag Etappe 6).
// Die Kataloge kommen aus src/locales; der Bau (vite.desktop.config.ts)
// dampft sie auf die Zweige `openintrapdf`, `werkzeugband` und `fehler` ein, und geladen
// wird nur die Sprache des Systems (dazu Deutsch als Rückfall).

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

type Katalog = Record<string, unknown>;

const kataloge = import.meta.glob<{ default: Katalog }>('../locales/*/translation.json');

/** Zwei-Buchstaben-Code, für den es einen Katalog gibt; sonst `null`. */
export function katalogSprache(sprachen: readonly string[], vorhanden: readonly string[]): string | null {
    for (const s of sprachen) {
        const code = s.toLowerCase().split(/[-_]/)[0];
        if (vorhanden.includes(code)) return code;
    }
    return null;
}

function katalogPfad(code: string): string {
    return `../locales/${code}/translation.json`;
}

export async function spracheEinrichten(): Promise<string> {
    const vorhanden = Object.keys(kataloge).map(p => p.split('/').at(-2) ?? '').filter(Boolean);
    const code = katalogSprache(navigator.languages ?? [navigator.language], vorhanden) ?? 'de';
    const laden = async (c: string): Promise<Katalog> => {
        const l = kataloge[katalogPfad(c)];
        return l ? (await l()).default : {};
    };
    const [de, eigene] = await Promise.all([laden('de'), code === 'de' ? Promise.resolve(null) : laden(code)]);
    const resources: Record<string, { translation: Katalog }> = { de: { translation: de } };
    if (eigene) resources[code] = { translation: eigene };
    await i18n.use(initReactI18next).init({
        lng: code,
        fallbackLng: 'de',
        resources,
        interpolation: { escapeValue: false },
    });
    document.documentElement.lang = code;
    return code;
}

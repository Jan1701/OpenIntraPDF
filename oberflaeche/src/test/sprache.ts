// SPDX-License-Identifier: Apache-2.0
//
// i18next für Oberflächentests mit dem ECHTEN deutschen Katalog.
//
// Kein nachgebautes t(): So fällt ein Schlüssel, der im Katalog fehlt, im
// Test auf (der Text erscheint dann als roher Schlüssel), und Mehrzahlformen
// (_one/_other) werden so aufgelöst wie im Betrieb.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from '../locales/de/translation.json';

let bereit: Promise<unknown> | null = null;

export function spracheDeutsch(): Promise<unknown> {
    bereit ??= i18next.use(initReactI18next).init({
        lng: 'de',
        fallbackLng: 'de',
        resources: { de: { translation: de } },
        interpolation: { escapeValue: false },
    });
    return bereit;
}

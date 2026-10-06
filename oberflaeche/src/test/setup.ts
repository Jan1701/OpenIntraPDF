import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Grenzen fuer den geteilten CI-Laeufer. Dort laufen alle Testdateien
// parallel neben Backend- und Rust-Jobs; mehrstufige Ablaeufe (PDF-
// Arbeitsplatz: 61 s je Datei) rissen am 02.10.2026 zweimal die Vorgaben --
// 5 s je Test und 1 s fuer findBy/waitFor. Das ist eine Grenze, kein
// Fehlerbild; ein echter Fehler scheitert weiterhin, nur spaeter.
// testTimeout steht in vite.config.ts.
configure({ asyncUtilTimeout: 3000 });

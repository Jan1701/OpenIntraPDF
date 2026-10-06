// SPDX-License-Identifier: Apache-2.0
//
// Vite-Konfiguration fuer OpenIntraPDF auf dem Schreibtisch (Vertrag
// Etappe 6): Einstieg desktop.html, Ausgabe nach
// clients/openintrapdf-desktop/frontend/dist, von wo Wails sie einbettet.
//
// Benutzt werden src/openintrapdf, das gemeinsame Werkzeugband
// (src/components/shared/werkzeugband), die vorhandenen node_modules und die
// Kataloge aus src/locales — nur die Zweige, die der Arbeitsplatz braucht
// (openintrapdf, werkzeugband, fehler); alles andere von OpenIntraHub bleibt draussen.
//
//   npx vite build --config vite.desktop.config.ts

import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

/**
 * Wails erwartet index.html; Vite benennt die Ausgabe nach dem Einstieg.
 * Umbenannt wird auf der Platte, nachdem alles geschrieben ist — Vites
 * eigene HTML-Ausgabe kommt erst nach den Plugins in das Buendel.
 */
function alsIndex(ausgabe: string): Plugin {
    return {
        name: 'openintrapdf-desktop-index',
        closeBundle() {
            const von = path.join(ausgabe, 'desktop.html');
            if (fs.existsSync(von)) fs.renameSync(von, path.join(ausgabe, 'index.html'));
            // emptyOutDir nimmt auch die .gitkeep mit; der Ordner muss im Repo
            // bleiben, sonst scheitert go:embed im frischen Klon.
            fs.writeFileSync(path.join(ausgabe, '.gitkeep'), '');
        },
    };
}

/** Sprachkataloge auf die Zweige des Arbeitsplatzes eindampfen (26 Sprachen). */
function katalogeEindampfen(): Plugin {
    const zweige = ['openintrapdf', 'werkzeugband', 'fehler'];
    return {
        name: 'openintrapdf-desktop-kataloge',
        enforce: 'pre',
        transform(code, id) {
            if (!/[\\/]src[\\/]locales[\\/][a-z]{2}[\\/]translation\.json$/.test(id)) return null;
            const alles = JSON.parse(code) as Record<string, unknown>;
            const rest: Record<string, unknown> = {};
            for (const z of zweige) if (z in alles) rest[z] = alles[z];
            return { code: JSON.stringify(rest), map: null };
        },
    };
}

/**
 * Welche npm-Pakete wirklich in der App stecken (06.10.2026, Lizenzdialog).
 *
 * Gezaehlt wird, was nach dem Baumschuetteln Code im Buendel hat
 * (renderedLength > 0). Die Liste geht nach build/js-pakete.json; das
 * Werkzeug lizenzverzeichnis legt daraus die Lizenztexte in die App.
 */
function drittanbieterListe(ziel: string): Plugin {
    return {
        name: 'openintrapdf-desktop-drittanbieter',
        generateBundle(_optionen, buendel) {
            const pakete = new Map<string, { name: string; version: string; license: string; dir: string }>();
            for (const teil of Object.values(buendel)) {
                if (teil.type !== 'chunk') continue;
                for (const [roheId, modul] of Object.entries(teil.modules)) {
                    if (!modul.renderedLength) continue;
                    // Hilfsmodule der Plugins tragen \0 vorn und ?… hinten.
                    const id = roheId.replace(/^\0/, '').replace(/\?.*$/, '');
                    // Letztes node_modules/<paket> bzw. node_modules/@scope/<paket>
                    const treffer = [...id.matchAll(/[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g)].at(-1);
                    if (!treffer || treffer.index === undefined) continue;
                    const dir = id.slice(0, treffer.index + treffer[0].length);
                    if (pakete.has(dir)) continue;
                    try {
                        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string; license?: unknown };
                        pakete.set(dir, {
                            name: pj.name ?? treffer[1].replace(/\\/g, '/'),
                            version: pj.version ?? '',
                            license: typeof pj.license === 'string' ? pj.license : '',
                            dir,
                        });
                    } catch {
                        // Ohne package.json kein Eintrag; das Werkzeug meldet fehlende Texte.
                    }
                }
            }
            const liste = [...pakete.values()].sort((a, b) => a.name.localeCompare(b.name));
            fs.mkdirSync(path.dirname(ziel), { recursive: true });
            fs.writeFileSync(ziel, JSON.stringify(liste, null, 1));
        },
    };
}

/**
 * Menütexte aller Sprachen für die Go-Seite (06.10.2026).
 *
 * Unter Linux kann Wails v2 das Menü nach dem Start nicht mehr tauschen (die
 * neue GTK-Leiste wird nie ins Fenster gehängt). Die Go-Seite baut es deshalb
 * gleich beim Start in der Systemsprache und liest die Texte aus dieser Datei
 * im eingebetteten Bündel (sprache.go). Quelle bleibt src/locales.
 */
function menueTexte(): Plugin {
    return {
        name: 'openintrapdf-desktop-menuetexte',
        generateBundle() {
            const ordner = path.resolve(__dirname, 'src/locales');
            const alle: Record<string, unknown> = {};
            for (const code of fs.readdirSync(ordner).sort()) {
                const datei = path.join(ordner, code, 'translation.json');
                if (!/^[a-z]{2}$/.test(code) || !fs.existsSync(datei)) continue;
                const k = JSON.parse(fs.readFileSync(datei, 'utf8')) as { openintrapdf?: { desktop?: { menue?: unknown; ueber?: unknown } } };
                const d = k.openintrapdf?.desktop;
                if (d?.menue) alle[code] = { menue: d.menue, ueber: d.ueber ?? {} };
            }
            this.emitFile({ type: 'asset', fileName: 'menue-texte.json', source: JSON.stringify(alle) });
        },
    };
}

const ausgabe = path.resolve(__dirname, '../frontend/dist');
const jsPakete = path.resolve(__dirname, '../build/js-pakete.json');

export default defineConfig({
    root: '.',
    // Relative Pfade: Die App laedt ihre Dateien ueber wails://, nicht von /.
    base: './',
    // Nichts aus public/ (Flaggen, Schriften, Kataloge von OpenIntraHub):
    // Die App braucht davon nichts, und 24 MB waeren sonst dabei.
    publicDir: false,
    plugins: [react(), alsIndex(ausgabe), katalogeEindampfen(), drittanbieterListe(jsPakete), menueTexte()],
    css: {
        postcss: {
            plugins: [
                tailwindcss({
                    darkMode: ['class'],
                    content: ['./desktop.html', './src/desktop/**/*.{ts,tsx}', './src/openintrapdf/**/*.{ts,tsx}', './src/components/shared/werkzeugband/**/*.{ts,tsx}'],
                }),
                autoprefixer(),
            ],
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify('desktop'),
        __APP_BAU__: JSON.stringify('0'),
    },
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    build: {
        outDir: ausgabe,
        emptyOutDir: true,
        target: 'es2020',
        // Kein terser noetig; esbuild reicht und ist schneller.
        minify: 'esbuild',
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            input: path.resolve(__dirname, 'desktop.html'),
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/pdfjs-dist/web/')) return 'vendor-pdf-viewer';
                    if (id.includes('node_modules/pdfjs-dist')) return 'vendor-pdf';
                    if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')
                        || id.includes('/node_modules/scheduler/')) return 'vendor-react';
                    return undefined;
                },
            },
        },
    },
});

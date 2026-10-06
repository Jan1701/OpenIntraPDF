// SPDX-License-Identifier: Apache-2.0
//
// Einstieg von OpenIntraPDF auf dem Schreibtisch (desktop.html). Erst die
// Sprache (Systemsprache, Rückfall Deutsch), dann die App mit der Brücke
// zur Go-Seite.

import React from 'react';
import ReactDOM from 'react-dom/client';
import './desktop.css';
import { App } from './App';
import { bruecke, ereignis } from './bruecke';
import { spracheEinrichten } from './sprache';

const wurzel = document.getElementById('root');
if (!wurzel) throw new Error('kein #root');

spracheEinrichten().then(() => {
    let b;
    try {
        b = bruecke();
    } catch {
        wurzel.textContent = 'OpenIntraPDF: Die Verbindung zur App fehlt. Bitte OpenIntraPDF neu starten.';
        return;
    }
    ReactDOM.createRoot(wurzel).render(
        <React.StrictMode>
            <App bruecke={b} ereignis={ereignis} />
        </React.StrictMode>,
    );
});

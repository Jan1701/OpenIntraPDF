// SPDX-License-Identifier: Apache-2.0
//
// Ein Dialog innerhalb des Arbeitsplatzes.
//
// Er liegt über dem Arbeitsplatz, nicht über ganz OIH, und hält den Fokus
// bei sich (Tab läuft im Kreis). Esc behandelt der Arbeitsplatz selbst —
// dort steht die Reihenfolge „erst Dialog, dann Werkzeug, dann Fenster“.
// Beim Schließen kehrt der Fokus dorthin zurück, wo er vorher war.

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface Props {
    titel: string;
    children: ReactNode;
    aktionen: ReactNode;
    onAbbrechen: () => void;
    breit?: boolean;
}

const FOKUSSIERBAR = 'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

export function Dialog({ titel, children, aktionen, onAbbrechen, breit = false }: Props) {
    const id = useId();
    const rahmen = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const vorher = document.activeElement as HTMLElement | null;
        const el = rahmen.current;
        const erstes = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOKUSSIERBAR);
        erstes?.focus();
        return () => {
            if (vorher && document.contains(vorher)) vorher.focus();
        };
    }, []);

    const imKreis = (e: KeyboardEvent) => {
        if (e.key !== 'Tab' || !rahmen.current) return;
        const alle = Array.from(rahmen.current.querySelectorAll<HTMLElement>(FOKUSSIERBAR));
        if (!alle.length) return;
        const erstes = alle[0];
        const letztes = alle[alle.length - 1];
        if (e.shiftKey && document.activeElement === erstes) {
            e.preventDefault();
            letztes.focus();
        } else if (!e.shiftKey && document.activeElement === letztes) {
            e.preventDefault();
            erstes.focus();
        }
    };

    return (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-4"
            onMouseDown={e => { if (e.target === e.currentTarget) onAbbrechen(); }}>
            <div ref={rahmen} role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={imKreis}
                className={`w-full ${breit ? 'max-w-2xl' : 'max-w-lg'} max-h-full overflow-auto rounded-xl border border-[var(--opdf-linie)] bg-[var(--opdf-paneel)] text-[var(--opdf-text)] shadow-2xl`}>
                <h2 id={id} className="px-5 pt-5 text-base font-semibold">{titel}</h2>
                <div className="px-5 py-3 text-sm leading-relaxed">{children}</div>
                <div className="px-5 pb-5 flex flex-wrap justify-end gap-2">{aktionen}</div>
            </div>
        </div>
    );
}

// SPDX-License-Identifier: Apache-2.0
//
// Der eingeblendete Tastenbuchstabe an einem Reiter, Knopf oder Menüeintrag.

import type { ReactNode } from 'react';

export function Tipp({ children }: { children: ReactNode }) {
    return (
        <kbd aria-hidden className="absolute -top-1 -left-1 z-10 rounded border border-[var(--rb-linie)] bg-[var(--rb-text)] px-1 font-sans text-[10px] font-bold leading-4 text-[var(--rb-paneel)] shadow-sm">
            {children}
        </kbd>
    );
}

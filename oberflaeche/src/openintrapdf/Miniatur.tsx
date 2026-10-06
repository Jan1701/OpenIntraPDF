// SPDX-License-Identifier: Apache-2.0
//
// Ein Seitenbild, das sich erst zeichnet, wenn es ins Bild rückt.

import { useEffect, useRef, useState } from 'react';
import type { MiniaturBild, MiniaturDienst } from './miniaturen';

interface Props {
    dienst: MiniaturDienst | null;
    quelle: number;
    drehung: number;
    /** Für Screenreader; die Miniatur ist sonst reine Dekoration. */
    alt?: string;
    className?: string;
}

// Seitenverhältnis A4 hochkant als Platzhalter, bis das echte Bild da ist.
const PLATZHALTER = 1.414;

export function Miniatur({ dienst, quelle, drehung, alt = '', className = '' }: Props) {
    const rahmen = useRef<HTMLDivElement>(null);
    const schluessel = `${quelle}:${drehung}`;
    const [geladen, setGeladen] = useState<{ schluessel: string; bild: MiniaturBild } | null>(() => {
        const b = dienst?.vorhanden(quelle, drehung);
        return b ? { schluessel, bild: b } : null;
    });
    const [imBild, setImBild] = useState(false);

    // Sichtbarkeit beobachten. Ohne IntersectionObserver (alte Umgebung,
    // Testumgebung) gilt jede Miniatur als sichtbar.
    useEffect(() => {
        const el = rahmen.current;
        if (!el) return;
        if (typeof IntersectionObserver === 'undefined') {
            setImBild(true);
            return;
        }
        const beobachter = new IntersectionObserver(
            eintraege => setImBild(eintraege.some(e => e.isIntersecting)),
            { rootMargin: '300px 0px' },
        );
        beobachter.observe(el);
        return () => beobachter.disconnect();
    }, []);

    useEffect(() => {
        if (!dienst || geladen?.schluessel === schluessel) return;
        const schon = dienst.vorhanden(quelle, drehung);
        if (schon) {
            setGeladen({ schluessel, bild: schon });
            return;
        }
        if (!imBild) return;
        const abbruch = new AbortController();
        dienst.holen(quelle, drehung, abbruch.signal).then(
            bild => { if (!abbruch.signal.aborted) setGeladen({ schluessel, bild }); },
            () => { /* abgebrochen oder nicht darstellbar: Platzhalter bleibt */ },
        );
        return () => abbruch.abort();
    }, [dienst, quelle, drehung, schluessel, imBild, geladen?.schluessel]);

    const bild = geladen?.schluessel === schluessel ? geladen.bild : null;
    const quer = drehung === 90 || drehung === 270;
    return (
        <div ref={rahmen} className={`bg-white ${className}`}
            style={bild ? undefined : { aspectRatio: quer ? `${PLATZHALTER} / 1` : `1 / ${PLATZHALTER}` }}>
            {bild && (
                <img src={bild.adresse} alt={alt} width={bild.breite} height={bild.hoehe}
                    className="block w-full h-auto select-none" draggable={false} />
            )}
        </div>
    );
}

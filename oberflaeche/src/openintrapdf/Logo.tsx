// SPDX-License-Identifier: Apache-2.0
//
// Das Zeichen von OpenIntraPDF: das rote Dokument aus
// ~/Desktop/Projekte/OpenIntra-Logos/openintrapdf/openintrapdf-zeichen.svg
// (Quelle dort, `quelle/logos.py`). Eingebettet statt als Datei, damit das
// Paket es auch ohne OIH-Auslieferung mitbringt (Desktop-App). Die
// Kennungen tragen ein Praefix: Eingebettete SVGs teilen sich die Seite,
// und ein zweites "za" irgendwo wuerde den Verlauf kapern.

export function OpenintraPdfZeichen({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="76 26 370 460" className={className} aria-hidden focusable="false">
            <defs>
                <linearGradient id="opdf-logo-za" x1="0" y1="0" x2="0.25" y2="1">
                    <stop offset="0" stopColor="#E0302B" />
                    <stop offset="1" stopColor="#B8141B" />
                </linearGradient>
                <linearGradient id="opdf-logo-zb" x1="0" y1="0" x2="0.25" y2="1">
                    <stop offset="0" stopColor="#C81E22" />
                    <stop offset="1" stopColor="#A80F16" />
                </linearGradient>
                <linearGradient id="opdf-logo-zc" x1="0" y1="0" x2="0.25" y2="1">
                    <stop offset="0" stopColor="#FF6B5E" />
                    <stop offset="1" stopColor="#EE3F37" />
                </linearGradient>
                <linearGradient id="opdf-logo-zd" x1="0" y1="0" x2="0.25" y2="1">
                    <stop offset="0" stopColor="#FFB3AA" />
                    <stop offset="1" stopColor="#FF8577" />
                </linearGradient>
                <clipPath id="opdf-logo-zk">
                    <path d="M135.6,46 L327,46 L426,145 L426,426.4 Q426,466 386.4,466 L135.6,466 Q96,466 96,426.4 L96,85.6 Q96,46 135.6,46 Z" fillRule="evenodd" clipRule="evenodd" />
                </clipPath>
                <mask id="opdf-logo-zm" maskUnits="userSpaceOnUse" x="76" y="26" width="370" height="460">
                    <rect x="76" y="26" width="370" height="460" fill="white" />
                    <line x1="241.2" y1="298" x2="391.35" y2="110.35" stroke="black" strokeWidth="20" strokeLinecap="round" />
                    <line x1="241.2" y1="298" x2="91" y2="243.4" stroke="black" strokeWidth="20" strokeLinecap="round" />
                    <line x1="241.2" y1="298" x2="294" y2="471" stroke="black" strokeWidth="20" strokeLinecap="round" />
                </mask>
            </defs>
            <g mask="url(#opdf-logo-zm)">
                <g clipPath="url(#opdf-logo-zk)">
                    <path d="M241.2,298 L91,243.4 L91,41 L391.35,41 L391.35,110.35 Z" fill="url(#opdf-logo-za)" />
                    <path d="M241.2,298 L294,471 L91,471 L91,243.4 Z" fill="url(#opdf-logo-zb)" />
                    <path d="M241.2,298 L391.35,110.35 L431,110.35 L431,471 L294,471 Z" fill="url(#opdf-logo-zc)" />
                </g>
                <path d="M345,49.6 L422.4,127 L345,127 Z" fill="url(#opdf-logo-zd)" />
            </g>
        </svg>
    );
}

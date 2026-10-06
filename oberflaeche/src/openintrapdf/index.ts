// SPDX-License-Identifier: Apache-2.0
//
// OpenIntraPDF — gemeinsame Oberfläche. Kennt keine OIH-Bausteine; ein
// Gastgeber (Drive, Wiki, später das Desktop-Programm) bindet sie über
// `PdfHost` ein.

export { PdfArbeitsplatz } from './PdfArbeitsplatz';
export type { PdfArbeitsplatzProps } from './PdfArbeitsplatz';
export { PdfHostFehler, alsHostFehler } from './typen';
export type {
    AnalyseBefehl, AnmerkungAendern, AnmerkungHinzu, AnmerkungLoeschen, AnmerkungsArt, AnmerkungsBefehle, AnmerkungStatus,
    BindeBefehl, BindeErgebnis, BindeQuelle, CommitBefehl, CommitErgebnis, CommitSeite, CommitZiel, DateiWahl, ErhaltungsBericht,
    ExportBefehl, ExportErgebnis, ExportFormat, ExtraktBefehl, ExtraktErgebnis, PdfFaehigkeit, PdfHost, PdfInfo, PdfInspektion,
    PdfLadung, PdfRechteck, PdfZiel, PdfZugriff, SpaltenTyp, ZielAnfrage, ZielZweck,
} from './typen';
export { dateiAnbieten, pdfDrucken } from './hilfen';

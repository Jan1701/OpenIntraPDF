// SPDX-License-Identifier: Apache-2.0

// Package export baut aus den Woertern eines PDFs ein Dokumentmodell und
// schreibt es als DOCX, ODT, XLSX oder CSV (OpenIntraPDF Etappe 4, Konzept
// Kap. 05: „Gemeinsames Zwischenmodell fuer Exporte“).
//
// Das Paket kennt weder Drive noch den Texterkennungsdienst: Es bekommt
// Woerter mit Lage (Seitenwoerter) und liefert Bytes. Der Gastgeber
// (drive/pdf_export.go) besorgt die Woerter — aus der Textebene oder aus
// der Erkennung — und legt das Ergebnis ab.
//
// # Zwei Schritte
//
//  1. Erkennen macht aus Woertern Absaetze, Ueberschriften, Listen und
//     Tabellen. Die Heuristiken sind einfach, versioniert
//     (Heuristikfassung) und nachvollziehbar; was unsicher ist, steht als
//     Warnung im Modell, nicht im Ergebnis versteckt.
//  2. DOCX, ODT, XLSX und CSV schreiben das Modell. Werte werden nie
//     still umgewandelt: Text bleibt Text, bis die Person eine Spalte als
//     Zahl oder Datum waehlt — und auch dann bleibt, was nicht eindeutig
//     ist, als Text stehen und wird gemeldet.
//
// Nicht in dieser Etappe: Bilder, Formeln, „Layout aehnlich“, ODS.
package export

// Heuristikfassung zaehlt bei jeder Aenderung an der Erkennung hoch. Sie
// steht im Modell, damit ein alter Auftrag als alt erkennbar ist.
const Heuristikfassung = 1

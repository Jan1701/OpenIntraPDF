// SPDX-License-Identifier: Apache-2.0

// Package korpus erzeugt synthetische Test-PDFs fuer OpenIntraPDF.
//
// Alles hier ist erfunden: „Musterfirma GmbH“, „Rechnung 00123“, „Erika
// Musterfrau“. Es gibt keine echten Dokumente im Korpus und keine, die aus
// echten abgeleitet waeren (Vertrag Etappe 1: „Synthetische Daten“).
//
// Jede Datei deckt einen Fall aus dem Erhaltungsvertrag ab (Konzept Kap.
// 04): Anmerkungen verschiedener Arten, Formularfelder, Anhaenge,
// Lesezeichen, Signaturfeld, Verschluesselung, JavaScript, Struktur,
// PDF/A-Kennzeichnung, vererbte Seitenattribute. Die Tests des Adapters
// (openintrapdf/dokument) benutzen ihn; cmd/pdfkorpus schreibt ihn in ein
// Verzeichnis, damit man die Dateien in Acrobat, Foxit oder der Vorschau
// von Hand pruefen kann.
//
// Jede Seite traegt im Inhalt die Marke "SEITE-NN" (Marke). Daran erkennt
// ein Test nach dem Umsortieren, welche Quellseite wo steht.
package korpus

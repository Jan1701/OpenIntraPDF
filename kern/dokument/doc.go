// SPDX-License-Identifier: Apache-2.0

// Package dokument ist der schmale Adapter von OpenIntraPDF auf pdfcpu:
// Dokumente pruefen (Inspizieren), Seiten neu ordnen, drehen, entfernen und
// verdoppeln (SeitenplanBauen, Extrahieren), Dokumente binden (Binden),
// Anmerkungen anlegen, aendern, bewerten und loeschen (AnmerkungenAnwenden,
// zusammen mit dem Seitenplan: CommitBauen) — und nach jedem Schreiben
// ehrlich sagen, was erhalten blieb (Erhaltungsbericht).
//
// Anmerkungen schreibt der Adapter selbst ins Objektmodell, mit eigenem
// Erscheinungsbild je Art (anmerkungen.go): pdfcpus Anmerkungsfunktionen
// erzeugen keine Erscheinungsbilder, und ohne sie zeichnet jedes Programm
// etwas anderes.
//
// # Grenzen des Pakets
//
// Es importiert nichts aus openintrahub.org/oih/core oder .../module. Wer
// es benutzt — heute Drive, spaeter der Desktop-Gastgeber —, reicht Bytes
// herein und bekommt Bytes und einen Bericht zurueck. Keine Pfade, keine
// Shell, keine Datenbank. Die Konfiguration von pdfcpu ist zustandslos:
// kein Konfigurationsordner, kein Netz (pdfcpu kann sonst fuer
// Zertifikatspruefungen nach draussen gehen).
//
// # Warum der Seitenplan nicht api.Collect benutzt
//
// pdfcpu baut beim Umsortieren (api.Collect, api.RemovePages — beide ueber
// pdfcpu.ExtractPages) ein NEUES Dokument und kopiert die Seiten hinein.
// Mit kommen: Seiten, ihre Anmerkungen, die Formularfelder der Seiten und
// benannte Ziele. Nicht mit kommen: Lesezeichen, eingebettete Dateien
// (EmbeddedFiles — die maschinenlesbare E-Rechnung!), XMP-Metadaten,
// Strukturbaum, Sprache, Seitenbeschriftungen. Belegt in
// TestPdfcpuCollectVerliertKatalog. Das widerspraeche dem
// Erhaltungsvertrag (Konzept Kap. 04).
//
// Der Seitenplan arbeitet deshalb am geoeffneten Dokument selbst: Der
// Seitenbaum wird flach neu gesetzt, vererbte Seitenattribute werden in
// die Seiten geschrieben, Verdopplungen bekommen eigene Seiten- und
// Anmerkungsobjekte. Der Katalog bleibt, wie er ist. Was auf entfernte
// Seiten zeigt (Lesezeichen, Links, benannte Ziele, Formularfelder,
// Strukturverweise), wird gezielt abgeraeumt — sonst schriebe pdfcpu eine
// entfernte Seite ueber so einen Verweis doch wieder in die Datei, samt
// Inhalt.
//
// Beim Binden benutzt der Adapter pdfcpu.MergeXRefTables: Es fuehrt
// Formulare, Namensbaeume und Lesezeichen zusammen. Zwei Luecken schliesst
// der Adapter selbst (siehe binden.go): gleichnamige Anhaenge (pdfcpu
// verwirft den zweiten still) und die Pruefung, dass gleichnamige
// Formularfelder nicht verschmolzen sind.
package dokument

<p align="center">
  <img src="logo/openintrapdf-auf-dunkelblau.svg" alt="OpenIntraPDF" width="160">
</p>

<h1 align="center">OpenIntraPDF</h1>

<p align="center">
  PDF lesen, Seiten ordnen, kommentieren, Text erkennen, exportieren und binden –<br>
  auf dem eigenen Rechner, ohne Server, ohne Konto, ohne Netz.
</p>

<p align="center">
  <a href="LICENSE">Apache-2.0</a> · macOS · Linux (deb, rpm, Arch) · Windows in Arbeit
</p>

---

OpenIntraPDF ist die Desktop-Fassung des PDF-Arbeitsplatzes aus
[OpenIntraHub](https://openintrahub.org), einem Intranet für Unternehmen. Dort
bearbeitet man PDFs direkt im Drive; hier dieselbe Oberfläche als eigenständige
App für Mac und Linux. Die Dateien bleiben auf dem Rechner, die Texterkennung
läuft lokal.

## Was die App kann

- **Lesen** – Miniaturen, Lesezeichen, Suche, Zoom, helle und dunkle Darstellung
- **Seiten ordnen** – drehen, löschen, verschieben, kopieren und einfügen, Seiten aus anderen Dateien übernehmen
- **Kommentieren** – Markierungen, Notizen, Post-its und Stempel, Kommentarliste mit Filter
- **Text erkennen** – gescannte Seiten durchsuchbar machen (Tesseract, Deutsch und Englisch)
- **Exportieren** – Inhalte nach Word (DOCX), OpenDocument (ODT), Excel (XLSX) und CSV
- **Binden** – mehrere PDFs zu einer Datei zusammenführen
- **Schützen** – Kennwortschutz (AES-256) und Rechte geschützter Dateien beachten
- **Eigenschaften** – Titel, Autor, Stichwörter bearbeiten
- **Drucken** – mit Seitenbereich, wahlweise ohne Anmerkungen

Bedient wird alles über ein Werkzeugband mit Reitern. Menüs und Oberfläche
erscheinen in der Sprache des Systems; 26 Sprachen sind enthalten.

## Installieren

Fertige Pakete folgen unter [Releases](../../releases). Bis dahin lässt sich die
App aus dem Quelltext bauen (siehe unten).

| System | Paket | Texterkennung | geprüft mit |
|---|---|---|---|
| macOS (Apple Silicon) | `OpenIntraPDF.app` | mitgeliefert | macOS 27 |
| Debian, Ubuntu, OpenIntraOS | `.deb` | aus der Distribution (`tesseract-ocr`) | Debian 13, Ubuntu 24.04 |
| Fedora | `.rpm` | aus der Distribution (`tesseract`) | aktuelle Fedora |
| Arch Linux | `.pkg.tar.zst` | aus der Distribution (`tesseract`) | aktueller Stand |

Das Linux-Programm braucht glibc 2.34 oder neuer und WebKitGTK 4.1. Gedruckt
wird über den Druckdialog von KDE (Okular, empfohlen).

## Selbst bauen

Aufbau des Repositorys:

```
/            die App (Go, Wails v2) – Fenster, Menü, Dateien, Drucken, Texterkennung
kern/        der PDF-Kern (Go): Dokument lesen und schreiben, Export, Erkennung
oberflaeche/ die Oberfläche (React, TypeScript, pdf.js)
logo/        Programmsymbol
```

**macOS** – Go 1.27, Xcode, [Wails v2](https://wails.io) CLI, Node.js 22,
Homebrew mit `tesseract` und `librsvg`:

```sh
cd oberflaeche && npm ci && cd ..
./bauen.sh            # → build/bin/OpenIntraPDF.app
```

Das Skript baut die Oberfläche, packt Tesseract samt Bibliotheken und
Sprachdaten in die App, legt alle Lizenztexte bei und signiert ad hoc.

**Linux** – gebaut wird in einem Container `golang:1.27-trixie` auf einem Rechner
mit Docker; heraus kommen .deb, .rpm und das Arch-Paket (mit
[nfpm](https://nfpm.goreleaser.com)):

```sh
cd oberflaeche && npm ci && cd ..
OPENINTRAPDF_BAUSERVER=root@mein-docker-host ./bauen-linux.sh --pruefen
```

`--pruefen` installiert die drei Pakete danach probeweise in Debian-, Ubuntu-,
Fedora- und Arch-Containern.

**Tests**

```sh
go test ./... && (cd oberflaeche && npm test)
```

## Lizenz

OpenIntraPDF © 2026 Jan Günther, veröffentlicht unter der
[Apache-Lizenz 2.0](LICENSE).

Die App enthält Programme, Bibliotheken und Schriften anderer Autorinnen und
Autoren, unter anderem [Wails](https://wails.io), [pdfcpu](https://pdfcpu.io),
[pdf.js](https://mozilla.github.io/pdf.js/), [React](https://react.dev),
[i18next](https://www.i18next.com), [Lucide](https://lucide.dev),
[excelize](https://xuri.me/excelize/), [Tesseract](https://github.com/tesseract-ocr/tesseract)
mit Leptonica und die Schrift [Noto Sans](https://fonts.google.com/noto). Die
vollständige Liste mit allen Lizenztexten zeigt die App unter
**Hilfe → Lizenzen**; sie entsteht bei jedem Bau neu (`lizenzverzeichnis/`).

Name und Logo „OpenIntraPDF“ und „OpenIntraHub“ sind von der Lizenz nicht
umfasst (Apache-2.0, Abschnitt 6).

---

## English

OpenIntraPDF is a desktop PDF tool: read, reorder pages, annotate, recognize
text (OCR), export to DOCX/ODT/XLSX/CSV, merge, protect and print – locally,
without a server or account. It is the desktop edition of the PDF workspace in
[OpenIntraHub](https://openintrahub.org). The interface follows the system
language (26 languages). Licensed under Apache-2.0, © 2026 Jan Günther;
third-party licenses are listed in the app under *Help → Licenses*.

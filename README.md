<p align="center">
  <img src="logo/openintrapdf-auf-dunkelblau.svg" alt="OpenIntraPDF" width="160">
</p>

<h1 align="center">OpenIntraPDF</h1>

<p align="center">
  PDF lesen, Seiten ordnen, kommentieren, Text erkennen, exportieren und binden –<br>
  auf dem eigenen Rechner, ohne Server, ohne Konto, ohne Netz.
</p>

<p align="center">
  <a href="https://github.com/Jan1701/OpenIntraPDF/releases/latest"><b>Herunterladen</b></a> ·
  <a href="https://github.com/Jan1701/OpenIntraPDF/releases">Alle Versionen</a> ·
  <a href="LICENSE">Apache-2.0</a> ·
  Windows (MSI) · Linux (deb, rpm, Arch) · macOS in Prüfung durch Apple
</p>

---

OpenIntraPDF ist die Desktop-Fassung des PDF-Arbeitsplatzes aus
[OpenIntraHub](https://openintrahub.org), einem Intranet für Unternehmen. Dort
bearbeitet man PDFs direkt im Drive; hier dieselbe Oberfläche als eigenständige
App für Windows, Mac und Linux. Die Dateien bleiben auf dem Rechner, die
Texterkennung läuft lokal.

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

Die fertigen Pakete hängen an der **[neuesten Version](https://github.com/Jan1701/OpenIntraPDF/releases/latest)**; ältere
Versionen und was sich jeweils geändert hat, stehen unter
**[Releases](https://github.com/Jan1701/OpenIntraPDF/releases)**. Die Dateinamen tragen keine Versionsnummer, damit
Freigaben in Virenschutz und Softwareverteilung bei jeder neuen Version gültig
bleiben – und die Links unten immer auf die neueste Version zeigen. Welche
Version installiert ist, steht in der App unter **Über OpenIntraPDF**.

| System | Paket | Texterkennung | geprüft mit |
|---|---|---|---|
| Windows 10/11 (x64) | [`OpenIntraPDF.msi`](https://github.com/Jan1701/OpenIntraPDF/releases/latest/download/OpenIntraPDF.msi) | mitgeliefert | Windows 11 |
| macOS (Apple Silicon) | folgt nach der Prüfung durch Apple | mitgeliefert | macOS 27 |
| Debian, Ubuntu, OpenIntraOS | [`openintrapdf_amd64.deb`](https://github.com/Jan1701/OpenIntraPDF/releases/latest/download/openintrapdf_amd64.deb) | aus der Distribution (`tesseract-ocr`) | Debian 13, Ubuntu 24.04 |
| Fedora | [`openintrapdf.x86_64.rpm`](https://github.com/Jan1701/OpenIntraPDF/releases/latest/download/openintrapdf.x86_64.rpm) | aus der Distribution (`tesseract`) | aktuelle Fedora |
| Arch Linux | [`openintrapdf-x86_64.pkg.tar.zst`](https://github.com/Jan1701/OpenIntraPDF/releases/latest/download/openintrapdf-x86_64.pkg.tar.zst) | aus der Distribution (`tesseract`) | aktueller Stand |

Die Prüfsummen aller Pakete stehen in
[`SHA256SUMS`](https://github.com/Jan1701/OpenIntraPDF/releases/latest/download/SHA256SUMS):
`sha256sum -c SHA256SUMS --ignore-missing` (Linux) bzw.
`shasum -a 256 -c SHA256SUMS --ignore-missing` (macOS).

**Windows:** Das MSI installiert für alle Benutzer nach
`C:\Program Files\OpenIntraPDF` und trägt die App unter „Öffnen mit“ und den
Standard-Apps ein, ohne sich selbst zum Standard zu machen. Es braucht die
Microsoft-Edge-WebView2-Laufzeit, die zu Windows 11 und den meisten
Windows-10-Rechnern gehört. Eine neue Version ersetzt die alte. Für die
Verteilung im Netzwerk, etwa als Startskript einer Gruppenrichtlinie:

```bat
msiexec /i \\server\freigabe\OpenIntraPDF.msi /qn /norestart
```

**macOS:** Die Mac-Fassung ist in der Prüfung durch Apple (Notarisierung) und
erscheint unter den Releases, sobald sie durch ist – dann öffnet sie sich ohne
Warnung. Bis dahin lässt sie sich selbst bauen (siehe unten).

**Linux:** Das Paket mit dem Paketwerkzeug der Distribution installieren; es
holt Tesseract und WebKitGTK selbst dazu:

```sh
sudo apt install ./openintrapdf_amd64.deb                 # Debian, Ubuntu, OpenIntraOS
sudo dnf install ./openintrapdf.x86_64.rpm                # Fedora
sudo pacman -U openintrapdf-x86_64.pkg.tar.zst            # Arch Linux
```

Das Linux-Programm braucht glibc 2.34 oder neuer und WebKitGTK 4.1. Gedruckt
wird über den Druckdialog von KDE (Okular, empfohlen).

Das Windows-Programm ist nicht signiert: Beim ersten Start fragt SmartScreen
nach („Weitere Informationen“ → „Trotzdem ausführen“).

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
Sprachdaten in die App, legt alle Lizenztexte bei und signiert. Liegt eine
„Developer ID Application“ im Schlüsselbund, signiert es damit (Hardened
Runtime) und lässt die App von Apple notarisieren – das Profil dafür einmalig
mit `xcrun notarytool store-credentials openintrapdf` anlegen. Sonst signiert
es ad hoc. Heraus kommt außerdem `build/OpenIntraPDF-macos-arm64.zip`.

**Linux** – gebaut wird in einem Container `golang:1.27-trixie` auf einem Rechner
mit Docker; heraus kommen .deb, .rpm und das Arch-Paket (mit
[nfpm](https://nfpm.goreleaser.com)):

```sh
cd oberflaeche && npm ci && cd ..
OPENINTRAPDF_BAUSERVER=root@mein-docker-host ./bauen-linux.sh --pruefen
```

`--pruefen` installiert die drei Pakete danach probeweise in Debian-, Ubuntu-,
Fedora- und Arch-Containern.

**Windows** – gebaut wird auf dem Mac (Go, Wails v2, Node.js, `librsvg`,
`zstd`, `objdump` aus binutils); Tesseract kommt samt Bibliotheken aus den
Paketen von [MSYS2](https://www.msys2.org) (jedes gegen die Prüfsumme der
Paketdatenbank geprüft), das MSI baut [msitools](https://gitlab.gnome.org/GNOME/msitools)
(`wixl`) in einem Debian-Container:

```sh
cd oberflaeche && npm ci && cd ..
OPENINTRAPDF_BAUSERVER=root@mein-docker-host ./bauen-windows.sh   # → build/windows/OpenIntraPDF.msi
```

**Tests**

```sh
go test ./... && (cd oberflaeche && npm test)
```

## Fehler und Wünsche

Fehler und Vorschläge bitte als [Issue](https://github.com/Jan1701/OpenIntraPDF/issues)
melden – am besten mit Version (Über OpenIntraPDF), System und, wenn möglich,
einer Beispieldatei ohne vertrauliche Inhalte.

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
without a server or account, on Windows, macOS and Linux. It is the desktop
edition of the PDF workspace in [OpenIntraHub](https://openintrahub.org). The
interface follows the system language (26 languages).

**Download:** ready-made packages (Windows MSI, deb, rpm, Arch; macOS after
Apple's notarization review) are attached to the [latest release](https://github.com/Jan1701/OpenIntraPDF/releases/latest); all versions and their changes
are listed under [Releases](https://github.com/Jan1701/OpenIntraPDF/releases). File names carry no version number, so
antivirus and deployment exclusions stay valid across updates. Bugs and
suggestions: [Issues](https://github.com/Jan1701/OpenIntraPDF/issues).

Licensed under Apache-2.0, © 2026 Jan Günther; third-party licenses are listed
in the app under *Help → Licenses*.

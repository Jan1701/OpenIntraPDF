#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# OpenIntraPDF fuer Windows bauen: OpenIntraPDF.exe und das MSI (Jan,
# 06.10.2026: „Windows gern auch als msi … da müssen wir auch alles
# mitgeben“).
#
#   1. Oberflaeche (Vite) wie beim Mac nach frontend/dist
#   2. Programm: wails build -platform windows/amd64 (vom Mac aus; Wails
#      braucht unter Windows kein cgo) mit Symbol, Manifest, Versionsangaben
#   3. Tesseract samt DLLs aus MSYS2 und den Sprachdaten des Mac-Baus
#      (tesseract/einpacken-windows.sh) nach tesseract\ neben der App
#   4. LICENSE und Lizenzverzeichnis (Go-Module des Windows-Baus, Tesseract
#      und seine Bibliotheken, Schrift, JavaScript)
#   5. MSI mit wixl (msitools) in einem Container auf dem Bauserver
#      (windows/msi.py erzeugt die WiX-Quelle aus dem Paketordner)
#
# Voraussetzungen wie bauen.sh (Mac): Go, Wails v2 CLI, node_modules,
# rsvg-convert, zstd; build/tesseract aus tesseract/einpacken.sh. Dazu ein
# Rechner mit Docker (OPENINTRAPDF_BAUSERVER) fuer das MSI.
#
#   ./bauen-windows.sh        → build/windows/OpenIntraPDF.msi
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
cd "$HIER"
export PATH="$HOME/go/bin:$PATH"
# >>> ablage
OBERFLAECHE="$HIER/oberflaeche"
KERN="$HIER/kern"
BAUNUMMER_DATEI="$HIER/BAUNUMMER"
SVG="$HIER/logo/openintrapdf-auf-dunkelblau.svg"
BAUSERVER="${OPENINTRAPDF_BAUSERVER:?Rechner mit Docker angeben, z. B. OPENINTRAPDF_BAUSERVER=root@mein-docker-host}"
# <<< ablage
RSVG="${RSVG_CONVERT:-/opt/homebrew/bin/rsvg-convert}"
FASSUNG="$(python3 -c "import json;print(json.load(open('$HIER/wails.json'))['info']['productVersion'])")"
BAU="$(cat "$BAUNUMMER_DATEI" 2>/dev/null || echo 0)"
PAKET="$HIER/build/windows/paket"
# Dateiname OHNE Fassung (Jan 06.10.2026): Die Ausnahmen in SentinelOne
# gelten fuer feste Namen; die Fassung steht im Info-Fenster und im MSI.
MSI="OpenIntraPDF.msi"

# --- 1. Oberflaeche -----------------------------------------------------------
( cd "$OBERFLAECHE" && npx vite build --config vite.desktop.config.ts >/dev/null )
BUENDEL="$(grep -o 'desktop-[A-Za-z0-9_-]*\.js' "$HIER/frontend/dist/index.html" | head -1)"
[ -n "$BUENDEL" ] || { echo "✗ frontend/dist/index.html ohne desktop-*.js"; exit 1; }

# --- 2. Programm --------------------------------------------------------------
# Symbol aus Jans Sternlogo (unveraendert, nur gerendert); Wails macht daraus
# build/windows/icon.ico.
"$RSVG" -w 1024 -h 1024 "$SVG" -o "$HIER/build/appicon.png"
rm -f "$HIER/build/windows/icon.ico"
wails build -s -platform windows/amd64 -ldflags "-X main.bau=$BAU" -o OpenIntraPDF.exe >/dev/null
EXE="$HIER/build/bin/OpenIntraPDF.exe"
grep -a -q "$BUENDEL" "$EXE" || { echo "✗ die .exe enthaelt nicht die frisch gebaute Oberflaeche ($BUENDEL)"; exit 1; }
echo "✓ OpenIntraPDF.exe ($(du -h "$EXE" | cut -f1), Oberflaeche $BUENDEL)"

# --- 3. Tesseract -------------------------------------------------------------
[ -f "$HIER/build/tesseract/tessdata/deu.traineddata" ] || "$HIER/tesseract/einpacken.sh"
"$HIER/tesseract/einpacken-windows.sh" | grep -E "✓|✗"

# --- 4. Paketordner und Lizenzen ----------------------------------------------
rm -rf "$PAKET"
mkdir -p "$PAKET/tesseract"
cp "$EXE" "$PAKET/OpenIntraPDF.exe"
cp "$HIER/LICENSE" "$PAKET/LICENSE"
cp -R "$HIER/build/tesseract-windows/"{tesseract.exe,tessdata} "$PAKET/tesseract/"
cp "$HIER"/build/tesseract-windows/*.dll "$PAKET/tesseract/"
go run ./lizenzverzeichnis -aus "$PAKET/lizenzen" -ocr "$HIER/build/tesseract-windows/lizenzen" \
    -schrift "$KERN/dokument/schriften/OFL.txt" -js "$HIER/build/js-pakete.json" -goos windows -goarch amd64
cp "$HIER"/build/tesseract-windows/lizenzen/*.txt "$PAKET/lizenzen/"

# --- 5. MSI -------------------------------------------------------------------
FERN=/root/openintrapdf-msi-bau
OIPDF_SYMBOL=/paket-symbol/icon.ico python3 "$HIER/windows/msi.py" "$PAKET" "$FASSUNG" "$BAU" /paket > "$HIER/build/windows/openintrapdf.wxs"
ssh "$BAUSERVER" "rm -rf $FERN && mkdir -p $FERN/paket $FERN/symbol $FERN/ausgabe"
COPYFILE_DISABLE=1 tar -C "$PAKET" -cf - . | ssh "$BAUSERVER" "tar -C $FERN/paket -xf -"
scp -q "$HIER/build/windows/icon.ico" "$BAUSERVER:$FERN/symbol/icon.ico"
scp -q "$HIER/build/windows/openintrapdf.wxs" "$BAUSERVER:$FERN/openintrapdf.wxs"
ssh "$BAUSERVER" "docker run --rm -v $FERN/paket:/paket:ro -v $FERN/symbol:/paket-symbol:ro -v $FERN:/arbeit debian:trixie \
    sh -c 'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends msitools wixl >/dev/null \
    && wixl -a x64 -o /arbeit/ausgabe/$MSI /arbeit/openintrapdf.wxs && msiinfo suminfo /arbeit/ausgabe/$MSI | grep -E \"Title|Subject|Author|Revision\"'"
mkdir -p "$HIER/build/windows"
scp -q "$BAUSERVER:$FERN/ausgabe/$MSI" "$HIER/build/windows/$MSI"
ssh "$BAUSERVER" "rm -rf $FERN"
echo "✓ $HIER/build/windows/$MSI ($(du -h "$HIER/build/windows/$MSI" | cut -f1))"

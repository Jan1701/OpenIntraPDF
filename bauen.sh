#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# OpenIntraPDF fuer den Mac bauen (Vertrag Etappe 6):
#
#   1. Oberflaeche (Vite, aus core/frontend nach frontend/dist) — baut
#      dieses Skript selbst, Wails laeuft mit -s (siehe Schritt 3)
#   2. App-Symbol aus dem Sternlogo (rsvg-convert + iconutil)
#   3. wails build -platform darwin/arm64 (Go, Paketierung, ad hoc)
#   4. Tesseract samt Bibliotheken und Sprachdaten in die App
#   5. LICENSE und Lizenzverzeichnis (alle mitgelieferten Teile) in die App
#   6. ad hoc signieren, otool-Pruefung, Groesse
#
# Voraussetzungen: Go 1.27, Xcode, Wails v2 CLI (~/go/bin/wails), node_modules
# in core/frontend (npm ci), Homebrew-Tesseract zum Umpacken, rsvg-convert.
#
#   ./bauen.sh            baut build/bin/OpenIntraPDF.app
#   ./bauen.sh --schnell  ueberspringt das Umpacken, wenn build/tesseract da ist
set -euo pipefail

HIER="$(cd "$(dirname "$0")" && pwd)"
cd "$HIER"
export PATH="$HOME/go/bin:$PATH"
# >>> ablage
OBERFLAECHE="$HIER/oberflaeche"
KERN="$HIER/kern"
BAUNUMMER_DATEI="$HIER/BAUNUMMER"
SVG="$HIER/logo/openintrapdf-auf-dunkelblau.svg"
# <<< ablage
RSVG="${RSVG_CONVERT:-/opt/homebrew/bin/rsvg-convert}"
APP="$HIER/build/bin/OpenIntraPDF.app"

# --- 1b. Info.plist -----------------------------------------------------------
# build/ ist in clients/.gitignore ausgenommen; die Vorlage mit der
# Dateizuordnung .pdf liegt deshalb unter mac/ und kommt vor jedem Bau dorthin,
# wo Wails sie erwartet.
mkdir -p "$HIER/build/darwin"
cp "$HIER/mac/Info.plist" "$HIER/build/darwin/Info.plist"

# --- 2. App-Symbol ------------------------------------------------------------
# Jans Vorgabe: openintrapdf-auf-dunkelblau.svg unveraendert, nur gerendert.
if [ -f "$SVG" ] && [ -x "$RSVG" ]; then
    SET="$HIER/build/darwin/OpenIntraPDF.iconset"
    rm -rf "$SET"; mkdir -p "$SET"
    for n in 16 32 128 256 512; do
        "$RSVG" -w "$n" -h "$n" "$SVG" -o "$SET/icon_${n}x${n}.png"
        "$RSVG" -w $((n * 2)) -h $((n * 2)) "$SVG" -o "$SET/icon_${n}x${n}@2x.png"
    done
    iconutil -c icns "$SET" -o "$HIER/build/darwin/OpenIntraPDF.icns"
    "$RSVG" -w 1024 -h 1024 "$SVG" -o "$HIER/build/appicon.png"
    rm -rf "$SET"
    echo "✓ Symbol aus $(basename "$SVG")"
else
    echo "⚠ Sternlogo oder rsvg-convert fehlt — Wails nimmt build/appicon.png, falls vorhanden"
fi

# --- 3. Wails ----------------------------------------------------------------
# Die Oberflaeche baut dieses Skript selbst und ruft Wails mit -s: Mit
# Wails' eigenem Frontend-Schritt (und -clean) steckte am 30.09.2026 eine
# VERALTETE Oberflaeche in der App -- frontend/dist war danach leer bis auf
# .gitkeep, eingebettet war der Stand vor der Umbenennung. Die Pruefung
# unten stellt sicher, dass das frisch gebaute Buendel in der App steckt.
( cd "$OBERFLAECHE" && npx vite build --config vite.desktop.config.ts >/dev/null )
BUENDEL="$(grep -o 'desktop-[A-Za-z0-9_-]*\.js' "$HIER/frontend/dist/index.html" | head -1)"
[ -n "$BUENDEL" ] || { echo "✗ frontend/dist/index.html ohne desktop-*.js"; exit 1; }
rm -rf "$APP"
# Baunummer ins Info-Fenster (ueber.go); dieselbe wie fuer OpenIntraHub.
BAU="$(cat "$BAUNUMMER_DATEI" 2>/dev/null || echo "")"
wails build -s -platform darwin/arm64 -ldflags "-X main.bau=$BAU"
[ -d "$APP" ] || { echo "✗ $APP fehlt"; exit 1; }
grep -a -q "$BUENDEL" "$APP/Contents/MacOS/OpenIntraPDF" \
    || { echo "✗ die App enthaelt nicht die frisch gebaute Oberflaeche ($BUENDEL)"; exit 1; }
echo "✓ Oberflaeche eingebettet ($BUENDEL)"

# --- 4. Tesseract -------------------------------------------------------------
if [ ! -x "$HIER/build/tesseract/MacOS/tesseract" ] || [ "${1:-}" != "--schnell" ]; then
    "$HIER/tesseract/einpacken.sh"
fi
mkdir -p "$APP/Contents/Frameworks" "$APP/Contents/Resources/tessdata" "$APP/Contents/Resources/lizenzen"
cp "$HIER/build/tesseract/MacOS/tesseract" "$APP/Contents/MacOS/tesseract"
cp "$HIER"/build/tesseract/Frameworks/*.dylib "$APP/Contents/Frameworks/"
# Ganz, mit configs/ (tsv, hocr …): Ohne tessdata/configs/tsv liefert
# Tesseract nur Fliesstext, und die Erkennung ergaebe keine Woerter.
cp -R "$HIER"/build/tesseract/tessdata/. "$APP/Contents/Resources/tessdata/"
[ -f "$APP/Contents/Resources/tessdata/configs/tsv" ] || { echo "✗ tessdata/configs/tsv fehlt in der App"; exit 1; }
cp "$HIER"/build/tesseract/lizenzen/* "$APP/Contents/Resources/lizenzen/"

# --- 5. Lizenzen und Symbol --------------------------------------------------
# Der Dialog „Hilfe → Lizenzen“ liest LICENSE und lizenzen/verzeichnis.json
# (lizenzen.go). Das Verzeichnis nennt jedes mitgelieferte Teil mit vollem
# Text: Texterkennung, Schrift, Go-Module, JavaScript-Pakete (js-pakete.json
# schreibt der Vite-Bau in Schritt 3). LIZENZEN.md bleibt Entwicklernotiz.
cp "$HIER/LICENSE" "$APP/Contents/Resources/LICENSE"
go run ./lizenzverzeichnis -aus "$APP/Contents/Resources/lizenzen" -ocr "$HIER/build/tesseract/lizenzen" \
    -schrift "$KERN/dokument/schriften/OFL.txt" -js "$HIER/build/js-pakete.json"
[ -f "$HIER/build/darwin/OpenIntraPDF.icns" ] && cp "$HIER/build/darwin/OpenIntraPDF.icns" "$APP/Contents/Resources/iconfile.icns"

# --- 6. Signieren und pruefen ------------------------------------------------
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

fehler=0
while IFS= read -r f; do
    if file "$f" | grep -q 'Mach-O'; then
        if otool -L "$f" | tail -n +2 | grep -Eq '/opt/homebrew|/usr/local'; then
            echo "✗ $f verweist auf Homebrew"; fehler=1
        fi
    fi
done < <(find "$APP" -type f)
[ $fehler -eq 0 ] || exit 1
echo "✓ otool -L: kein Verweis auf /opt/homebrew oder /usr/local"
echo "✓ $APP ($(du -sh "$APP" | cut -f1))"

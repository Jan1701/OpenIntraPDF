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
#   6. signieren (Developer ID, sonst ad hoc), otool-Pruefung, Groesse
#   7. mit Developer ID notarisieren; Release-Zip build/OpenIntraPDF-macos-arm64.zip
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
# Mit Developer-ID (Apple Developer Program; Jan 07.10.2026 zur Warnung
# „nicht geöffnet“: „das müssen wir irgendwie einfacher hinbekommen“): jede
# Mach-O-Datei einzeln von innen nach außen, Hardened Runtime, Zeitstempel —
# --deep signiert verschachtelte Teile nicht verlässlich. Bibliotheken,
# Tesseract und App tragen dieselbe Team-ID, sonst lehnt die Hardened Runtime
# die Bibliotheken ab. Ohne Developer-ID wie bisher ad hoc (reicht für den
# eigenen Mac, Gatekeeper warnt beim Herunterladen).
#
#   OPENINTRAPDF_SIGNATUR  Identität; leer: die einzige „Developer ID
#                          Application“ im Schlüsselbund, sonst ad hoc
#   OPENINTRAPDF_NOTAR     Profil für xcrun notarytool (einmalig anlegen mit
#                          xcrun notarytool store-credentials openintrapdf);
#                          „-“ überspringt die Notarisierung
IDENTITAET="${OPENINTRAPDF_SIGNATUR:-}"
if [ -z "$IDENTITAET" ]; then
    IDS="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application: [^"]*"' | tr -d '"' || true)"
    [ "$(printf '%s' "$IDS" | grep -c .)" = "1" ] && IDENTITAET="$IDS"
fi
NOTAR="${OPENINTRAPDF_NOTAR:-openintrapdf}"
if [ -n "$IDENTITAET" ]; then
    signieren() { codesign --force --options runtime --timestamp --sign "$IDENTITAET" "$1"; }
    for f in "$APP"/Contents/Frameworks/*.dylib "$APP/Contents/MacOS/tesseract"; do signieren "$f"; done
    signieren "$APP"
    echo "✓ signiert: $IDENTITAET"
else
    codesign --force --deep --sign - "$APP"
    echo "✓ ad hoc signiert (keine Developer ID im Schlüsselbund)"
fi
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

# --- 7. Notarisieren und Release-Zip ------------------------------------------
# Nur mit Developer-ID: Apple prüft die App (notarytool, wenige Minuten), das
# Ticket wird angeheftet (stapler) — dann öffnet macOS sie auch ohne Netz
# nach dem Herunterladen ohne Warnung. Die Zip für das Release entsteht aus
# der fertigen App; ihr Name trägt keine Versionsnummer (Jan 06.10.2026).
ZIP="$HIER/build/OpenIntraPDF-macos-arm64.zip"
rm -f "$ZIP"
if [ -n "$IDENTITAET" ] && [ "$NOTAR" != "-" ]; then
    ditto -c -k --keepParent "$APP" "$ZIP"
    xcrun notarytool submit "$ZIP" --keychain-profile "$NOTAR" --wait | tee "$HIER/build/notarisierung.log" | grep -E "status:|id:" | tail -2
    grep -q "status: Accepted" "$HIER/build/notarisierung.log" \
        || { echo "✗ Notarisierung nicht angenommen (Protokoll: xcrun notarytool log <id> --keychain-profile $NOTAR)"; exit 1; }
    xcrun stapler staple "$APP" >/dev/null
    spctl --assess --type execute "$APP" || { echo "✗ Gatekeeper lehnt die notarisierte App ab"; exit 1; }
    rm -f "$ZIP"
    echo "✓ notarisiert und Ticket angeheftet"
fi
ditto -c -k --keepParent "$APP" "$ZIP"
echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"

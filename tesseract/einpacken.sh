#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# Tesseract fuer OpenIntraPDF umpacken (Vertrag Etappe 6): das Programm,
# Leptonica und alle nachgeladenen Bibliotheken aus den Homebrew-Flaschen
# nach build/tesseract, die Ladepfade auf @executable_path/@loader_path
# umgeschrieben, jede Datei ad hoc signiert, die Sprachdaten deu/eng/osd
# (tessdata_fast 4.1.0, dieselbe Sorte wie die Debian-Pakete des
# OIH-Dienstes) und die Lizenztexte daneben.
#
# Ergebnis (dieselbe Anordnung wie in der App, damit die Probe am Ende
# echt ist):
#   build/tesseract/MacOS/tesseract        -> Contents/MacOS/tesseract
#   build/tesseract/Frameworks/*.dylib     -> Contents/Frameworks/
#   build/tesseract/tessdata/*.traineddata -> Contents/Resources/tessdata/
#   build/tesseract/lizenzen/*             -> Contents/Resources/lizenzen/
#   build/tesseract/teile.txt              Liste fuer LIZENZEN.md
#
# Pruefung am Ende: otool -L rekursiv ueber alle Mach-O-Dateien — kein
# Verweis auf /opt/homebrew oder /usr/local darf uebrig bleiben — und ein
# Start ohne Homebrew im PATH.
#
# macOS liefert bash 3.2: keine assoziativen Felder, keine ${var,,}.
set -euo pipefail

HIER="$(cd "$(dirname "$0")/.." && pwd)"
ZIEL="$HIER/build/tesseract"
BREW="${HOMEBREW_PREFIX:-/opt/homebrew}"
TESSERACT="$BREW/bin/tesseract"
TESSDATA="$BREW/share/tessdata"

[ -x "$TESSERACT" ] || { echo "✗ $TESSERACT fehlt (brew install tesseract tesseract-lang)"; exit 1; }
for s in deu eng osd; do
    [ -f "$TESSDATA/$s.traineddata" ] || { echo "✗ Sprachdaten $s fehlen unter $TESSDATA"; exit 1; }
done

rm -rf "$ZIEL"
mkdir -p "$ZIEL/MacOS" "$ZIEL/Frameworks" "$ZIEL/tessdata" "$ZIEL/lizenzen"

echt() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }

# ladepfade <mach-o>: die Ladepfade aus otool -L, ohne die eigene Kennung.
ladepfade() {
    otool -L "$1" | tail -n +2 | sed -e 's/ (.*//' -e 's/^[[:space:]]*//' | grep -v '^$' || true
}

# fremd <pfad>: 0, wenn der Pfad zu Homebrew gehoert (auch ueber @rpath,
# @loader_path — die Homebrew-Flaschen verweisen so aufeinander).
fremd() {
    case "$1" in
        "$BREW"/*|/usr/local/*|@rpath/*|@loader_path/*|@executable_path/*) return 0 ;;
        *) return 1 ;;
    esac
}

# datei_zu <ladepfad> <ordner der verweisenden Datei>: die Datei, die der
# Ladepfad meint. @rpath/@loader_path zeigen bei Homebrew in denselben
# lib-Ordner oder nach $BREW/lib.
datei_zu() {
    local ref="$1" ordner="$2" name
    name="$(basename "$ref")"
    case "$ref" in
        "$BREW"/*|/usr/local/*) [ -e "$ref" ] && echo "$ref" && return 0 ;;
    esac
    for k in "$ordner/$name" "$ordner/../lib/$name" "$BREW/lib/$name" "$BREW/opt/*/lib/$name"; do
        for f in $k; do
            [ -e "$f" ] && { echo "$f"; return 0; }
        done
    done
    return 1
}

# --- Abhaengigkeiten rekursiv sammeln ------------------------------------
# Jede Bibliothek wird unter dem NAMEN abgelegt, mit dem andere sie laden
# (libwebp.7.dylib), nicht unter dem aufgeloesten Dateinamen
# (libwebp.7.2.0.dylib) — so trifft das Umschreiben immer.
NAMEN=""
QUELLEN=()
WARTESCHLANGE=("$(echt "$TESSERACT")")
while [ ${#WARTESCHLANGE[@]} -gt 0 ]; do
    datei="${WARTESCHLANGE[0]}"
    if [ ${#WARTESCHLANGE[@]} -gt 1 ]; then WARTESCHLANGE=("${WARTESCHLANGE[@]:1}"); else WARTESCHLANGE=(); fi
    while IFS= read -r ref; do
        fremd "$ref" || continue
        name="$(basename "$ref")"
        printf '%s\n' "$NAMEN" | grep -qx "$name" && continue
        quelle="$(datei_zu "$ref" "$(dirname "$datei")")" || { echo "✗ $name (aus $(basename "$datei")) nicht gefunden"; exit 1; }
        quelle="$(echt "$quelle")"
        NAMEN="$NAMEN
$name"
        QUELLEN+=("$name=$quelle")
        WARTESCHLANGE+=("$quelle")
    done < <(ladepfade "$datei")
done

# --- Kopieren und Ladepfade umschreiben -----------------------------------
cp "$(echt "$TESSERACT")" "$ZIEL/MacOS/tesseract"
chmod 755 "$ZIEL/MacOS/tesseract"
for eintrag in "${QUELLEN[@]}"; do
    cp "${eintrag#*=}" "$ZIEL/Frameworks/${eintrag%%=*}"
    chmod 644 "$ZIEL/Frameworks/${eintrag%%=*}"
done

# umschreiben <datei> <praefix>: jeden fremden Ladepfad auf praefix/<name>.
umschreiben() {
    local datei="$1" praefix="$2"
    while IFS= read -r ref; do
        fremd "$ref" || continue
        install_name_tool -change "$ref" "$praefix/$(basename "$ref")" "$datei" 2>/dev/null
    done < <(ladepfade "$datei")
    # Keine Suchpfade nach Homebrew mehr.
    while IFS= read -r rp; do
        [ -n "$rp" ] && install_name_tool -delete_rpath "$rp" "$datei" 2>/dev/null || true
    done < <(otool -l "$datei" | awk '/LC_RPATH/{f=1} f&&/path /{print $2; f=0}')
}

umschreiben "$ZIEL/MacOS/tesseract" "@executable_path/../Frameworks"
for b in "$ZIEL"/Frameworks/*.dylib; do
    install_name_tool -id "@loader_path/$(basename "$b")" "$b" 2>/dev/null
    umschreiben "$b" "@loader_path"
done

# Ad hoc signieren — install_name_tool macht die Homebrew-Signatur ungueltig.
for f in "$ZIEL/MacOS/tesseract" "$ZIEL"/Frameworks/*.dylib; do
    codesign --force --sign - "$f" >/dev/null 2>&1
done

# --- Sprachdaten (tessdata_fast 4.1.0) und Konfigurationen ------------------
for s in deu eng osd; do
    cp -L "$TESSDATA/$s.traineddata" "$ZIEL/tessdata/$s.traineddata"
done
# tessdata/configs/tsv schaltet die TSV-Ausgabe (Woerter mit Lage) ein —
# ohne die Datei schreibt Tesseract nur Fliesstext („Can't open tsv“).
mkdir -p "$ZIEL/tessdata/configs"
cp -L "$TESSDATA/configs/"* "$ZIEL/tessdata/configs/"
[ -f "$ZIEL/tessdata/configs/tsv" ] || { echo "✗ tessdata/configs/tsv fehlt"; exit 1; }

# --- Lizenztexte je Formel --------------------------------------------------
# Jede Bibliothek kommt aus einer Homebrew-Flasche; ihr Cellar-Ordner
# traegt LICENSE/COPYING, und die Formel nennt den SPDX-Ausdruck.
formel_von() {
    python3 - "$1" "$BREW" <<'EOF'
import os, sys
p, brew = os.path.realpath(sys.argv[1]), sys.argv[2]
cellar = os.path.join(brew, "Cellar")
if p.startswith(cellar + "/"):
    rest = p[len(cellar) + 1:].split("/")
    print(rest[0], rest[1])
EOF
}
spdx_von() {
    python3 - "$1" <<'EOF'
import re, sys
try:
    s = open(sys.argv[1]).read()
except OSError:
    print(""); sys.exit()
m = re.search(r'^\s*license\s+(.+?)\n(?:\s*\S.*\n)*?(?=\s*\n|\s*(?:depends_on|head|bottle|livecheck|url|sha256|homepage|desc)\b)', s, re.M)
t = m.group(0) if m else ""
t = re.sub(r'\s+', ' ', t).replace('license ', '', 1).strip()
print(t)
EOF
}
: > "$ZIEL/teile.txt"
alle=("$(echt "$TESSERACT")")
for eintrag in "${QUELLEN[@]}"; do alle+=("${eintrag#*=}"); done
for f in "${alle[@]}"; do
    formel=""; fassung=""
    read -r formel fassung < <(formel_von "$f") || true
    [ -z "$formel" ] && continue
    grep -q "^$formel " "$ZIEL/teile.txt" && continue
    ordner="$BREW/Cellar/$formel/$fassung"
    lizenz=""
    for k in LICENSE LICENSE.txt LICENSE.md COPYING COPYING.txt COPYRIGHT license.txt LICENSE.TXT; do
        [ -f "$ordner/$k" ] && { lizenz="$ordner/$k"; break; }
    done
    [ -z "$lizenz" ] && lizenz="$(find "$ordner" -maxdepth 3 \( -iname 'license*' -o -iname 'copying*' \) -type f 2>/dev/null | head -1 || true)"
    [ -n "$lizenz" ] && cp "$lizenz" "$ZIEL/lizenzen/$formel-$fassung.txt"
    echo "$formel $fassung $(basename "$f") $(spdx_von "$ordner/.brew/$formel.rb")" >> "$ZIEL/teile.txt"
done
# Leptonica legt in der Flasche keinen Lizenztext ab; er liegt hier im Repo
# (leptonica-license.txt der Quelle 1.87.0).
cp "$HIER"/tesseract/lizenzen/*.txt "$ZIEL/lizenzen/"
cp -L "$TESSDATA/LICENSE" "$ZIEL/lizenzen/tessdata_fast-4.1.0.txt" 2>/dev/null || true

# --- Pruefung ---------------------------------------------------------------
fehler=0
for f in "$ZIEL/MacOS/tesseract" "$ZIEL"/Frameworks/*.dylib; do
    if otool -L "$f" | tail -n +2 | grep -Eq '/opt/homebrew|/usr/local|@rpath'; then
        echo "✗ $f verweist noch nach draussen:"; otool -L "$f" | grep -E '/opt/homebrew|/usr/local|@rpath'
        fehler=1
    fi
done
[ $fehler -eq 0 ] || exit 1

# Laeuft es ohne Homebrew im PATH?
if ! env -i PATH=/usr/bin:/bin HOME="$HOME" "$ZIEL/MacOS/tesseract" --version >/dev/null 2>"$ZIEL/start.log"; then
    echo "✗ umgepacktes tesseract startet nicht:"; cat "$ZIEL/start.log"; exit 1
fi
rm -f "$ZIEL/start.log"
env -i PATH=/usr/bin:/bin HOME="$HOME" "$ZIEL/MacOS/tesseract" --list-langs --tessdata-dir "$ZIEL/tessdata" | tail -n +2 | tr '\n' ' '
echo
echo "✓ Tesseract umgepackt nach $ZIEL ($(du -sh "$ZIEL" | cut -f1), $(ls "$ZIEL/Frameworks" | wc -l | tr -d ' ') Bibliotheken)"

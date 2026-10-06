#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# OpenIntraPDF fuer Linux bauen: .deb (Debian, Ubuntu, OpenIntraOS), .rpm
# (Fedora) und Arch-Paket aus EINEM Programm (Jan, 06.10.2026: „deb pakete
# bauen und rpm und für arch“).
#
#   1. Oberflaeche (Vite) wie beim Mac nach frontend/dist
#   2. Lizenzverzeichnis HIER (nur hier liegen node_modules), mit den
#      Go-Modulen des Linux-Baus (GOOS=linux, webkit2_41)
#   3. Quellbaum ohne node_modules auf einen Rechner mit Docker (OPENINTRAPDF_BAUSERVER)
#   4. im Container golang:1.27-trixie: go build mit WebKitGTK 4.1, Pruefung,
#      nfpm baut die drei Pakete (linux/nfpm.yaml)
#   5. Pakete nach build/linux/ (nicht im Git)
#
# Tesseract kommt NICHT mit wie beim Mac, sondern aus der Distribution: Das
# Programm findet /usr/bin/tesseract neben sich, das seine Sprachdaten kennt.
#
#   ./bauen-linux.sh            bauen
#   ./bauen-linux.sh --pruefen  danach in Debian-, Fedora- und Arch-Containern installieren
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
# >>> ablage
QUELLE="$HIER"                               # was in den Container kommt
APP_IM_BAUM=.                                # die App darin
OBERFLAECHE="$QUELLE/oberflaeche"
KERN="$QUELLE/kern"
BAUNUMMER_DATEI="$QUELLE/BAUNUMMER"
SVG="$QUELLE/logo/openintrapdf-auf-dunkelblau.svg"
BAUSERVER="${OPENINTRAPDF_BAUSERVER:?Rechner mit Docker angeben, z. B. OPENINTRAPDF_BAUSERVER=root@mein-docker-host}"
# <<< ablage
FERN=/root/openintrapdf-linux-bau
# Fassung: Bau plus Commit -- der Desktop-Stand muss nicht ausgerollt sein.
BAU="$(cat "$BAUNUMMER_DATEI")"
HASH="g$(git -C "$QUELLE" rev-parse --short HEAD)"
if [ -n "$(git -C "$HIER" status --porcelain -- . "$KERN" "$OBERFLAECHE/src")" ]; then
    HASH="$HASH.lokal"
fi

# --- 1. Oberflaeche -----------------------------------------------------------
( cd "$OBERFLAECHE" && npx vite build --config vite.desktop.config.ts >/dev/null )
BUENDEL="$(grep -o 'desktop-[A-Za-z0-9_-]*\.js' "$HIER/frontend/dist/index.html" | head -1)"
[ -n "$BUENDEL" ] || { echo "✗ frontend/dist/index.html ohne desktop-*.js"; exit 1; }

# --- 2. Lizenzen --------------------------------------------------------------
LIZ="$HIER/build/linux/lizenzen"
rm -rf "$LIZ"
( cd "$HIER" && go run ./lizenzverzeichnis -aus "$LIZ" -schrift "$KERN/dokument/schriften/OFL.txt" \
    -js "$HIER/build/js-pakete.json" -tags desktop,production,webkit2_41 -goos linux -goarch amd64 )

# --- 3. Quelle zum Bauserver --------------------------------------------------
ssh "$BAUSERVER" "rm -rf $FERN && mkdir -p $FERN/quelle $FERN/ausgabe $FERN/symbol $FERN/lizenzen /root/.cache/openintrapdf-go /root/.cache/openintrapdf-gobau"
COPYFILE_DISABLE=1 tar -C "$QUELLE" --exclude=node_modules --exclude=target --exclude=.git \
    --exclude="$APP_IM_BAUM/build" -cf - . | ssh "$BAUSERVER" "tar -C $FERN/quelle -xf -"
COPYFILE_DISABLE=1 tar -C "$LIZ" -cf - . | ssh "$BAUSERVER" "tar -C $FERN/lizenzen -xf -"
scp -q "$SVG" "$BAUSERVER:$FERN/symbol/openintrapdf.svg"

# --- 4. Bauen und packen ------------------------------------------------------
ssh "$BAUSERVER" "docker run --rm -v $FERN/quelle:/quelle -v $FERN/ausgabe:/ausgabe -v $FERN/symbol:/symbol:ro \
    -v $FERN/lizenzen:/lizenzen:ro -v /root/.cache/openintrapdf-go:/go/pkg/mod -v /root/.cache/openintrapdf-gobau:/root/.cache/go-build \
    golang:1.27-trixie sh /quelle/$APP_IM_BAUM/linux/bauen-im-container.sh '$BAU' '$HASH' '$BUENDEL' '/quelle/$APP_IM_BAUM'"

# --- 5. Abholen ---------------------------------------------------------------
mkdir -p "$HIER/build/linux"
rm -f "$HIER"/build/linux/openintrapdf*.deb "$HIER"/build/linux/openintrapdf*.rpm "$HIER"/build/linux/openintrapdf*.pkg.tar.zst
scp -q "$BAUSERVER:$FERN/ausgabe/*" "$HIER/build/linux/"
ls -lh "$HIER"/build/linux/openintrapdf*

if [ "${1:-}" = "--pruefen" ]; then
    "$HIER/linux/pruefen.sh" "$BAUSERVER" "$FERN/ausgabe"
fi
ssh "$BAUSERVER" "rm -rf $FERN"

#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# Die drei Linux-Pakete in frischen Containern installieren (Bauserver): Laesst
# sich jedes mit seinen Abhaengigkeiten aus den Quellen der Distribution
# installieren, findet das Programm alle Bibliotheken, liegen Lizenzen und
# Starter da, und laesst es sich wieder entfernen?
#
#   linux/pruefen.sh root@mein-docker-host /root/openintrapdf-linux-bau/ausgabe
set -euo pipefail
SERVER="$1"
AUSGABE="$2"
ssh "$SERVER" "AUSGABE=$AUSGABE sh -s" <<'FERN'
set -eu
gemeinsam='set -e
test -x /usr/bin/openintrapdf
! ldd /usr/bin/openintrapdf | grep "not found"
test -f /usr/share/openintrapdf/LICENSE
test -f /usr/share/openintrapdf/lizenzen/verzeichnis.json
test -f /usr/share/applications/openintrapdf.desktop
command -v tesseract >/dev/null
echo "  tesseract $(tesseract --version 2>&1 | head -1), Sprachen: $(tesseract --list-langs 2>/dev/null | tail -n +2 | tr "\n" " ")"'
pruefe() { # name image installieren entfernen
    echo "== $1"
    docker run --rm -v "$AUSGABE":/pakete:ro "$2" sh -c "$3 && $gemeinsam && $4 && ! test -e /usr/bin/openintrapdf && echo '  ✓ installiert, geprueft, entfernt'"
}
pruefe Debian debian:trixie \
    'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends /pakete/openintrapdf_*.deb >/dev/null' \
    'apt-get remove -y -qq openintrapdf >/dev/null'
pruefe Ubuntu ubuntu:24.04 \
    'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends /pakete/openintrapdf_*.deb >/dev/null' \
    'apt-get remove -y -qq openintrapdf >/dev/null'
pruefe Fedora fedora:latest \
    'dnf install -y -q --setopt=install_weak_deps=False /pakete/openintrapdf-*.rpm >/dev/null' \
    'dnf remove -y -q openintrapdf >/dev/null'
pruefe Arch archlinux:latest \
    'pacman -Sy --noconfirm --needed >/dev/null 2>&1; pacman -U --noconfirm /pakete/openintrapdf-*.pkg.tar.zst >/dev/null' \
    'pacman -R --noconfirm openintrapdf >/dev/null'
FERN

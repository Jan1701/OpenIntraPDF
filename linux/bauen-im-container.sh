#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Laeuft IM Container golang:1.27-trixie auf dem Bauserver (siehe ../bauen-linux.sh).
# /quelle = Quellbaum (ohne node_modules), $4 = Ordner der App darin,
# /lizenzen = Lizenzverzeichnis (auf
# dem Mac erzeugt), /ausgabe = Ergebnis.
#
# Ein Programm, drei Pakete (nfpm, linux/nfpm.yaml): .deb (Debian, Ubuntu,
# OpenIntraOS), .rpm (Fedora), .pkg.tar.zst (Arch).
set -eu
BAU="$1"
HASH="$2"
BUENDEL="$3"
APP="${4:-/quelle/clients/openintrapdf-desktop}"
NFPM=v2.47.0
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config >/dev/null
cd "$APP"
# Wails v2 ohne CLI: dieselben Tags wie "wails build" fuer Linux mit
# WebKitGTK 4.1 (Debian 13 hat 4.0 nicht mehr).
CGO_ENABLED=1 go build -tags desktop,production,webkit2_41 -trimpath -buildvcs=false \
    -ldflags "-s -w -X main.bau=$BAU" -o /tmp/openintrapdf .
grep -a -q "$BUENDEL" /tmp/openintrapdf || { echo "✗ Oberflaeche $BUENDEL nicht eingebettet"; exit 1; }
if ldd /tmp/openintrapdf | grep -q "not found"; then ldd /tmp/openintrapdf | grep "not found"; exit 1; fi
[ -f /lizenzen/verzeichnis.json ] || { echo "✗ Lizenzverzeichnis fehlt"; exit 1; }
# Hoechste glibc-Fassung, die das Programm verlangt: so alt darf eine
# Distribution hoechstens sein.
echo "glibc: $(objdump -T /tmp/openintrapdf | grep -o 'GLIBC_[0-9.]*' | sort -V | tail -1)"

GOBIN=/tmp/werkzeug go install github.com/goreleaser/nfpm/v2/cmd/nfpm@$NFPM
sed -e "s/@BAU@/$BAU/" linux/nfpm.yaml > /tmp/nfpm.yaml
# Dateinamen OHNE Fassung (Jan 06.10.2026, SentinelOne-Ausnahmen); die
# Fassung steht in den Paketdaten.
/tmp/werkzeug/nfpm package -f /tmp/nfpm.yaml -p deb -t /ausgabe/openintrapdf_amd64.deb >/dev/null
/tmp/werkzeug/nfpm package -f /tmp/nfpm.yaml -p rpm -t /ausgabe/openintrapdf.x86_64.rpm >/dev/null
/tmp/werkzeug/nfpm package -f /tmp/nfpm.yaml -p archlinux -t /ausgabe/openintrapdf-x86_64.pkg.tar.zst >/dev/null
ls /ausgabe

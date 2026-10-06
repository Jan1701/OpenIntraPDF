#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Nach dem Installieren (deb, rpm, Arch): Starter und Symbol bekannt machen.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
exit 0

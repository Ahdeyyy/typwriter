#!/bin/sh
# Used after installation and removal, including upgrades. Cache refreshes
# must not prevent package removal when their utilities have been removed.
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi
exit 0

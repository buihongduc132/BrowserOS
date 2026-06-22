#!/usr/bin/env bash
# launch-browseros-prod.sh — GUI launcher for BrowserOS Prod instance
# Called by browseros.desktop Exec line.
# Launches the AppImage directly with correct flags.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../gpu-flags.sh"

APPIMAGE="${BROWSEROS_APP_PATH:-$HOME/Downloads/alta/BrowserOS.AppImage}"

if [[ ! -f "$APPIMAGE" ]]; then
  notify-send "BrowserOS" "AppImage not found: $APPIMAGE" -i dialog-error 2>/dev/null || true
  exit 1
fi

# Clean stale singleton locks
rm -f ~/.config/browser-os/SingletonLock ~/.config/browser-os/SingletonCookie ~/.config/browser-os/SingletonSocket 2>/dev/null

# Launch browser (foreground — GNOME tracks this process)
exec "$APPIMAGE" ${BROWSEROS_GPU_FLAGS} --class=browseros

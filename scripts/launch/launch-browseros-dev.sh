#!/usr/bin/env bash
# launch-browseros-dev.sh — GUI launcher for BrowserOS Dev instance
# Called by browseros-dev.desktop Exec line.
# Delegates to instance.sh for all shared logic.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
source "${SCRIPT_DIR}/instance.sh"

REPO_ROOT="$(discover_repo_root)"
declare_instance dev

# ── Ensure mise is available ──
if ! command -v mise &>/dev/null; then
  notify-send "BrowserOS Dev" "mise not found. Install mise first." -i dialog-error 2>/dev/null || true
  echo "[ERROR] mise not found in PATH" >&2
  exit 1
fi

# ── Check if already running ──
if is_browser_running "$INSTANCE_BROWSER_PID_FILE"; then
  notify-send "BrowserOS Dev" "Already running. Use kill-dev to stop first." -i dialog-warning 2>/dev/null || true
  exit 0
fi

# ── Launch via mise (ensures build + singleton guard) ──
cd "$REPO_ROOT"
exec mise run browseros:start-dev

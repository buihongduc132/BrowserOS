#!/usr/bin/env bash
# launch-browseros-dev.sh — GUI launcher for BrowserOS Dev instance
# Called by browseros-dev.desktop Exec line.
# Delegates to the Go CLI via mise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../../../scripts/gpu-flags.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ── Ensure mise is available ──
if ! command -v mise &>/dev/null; then
  notify-send "BrowserOS Dev" "mise not found. Install mise first." -i dialog-error 2>/dev/null || true
  echo "[ERROR] mise not found in PATH" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec mise run browseros:start-dev

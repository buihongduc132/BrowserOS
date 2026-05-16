#!/usr/bin/env bash
# launch-browseros-prod.sh — GUI launcher for BrowserOS Prod instance
# Called by browseros.desktop Exec line (and by start-prod mise task via nohup).
# Delegates to instance.sh for all shared logic.
#
# IMPORTANT: must work under both:
#   1. systemd-run --user (from .desktop) — signal forwarding works naturally
#   2. Direct bash (from mise task)     — needs explicit signal handling
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
source "${SCRIPT_DIR}/instance.sh"

REPO_ROOT="$(discover_repo_root)"
declare_instance prod

# ── Write port config BEFORE launch (prod uses embedded server) ──
write_server_config "$INSTANCE_PROFILE" "$INSTANCE_CDP_PORT" "$INSTANCE_SERVER_PORT" "$INSTANCE_EXTENSION_PORT" "${INSTANCE_SERVER_RESOURCES_DIR:-}"

# ── Clean stale state ──
clean_singleton_locks "$INSTANCE_PROFILE"

# ── Export env vars (highest priority for server binary) ──
export BROWSEROS_CDP_PORT="$INSTANCE_CDP_PORT"
export BROWSEROS_SERVER_PORT="$INSTANCE_SERVER_PORT"
export BROWSEROS_EXTENSION_PORT="$INSTANCE_EXTENSION_PORT"
export BROWSEROS_PROXY_PORT="$INSTANCE_SERVER_PORT"
export BROWSEROS_SKIP_OPENCLAW=1

# ── Launch browser (foreground, NOT backgrounded) ──
# When launched from .desktop via bash -c, the browser MUST be the main
# process so GNOME tracks it. When launched from mise, same thing.
# _sandbox_flag auto-detects whether --no-sandbox is needed.
_bos_sandbox=$(_sandbox_flag)
exec "$INSTANCE_APP" \
  ${_bos_sandbox} \
  --remote-allow-origins=* \
  --class="$INSTANCE_APP_CLASS" \
  --user-data-dir="$INSTANCE_PROFILE" \
  --remote-debugging-port="$INSTANCE_CDP_PORT" \
  --browseros-extension-port="$INSTANCE_EXTENSION_PORT" \
  --browseros-proxy-port="$INSTANCE_SERVER_PORT" \
  --browseros-server-resources-dir="${INSTANCE_SERVER_RESOURCES_DIR:-}" \
  --disable-browseros-server-updater

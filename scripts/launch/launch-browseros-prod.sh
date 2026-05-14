#!/usr/bin/env bash
# launch-browseros-prod.sh — GUI launcher for BrowserOS Prod instance
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/common.sh"

APP="${BROWSEROS_APP_PATH:-$HOME/Downloads/alta/BrowserOS.AppImage}"
PROD_SERVER_RESOURCES_DIR="${BROWSEROS_SERVER_RESOURCES_DIR:-${REPO_ROOT}/.browseros-prod-resources}"

# PROD_BOS_DIR, PROD_PROFILE, PROD_BROWSER_PID, PROD_*_PORT all come from common.sh

mkdir -p "$PROD_BOS_DIR"

if is_browser_running "$PROD_BROWSER_PID"; then
  OLD_PID=$(cat "$PROD_BROWSER_PID")
  notify-send "BrowserOS" "Already running (PID $OLD_PID)." -i dialog-warning 2>/dev/null || true
  exit 0
fi

if [ ! -x "$APP" ]; then
  notify-send "BrowserOS" "AppImage not found: $APP" -i dialog-error 2>/dev/null || true
  exit 1
fi

LOCK_FD=200
exec {LOCK_FD}>"${PROD_BOS_DIR}/start.lock"
flock -n "$LOCK_FD" || {
  notify-send "BrowserOS" "Already starting." -i dialog-warning 2>/dev/null || true
  exit 0
}

clean_singleton_locks "$PROD_PROFILE"
rm -f "${PROD_PROFILE}/Crash Reports/pending/"*.lock 2>/dev/null || true

# ── Write server_config.json with FIXED ports BEFORE launch ──
# The browser reads this config on startup to know which ports to use.
# If we don't write it, the browser picks random ports on every launch.
# The CLI flags (--remote-debugging-port, --browseros-server-port) must
# MATCH the values here, or the spawned server crashes trying to connect
# to the wrong CDP port.
PROD_CONFIG_DIR="${PROD_PROFILE}/.browseros"
mkdir -p "$PROD_CONFIG_DIR"
python3 - "$PROD_PROFILE" "$PROD_CDP_PORT" "$PROD_SERVER_PORT" "$PROD_EXTENSION_PORT" "$PROD_SERVER_RESOURCES_DIR" <<'PYEOF'
import json, os, sys

profile = sys.argv[1]
cdp_port, srv_port, ext_port = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
resources_dir = sys.argv[5]

# 1. Write server_config.json (read by spawned server binary)
config_path = os.path.join(profile, ".browseros", "server_config.json")
cfg = {
    "directories": {
        "execution": os.path.join(profile, ".browseros"),
        "resources": resources_dir
    },
    "flags": {"allow_remote_in_mcp": False},
    "instance": {},
    "ports": {"cdp": cdp_port, "server": srv_port, "extension": ext_port}
}
if os.path.exists(config_path):
    try:
        old = json.load(open(config_path))
        if "instance" in old and old["instance"]: cfg["instance"] = old["instance"]
    except: pass
with open(config_path, "w") as f:
    json.dump(cfg, f, indent=2)

# 2. Write CDP port into Chromium "Local State" (the ACTUAL source of truth
#    for BrowserOS internal chromium code). Without this, the browser picks
#    a random CDP port on every launch and writes it to Local State, which
#    then overrides server_config.json → mismatch → server crash.
local_state_path = os.path.join(profile, "Local State")
if os.path.exists(local_state_path):
    try:
        ls = json.load(open(local_state_path))
    except:
        ls = {}
else:
    ls = {}

if "browseros" not in ls: ls["browseros"] = {}
if "server" not in ls["browseros"]: ls["browseros"]["server"] = {}

ls["browseros"]["server"]["cdp_port"] = cdp_port
ls["browseros"]["server"]["server_port"] = srv_port
ls["browseros"]["server"]["extension_port"] = ext_port
ls["browseros"]["server"]["proxy_port"] = srv_port  # proxy shares server port

with open(local_state_path, "w") as f:
    json.dump(ls, f, indent=2)

print(f"Fixed prod ports: cdp={cdp_port}, server={srv_port}, extension={ext_port}")
print(f"  Wrote {config_path}")
print(f"  Wrote {local_state_path}")
PYEOF

# ── Export env vars for the server binary (spawned by browser as child process) ──
# The server reads BROWSEROS_CDP_PORT etc. with HIGHEST priority.
# This prevents the server from reading stale/wrong ports from server_config.json
# (which the browser may overwrite with incorrect cdp_port after launch).
export BROWSEROS_CDP_PORT="$PROD_CDP_PORT"
export BROWSEROS_SERVER_PORT="$PROD_SERVER_PORT"
export BROWSEROS_EXTENSION_PORT="$PROD_EXTENSION_PORT"
export BROWSEROS_PROXY_PORT="$PROD_SERVER_PORT"

# Start browser in background to capture real PID (exec loses $$)
# CLI flags MUST match server_config.json written above.
"$APP" \
  --no-sandbox \
  --remote-allow-origins=* \
  --class=org.chromium.Chromium \
  --user-data-dir="$PROD_PROFILE" \
  --remote-debugging-port="$PROD_CDP_PORT" \
  --browseros-extension-port="$PROD_EXTENSION_PORT" \
  --browseros-proxy-port="$PROD_SERVER_PORT" \
  --browseros-server-resources-dir="$PROD_SERVER_RESOURCES_DIR" \
  --disable-browseros-server-updater &

APP_PID=$!
echo "$APP_PID" > "$PROD_BROWSER_PID"
wait "$APP_PID"

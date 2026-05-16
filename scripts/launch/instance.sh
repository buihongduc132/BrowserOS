#!/usr/bin/env bash
# instance.sh — Parametric BrowserOS instance management
# Source this AFTER common.sh. Call declare_instance <dev|prod> first.
#
# Eliminates drift between dev/prod launch scripts by centralizing all
# instance-specific logic into parametric functions.
#
# Usage:
#   source "${REPO_ROOT}/scripts/launch/common.sh"
#   source "${REPO_ROOT}/scripts/launch/instance.sh"
#   REPO_ROOT="$(discover_repo_root)"
#   declare_instance dev   # or prod
#   # now use INSTANCE_* variables and instance functions

# ═══════════════════════════════════════════════════════════════════════
#  Guard: every function below requires declare_instance to have run
# ═══════════════════════════════════════════════════════════════════════
_require_instance() {
  [[ -v BOS_ENV ]] || { echo "[ERROR] Call declare_instance first (BOS_ENV not set)." >&2; return 1; }
}

# ═══════════════════════════════════════════════════════════════════════
#  discover_repo_root — single implementation replacing 10 copies
# ═══════════════════════════════════════════════════════════════════════
# Tries relative to BASH_SOURCE caller, then falls back to pwd.
discover_repo_root() {
  local candidate
  # BASH_SOURCE[1] is the caller's script (or BASH_SOURCE[0] if sourced directly)
  candidate="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" 2>/dev/null && pwd)" || candidate=""
  # Walk up to find packages/browseros-agent
  local dir="$candidate"
  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if [[ -d "${dir}/packages/browseros-agent" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  # Fallback: check if cwd has it
  if [[ -d "${PWD}/packages/browseros-agent" ]]; then
    echo "$PWD"
    return 0
  fi
  echo "$PWD"
}

# ═══════════════════════════════════════════════════════════════════════
#  declare_instance — constructor for all INSTANCE_* variables
# ═══════════════════════════════════════════════════════════════════════
# Usage: declare_instance <dev|prod>
declare_instance() {
  local env="${1:?Usage: declare_instance <dev|prod>}"

  if [[ "$env" != "dev" && "$env" != "prod" ]]; then
    echo "[ERROR] Unknown environment: $env (expected dev|prod)" >&2
    return 1
  fi

  BOS_ENV="$env"

  if [[ "$BOS_ENV" == "dev" ]]; then
    INSTANCE_PROFILE="${HOME}/.browseros-dev-chrome"
    INSTANCE_BOS_DIR="${HOME}/.browseros-dev"
    INSTANCE_CDP_PORT="${BROWSEROS_DEV_CDP_PORT:-9010}"
    INSTANCE_SERVER_PORT="${BROWSEROS_DEV_SERVER_PORT:-9115}"
    INSTANCE_EXTENSION_PORT="${BROWSEROS_DEV_EXTENSION_PORT:-9305}"
    INSTANCE_BROWSER_PID_FILE="${INSTANCE_BOS_DIR}/browser.pid"
    INSTANCE_SERVER_PID_FILE="${INSTANCE_BOS_DIR}/server.pid"
    INSTANCE_LOCK_FILE="${INSTANCE_BOS_DIR}/start.lock"
    INSTANCE_BROWSER_LOG="/tmp/browseros-dev-browser.log"
    INSTANCE_SERVER_LOG="/tmp/browseros-dev-server.log"
    INSTANCE_LOG_DIR="${INSTANCE_BOS_DIR}"
    INSTANCE_APP_CLASS="browseros-dev"
    INSTANCE_APP_NAME="BrowserOS-Dev"
    # Dev-specific: extension dir (relative to packages/browseros-agent)
    INSTANCE_EXT_DIR="apps/agent/dist/chrome-mv3-dev"
    INSTANCE_SERVER_RESOURCES_DIR=""
  elif [[ "$BOS_ENV" == "prod" ]]; then
    INSTANCE_PROFILE="${HOME}/.config/browser-os"
    INSTANCE_BOS_DIR="${HOME}/.browseros"
    INSTANCE_CDP_PORT="${BROWSEROS_CDP_PORT:-9104}"
    INSTANCE_SERVER_PORT="${BROWSEROS_SERVER_PORT:-9110}"
    INSTANCE_EXTENSION_PORT="${BROWSEROS_EXTENSION_PORT:-9300}"
    INSTANCE_BROWSER_PID_FILE="${INSTANCE_BOS_DIR}/browser.pid"
    INSTANCE_SERVER_PID_FILE="${INSTANCE_BOS_DIR}/server.pid"
    INSTANCE_LOCK_FILE="${INSTANCE_BOS_DIR}/start.lock"
    INSTANCE_BROWSER_LOG="${INSTANCE_BOS_DIR}/logs/browser.log"
    INSTANCE_SERVER_LOG="${INSTANCE_BOS_DIR}/logs/server.log"
    INSTANCE_LOG_DIR="${INSTANCE_BOS_DIR}/logs"
    INSTANCE_APP_CLASS="browseros"
    INSTANCE_APP_NAME="BrowserOS"
    INSTANCE_SERVER_RESOURCES_DIR="${BROWSEROS_SERVER_RESOURCES_DIR:-${REPO_ROOT}/.browseros-prod-resources}"
    INSTANCE_EXT_DIR=""
  fi

  INSTANCE_APP="${BROWSEROS_APP_PATH:-$HOME/Downloads/alta/BrowserOS.AppImage}"

  # Ensure state dirs exist
  mkdir -p "$INSTANCE_BOS_DIR" "$INSTANCE_LOG_DIR"

  # Auto-clean stale state (crash locks, singleton locks, stale PIDs)
  # This runs on EVERY launch — no manual cleanup ever needed.
  _clean_stale_instance_state
}

# ── Clean stale state for current instance ──
# Called by declare_instance. Safe to run on every launch.
_clean_stale_instance_state() {
  # Stale PID files from previous boot
  for pf in "$INSTANCE_BROWSER_PID_FILE" "$INSTANCE_SERVER_PID_FILE"; do
    if [[ -f "$pf" ]]; then
      local _pid
      _pid=$(cat "$pf" 2>/dev/null) || continue
      if ! kill -0 "$_pid" 2>/dev/null; then
        rm -f "$pf"
      fi
    fi
  done

  # Stale start lock
  rm -f "$INSTANCE_LOCK_FILE" 2>/dev/null || true

  # Stale Chromium singleton locks (prevent "profile in use" on fresh start)
  clean_singleton_locks "$INSTANCE_PROFILE"

  # Stale crash report lock files (prevent crashpad noise on startup)
  if [[ -d "${INSTANCE_PROFILE}/Crash Reports/pending" ]]; then
    rm -f "${INSTANCE_PROFILE}/Crash Reports/pending/"*.lock 2>/dev/null || true
  fi

  # Fix exit_type=Crashed in profile Preferences (triggers profile picker)
  # BrowserOS shows profile picker on every launch if previous session crashed.
  # Our kill -9 always looks like a crash. Patch it before launch.
  local _prefs="${INSTANCE_PROFILE}/Default/Preferences"
  if [[ -f "$_prefs" ]]; then
    python3 -c "
import json, sys
try:
  with open(sys.argv[1]) as f:
    p = json.load(f)
  if p.get('profile',{}).get('exit_type') == 'Crashed':
    p['profile']['exit_type'] = 'SessionEnded'
    with open(sys.argv[1], 'w') as f:
      json.dump(p, f)
except: pass
" "$_prefs" 2>/dev/null || true
  fi
}

# ═══════════════════════════════════════════════════════════════════════
#  ensure_desktop_entries — shared guard for .desktop file existence
# ═══════════════════════════════════════════════════════════════════════
ensure_desktop_entries() {
  _require_instance || return 1
  local desktop_name
  if [[ "$BOS_ENV" == "dev" ]]; then
    desktop_name="browseros-dev.desktop"
  else
    desktop_name="browseros.desktop"
  fi
  if [ ! -f "${HOME}/.local/share/applications/${desktop_name}" ]; then
    "${REPO_ROOT}/scripts/setup-desktop-entries.sh" 2>/dev/null || true
  fi
}

# ═══════════════════════════════════════════════════════════════════════
#  preflight_checks — singleton flock + browser check + port orphans + clean locks
# ═══════════════════════════════════════════════════════════════════════
# Sets LOCK_FD for later release via release_lock.
# Exits/returns 1 on failure.
preflight_checks() {
  _require_instance || return 1

  # Singleton guard with flock
  LOCK_FD=200
  eval "exec $LOCK_FD>\"${INSTANCE_LOCK_FILE}\""
  flock -n $LOCK_FD || {
    echo "[ERROR] Another start-${BOS_ENV} is already running (lock held)." >&2
    echo "        If stale, remove ${INSTANCE_LOCK_FILE}" >&2
    return 1
  }

  # Check if browser already running
  if is_browser_running "$INSTANCE_BROWSER_PID_FILE"; then
    local old_pid
    old_pid=$(cat "$INSTANCE_BROWSER_PID_FILE")
    echo "[ERROR] ${BOS_ENV} browser already running (PID $old_pid)." >&2
    echo "        Run 'mise run browseros:kill-${BOS_ENV}' first." >&2
    return 1
  fi

  # Port orphan cleanup — matchers differ by env
  local cdp_matcher="browseros"
  local server_matcher
  if [[ "$BOS_ENV" == "dev" ]]; then
    server_matcher="bun"
  else
    server_matcher="browseros"
  fi

  if port_in_use "$INSTANCE_CDP_PORT"; then
    echo "[preflight] CDP port $INSTANCE_CDP_PORT occupied — attempting orphan cleanup..."
    kill_port_orphan "$INSTANCE_CDP_PORT" "$cdp_matcher"
    sleep 1
    if port_in_use "$INSTANCE_CDP_PORT"; then
      echo "[ERROR] CDP port $INSTANCE_CDP_PORT still in use after cleanup." >&2
      echo "        Run 'mise run browseros:kill-${BOS_ENV}' first." >&2
      return 1
    fi
  fi
  if port_in_use "$INSTANCE_SERVER_PORT"; then
    echo "[preflight] Server port $INSTANCE_SERVER_PORT occupied — attempting orphan cleanup..."
    kill_port_orphan "$INSTANCE_SERVER_PORT" "$server_matcher"
    sleep 1
    if port_in_use "$INSTANCE_SERVER_PORT"; then
      echo "[ERROR] Server port $INSTANCE_SERVER_PORT still in use after cleanup." >&2
      echo "        Run 'mise run browseros:kill-${BOS_ENV}' first." >&2
      return 1
    fi
  fi

  # Clean stale singleton locks
  clean_singleton_locks "$INSTANCE_PROFILE"
}

# ═══════════════════════════════════════════════════════════════════════
#  write_server_config — port pinning for prod (writes server_config.json + Local State)
# ═══════════════════════════════════════════════════════════════════════
# Usage: write_server_config <profile> <cdp_port> <server_port> <ext_port> [resources_dir]
write_server_config() {
  _require_instance || return 1
  local profile="$1"
  local cdp_port="$2"
  local server_port="$3"
  local ext_port="$4"
  local resources_dir="${5:-}"

  python3 - "$profile" "$cdp_port" "$server_port" "$ext_port" "$resources_dir" <<'PYEOF'
import json, os, sys

profile = sys.argv[1]
cdp_port, srv_port, ext_port = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
resources_dir = sys.argv[5] if len(sys.argv) > 5 else ""

# 1. Write server_config.json (read by spawned server binary)
config_dir = os.path.join(profile, ".browseros")
os.makedirs(config_dir, exist_ok=True)
config_path = os.path.join(config_dir, "server_config.json")
cfg = {
    "directories": {
        "execution": os.path.join(profile, ".browseros"),
        "resources": resources_dir or os.path.join(profile, ".browseros")
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

print(f"Fixed ports: cdp={cdp_port}, server={srv_port}, extension={ext_port}")
print(f"  Wrote {config_path}")
print(f"  Wrote {local_state_path}")
PYEOF
}

# ═══════════════════════════════════════════════════════════════════════
#  launch_browser — parameterized by BOS_ENV
# ═══════════════════════════════════════════════════════════════════════
# Launches the browser in the background. Writes PID to INSTANCE_BROWSER_PID_FILE.
launch_browser() {
  _require_instance || return 1

  # Verify AppImage exists
  if [ ! -x "$INSTANCE_APP" ]; then
    echo "[ERROR] BrowserOS AppImage missing: $INSTANCE_APP" >&2
    echo "        Set BROWSEROS_APP_PATH env var to override." >&2
    return 1
  fi

  if [[ "$BOS_ENV" == "dev" ]]; then
    # Dev: loads local extension ON TOP of bundled ones, disables embedded server only
    local ext_dir="${REPO_ROOT}/packages/browseros-agent/${INSTANCE_EXT_DIR}"
    if [ ! -d "$ext_dir" ]; then
      echo "[ERROR] Dev extension build missing: $ext_dir" >&2
      echo "        Run: mise run browseros:build-dev" >&2
      return 1
    fi
    echo "[start] Launching BrowserOS Dev (CDP=$INSTANCE_CDP_PORT, Server=$INSTANCE_SERVER_PORT)..."
    local _sandbox
    _sandbox=$(_sandbox_flag)
    [ -n "$_sandbox" ] && echo "[start] Sandbox: $_sandbox (AppArmor userns restricted)"
    nohup "$INSTANCE_APP" \
      ${_sandbox} \
      --remote-allow-origins=* \
      --no-first-run \
      --no-default-browser-check \
      --use-mock-keychain \
      --show-component-extension-options \
      --disable-browseros-server \
      --name="$INSTANCE_APP_NAME" \
      --class="$INSTANCE_APP_CLASS" \
      --remote-debugging-port="$INSTANCE_CDP_PORT" \
      --browseros-extension-port="$INSTANCE_EXTENSION_PORT" \
      --browseros-mcp-port="$INSTANCE_SERVER_PORT" \
      --browseros-server-port="$INSTANCE_SERVER_PORT" \
      --user-data-dir="$INSTANCE_PROFILE" \
      --load-extension="$ext_dir" \
      chrome://newtab \
      > "$INSTANCE_BROWSER_LOG" 2>&1 &
  elif [[ "$BOS_ENV" == "prod" ]]; then
    # Prod: uses bundled extension, embedded server
    # Write port config BEFORE launch
    write_server_config "$INSTANCE_PROFILE" "$INSTANCE_CDP_PORT" "$INSTANCE_SERVER_PORT" "$INSTANCE_EXTENSION_PORT" "${INSTANCE_SERVER_RESOURCES_DIR:-}"

    # Export env vars (highest priority for server binary)
    export BROWSEROS_CDP_PORT="$INSTANCE_CDP_PORT"
    export BROWSEROS_SERVER_PORT="$INSTANCE_SERVER_PORT"
    export BROWSEROS_EXTENSION_PORT="$INSTANCE_EXTENSION_PORT"
    export BROWSEROS_PROXY_PORT="$INSTANCE_SERVER_PORT"
    export BROWSEROS_SKIP_OPENCLAW=1

    # Clean crash reports
    rm -f "${INSTANCE_PROFILE}/Crash Reports/pending/"*.lock 2>/dev/null || true

    echo "[start] Launching BrowserOS Prod (CDP=$INSTANCE_CDP_PORT, Server=$INSTANCE_SERVER_PORT)..."
    local _sandbox
    _sandbox=$(_sandbox_flag)
    [ -n "$_sandbox" ] && echo "[start] Sandbox: $_sandbox (AppArmor userns restricted)"
    "$INSTANCE_APP" \
      ${_sandbox} \
      --remote-allow-origins=* \
      --class="$INSTANCE_APP_CLASS" \
      --user-data-dir="$INSTANCE_PROFILE" \
      --remote-debugging-port="$INSTANCE_CDP_PORT" \
      --browseros-extension-port="$INSTANCE_EXTENSION_PORT" \
      --browseros-proxy-port="$INSTANCE_SERVER_PORT" \
      --browseros-server-resources-dir="${INSTANCE_SERVER_RESOURCES_DIR:-}" \
      --disable-browseros-server-updater &
  fi

  local browser_pid=$!
  echo "$browser_pid" > "$INSTANCE_BROWSER_PID_FILE"
  echo "[start] Browser PID: $browser_pid"
}

# ═══════════════════════════════════════════════════════════════════════
#  wait_cdp — wait for CDP port to open
# ═══════════════════════════════════════════════════════════════════════
# Usage: wait_cdp [timeout_secs]
wait_cdp() {
  _require_instance || return 1
  local timeout_secs="${1:-30}"
  echo "[wait] Waiting for CDP port $INSTANCE_CDP_PORT..."
  python3 - "$INSTANCE_CDP_PORT" "$timeout_secs" <<"PY"
import socket, time, sys
port = int(sys.argv[1])
timeout = int(sys.argv[2])
for _ in range(timeout * 2):
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(("127.0.0.1", port))
        s.close()
        sys.exit(0)
    except OSError:
        time.sleep(0.5)
print(f"[ERROR] CDP port {port} did not open within {timeout}s", file=sys.stderr)
sys.exit(1)
PY
  echo "[wait] Browser ready on CDP port $INSTANCE_CDP_PORT"
}

# ═══════════════════════════════════════════════════════════════════════
#  trigger_extensions — create CDP tabs to force extension loading
# ═══════════════════════════════════════════════════════════════════════
# BrowserOS shows a profile picker that blocks --load-extension activation.
# Creating tabs via CDP triggers extension service worker startup.
# Two tabs needed: 1st triggers bundled extensions, 2nd triggers --load-extension.
trigger_extensions() {
  _require_instance || return 1
  if [[ "$BOS_ENV" != "dev" ]]; then
    return 0
  fi
  echo "[trigger] Creating CDP tabs to trigger extension loading..."
  python3 - "$INSTANCE_CDP_PORT" <<'PY'
import json, urllib.request, time, sys
port = sys.argv[1]
base = f"http://localhost:{port}"

# Create two tabs: first triggers bundled extensions, second triggers --load-extension
for i, url in enumerate(["chrome://newtab", "about:blank"]):
    for attempt in range(3):
        try:
            req = urllib.request.Request(f"{base}/json/new?{url}", method="PUT")
            urllib.request.urlopen(req, timeout=10)
            break
        except Exception:
            time.sleep(2)
    time.sleep(3)

# Verify extensions loaded
req = urllib.request.Request(f"{base}/json/list")
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())
ext_workers = [t for t in tabs if t["type"] == "service_worker"]
if len(ext_workers) < 2:
    print(f"[ERROR] Only {len(ext_workers)} extension workers loaded (expected >=2). Extension loading failed.", file=sys.stderr)
    sys.exit(1)
else:
    print(f"[trigger] {len(ext_workers)} extensions loaded")
PY
}

# ═══════════════════════════════════════════════════════════════════════
#  start_dev_server — dev only: launches bun run start:ci as separate process
# ═══════════════════════════════════════════════════════════════════════
start_dev_server() {
  _require_instance || return 1
  if [[ "$BOS_ENV" != "dev" ]]; then
    echo "[ERROR] start_dev_server called for prod (prod uses embedded server)" >&2
    return 1
  fi
  # bun --filter requires cwd inside a workspace with package.json
  cd "${REPO_ROOT}/packages/browseros-agent"
  echo "[start] Launching dev server..."
  nohup env \
    BROWSEROS_SKIP_OPENCLAW=1 \
    BROWSEROS_CDP_PORT="$INSTANCE_CDP_PORT" \
    BROWSEROS_SERVER_PORT="$INSTANCE_SERVER_PORT" \
    BROWSEROS_EXTENSION_PORT="$INSTANCE_EXTENSION_PORT" \
    bun run --filter @browseros/server start:ci \
    > "$INSTANCE_SERVER_LOG" 2>&1 &
  local server_pid=$!
  echo "$server_pid" > "$INSTANCE_SERVER_PID_FILE"
  echo "[start] Server PID: $server_pid"
}

# ═══════════════════════════════════════════════════════════════════════
#  wait_server_health — wait for server readiness
# ═══════════════════════════════════════════════════════════════════════
# Usage: wait_server_health [timeout_secs] [mode]
#   mode=basic — dev: status=ok + cdpConnected=true
#   mode=soak  — prod: health + adapters + MCP proxy + soak test
wait_server_health() {
  _require_instance || return 1
  local timeout_secs="${1:-30}"
  local mode="${2:-basic}"

  echo "[wait] Waiting for server health on port $INSTANCE_SERVER_PORT..."

  if [[ "$mode" == "soak" ]]; then
    # Prod: multi-endpoint readiness + soak test
    python3 - "$INSTANCE_SERVER_PORT" "$timeout_secs" <<'PY'
import json, sys, time, urllib.request
port = int(sys.argv[1])
timeout = int(sys.argv[2])
checks = [
    (f"http://127.0.0.1:{port}/health", lambda data: data.get("status") == "ok"),
    (f"http://127.0.0.1:{port}/agents/adapters", lambda data: isinstance(data.get("adapters"), list) and len(data["adapters"]) > 0),
]
for _ in range(timeout * 2):
    ready = True
    for url, predicate in checks:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                body = json.load(resp)
            if not predicate(body):
                ready = False
                break
        except Exception:
            ready = False
            break
    if ready:
        sys.exit(0)
    time.sleep(0.5)
print(f"[ERROR] Prod endpoints did not become ready on port {port}", file=sys.stderr)
sys.exit(1)
PY

    # Soak test phase
    python3 - "$INSTANCE_SERVER_PORT" "$INSTANCE_SERVER_PORT" <<'PYEOF'
import json, sys, time, urllib.request
http_port = int(sys.argv[1])
proxy_port = int(sys.argv[2])
checks = [
    ("health", f"http://127.0.0.1:{http_port}/health", lambda data: data.get("status") == "ok"),
    (
        "agents_adapters",
        f"http://127.0.0.1:{http_port}/agents/adapters",
        lambda data: isinstance(data.get("adapters"), list) and len(data["adapters"]) > 0 and any(item.get("id") == "claude" for item in data["adapters"]),
    ),
    (
        "mcp_proxy",
        f"http://127.0.0.1:{proxy_port}/mcp",
        lambda data: data.get("status") == "ok",
    ),
]

for phase in range(2):
    label = "smoke" if phase == 0 else "soak"
    if phase == 1:
        time.sleep(10)
    for name, url, predicate in checks:
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = json.load(resp)
        if not predicate(body):
            raise SystemExit(f"[ERROR] {label} check failed for {url}: {body}")
        print(json.dumps({"phase": label, "check": name, "url": url, "body": body}))
PYEOF
  else
    # Dev: basic health check (status=ok + cdpConnected=true)
    python3 - "$INSTANCE_SERVER_PORT" "$timeout_secs" <<"PY"
import json, time, urllib.request, sys
port = sys.argv[1]
timeout = int(sys.argv[2])
url = f"http://127.0.0.1:{port}/health"
for _ in range(timeout * 2):
    try:
        with urllib.request.urlopen(url, timeout=1) as r:
            data = json.load(r)
        if data.get("status") == "ok" and data.get("cdpConnected") is True:
            print(json.dumps(data))
            sys.exit(0)
        time.sleep(1)
    except Exception:
        time.sleep(0.5)
print(f"[ERROR] Server health check failed on {url}", file=sys.stderr)
sys.exit(1)
PY
  fi
  echo "[wait] Server ready on port $INSTANCE_SERVER_PORT"
}

# ═══════════════════════════════════════════════════════════════════════
#  check_health — single HTTP GET, no retry (for health-dev)
# ═══════════════════════════════════════════════════════════════════════
check_health() {
  _require_instance || return 1
  python3 - "$INSTANCE_SERVER_PORT" <<"PY"
import json, sys, urllib.request
port = sys.argv[1]
try:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as r:
        print(json.dumps(json.load(r)))
except Exception as e:
    print(f"[ERROR] Health check failed: {e}", file=sys.stderr)
    sys.exit(1)
PY
}

# ═══════════════════════════════════════════════════════════════════════
#  copy_server_resources — prod only: copies server binary + SQL migrations
# ═══════════════════════════════════════════════════════════════════════
copy_server_resources() {
  _require_instance || return 1
  if [[ "$BOS_ENV" != "prod" ]]; then
    return 0
  fi

  local resources_dir="${INSTANCE_SERVER_RESOURCES_DIR}"
  mkdir -p "$resources_dir/bin" "$resources_dir/db/migrations/meta"

  local server_src="${REPO_ROOT}/packages/browseros-agent/dist/prod/server/linux-x64/resources/bin/browseros_server"
  if [[ -f "$server_src" ]]; then
    cp "$server_src" "$resources_dir/bin/browseros_server"
    chmod +x "$resources_dir/bin/browseros_server"
  fi

  local migration_dir="${REPO_ROOT}/packages/browseros-agent/apps/server/src/lib/db/migrations"
  if [[ -d "$migration_dir" ]]; then
    cp "${migration_dir}/"*.sql "$resources_dir/db/migrations/" 2>/dev/null || true
    cp "${migration_dir}/meta/"* "$resources_dir/db/migrations/meta/" 2>/dev/null || true
  fi
}

# ═══════════════════════════════════════════════════════════════════════
#  kill_instance — unified kill using kill_tree for BOTH envs
# ═══════════════════════════════════════════════════════════════════════
# Fixes prod bug where it only used kill_by_pidfile (missed process tree).
kill_instance() {
  _require_instance || return 1

  echo "[kill] Stopping BrowserOS ${BOS_ENV} instance..."

  # Dev: stop systemd services first (they use same ports)
  if [[ "$BOS_ENV" == "dev" ]]; then
    systemctl --user stop browser-os-dev-server 2>/dev/null || true
    systemctl --user stop browser-os-dev-app 2>/dev/null || true
  fi

  # Kill browser (entire process tree — catches GPU/renderer/zygote)
  if is_browser_running "$INSTANCE_BROWSER_PID_FILE"; then
    local pid
    pid=$(cat "$INSTANCE_BROWSER_PID_FILE")
    echo "[kill] Stopping ${BOS_ENV} browser (PID $pid) and process tree..."
    # Verify it's the right process before tree kill
    local cmdline
    cmdline=$(cat "/proc/${pid}/cmdline" 2>/dev/null | tr '\0' ' ') || true
    case "$cmdline" in
      *"BrowserOS"*|*"browseros-dev-chrome"*|*"browser-os"*|*"chrome"*)
        kill_tree "$pid"
        ;;
      *)
        echo "[WARN] PID $pid cmdline mismatch — falling back to single-process kill" >&2
        kill_by_pidfile "$INSTANCE_BROWSER_PID_FILE" "BrowserOS"
        ;;
    esac
    rm -f "$INSTANCE_BROWSER_PID_FILE"
  else
    echo "[kill] Browser not running."
  fi

  # Kill server process
  if [[ -f "$INSTANCE_SERVER_PID_FILE" ]]; then
    local pid
    pid=$(cat "$INSTANCE_SERVER_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "[kill] Stopping ${BOS_ENV} server (PID $pid) and process tree..."
      kill_tree "$pid"
    else
      echo "[kill] Server already dead (PID $pid)."
    fi
    rm -f "$INSTANCE_SERVER_PID_FILE"
  else
    # Prod-specific: try pattern-based kills for server and orphaned browser processes
    if [[ "$BOS_ENV" == "prod" ]]; then
      pkill -f "browseros_server.*config.*browser-os" 2>/dev/null && echo "[kill] Stopped BrowserOS server" || true
      pkill -f "mount_Browse.*opt/browseros/browseros" 2>/dev/null && echo "[kill] Killed orphaned browser process" || true
      # Kill AppImage processes that are NOT using the dev profile
      local pids
      pids=$(pgrep -f "BrowserOS.AppImage" 2>/dev/null || true)
      if [ -n "$pids" ]; then
        for p in $pids; do
          if cat "/proc/$p/cmdline" 2>/dev/null | tr '\0' '\n' | grep -q "browseros-dev-chrome"; then
            continue  # skip dev instance
          fi
          kill "$p" 2>/dev/null && echo "[kill] Killed prod AppImage (PID $p)" || true
        done
      fi
    fi
    if [[ "$BOS_ENV" == "dev" ]]; then
      echo "[kill] Server not running."
    fi
  fi

  # Fallback: kill orphans by port (PID file may be missing/wrong)
  local server_matcher
  if [[ "$BOS_ENV" == "dev" ]]; then
    server_matcher="bun"
  else
    server_matcher="browseros"
  fi
  kill_port_orphan "$INSTANCE_SERVER_PORT" "$server_matcher"
  kill_port_orphan "$INSTANCE_CDP_PORT" "browseros"

  # Clean singleton locks if no browser process exists
  if ! is_browser_running "$INSTANCE_BROWSER_PID_FILE"; then
    clean_singleton_locks "$INSTANCE_PROFILE"
  fi

  # Clean stale start lock
  rm -f "$INSTANCE_LOCK_FILE" 2>/dev/null || true

  echo "[kill] ${BOS_ENV} instance stopped."
}

# ═══════════════════════════════════════════════════════════════════════
#  print_status — formatted status output
# ═══════════════════════════════════════════════════════════════════════
print_status() {
  _require_instance || return 1

  local browser_status="STOPPED"
  local server_status="STOPPED"
  local browser_pid_str="-"
  local server_pid_str="-"

  if is_browser_running "$INSTANCE_BROWSER_PID_FILE"; then
    browser_status="RUNNING"
    browser_pid_str=$(cat "$INSTANCE_BROWSER_PID_FILE")
  fi

  if [[ -f "$INSTANCE_SERVER_PID_FILE" ]]; then
    local pid
    pid=$(cat "$INSTANCE_SERVER_PID_FILE")
    if verify_pid "$pid" "@browseros/server" || verify_pid "$pid" "bun"; then
      server_status="RUNNING"
      server_pid_str="$pid"
    fi
  fi

  local cdp_status="free"
  local server_port_status="free"
  port_in_use "$INSTANCE_CDP_PORT" && cdp_status="in use"
  port_in_use "$INSTANCE_SERVER_PORT" && server_port_status="in use"

  local env_label="Dev"
  [[ "$BOS_ENV" == "prod" ]] && env_label="Prod"

  echo "┌─────────────────────────────────────────────────┐"
  echo "│ BrowserOS ${env_label} Status$(printf '%*s' $((21 - ${#env_label})) '')│"
  echo "├─────────────────────────────────────────────────┤"
  echo "│ Browser:  ${browser_status}  PID: ${browser_pid_str}"
  echo "│ Server:   ${server_status}  PID: ${server_pid_str}"
  echo "│ CDP port: ${INSTANCE_CDP_PORT} (${cdp_status})"
  echo "│ Srv port: ${INSTANCE_SERVER_PORT} (${server_port_status})"
  echo "│ Profile:  ${INSTANCE_PROFILE}"
  echo "│ Config:   ${INSTANCE_BOS_DIR}"
  echo "│ Pidfiles: ${INSTANCE_BOS_DIR}/"
  echo "└─────────────────────────────────────────────────┘"
}

# ═══════════════════════════════════════════════════════════════════════
#  wait_ports_released — wait after kill for ports to be free
# ═══════════════════════════════════════════════════════════════════════
# Usage: wait_ports_released [max_wait_secs]
wait_ports_released() {
  _require_instance || return 1
  local max_wait="${1:-10}"
  for i in $(seq 1 $((max_wait * 2))); do
    port_in_use "$INSTANCE_CDP_PORT" || port_in_use "$INSTANCE_SERVER_PORT" || break
    sleep 0.5
  done
}

# ═══════════════════════════════════════════════════════════════════════
#  release_lock — release flock acquired by preflight_checks
# ═══════════════════════════════════════════════════════════════════════
release_lock() {
  _require_instance || return 1
  flock -u $LOCK_FD 2>/dev/null || true
}

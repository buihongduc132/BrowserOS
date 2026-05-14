#!/usr/bin/env bash
# common.sh — Shared functions for BrowserOS deployment scripts
# Sourced by kill-dev, start-dev, restart-dev, and launch scripts.
#
# PID files live in the BrowserOS state directory (not /tmp):
#   Dev:  ~/.browseros-dev/browser.pid, ~/.browseros-dev/server.pid
#   Prod: ~/.browseros/browser.pid, ~/.browseros/server.pid
#
# This ensures PID files survive reboots predictably and are
# co-located with the profile data they protect.

# ── Directory constants ──
DEV_PROFILE="${HOME}/.browseros-dev-chrome"
DEV_BOS_DIR="${HOME}/.browseros-dev"
PROD_PROFILE="${HOME}/.config/browser-os"
PROD_BOS_DIR="${HOME}/.browseros"

# ── PID file paths (in state dir, not /tmp) ──
DEV_BROWSER_PID="${DEV_BOS_DIR}/browser.pid"
DEV_SERVER_PID="${DEV_BOS_DIR}/server.pid"
PROD_BROWSER_PID="${PROD_BOS_DIR}/browser.pid"
PROD_SERVER_PID="${PROD_BOS_DIR}/server.pid"

# ── Dev ports (override with BROWSEROS_DEV_CDP_PORT etc.) ──
# Dev uses +10 offset from prod defaults to allow side-by-side operation.
DEV_CDP_PORT="${BROWSEROS_DEV_CDP_PORT:-9010}"
DEV_SERVER_PORT="${BROWSEROS_DEV_SERVER_PORT:-9115}"
DEV_EXTENSION_PORT="${BROWSEROS_DEV_EXTENSION_PORT:-9305}"

# ── Prod ports (override with BROWSEROS_CDP_PORT etc.) ──
PROD_CDP_PORT="${BROWSEROS_CDP_PORT:-9104}"
PROD_SERVER_PORT="${BROWSEROS_SERVER_PORT:-9110}"
PROD_EXTENSION_PORT="${BROWSEROS_EXTENSION_PORT:-9300}"
# proxy_port always equals server_port (unified port model since v0.39)
PROD_PROXY_PORT="$PROD_SERVER_PORT"

# ── Verify a PID is alive AND matches expected process ──
# Usage: verify_pid <pid> <expected_cmdline_substring>
# Returns 0 if PID is alive and cmdline contains the expected substring.
verify_pid() {
  local pid="$1"
  local expected="$2"

  # Check process exists
  kill -0 "$pid" 2>/dev/null || return 1

  # Verify cmdline matches expected pattern (prevents recycled PID kills)
  local cmdline
  cmdline=$(cat "/proc/${pid}/cmdline" 2>/dev/null | tr '\0' ' ') || return 1

  # Match if cmdline contains expected substring
  # Use case/esac for literal substring matching (no glob surprises)
  case "$cmdline" in
    *"$expected"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Check if browser is running ──
# Usage: is_browser_running <pid_file>
is_browser_running() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if verify_pid "$pid" "chrome"; then
      return 0
    fi
    # Also match AppImage launcher
    if verify_pid "$pid" "BrowserOS"; then
      return 0
    fi
    # Stale PID file — clean it
    rm -f "$pid_file"
  fi
  return 1
}

# ── Check if a port is in use ──
# Usage: port_in_use <port>
port_in_use() {
  local port="$1"
  python3 -c "import socket; s=socket.socket(); s.settimeout(0.3); s.connect(('127.0.0.1',$port)); s.close()" 2>/dev/null
}

# ── Kill a process by PID file with verification ──
# Usage: kill_by_pidfile <pid_file> <expected_cmdline> [signal]
# Returns 0 if process was stopped or already dead.
kill_by_pidfile() {
  local pid_file="$1"
  local expected="$2"
  local sig="${3:-TERM}"

  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid=$(cat "$pid_file")

  if ! kill -0 "$pid" 2>/dev/null; then
    # Already dead
    rm -f "$pid_file"
    return 0
  fi

  # Verify this is the right process before killing
  if ! verify_pid "$pid" "$expected"; then
    echo "[WARN] PID $pid doesn't match expected '$expected' — skipping kill (recycled PID?)" >&2
    rm -f "$pid_file"
    return 1
  fi

  # Graceful stop
  kill -s "$sig" "$pid" 2>/dev/null || true

  # Wait up to 5s
  local i
  for i in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done

  # Force kill if still alive
  if kill -0 "$pid" 2>/dev/null; then
    echo "[kill] Force-killing PID $pid..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.5
  fi

  rm -f "$pid_file"
  return 0
}

# ── Kill an entire process tree (parent + all descendants) ──
# Usage: kill_tree <pid> [signal]
# Uses /proc to walk the process tree recursively, then waits for cleanup.
kill_tree() {
  local pid="$1"
  local sig="${2:-TERM}"

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  # Try process-group kill first (most reliable for Chromium)
  # Read PGID from /proc/$pid/stat (field 5)
  local pgid
  pgid=$(awk '{print $5}' "/proc/${pid}/stat" 2>/dev/null) || pgid=""
  if [ -n "$pgid" ] && [ "$pgid" != "$pid" ]; then
    kill -s "$sig" -- "-$pgid" 2>/dev/null || true
  fi

  # Also collect descendants via BFS as fallback (catches children in different groups)
  local all_pids=("$pid")
  local queue=("$pid")
  local idx=0
  while [ $idx -lt ${#queue[@]} ]; do
    local ppid="${queue[$idx]}"
    idx=$((idx + 1))
    local children
    children=$(ps --ppid "$ppid" -o pid= 2>/dev/null) || true
    if [ -n "$children" ]; then
      local child
      for child in $children; do
        case " ${all_pids[*]} " in
          *" $child "*) continue ;;  # already tracked
        esac
        all_pids+=("$child")
        queue+=("$child")
      done
    fi
  done

  # Send signal to all PIDs in tree
  local p
  for p in "${all_pids[@]}"; do
    kill -s "$sig" "$p" 2>/dev/null || true
  done

  # Wait up to 5s for all to die
  local attempt
  for attempt in $(seq 1 10); do
    local alive=0
    for p in "${all_pids[@]}"; do
      kill -0 "$p" 2>/dev/null && alive=1 && break
    done
    [ "$alive" -eq 0 ] && break
    sleep 0.5
  done

  # SIGKILL any survivors
  for p in "${all_pids[@]}"; do
    if kill -0 "$p" 2>/dev/null; then
      kill -9 "$p" 2>/dev/null || true
    fi
  done
  sleep 0.3
}

# ── Clean stale Chromium singleton locks (safe: call only after verifying no process) ──
# Usage: clean_singleton_locks <profile_dir>
clean_singleton_locks() {
  local profile_dir="$1"
  if [[ -d "$profile_dir" ]]; then
    rm -f "$profile_dir/SingletonLock" "$profile_dir/SingletonCookie" "$profile_dir/SingletonSocket" 2>/dev/null || true
  fi
}

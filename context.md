# Code Context: BrowserOS Dev Launch Infrastructure

## Files Retrieved

### Launch Scripts (`scripts/launch/`)
1. `scripts/launch/common.sh` (full) — Shared functions: sandbox detection, PID/port helpers, kill logic, process tree walk, orphan cleanup
2. `scripts/launch/instance.sh` (full) — Parametric instance manager: `declare_instance dev|prod` sets all `INSTANCE_*` vars; provides `launch_browser`, `start_dev_server`, `preflight_checks`, `kill_instance`, `wait_cdp`, `wait_server_health`, `write_server_config`, `copy_server_resources`, `print_status`
3. `scripts/launch/launch-browseros-prod.sh` (full) — Prod GUI launcher (called by `.desktop`): writes server config → cleans locks → exports env vars → `exec` AppImage with prod flags
4. `scripts/launch/launch-browseros-dev.sh` (full) — Dev GUI launcher (called by `.desktop`): validates mise → checks running → `exec mise run browseros:start-dev`

### Mise Tasks (`.mise/tasks/browseros/`)
5. `.mise/tasks/browseros/start-dev` — Full dev lifecycle: preflight → ensure desktop → check extension build → launch_browser → wait_cdp → start_dev_server → wait_server_health
6. `.mise/tasks/browseros/start-prod` — Prod lifecycle: check AppImage → ensure desktop → port orphan cleanup → copy_server_resources → nohup launch-browseros-prod.sh → wait_server_health (soak mode, 120s)
7. `.mise/tasks/browseros/build-dev` — `bun wxt build` in agent app, moves `dist/chrome-mv3` → `dist/chrome-mv3-dev`
8. `.mise/tasks/browseros/restart-dev` — kill → wait ports → build-dev → start-dev → smoke test
9. `.mise/tasks/browseros/kill-dev` — `declare_instance dev` → `kill_instance`
10. `.mise/tasks/browseros/kill-prod` — `declare_instance prod` → `kill_instance`
11. `.mise/tasks/browseros/health-dev` — Single HTTP GET `/health`
12. `.mise/tasks/browseros/status` — Print dev instance status box
13. `.mise/tasks/browseros/setup` — Idempotent bootstrap: prerequisites → state dirs → stale cleanup → .env files → desktop entries → Go CLI → bun install → extension build

### Desktop & Icons
14. `scripts/setup-desktop-entries.sh` (full) — Installs icons (extracts from AppImage, creates β badge for dev) + writes `browseros.desktop` and `browseros-dev.desktop`
15. `~/.local/share/applications/browseros.desktop` — Prod entry: `Exec=bash -c 'exec .../launch-browseros-prod.sh'`, `StartupWMClass=browseros`, `Terminal=false`
16. `~/.local/share/applications/browseros-dev.desktop` — Dev entry: `Exec=bash .../launch-browseros-dev.sh`, `StartupWMClass=browseros-dev`, `Terminal=true`

## Key Code

### Port Configuration (from `common.sh`)

| Port | Dev Default | Prod Default | Env Override |
|------|-------------|--------------|--------------|
| CDP  | 9010        | 9104         | `BROWSEROS_DEV_CDP_PORT` / `BROWSEROS_CDP_PORT` |
| Server | 9115      | 9110         | `BROWSEROS_DEV_SERVER_PORT` / `BROWSEROS_SERVER_PORT` |
| Extension | 9305    | 9300         | `BROWSEROS_DEV_EXTENSION_PORT` / `BROWSEROS_EXTENSION_PORT` |

### Profile Paths

| | Dev | Prod |
|--|-----|------|
| Chrome profile | `~/.browseros-dev-chrome` | `~/.config/browser-os` |
| State dir | `~/.browseros-dev` | `~/.browseros` |
| Server resources | (none — bun runs locally) | `.browseros-prod-resources/` |

### Critical Flag Differences: Dev vs Prod Browser Launch

**Dev flags (instance.sh `launch_browser` dev branch):**
```bash
--no-first-run
--no-default-browser-check
--use-mock-keychain
--show-component-extension-options
--disable-browseros-server          # ← disables embedded server
--disable-browseros-extensions      # ← disables bundled extensions
--name="BrowserOS-Dev"
--class="browseros-dev"             # ← separate WM class for GNOME
--remote-debugging-port=9010
--browseros-mcp-port=9115           # ← uses mcp-port, NOT proxy-port
--browseros-server-port=9115
--user-data-dir=~/.browseros-dev-chrome
--load-extension=<repo>/dist/chrome-mv3-dev  # ← loads local build
chrome://newtab                     # ← opens newtab on launch
```

**Prod flags (instance.sh `launch_browser` prod branch + launch-browseros-prod.sh):**
```bash
--remote-allow-origins=*            # ← PROD ONLY
--class="browseros"
--remote-debugging-port=9104
--browseros-extension-port=9300     # ← PROD ONLY
--browseros-proxy-port=9110         # ← PROD ONLY (proxy = server port)
--browseros-server-resources-dir=...  # ← PROD ONLY
--disable-browseros-server-updater  # ← PROD ONLY
--user-data-dir=~/.config/browser-os
# NO --disable-browseros-server     (uses embedded server)
# NO --disable-browseros-extensions (uses bundled extensions)
# NO --load-extension               (uses bundled extensions)
# NO --browseros-mcp-port           (uses proxy-port instead)
```

### Running Prod Instance (live `ps` output)

AppImage main process:
```
BrowserOS.AppImage \
  --remote-allow-origins=* \
  --class=browseros \
  --user-data-dir=/home/bhd/.config/browser-os \
  --remote-debugging-port=9104 \
  --browseros-extension-port=9300 \
  --browseros-proxy-port=9110 \
  --browseros-server-resources-dir=.../BrowserOS/.browseros-prod-resources \
  --disable-browseros-server-updater
```

Spawned server binary (separate process from AppImage):
```
browseros_server \
  --config=/home/bhd/.config/browser-os/.browseros/server_config.json \
  --cdp-port=9104 \
  --server-port=9200 \      ← NOTE: 9200, NOT 9110!
  --extension-port=9300
```

### Key Difference Summary

| Aspect | Dev | Prod |
|--------|-----|------|
| Server | External bun process (`start_dev_server`) | Embedded `browseros_server` binary spawned by AppImage |
| Extension | `--load-extension=<local build>` | Bundled (no flag) |
| WM class | `browseros-dev` | `browseros` |
| `--disable-browseros-server` | ✅ Yes | ❌ No |
| `--disable-browseros-extensions` | ✅ Yes | ❌ No |
| `--remote-allow-origins=*` | ❌ No | ✅ Yes |
| `--browseros-proxy-port` | ❌ No (uses `--browseros-mcp-port`) | ✅ Yes |
| `--browseros-server-resources-dir` | ❌ No | ✅ Yes |
| `--disable-browseros-server-updater` | ❌ No | ✅ Yes |
| `--browseros-extension-port` | ❌ No | ✅ Yes |
| `--no-first-run` / `--no-default-browser-check` | ✅ Yes | ❌ No |
| `--use-mock-keychain` | ✅ Yes | ❌ No |
| Health check mode | `basic` (status=ok + cdpConnected) | `soak` (health + adapters + MCP proxy + 10s soak) |
| Health timeout | 30s | 120s |
| Launch URL | `chrome://newtab` | (none — AppImage opens default) |
| Server port discrepancy | Server = 9115 (browser sends `--browseros-mcp-port=9115`) | Browser sends `--browseros-proxy-port=9110` but actual server listens on **9200** |

### ⚠️ Notable Anomaly
The prod server binary is actually listening on port **9200** (from `server_config.json`), while the browser passes `--browseros-proxy-port=9110`. This means either:
- The proxy-port flag is for the browser's internal routing, and the server reads its actual port from `server_config.json` 
- Or there's a config mismatch where `PROD_SERVER_PORT=9110` in `common.sh` but the running server picked up 9200 from a stale/external config

## Architecture

```
User clicks "BrowserOS (Dev)" .desktop
  → launch-browseros-dev.sh
    → exec mise run browseros:start-dev
      → declare_instance dev (sets INSTANCE_* vars)
      → preflight_checks (flock, port orphans)
      → ensure_desktop_entries
      → launch_browser() [instance.sh, dev branch]
          → nohup AppImage --disable-browseros-server --load-extension=... &
      → wait_cdp (poll CDP port)
      → start_dev_server() [instance.sh]
          → nohup bun run start:ci @browseros/server &
      → wait_server_health (basic mode)

User clicks "BrowserOS" .desktop
  → launch-browseros-prod.sh
    → declare_instance prod
    → write_server_config (server_config.json + Local State)
    → clean_singleton_locks
    → export BROWSEROS_* env vars
    → exec AppImage --remote-allow-origins=* --browseros-proxy-port=... &
      [AppImage spawns browseros_server internally]

mise run browseros:start-prod (alternative entry)
  → copy_server_resources (bin + SQL migrations)
  → nohup launch-browseros-prod.sh &
  → wait_server_health (soak mode, 120s)
```

## Start Here

Open `scripts/launch/instance.sh` — it is the single source of truth for all dev vs prod behavior. The `declare_instance()` function (lines ~48-110) sets every `INSTANCE_*` variable, and `launch_browser()` (lines ~205-265) contains the actual flag divergence between dev and prod.

## Open Questions
1. **Server port 9200 vs 9110**: The running prod server listens on 9200 but `common.sh` defines `PROD_SERVER_PORT=9110`. Investigate `server_config.json` and whether the AppImage overrides ports.
2. **`--browseros-mcp-port` (dev) vs `--browseros-proxy-port` (prod)**: Different flag names for what appears to be the same purpose. Unclear if both are recognized by the browser binary.

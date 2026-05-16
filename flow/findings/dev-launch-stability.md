# Dev Launch Stability — Findings & Fixes

Date: 2026-05-16
Status: Fixed

---

## F1: `--disable-browseros-extensions` blocks ALL extension loading

**Symptom**: Dev extension never loads. CDP shows 0 extension service workers.

**Cause**: `instance.sh` dev branch passed `--disable-browseros-extensions` to prevent bundled extensions from conflicting with `--load-extension`. This flag blocks the Chromium extension system entirely — bundled AND `--load-extension` extensions all fail.

**Fix**: Removed `--disable-browseros-extensions`. Dev now loads BOTH bundled + dev extension via `--load-extension`.

**File**: `scripts/launch/instance.sh` line ~329 (dev branch of `launch_browser`)

---

## F2: Profile picker blocks `--load-extension` until dismissed

**Symptom**: Even with bundled extensions loading, the dev `--load-extension` doesn't activate until a tab is created (profile picker gate).

**Cause**: BrowserOS Chromium fork shows `chrome://profile-picker/` on startup. Until a tab is opened, `--load-extension` extensions sit in a pending queue.

**Fix**: Added `trigger_extensions()` in `instance.sh` — creates 2 CDP tabs after `wait_cdp`: first triggers bundled extensions, second triggers `--load-extension`.

**File**: `scripts/launch/instance.sh` line ~404 (`trigger_extensions`)
**File**: `.mise/tasks/browseros/start-dev` line ~46 (calls `trigger_extensions`)

---

## F3: Dev desktop entry `Terminal=true` opens terminal window

**Symptom**: Clicking "BrowserOS (Dev)" from GNOME launcher opens a terminal window instead of just the browser.

**Cause**: `scripts/setup-desktop-entries.sh` set `Terminal=true` in the dev `.desktop` entry.

**Fix**: Changed to `Terminal=false` — it's a GUI app, not a CLI tool.

**File**: `scripts/setup-desktop-entries.sh` line ~157

---

## F4: `StartupWMClass=chromium-browser` didn't match actual WM class

**Symptom**: Prod BrowserOS window doesn't appear in GNOME taskbar under its icon.

**Cause**: Desktop entry used `StartupWMClass=chromium-browser` but the browser runs with `--class=browseros`. GNOME couldn't match the window to the `.desktop` entry.

**Fix**: Changed to `StartupWMClass=browseros` (matches `--class=browseros` flag). Dev uses `StartupWMClass=browseros-dev` (matches `--class=browseros-dev`).

**File**: `scripts/setup-desktop-entries.sh` line ~141

---

## F5: WXT `--dev` flag (not `--mode`) injects HMR into extension

**Symptom**: Extension errors on load — tries to connect to `ws://localhost:3001` (Vite HMR websocket).

**Cause**: WXT's HMR injection is triggered by the `--dev` CLI flag, NOT by `--mode development`. The old build used `wxt build --mode development` (no `--dev`) which was safe, but the original `build:agent:dev` script that preceded it used `wxt` with `--dev`.

**Fix**: `build-dev` uses `wxt build --mode development` (loads `.env.development` for env vars) WITHOUT `--dev` flag. This gets correct env vars without HMR injection.

**File**: `.mise/tasks/browseros/build-dev`

---

## F6: AppArmor userns restriction blocks BrowserOS sandbox on Ubuntu 24.04+

**Symptom**: BrowserOS silently fails to start without `--no-sandbox`.

**Cause**: Ubuntu 24.04+ sets `kernel.apparmor_restrict_unprivileged_userns=1` by default. Chromium needs userns for its sandbox.

**Fix**: Persistent sysctl override:
```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-allow-chromium-sandbox.conf
sudo sysctl --system
```
This is MORE secure than `--no-sandbox` (keeps seccomp + namespace sandbox, just removes OS restriction).

**File**: N/A (system-level fix, one-time)

---

## F7: Dev profile drift from prod profile copy

**Symptom**: Dev profile shows profile picker every launch, has Google account sync from prod, creates `Profile 2` automatically.

**Cause**: Earlier fix copied prod profile (`~/.config/browser-os/`) to dev (`~/.browseros-dev-chrome/`). BrowserOS auto-creates profiles for detected Google accounts.

**Fix**: Nuke dev profile, let BrowserOS create fresh. The `setup` mise task now starts with clean profile dirs.

**File**: `.mise/tasks/browseros/setup` (profile creation)

---

## F8: `VITE_PUBLIC_BROWSEROS_API` undefined → manifest `matches: ["undefined/home"]`

**Symptom**: Chrome refuses to load extension: `Invalid value for 'content_scripts[0].matches[0]': Missing scheme separator.`

**Cause**: `entrypoints/auth.content/index.ts` uses template literal `` `${env.VITE_PUBLIC_BROWSEROS_API}/home` ``. When `VITE_PUBLIC_BROWSEROS_API` is undefined at build time, this resolves to the literal string `"undefined/home"` — not a valid URL scheme.

**Root cause**: `build-dev` used plain `wxt build` (production mode). WXT in production mode loads `.env.production` (doesn't exist), NOT `.env.development`. The `VITE_PUBLIC_BROWSEROS_API` var is only defined in `.env.development`.

**Fix**: `build-dev` now uses `wxt build --mode development` to load `.env.development` where `VITE_PUBLIC_BROWSEROS_API=https://api.browseros.com`. No `--dev` flag so no HMR injection.

**File**: `.mise/tasks/browseros/build-dev`, `packages/browseros-agent/apps/agent/entrypoints/auth.content/index.ts`, `packages/browseros-agent/apps/agent/.env.development`

---

## F9: exit_type patch only fixed `Default/Preferences`, missed other profiles

**Symptom**: Dev works on first start but fails on restart. Profile picker reappears.

**Cause**: `_clean_stale_instance_state()` only patched `Default/Preferences` for `exit_type=Crashed`. BrowserOS's actual profile may be `Profile 2` (or any non-Default). Kill -9 sets `exit_type=Crashed` in ALL profile dirs. Next launch sees crash → shows picker → blocks extension loading.

**Fix**: Iterate ALL `*/Preferences` files in the profile dir, not just `Default/`.

**File**: `scripts/launch/instance.sh` (`_clean_stale_instance_state`)

---

## F10: 2,334 lines of bash reinvented the Go CLI wheel

**Symptom**: Dev launch unstable across restarts. 9 findings (F1-F9) all caused by bash scripts replicating what the upstream Go CLI already handles natively.

**Root cause**: Instead of adapting the existing `packages/browseros-agent/tools/dev/` Go CLI for Linux, we wrote 2,334 lines of bash infrastructure (instance.sh, common.sh, 9 mise tasks, desktop entry scripts). Each layer introduced its own failure modes: PID tracking via files, singleton locks via python scripts, port management via `ss`+`grep`+`kill`, profile patching via inline python. The Go CLI does all of this in compiled code with proper error handling.

**Fix**: 
- `browser/args.go`: Detect OS → use AppImage path on Linux, add `--class=browseros-dev` for GNOME taskbar
- `proc/ports.go`: `KillPort` uses `fuser` on Linux instead of `lsof` (macOS-only)
- `proc/process.go`: Match `BrowserOS.AppImage` + `mount_Browse` paths on Linux
- `cmd/watch.go`: Default profile `~/.browseros-dev-chrome` on Linux (not `/tmp/`)
- `cmd/target.go`: Dev target uses OS-aware browser user data dirs
- Replaced 2,334 lines of bash with thin mise wrappers that call `./tools/dev/browseros-dev`

**Files**: `browser/args.go`, `proc/ports.go`, `proc/process.go`, `cmd/watch.go`, `cmd/target.go`, `.mise/tasks/browseros/*`

---

## Architecture Reference

```
Prod flow:  .desktop → launch-browseros-prod.sh → AppImage (embedded server + extensions)
Dev flow:   .desktop → launch-browseros-dev.sh → mise start-dev → Go CLI (browseros-dev watch --manual)
```

The Go CLI (`browseros-dev`) handles: build, browser launch, CDP wait, server start, health check, process supervision, port management, singleton locks, cleanup.

Key difference: prod uses embedded `browseros_server`, dev uses external server started by Go CLI.
Upstream server error on Linux: `browseros-vm currently supports macOS only` — unrelated to our changes.

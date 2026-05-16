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

## F5: WXT dev build injects HMR (`ws://localhost:3001`) into extension

**Symptom**: Extension errors on load — tries to connect to `ws://localhost:3001` (Vite HMR websocket).

**Cause**: `bun wxt build --mode development` injects HMR client code into the extension bundle.

**Fix**: `build-dev` mise task now uses plain `wxt build` (production mode), then copies output to `chrome-mv3-dev/`.

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

## Architecture Reference

```
Prod flow:  .desktop → launch-browseros-prod.sh → AppImage (embedded server + extensions)
Dev flow:   .desktop → launch-browseros-dev.sh → mise start-dev → AppImage (disabled server) + bun server
```

Key difference: prod uses embedded `browseros_server`, dev uses external `bun run start:ci`.
Key similarity: both now load bundled extensions (dev also loads `--load-extension` on top).

# BrowserOS GPU Crash + NVIDIA Vulkan Fix + Taskbar `--class` Isolation

Date: 2026-05-19

## GPU Crash Root Cause

**~96 crash dumps in 8 days.** All from the same cascade:

```
1. Chromium IPC descriptor lost
   → shared_memory_switch.cc:289 "Failed global descriptor lookup: 7"
2. GPU compositor tries render without descriptor
   → NVIDIA driver can't map the memory
   → nvidia_drm: Failed to map NvKmsKapiMemory
3. Media renderer hits unmapped GPU code path
   → trap invalid opcode ip:5ec83db01db6 (SIGILL)
4. Process dies
```

NVIDIA is the **victim**, not the culprit. The descriptor is lost before NVIDIA ever sees it.

### Fix: `--use-angle=vulkan`

Bypasses the broken EGL/GBM shared memory path entirely. Vulkan is the same rendering path Steam uses on NVIDIA — well-tested.

| Source | Issue |
|--------|-------|
| browseros-ai/BrowserOS#945 | Exact same crash, NVIDIA + Wayland, OPEN |
| NVIDIA/open-gpu-kernel-modules#644 | Chromium GPU can't start on Wayland + NVIDIA |
| Brave#52785 | SIGILL CFI violation in Chromium 144, NVIDIA + Wayland |
| swaywm/wlroots#3168 | Chrome crash in PlatformSharedMemoryRegion |

### Implementation

Single source of truth: `scripts/gpu-flags.sh`

- Auto-detects NVIDIA via `/proc/modules` + `/dev/dri/by-path/*-nvidia*`
- Sets `BROWSEROS_GPU_FLAGS=--use-angle=vulkan`
- Sourced by ALL launch scripts (prod, dev, local) + mise tasks + Go CLI

Files modified:
- `scripts/gpu-flags.sh` (NEW)
- `scripts/launch/launch-browseros-prod.sh`
- `scripts/launch/launch-browseros-dev.sh`
- `~/Downloads/alta/launch-browseros-local.sh`
- `.mise/tasks/browseros/start-prod`
- `.mise/tasks/browseros/start-dev`
- `.mise/tasks/browseros/start-appimage`
- `packages/browseros-agent/tools/dev/browser/args.go`

---

## `--class` Isolation + GNOME Taskbar Pinning

### How `--class` Works

`--class=<name>` sets the WM_CLASS X11 property (GTK application ID on Wayland).
GNOME uses this to:
1. Match a running window to its `.desktop` entry
2. Group windows under the correct taskbar icon
3. Show the right app name in Alt-Tab

### 3 Separate App Identities

| Instance | `--class` | Desktop File | Icon Badge | Profile |
|----------|-----------|-------------|------------|---------|
| PROD | `browseros` | `browseros.desktop` | None (blue) | `~/.config/browser-os` |
| DEV | `browseros-dev` | `browseros-dev.desktop` | Green β | `~/.browseros-dev-chrome` |
| LOCAL | `browseros-local` | `browseros-local.desktop` | Orange L | `~/.browseros-local-chrome` |

### Why DEV Sometimes Lands Under PROD's Icon

AppImage FUSE mounts randomize the binary path on every launch:

```
/tmp/.mount_BrowseVPxo8v/.../browseros  (launch 1)
/tmp/.mount_BrowsephfYpp/.../browseros  (launch 2)
/tmp/.mount_BrowsevrQLmR/.../browseros  (launch 3)
```

GNOME's startup notification tracks PID from `.desktop` → Exec → child process.
But the Go CLI spawns the AppImage as a grandchild through `mise → browseros-dev → AppImage`.
PID chain breaks → GNOME falls back to heuristic matching → picks wrong icon.

**LOCAL doesn't have this problem** — fixed extracted path, `exec` replaces shell directly.

### Desktop Entry Generation

`scripts/setup-desktop-entries.sh` generates all 3 `.desktop` files + icon badges (prod=plain, dev=green β, local=orange L).

Icons: `~/.local/share/icons/hicolor/{128,256}x{128,256}/apps/browseros{,-dev,-local}.png`

GNOME favorites already pinned all 3: `browseros.desktop`, `browseros-dev.desktop`, `browseros-local.desktop`.

#!/usr/bin/env bash
# gpu-flags.sh — Shared GPU workarounds for BrowserOS on Linux + NVIDIA
# ═══════════════════════════════════════════════════════════════
# SOURCE THIS FILE. Do not exec it.
#
# Problem:
#   NVIDIA proprietary driver + Chromium + Wayland = frequent GPU crashes
#   Root cause: Chromium's EGL/GBM shared memory path fails on NVIDIA
#   Cascade: shared_memory_switch.cc:289 → NvKmsKapiMemory mapping fail → SIGILL
#
# Fix:
#   --use-angle=vulkan bypasses the broken EGL/GBM path entirely
#   Vulkan is the same path Steam uses — well-tested on NVIDIA
#
# Evidence:
#   - ~96 crash dumps in 8 days without this flag
#   - browseros-ai/BrowserOS#945 (same crash, NVIDIA + Wayland)
#   - NVIDIA/open-gpu-kernel-modules#644 (systemic Chromium issue)
#   - Brave#52785 (SIGILL CFI violation in Chromium 144, NVIDIA + Wayland)
#
# Usage:
#   source "${SCRIPT_DIR}/gpu-flags.sh"
#   exec "$BINARY" ${BROWSEROS_GPU_FLAGS} --class=browseros
# ═══════════════════════════════════════════════════════════════

if [[ "$(uname -s)" != "Linux" ]]; then
    # Non-Linux: no flags needed
    export BROWSEROS_GPU_FLAGS=""
    return 0 2>/dev/null || true
fi

# Detect NVIDIA GPU
_has_nvidia() {
    # Check for NVIDIA DRM device or nvidia driver loaded
    if ls /dev/dri/by-path/*-nvidia* >/dev/null 2>&1; then
        return 0
    fi
    if grep -q 'nvidia' /proc/modules 2>/dev/null; then
        return 0
    fi
    if lspci 2>/dev/null | grep -qi 'nvidia'; then
        return 0
    fi
    return 1
}

if _has_nvidia; then
    export BROWSEROS_GPU_FLAGS="--use-angle=vulkan"
else
    # Non-NVIDIA: no workaround needed
    export BROWSEROS_GPU_FLAGS=""
fi

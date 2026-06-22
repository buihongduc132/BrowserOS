#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# BrowserOS Port Manifest — SINGLE SOURCE OF TRUTH
# ═══════════════════════════════════════════════════════════════
# Edit HERE and ONLY HERE. All other files read from this.
#
# PROD ports → written to ~/.config/browser-os/.browseros/server_config.json
# DEV ports  → read by Go CLI (proc/ports.go), .env.development, mise tasks
#
# WARNING: After changing ports here, you MUST also:
#   1. Update packages/browseros-agent/tools/dev/proc/ports.go (defaultLocalPorts)
#   2. Update packages/browseros-agent/apps/server/.env.development
#   3. Rebuild Go binary: make -C packages/browseros-agent/tools/dev
# ═══════════════════════════════════════════════════════════════

# PROD ports (AppImage embedded server)
export PROD_CDP_PORT=9105
export PROD_SERVER_PORT=9200
export PROD_EXTENSION_PORT=9300

# DEV ports (external dev server)
export DEV_CDP_PORT=9010
export DEV_SERVER_PORT=9011
export DEV_EXTENSION_PORT=9012

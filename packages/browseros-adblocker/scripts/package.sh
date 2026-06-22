#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/.."

# Build the extension
cd "$EXT_DIR"
npm run build

# Create output directory
mkdir -p dist-crx

# Create zip (CRX requires chrome which may not be available in CI)
cd "$EXT_DIR"
zip -r dist-crx/browseros-adblocker.zip dist/ manifest.json

# If chrome/chromium available and key.pem exists, create proper CRX
CHROME="${CHROME:-$(which google-chrome 2>/dev/null || which chromium 2>/dev/null || echo '')}"
KEY="$EXT_DIR/key.pem"

if [ -n "$CHROME" ] && [ -f "$KEY" ]; then
  "$CHROME" --pack-extension="$EXT_DIR" --pack-extension-key="$KEY" 2>/dev/null || true
  mv "$EXT_DIR.crx" dist-crx/browseros-adblocker.crx 2>/dev/null || true
fi

echo "Packaged: dist-crx/"
ls -la dist-crx/

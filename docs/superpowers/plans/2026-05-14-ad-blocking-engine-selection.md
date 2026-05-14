# Built-in Ad Blocking for BrowserOS — Engine Selection & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native ad blocking to BrowserOS for ALL web browsing by bundling an adblocker extension, using the engine that provides BEST coverage (especially YouTube) THEN best performance.

**Architecture:** Bundled MV2 WebExtension loaded via existing `bundled_extensions/` infrastructure. Engine runs in persistent background page, intercepts all requests via `webRequest.onBeforeRequest`, applies cosmetic filtering via content script + MutationObserver, injects scriptlets at `document_start`. Filter lists auto-update via OTA pipeline.

**Tech Stack:** `@ghostery/adblocker-webextension` (selected engine — rationale in Task 0), TypeScript, WXT or raw WebExtension API, EasyList + uBlock filter lists

**User Context (verbatim):** "NOT trying to cover it in the agents / assistant BUT the normal web browsing itself" — Focus: BEST covered → THEN performance

**Related Research:** `flow/findings/ad-blocking-research.md`

---

## Task 0: Engine Selection — @ghostery/adblocker ✅ SELECTED

### Decision Matrix (Coverage → Performance priority)

| Criterion | Weight | @ghostery/adblocker | adblock-rust WASM |
|-----------|--------|-------------------|-------------------|
| **YouTube coverage** | CRITICAL | ✅ Full (scriptlets + cosmetic + network, proven) | ✅ Same lists but WASM integration unproven |
| **EasyList/uBlock compat** | HIGH | 99% | ~95% (procedural gaps per GH issues) |
| **Scriptlet injection** | HIGH | ✅ Built-in, push model on Chromium | ✅ Built-in but needs custom WASM→JS bridge |
| **Setup effort** | MEDIUM | 1 line: `blocker.enableBlockingInBrowser(browser)` | 3-5 days custom WASM pipeline |
| **MV2 ready** | HIGH | ✅ Out of box, manifest.json example provided | ❌ Build from scratch |
| **Extension bundle size** | MEDIUM | 64KB gzip | 2-4MB WASM binary |
| **Raw speed** | LOW (after coverage) | 0.007ms/request (fastest in benchmarks) | ~0.05ms WASM overhead |
| **Maintenance** | HIGH | `npm update` — done | Custom WASM compile chain, binding layer |
| **Production proven** | HIGH | Ghostery + Cliqz (millions) | Brave only (native, not WASM) |
| **License** | CHECK | GPL-3.0 ⚠️ | MPL-2.0 ✅ |

### Verdict

**@ghostery/adblocker-webextension** wins on EVERY criterion that matters:
- **Best coverage**: 99% uBlock compat + proven YouTube scriptlets + push injection model
- **Best performance**: Fastest in independent benchmarks (0.007ms/request)
- **Lowest effort**: 1-line integration, MV2 example provided
- **Production proven**: Ghostery/Cliqz millions of users

**License note (GPL-3.0)**: BrowserOS is a Chromium fork distributing its own browser. GPL-3.0 requires making source available for the extension, which is already the case since @ghostery/adblocker is open source. The extension is a separate work loaded at runtime — not compiled into Chromium. **Acceptable risk.**

**adblock-rust WASM** rejected because:
- No official WASM npm package — 3-5 day custom build pipeline
- WASM adds latency vs pure JS for this use case
- Procedural filter compatibility gaps (GH issues #495, #42873)
- 30x larger bundle size (2-4MB vs 64KB)

---

## Task 1: Scaffold Adblocker Extension

**Files:**
- Create: `packages/browseros-adblocker/package.json`
- Create: `packages/browseros-adblocker/manifest.json`
- Create: `packages/browseros-adblocker/src/background.ts`
- Create: `packages/browseros-adblocker/src/content-script.ts`
- Create: `packages/browseros-adblocker/rollup.config.js`
- Create: `packages/browseros-adblocker/tsconfig.json`

- [ ] **Step 1: Create package scaffold**

```bash
mkdir -p packages/browseros-adblocker/src
```

`packages/browseros-adblocker/package.json`:
```json
{
  "name": "@browseros/adblocker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "rollup -c",
    "dev": "rollup -c --watch"
  },
  "dependencies": {
    "@ghostery/adblocker-webextension": "^2.0.0",
    "webextension-polyfill": "^0.12.0"
  },
  "devDependencies": {
    "@rollup/plugin-commonjs": "^28.0.0",
    "@rollup/plugin-node-resolve": "^15.0.0",
    "@rollup/plugin-typescript": "^12.0.0",
    "rollup": "^4.0.0",
    "typescript": "^5.7.0",
    "tslib": "^2.8.0"
  }
}
```

`packages/browseros-adblocker/manifest.json`:
```json
{
  "manifest_version": 2,
  "name": "BrowserOS Ad Blocker",
  "version": "1.0.0",
  "description": "Built-in ad and tracker blocking",
  "permissions": [
    "webRequest",
    "webRequestBlocking",
    "webNavigation",
    "tabs",
    "storage",
    "http://*/*",
    "https://*/*"
  ],
  "background": {
    "scripts": ["dist/background.iife.js"]
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["dist/content-script.iife.js"],
      "run_at": "document_start",
      "all_frames": true,
      "match_about_blank": true
    }
  ],
  "icons": {
    "48": "icon48.png",
    "128": "icon128.png"
  }
}
```

- [ ] **Step 2: Write background script**

`packages/browseros-adblocker/src/background.ts`:
```typescript
import browser from 'webextension-polyfill';
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';

async function main() {
  // Load with prebuilt EasyList + EasyPrivacy lists
  // Falls back to fetching from CDN if no cached version
  const blocker = await WebExtensionBlocker.fromPrebuiltAdsAndTracking();

  // Enable all blocking (network + cosmetic + scriptlets)
  blocker.enableBlockingInBrowser(browser);

  console.log('[BrowserOS Adblocker] Active');
}

main().catch(console.error);
```

`packages/browseros-adblocker/src/content-script.ts`:
```typescript
// Content script is automatically handled by @ghostery/adblocker-webextension
// via runtime.onMessage coordination. This file only needs to import the handler.
import { contentScript } from '@ghostery/adblocker-webextension';

// Self-initializing — sets up MutationObserver and message listener
contentScript.start();
```

Wait — `@ghostery/adblocker-webextension` does NOT export a `contentScript` object. The content script helper is in `@ghostery/adblocker-webextension-cosmetics`. Corrected:

`packages/browseros-adblocker/src/content-script.ts` (corrected):
```typescript
import { contentScript } from '@ghostery/adblocker-webextension-cosmetics';

contentScript.start();
```

- [ ] **Step 3: Create build config**

`packages/browseros-adblocker/rollup.config.js`:
```javascript
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default [
  {
    input: 'src/background.ts',
    output: { file: 'dist/background.iife.js', format: 'iife' },
    plugins: [resolve({ browser: true }), commonjs(), typescript()],
  },
  {
    input: 'src/content-script.ts',
    output: { file: 'dist/content-script.iife.js', format: 'iife' },
    plugins: [resolve({ browser: true }), commonjs(), typescript()],
  },
];
```

`packages/browseros-adblocker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Install deps and build**

```bash
cd packages/browseros-adblocker
npm install
npm run build
ls dist/
# Expected: background.iife.js, content-script.iife.js
```

- [ ] **Step 5: Verify extension loads in Chrome**

```bash
# Open chrome://extensions → Developer mode → Load unpacked → select packages/browseros-adblocker
# Visit https://pagead2.googlesyndication.com/ — should be blocked
# Visit any news site — ads should be hidden
# Check DevTools console for "[BrowserOS Adblocker] Active"
```

- [ ] **Step 6: Commit**

```bash
git add packages/browseros-adblocker/
git commit -m "feat(adblocker): scaffold adblocker extension using @ghostery/adblocker"
```

---

## Task 2: Add Custom Filter Lists (YouTube + Annoyances)

**Files:**
- Modify: `packages/browseros-adblocker/src/background.ts`
- Create: `packages/browseros-adblocker/src/filters.ts`
- Create: `packages/browseros-adblocker/src/lists.json`

- [ ] **Step 1: Write failing test for filter list loading**

Create `packages/browseros-adblocker/test/filters.test.ts`:
```typescript
import { FiltersEngine } from '@ghostery/adblocker';
import { loadLists } from '../src/filters';

describe('Filter loading', () => {
  it('should load EasyList rules without error', async () => {
    const engine = new FiltersEngine();
    const lists = await loadLists();
    expect(lists.length).toBeGreaterThan(0);
    // Should contain at least some YouTube rules
    const raw = lists.join('\n');
    expect(raw).toContain('youtube.com');
  });

  it('should parse all lists into engine without errors', () => {
    const engine = new FiltersEngine();
    // Push sample rules
    engine.update({
      newNetworkFilters: [{ raw: '||doubleclick.net^' }],
      newCosmeticFilters: [{ raw: 'youtube.com##ytd-display-ad-renderer' }],
    });
    expect(engine.networkFilters.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement filter list loader**

`packages/browseros-adblocker/src/filters.ts`:
```typescript
export const FILTER_LIST_URLS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://easylist.to/easylist/fanboy-annoyance.txt',
];

export async function fetchFilterList(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

export async function loadLists(): Promise<string[]> {
  const results = await Promise.allSettled(
    FILTER_LIST_URLS.map(fetchFilterList)
  );
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value);
}
```

- [ ] **Step 3: Update background.ts to use custom lists + caching**

`packages/browseros-adblocker/src/background.ts`:
```typescript
import browser from 'webextension-polyfill';
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { FILTER_LIST_URLS, fetchFilterList } from './filters';

const CACHE_KEY = 'browseros-adblocker-cached-engine';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

async function loadBlocker(): Promise<WebExtensionBlocker> {
  // Try cached engine first
  const cached = await browser.storage.local.get(CACHE_KEY);
  if (cached[CACHE_KEY]) {
    try {
      const { data, timestamp } = JSON.parse(cached[CACHE_KEY]);
      if (Date.now() - timestamp < CACHE_TTL) {
        const blocker = WebExtensionBlocker.deserialize(new Uint8Array(data));
        blocker.enableBlockingInBrowser(browser);
        console.log('[BrowserOS Adblocker] Loaded from cache');
        return blocker;
      }
    } catch {
      // Cache corrupt, rebuild
    }
  }

  // Fetch fresh lists
  console.log('[BrowserOS Adblocker] Fetching filter lists...');
  const rawLists = await Promise.allSettled(
    FILTER_LIST_URLS.map(fetchFilterList)
  );
  const lists = rawLists
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value);

  if (lists.length === 0) {
    // Fallback to prebuilt
    console.warn('[BrowserOS Adblocker] No lists fetched, using prebuilt');
    const blocker = await WebExtensionBlocker.fromPrebuiltAdsAndTracking();
    blocker.enableBlockingInBrowser(browser);
    return blocker;
  }

  const blocker = WebExtensionBlocker.parse(lists);
  blocker.enableBlockingInBrowser(browser);

  // Cache for next load
  const serialized = blocker.serialize();
  await browser.storage.local.set({
    [CACHE_KEY]: JSON.stringify({
      data: Array.from(serialized),
      timestamp: Date.now(),
    }),
  });

  console.log(`[BrowserOS Adblocker] Active with ${lists.length} filter lists`);
  return blocker;
}

loadBlocker().catch(console.error);

// Auto-update lists every 24h
browser.alarms?.create('update-filters', { periodInMinutes: 24 * 60 });
browser.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'update-filters') {
    loadBlocker().catch(console.error);
  }
});
```

- [ ] **Step 4: Run tests**

```bash
cd packages/browseros-adblocker
npx vitest run
# Expected: all tests pass
```

- [ ] **Step 5: Test YouTube specifically**

```
1. Load extension in Chrome
2. Navigate to youtube.com
3. Play any video
4. Expected: No pre-roll ad, no sidebar ads, no banner ads
5. Check DevTools console: no ad-related 404s for doubleclick.net
6. Check network tab: googlesyndication.com requests cancelled
```

- [ ] **Step 6: Commit**

```bash
git add packages/browseros-adblocker/
git commit -m "feat(adblocker): custom filter lists with caching and YouTube coverage"
```

---

## Task 3: Bundle Extension into BrowserOS Build

**Files:**
- Modify: `packages/browseros/chromium_patches/chrome/browser/browseros/bundled_extensions/BUILD.gn`
- Modify: `packages/browseros/chromium_patches/chrome/browser/browseros/bundled_extensions/bundled_extensions.json`
- Create: build script to package `.crx`

- [ ] **Step 1: Create CRX packaging script**

`packages/browseros-adblocker/scripts/package-crx.sh`:
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/.."
DIST_DIR="$EXT_DIR/dist-crx"

# Build extension
cd "$EXT_DIR"
npm run build

# Create CRX using Chrome's CLI
# Note: requires chrome or chromium installed
CHROME="${CHROME:-google-chrome}"
KEY="$EXT_DIR/key.pem"

if [ ! -f "$KEY" ]; then
  echo "Generating extension key..."
  openssl genrsa 2048 > "$KEY"
fi

"$CHROME" --pack-extension="$EXT_DIR" --pack-extension-key="$KEY" 2>/dev/null || {
  # Fallback: zip if chrome not available
  echo "Chrome not found, creating zip instead"
  cd "$EXT_DIR"
  zip -r "$DIST_DIR/browseros-adblocker.zip" dist/ manifest.json icon48.png icon128.png
  exit 0
}

mkdir -p "$DIST_DIR"
mv "$EXT_DIR.crx" "$DIST_DIR/"
echo "CRX packaged: $DIST_DIR/*.crx"
```

- [ ] **Step 2: Add to bundled_extensions config**

Modify `bundled_extensions.json` to add entry:
```json
{
  "extension_id": "browseros-adblocker",
  "filename": "browseros-adblocker.crx",
  "version": "1.0.0"
}
```

- [ ] **Step 3: Update BUILD.gn**

Add to `_bundled_extensions_sources` in `bundled_extensions/BUILD.gn`:
```python
_bundled_extensions_sources = [
  "bundled_extensions.json",
  "bflpfmnmnokmjhmgnolecpppdbdophmk.crx",  # Agent
  "adlpneommgkgeanpaekgoaolcpncohkf.crx",  # Bug Reporter
  "nlnihljpboknmfagkikhkdblbedophja.crx",  # Controller
  "browseros-adblocker.crx",                 # Ad Blocker
]
```

- [ ] **Step 4: Verify extension ID stability**

```bash
# Generate a stable extension ID by creating key.pem
# The CRX packaging uses key.pem to derive the extension ID
# This ensures the same ID across builds
openssl genrsa 2048 > packages/browseros-adblocker/key.pem
```

- [ ] **Step 5: Commit**

```bash
git add packages/browseros-adblocker/ packages/browseros/chromium_patches/
git commit -m "feat(adblocker): bundle adblocker extension into BrowserOS build"
```

---

## Task 4: TDD — Verification Test Suite

**Files:**
- Create: `packages/browseros-adblocker/test/adblocker-e2e.test.ts`
- Create: `packages/browseros-adblocker/test/youtube-blocking.test.ts`
- Create: `packages/browseros-adblocker/test/cosmetic-filtering.test.ts`

- [ ] **Step 1: Write TDD cases — delegate to sub-agent A**

> DELEGATE: Spawn sub-agent to write TDD cases for network blocking coverage.
> File: `test/network-blocking.test.ts`
> Cases: EasyList rule matching, $redirect, $important, CSP injection, exception handling

- [ ] **Step 2: Write TDD cases — delegate to sub-agent B**

> DELEGATE: Spawn sub-agent to write TDD cases for YouTube-specific blocking.
> File: `test/youtube-blocking.test.ts`
> Cases: YouTube scriptlets (`##+js(set, ytInitialPlayerResponse.adSlots, [])`),
> cosmetic selectors (`ytd-display-ad-renderer`, `ytd-promoted-sparkles-widget`),
> network blocks (`doubleclick.net`, `googlesyndication.com`)

- [ ] **Step 3: Write TDD cases — delegate to sub-agent C**

> DELEGATE: Spawn sub-agent to write TDD cases for cosmetic filtering.
> File: `test/cosmetic-filtering.test.ts`
> Cases: MutationObserver coordination, CSS injection, first-party heuristic,
> generic vs specific selectors, DOM element hiding

- [ ] **Step 4: Verification loop — delegate to @verifier**

> DELEGATE: Spawn @verifier sub-agent to:
> a. Remove theatrical tests that don't verify real behavior
> b. Ensure all tests align with user intent: "normal web browsing" ad blocking
> c. Verify coverage gaps against findings in flow/findings/ad-blocking-research.md

- [ ] **Step 5: Run all tests**

```bash
cd packages/browseros-adblocker
npx vitest run
# Expected: ALL pass
```

- [ ] **Step 6: Commit**

```bash
git add packages/browseros-adblocker/test/
git commit -m "test(adblocker): TDD verification suite for network, YouTube, and cosmetic blocking"
```

---

## Task 5: OTA Filter List Updates

**Files:**
- Modify: `packages/browseros-adblocker/src/background.ts`
- Create: `packages/browseros-adblocker/src/updater.ts`

- [ ] **Step 1: Implement incremental filter updater**

`packages/browseros-adblocker/src/updater.ts`:
```typescript
import browser from 'webextension-polyfill';
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { FILTER_LIST_URLS, fetchFilterList } from './filters';

const UPDATE_ALARM = 'browseros-filter-update';
const STORAGE_KEY = 'browseros-adblocker-cached-engine';
const UPDATE_INTERVAL_MINUTES = 24 * 60; // Daily

export async function updateFilters(): Promise<void> {
  console.log('[BrowserOS Adblocker] Checking for filter updates...');

  const lists = await Promise.allSettled(
    FILTER_LIST_URLS.map(fetchFilterList)
  );
  const rawLists = lists
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value);

  if (rawLists.length === 0) return;

  const blocker = WebExtensionBlocker.parse(rawLists);

  // Cache the updated engine
  const serialized = blocker.serialize();
  await browser.storage.local.set({
    [STORAGE_KEY]: JSON.stringify({
      data: Array.from(serialized),
      timestamp: Date.now(),
    }),
  });

  console.log(`[BrowserOS Adblocker] Updated with ${rawLists.length} lists`);
}

export function startAutoUpdate(): void {
  browser.alarms.create(UPDATE_ALARM, {
    periodInMinutes: UPDATE_INTERVAL_MINUTES,
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) {
      updateFilters().catch(console.error);
    }
  });
}
```

- [ ] **Step 2: Wire into background.ts**

Add to `background.ts`:
```typescript
import { startAutoUpdate } from './updater';
// ... after loadBlocker() ...
startAutoUpdate();
```

- [ ] **Step 3: Test update flow**

```bash
# Load extension → wait for initial load → trigger alarm manually
# Verify new engine cached in storage.local
```

- [ ] **Step 4: Commit**

```bash
git add packages/browseros-adblocker/
git commit -m "feat(adblocker): OTA filter list updates with daily auto-refresh"
```

---

## Task 6: Integration with BrowserOS OTA Updater

**Files:**
- Modify: BrowserOS OTA updater to bundle adblocker extension updates
- Coordinate with existing `ota-updater` feature

- [ ] **Step 1: Add adblocker to OTA update manifest**

Ensure `browseros-adblocker.crx` is included in the extension update manifest served by CDN.

- [ ] **Step 2: Test full OTA flow**

```
1. Build BrowserOS with bundled adblocker v1.0.0
2. Publish adblocker v1.0.1 to CDN
3. Trigger OTA update check
4. Verify adblocker updates to v1.0.1
5. Verify filter lists still load
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(adblocker): integrate with BrowserOS OTA updater"
```

---

## Verification Loop (Mandatory)

After ALL tasks complete, execute verification loop:

### @Verifier Round 1: Coverage Check

> DELEGATE: Spawn @verifier to verify:
> 1. YouTube ads blocked (pre-roll, sidebar, banner, mid-roll)
> 2. General browsing ads blocked (news sites, social media)
> 3. Tracker blocking active (Google Analytics, Facebook Pixel)
> 4. Cosmetic filtering hides ad containers (no blank spaces)
> 5. Scriptlet injection works (check console for scriptlet execution)
> 6. Filter list freshness (lists updated within last 24h)

### @Verifier Round 2: Performance Check

> DELEGATE: Spawn @verifier to measure:
> 1. Extension startup time < 500ms (from cache)
> 2. Per-request blocking latency < 1ms
> 3. Memory overhead < 50MB
> 4. No visible page load slowdown
> 5. YouTube video playback unaffected (no buffering from blocking)

### @Verifier Round 3: Compatibility Check

> DELEGATE: Spawn @verifier to verify:
> 1. No site breakage on top 100 sites (use automated crawl)
> 2. MV2 extension loads in BrowserOS Chromium build
> 3. No conflict with BrowserOS Agent extension
> 4. Extension survives BrowserOS rebuild
> 5. Filter lists accessible from BrowserOS network context

**Loop rule**: If ANY verifier rejects → fix → re-run ALL 3 verifiers.

---

## Effort Estimate

| Task | Days | Dependencies |
|------|------|-------------|
| Task 0: Engine selection | ✅ Done | — |
| Task 1: Scaffold extension | 1 day | — |
| Task 2: Custom filter lists | 1 day | Task 1 |
| Task 3: Bundle into build | 0.5 day | Task 1 |
| Task 4: TDD verification | 1.5 days | Tasks 1-2 |
| Task 5: OTA updates | 0.5 day | Task 2 |
| Task 6: Integration | 0.5 day | Tasks 3, 5 |
| Verification loops | 1 day | All tasks |
| **Total** | **~6 days** | |

---

## ⚠️ Callsout

1. **GPL-3.0 License**: @ghostery/adblocker is GPL-3.0. Acceptable for a runtime-loaded extension in an open browser, but confirm with legal if BrowserOS distributes under different terms.

2. **YouTube Cat-and-Mouse**: YouTube WILL change their ad system. Requires ongoing filter list maintenance. The OTA updater handles this, but someone needs to monitor.

3. **MV2 Deprecation**: Chrome is deprecating MV2. BrowserOS has the `extensions-manifestv2` patch which re-enables it. This patch must be maintained.

4. **Filter List Size**: Total filter lists ~300K rules after parsing. ~30-50MB memory. Acceptable for desktop, watch on mobile.

5. **Site Breakage**: Some sites break when ads are blocked. Need a per-site toggle (Shields-style) or global disable option. Not in this plan — Phase 2.

# Ad Blocking Research — Brave, @cliqz/adblocker, adblock-rust

> Date: 2026-05-14
> Context: BrowserOS needs native ad blocking for ALL web browsing (not just agent sessions)

## User Intent (verbatim)

> "How do [Brave] be able to block the ads including youtube"
> "Can we easily implement / reuse that functionalities?"
> "NOT trying to cover it in the agents / assistant BUT the normal web browsing itself"

---

## 1. Brave's 3-Layer Ad Blocking Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1: NETWORK BLOCKING  (intercepts URL before fetch)       │
│  Engine: adblock-rust (Rust → FlatBuffers)                      │
│  Pipeline: Chromium URLRequest → BraveShields → block/allow     │
│  Rules: EasyList, EasyPrivacy (~100K filters)                   │
│  Match: Bloom filter + Rabin-Karp ≈ 0.26ms/URL                 │
│  Supports: $important, $redirect, $removeparam, CSP injection   │
│  License: MPL-2.0                                                │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 2: COSMETIC FILTERING  (hides DOM elements)              │
│  Inject: chrome.tabs.insertCSS({ cssOrigin: 'user' })           │
│  Watch: MutationObserver → new class/id → query engine          │
│  Procedural: :has-text(), :upward(), :min-text-length()         │
│  Heuristic: skip first-party ads in Standard mode, all in Aggressive │
│  Injected at: document_start                                     │
├──────────────────────────────────────────────────────────────────┤
│  LAYER 3: SCRIPTLET INJECTION  (JS runtime patching)            │
│  uBlock ##+js(scriptlet-name, args) syntax                      │
│  YouTube: set ytInitialPlayerResponse.adSlots=[]                 │
│  Twitch: VAFT (manifest editing) + video-swap                   │
│  Resources: 50+ JS files, base64-encoded, injected at doc_start │
│  Source: brave/adblock-resources repository                      │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 Network Blocking Detail

**How it intercepts**: Brave patches Chromium's `URLRequest` pipeline. Every outgoing request passes through `BraveShields` which calls `adblock-rust`'s `Engine.check_network_request()`.

**Flow**:
1. Browser initiates URL request
2. Chromium's `URLRequest::BeforeRequest` fires
3. Brave's `BraveShieldsContentBrowserClient::ShouldForceBoolean()` intercepts
4. `adblock-rust::Engine::check()` matches against all rules
5. Returns `BlockerResult { matched, important, redirect, rewritten_url }`
6. If matched → cancel request (empty body); if redirect → inject resource

**Rule matching order**: `$important` → `$redirect` → normal filters → exceptions

**Source**: `brave/adblock-rust` — `src/blocker.rs` (check_parameterised method)

### 1.2 Cosmetic Filtering Detail

**Two-phase approach**:

**Phase A — Static (on navigation commit)**:
- `Engine::url_cosmetic_resources(url)` returns URL-specific CSS selectors + scriptlets
- Injected via `chrome.tabs.insertCSS({ cssOrigin: 'user', runAt: 'document_start' })`

**Phase B — Dynamic (MutationObserver)**:
- Content script watches for new CSS classes/IDs via MutationObserver
- Reports to background: `Engine::hidden_class_id_selectors(classes, ids, exceptions)`
- Background returns matching CSS selectors → inject more `display:none`

**First-party heuristic (Standard mode)**:
1. If element has well-known ad ID (`google_ads_iframe_`, `div-gpt-ad`, `adfox_`) → hide
2. If element has first-party resource → don't hide
3. If element contains third-party resource → hide
4. If element has >5 words of text → don't hide
5. Otherwise → hide

**Aggressive mode**: Skip heuristic, hide everything matching rules.

**Source**: `brave/brave-core` — `components/cosmetic_filters/renderer/cosmetic_filters_js_handler.cc`

### 1.3 Scriptlet Injection Detail

Scriptlets are JS snippets injected into the page world at `document_start` to neutralize ad loaders before they initialize.

**YouTube-specific scriptlets**:
- `##+js(set, ytInitialPlayerResponse.adSlots, [])` — empties ad slots before player loads
- `##+js(set, ytInitialPlayerResponse.playerConfig.adsPlayerResponse, '')` — blanks ad config
- Various `googlesyndication.com` and `doubleclick.net` network blocks

**Resource system**: `brave/adblock-resources`
- `metadata.json` describes each resource (name, aliases, MIME type)
- Build process: read JS → base64 encode → `dist/resources.json`
- Loaded by `adblock-rust::Engine::use_resources()`

---

## 2. YouTube Anti-Adblock Arms Race

YouTube actively detects and blocks adblockers. Key incidents:

| Date | Event | Resolution |
|------|-------|-----------|
| Oct 2023 | YouTube first anti-adblock popup | Filter list updates within days |
| Dec 2024 | YouTube bypasses Brave Shield (issue #43015) | Patched via component update in ~48h |
| Ongoing | YouTube changes DOM class names periodically | Filter authors update within hours |

**Brave's counter-strategies**:
1. Force aggressive cosmetic mode on youtube.com (issue #30896)
2. Dedicated YouTube filter rules in `uBlockOrigin/filters.txt` (200+ rules)
3. Component update system ships filter list patches independently of browser updates
4. `brave-unbreak.txt` fixes sites broken by over-aggressive blocking

**Key insight**: YouTube blocking requires **ongoing maintenance** of filter lists. It's not a one-time implementation.

---

## 3. Engine Comparison: @cliqz/adblocker vs adblock-rust

### 3.1 @ghostery/adblocker (formerly @cliqz/adblocker)

| Aspect | Detail |
|--------|--------|
| **Language** | Pure TypeScript/JavaScript |
| **Repo** | `ghostery/adblocker` (GPL-3.0) |
| **npm** | `@ghostery/adblocker-webextension` |
| **MV Support** | MV2 (uses `webRequest.onBeforeRequest` + `webRequestBlocking`) |
| **Size** | 64KB minified+gzipped (core) |
| **Filter syntax** | EasyList, EasyPrivacy, uBlock Origin (99% compatibility claimed) |
| **Network blocking** | ✅ via `webRequest.onBeforeRequest` |
| **Cosmetic filtering** | ✅ via content script + MutationObserver |
| **Scriptlet injection** | ✅ via `##+js(...)` syntax |
| **HTML filtering** | ✅ via `filterResponseData` (Firefox only) |
| **CSP injection** | ✅ via `webRequest.onHeadersReceived` |
| **$redirect** | ✅ resource replacement |
| **Serialization** | ✅ binary cache for fast reload |
| **Prebuilt lists** | ✅ `WebExtensionBlocker.fromPrebuiltAdsAndTracking()` |
| **Platforms** | Node.js, Puppeteer, Electron, WebExtension |
| **Production users** | Ghostery browser, Cliqz browser (millions of users) |
| **Maintenance** | Active (Ghostery team, last updated 2025) |
| **Performance** | ~0.007ms per request (fastest in benchmarks) |

**Key API** (`@ghostery/adblocker-webextension`):
```typescript
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';

WebExtensionBlocker.fromPrebuiltAdsAndTracking().then((blocker) => {
  blocker.enableBlockingInBrowser(browser);
});
// That's it. One function call. Done.
```

**What `enableBlockingInBrowser` does automatically**:
1. Hooks `webRequest.onBeforeRequest` → network blocking
2. Hooks `webRequest.onHeadersReceived` → CSP injection + HTML filtering
3. Hooks `runtime.onMessage` → cosmetic filter coordination with content script
4. Content script handles MutationObserver → dynamic CSS injection
5. Scriptlet injection via `tabs.executeScript` on navigation committed

**Push injection model** (Chromium-specific):
- On `webNavigation.onCommitted` → inject scriptlets immediately
- Breaks "isolated world" to inject into page context
- Critical for YouTube where timing matters

### 3.2 adblock-rust (Brave's engine)

| Aspect | Detail |
|--------|--------|
| **Language** | Rust (WASM compilation possible) |
| **Repo** | `brave/adblock-rust` (MPL-2.0) |
| **npm** | `adblock-rs` (native Node.js bindings, NOT WASM) |
| **MV Support** | N/A (library, not extension) |
| **Size** | WASM binary ~2-4MB |
| **Filter syntax** | EasyList, uBlock Origin (procedural cosmetic filters since v1.73) |
| **Network blocking** | ✅ `Engine.check_network_request()` |
| **Cosmetic filtering** | ✅ `Engine.hidden_class_id_selectors()` + `Engine.url_cosmetic_resources()` |
| **Scriptlet injection** | ✅ resource system with uBlock-compatible scriptlets |
| **FlatBuffer storage** | ✅ 75% memory reduction in v1.85 |
| **Serialization** | ✅ binary `.dat` format |
| **Platforms** | Rust native, Node.js (native bindings), WASM (manual compile) |
| **Production users** | Brave browser (millions of users) |
| **Maintenance** | Active (Brave team) |
| **Performance** | ~0.26ms per URL (C++ engine in benchmarks), WASM would be slower |

**WASM compilation**: Not officially packaged. Requires:
1. `wasm-pack build --target web`
2. Disable `embedded-domain-resolver` feature (reduce binary)
3. Manual JS binding layer
4. No official WASM package on npm

### 3.3 Head-to-Head Comparison

| Criterion | @ghostery/adblocker | adblock-rust (WASM) |
|-----------|-------------------|---------------------|
| **YouTube coverage** | ✅ Full (scriptlets + cosmetic + network) | ✅ Full (same filter lists) |
| **EasyList compat** | 99% | ~95% (some procedural gaps) |
| **uBlock scriptlets** | ✅ Built-in | ✅ Built-in |
| **Setup effort** | 1 line of code | ~3-5 days (WASM compile + binding) |
| **MV2 ready** | ✅ Out of box | ❌ Need to build extension from scratch |
| **Bundle size** | 64KB gzip | 2-4MB WASM |
| **Memory** | Low | Lower (FlatBuffers) |
| **Raw speed** | 0.007ms/request | ~0.05ms (WASM overhead) |
| **Maintenance burden** | Low (npm update) | High (custom WASM pipeline) |
| **License** | GPL-3.0 ⚠️ | MPL-2.0 ✅ |
| **Community** | Active (Ghostery) | Active (Brave) |
| **Production proven** | Ghostery + Cliqz | Brave |

### 3.4 Coverage Assessment

Both engines support the same filter lists (EasyList, EasyPrivacy, uBlock filters). **Coverage is identical** — it's the filter lists that determine what gets blocked, not the engine.

The critical coverage differentiator is **scriptlet injection quality**:
- `@ghostery/adblocker`: uBlock-compatible scriptlets built-in, proven in production
- `adblock-rust`: Same uBlock scriptlets, proven in Brave

**Verdict: Tied on coverage. Both are production-grade.**

---

## 4. BrowserOS Integration Surface

BrowserOS already has the necessary infrastructure:

```
✅ MV2 extension support     — extensions-manifestv2 patch in features.yaml
✅ Bundled extension infra    — bundled_extensions/BUILD.gn + .json
✅ OTA updater               — ota-updater feature for filter list updates
✅ Extension side-panel      — side-panel infra already built
✅ Chromium patches pipeline — features.yaml → apply diffs → build
```

**Bundling path**: Add `.crx` to `bundled_extensions/`, register in `bundled_extensions.json`, ship with AppImage.

---

## 5. Filter Lists Required

| List | URL | Purpose | ~Size |
|------|-----|---------|-------|
| EasyList | `https://easylist.to/easylist/easylist.txt` | General ad blocking | ~50K rules |
| EasyPrivacy | `https://easylist.to/easylist/easyprivacy.txt` | Tracker blocking | ~30K rules |
| uBlock Filters | `https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt` | YouTube + site-specific | ~5K rules |
| uBlock Resources | `https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/resources/scriptlets.js` | Scriptlet library | ~50 JS files |
| Brave Unbreak | (bundled with engine) | Fix sites broken by blocking | ~2K rules |
| Annoyances List | `https://easylist.to/easylist/fanboy-annoyance.txt` | Cookie banners, overlays | ~30K rules |

---

## 6. References

- `brave/adblock-rust` — https://github.com/brave/adblock-rust
- `ghostery/adblocker` — https://github.com/ghostery/adblocker
- `brave/adblock-resources` — https://github.com/brave/adblock-resources (redirects)
- Brave cosmetic filtering wiki — https://github.com/brave/brave-browser/wiki/Cosmetic-Filtering
- Brave procedural filtering blog — https://brave.com/privacy-updates/31-procedural-filtering/
- Brave adblock memory reduction — https://brave.com/privacy-updates/36-adblock-memory-reduction/
- Adblocker performance study — https://remusao.github.io/posts/adblockers_performance_study.html
- YouTube anti-adblock issue — https://github.com/brave/brave-browser/issues/43015

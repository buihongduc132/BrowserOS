# Adblocker Stats & Logging — NON-blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tab and global blocked-request stats (like Brave Shields) with structured logging. Zero impact on the blocking pipeline — all stats collection is fire-and-forget async.

**Architecture:** Instead of modifying the `@ghostery/adblocker-webextension` internals (which we can't), we **wrap** `chrome.webRequest.onBeforeRequest` with a stats listener that runs AFTER the blocking decision. Stats are accumulated in-memory, flushed to `chrome.storage.local` periodically via alarm. Badge updated via `chrome.browserAction.setBadgeText`. Popup HTML shows breakdown.

**Tech Stack:** TypeScript, Chrome Extension APIs (browserAction, storage, tabs, webRequest), vitest

**User Context (verbatim):** "Make it to NON-blocking" — stats/logging must NEVER add latency to the block/allow decision path.

**Related:** `docs/superpowers/plans/2026-05-14-ad-blocking-engine-selection.md` (parent plan, merged)
**Related:** `flow/findings/ad-blocking-research.md` (Brave stats reference)

---

## NON-blocking Design

```
┌─────────────────────────────────────────────────────────────────┐
│  BLOCKING PIPELINE (must complete in <1ms)                      │
│                                                                 │
│  webRequest.onBeforeRequest                                     │
│    └─→ blocker.onBeforeRequest() → { cancel: true } | {}        │
│         ↑ RETURN immediately, browser blocks/allows             │
│                                                                 │
│  ══════════════════════ CUTOFF ═══════════════════════════════  │
│                                                                 │
│  STATS PIPELINE (fire-and-forget, zero blocking impact)         │
│                                                                 │
│  onBeforeRequest listener (separate, runs after)                │
│    └─→ stats.record(tabId, url, blocked)   ← sync, ~0.01ms     │
│    └─→ badge.update(tabId)                 ← debounced, async   │
│                                                                 │
│  Periodic flush (chrome.alarms, every 5min)                     │
│    └─→ chrome.storage.local.set(stats)     ← async, batched     │
│                                                                 │
│  Console logging (structured, throttled)                        │
│    └─→ console.debug('[Adblocker] BLOCKED ...')  ← dev only     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why this is NON-blocking:**
1. Stats listener is a SEPARATE `chrome.webRequest.onBeforeRequest` listener (not wrapping the blocker's)
2. `stats.record()` is a single Map increment — O(1), no I/O
3. Badge updates are debounced (max once per second per tab)
4. Storage flushes are batched via alarm (every 5min), never inline
5. Console logs use `console.debug` (hidden by default, no perf impact)

---

## Task 1: Stats Counter Module + TDD

**Files:**
- Create: `packages/browseros-adblocker/src/stats.ts`
- Create: `packages/browseros-adblocker/test/stats.test.ts`

### TDD Tests (write first)

`test/stats.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector, TabStats, GlobalStats } from '../src/stats';

describe('StatsCollector', () => {
  let stats: StatsCollector;

  beforeEach(() => { stats = new StatsCollector(); });

  it('records blocked request for a tab', () => {
    stats.record(1, 'https://doubleclick.net/ad.js', true, 'network');
    const tab = stats.getTabStats(1);
    expect(tab.blocked).toBe(1);
    expect(tab.byCategory.network).toBe(1);
  });

  it('records allowed request (not blocked)', () => {
    stats.record(1, 'https://example.com/style.css', false, undefined);
    const tab = stats.getTabStats(1);
    expect(tab.blocked).toBe(0);
    expect(tab.allowed).toBe(1);
  });

  it('increments existing tab stats', () => {
    stats.record(1, 'url1', true, 'network');
    stats.record(1, 'url2', true, 'cosmetic');
    stats.record(1, 'url3', false, undefined);
    const tab = stats.getTabStats(1);
    expect(tab.blocked).toBe(2);
    expect(tab.allowed).toBe(1);
  });

  it('tracks separate tabs independently', () => {
    stats.record(1, 'url1', true, 'network');
    stats.record(2, 'url2', true, 'network');
    stats.record(2, 'url3', true, 'network');
    expect(stats.getTabStats(1).blocked).toBe(1);
    expect(stats.getTabStats(2).blocked).toBe(2);
  });

  it('getGlobalStats aggregates all tabs', () => {
    stats.record(1, 'url1', true, 'network');
    stats.record(2, 'url2', true, 'cosmetic');
    stats.record(1, 'url3', false, undefined);
    const global = stats.getGlobalStats();
    expect(global.totalBlocked).toBe(2);
    expect(global.totalAllowed).toBe(1);
    expect(global.byCategory.network).toBe(1);
    expect(global.byCategory.cosmetic).toBe(1);
  });

  it('clearTab removes tab stats', () => {
    stats.record(1, 'url1', true, 'network');
    stats.clearTab(1);
    expect(stats.getTabStats(1).blocked).toBe(0);
  });

  it('reset clears everything', () => {
    stats.record(1, 'url1', true, 'network');
    stats.reset();
    expect(stats.getGlobalStats().totalBlocked).toBe(0);
  });

  it('categorizes by domain patterns', () => {
    stats.record(1, 'https://googleads.g.doubleclick.net/ad', true, 'network');
    stats.record(1, 'https://analytics.google.com/collect', true, 'network');
    stats.record(1, 'https://ads.facebook.com/track', true, 'network');
    const tab = stats.getTabStats(1);
    expect(tab.blocked).toBe(3);
    expect(tab.byCategory.network).toBe(3);
  });

  it('serializes to/from JSON for storage', () => {
    stats.record(1, 'url1', true, 'network');
    stats.record(2, 'url2', true, 'cosmetic');
    const json = stats.toJSON();
    const restored = StatsCollector.fromJSON(json);
    expect(restored.getGlobalStats().totalBlocked).toBe(2);
  });
});
```

### Implementation

`src/stats.ts`:
```typescript
export interface TabStats {
  blocked: number;
  allowed: number;
  byCategory: { network: number; cosmetic: number; scriptlet: number };
  domains: Set<string>;       // unique blocked domains
  lastBlockedUrl: string;     // for popup preview
}

export interface GlobalStats {
  totalBlocked: number;
  totalAllowed: number;
  byCategory: { network: number; cosmetic: number; scriptlet: number };
  sessionStart: number;       // timestamp
}

export class StatsCollector {
  private tabs = new Map<number, TabStats>();

  record(tabId: number, url: string, blocked: boolean, category?: string): void {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, {
        blocked: 0, allowed: 0,
        byCategory: { network: 0, cosmetic: 0, scriptlet: 0 },
        domains: new Set(), lastBlockedUrl: '',
      });
    }
    const tab = this.tabs.get(tabId)!;
    if (blocked) {
      tab.blocked++;
      if (category && category in tab.byCategory) tab.byCategory[category as keyof typeof tab.byCategory]++;
      try { tab.domains.add(new URL(url).hostname); } catch { /* invalid url */ }
      tab.lastBlockedUrl = url;
    } else {
      tab.allowed++;
    }
  }

  getTabStats(tabId: number): TabStats {
    return this.tabs.get(tabId) ?? {
      blocked: 0, allowed: 0,
      byCategory: { network: 0, cosmetic: 0, scriptlet: 0 },
      domains: new Set(), lastBlockedUrl: '',
    };
  }

  getGlobalStats(): GlobalStats {
    let totalBlocked = 0, totalAllowed = 0;
    const byCategory = { network: 0, cosmetic: 0, scriptlet: 0 };
    for (const tab of this.tabs.values()) {
      totalBlocked += tab.blocked;
      totalAllowed += tab.allowed;
      byCategory.network += tab.byCategory.network;
      byCategory.cosmetic += tab.byCategory.cosmetic;
      byCategory.scriptlet += tab.byCategory.scriptlet;
    }
    return { totalBlocked, totalAllowed, byCategory, sessionStart: Date.now() };
  }

  clearTab(tabId: number): void { this.tabs.delete(tabId); }
  reset(): void { this.tabs.clear(); }

  toJSON(): string {
    return JSON.stringify({
      tabs: Array.from(this.tabs.entries()).map(([id, s]) => ({
        id, blocked: s.blocked, allowed: s.allowed, byCategory: s.byCategory,
        domains: Array.from(s.domains), lastBlockedUrl: s.lastBlockedUrl,
      })),
    });
  }

  static fromJSON(json: string): StatsCollector {
    const collector = new StatsCollector();
    try {
      const data = JSON.parse(json);
      for (const t of data.tabs ?? []) {
        collector.tabs.set(t.id, {
          blocked: t.blocked, allowed: t.allowed,
          byCategory: t.byCategory,
          domains: new Set(t.domains ?? []),
          lastBlockedUrl: t.lastBlockedUrl ?? '',
        });
      }
    } catch { /* corrupt, return empty */ }
    return collector;
  }
}
```

- [ ] **Step 1: Write tests** — create `test/stats.test.ts` with tests above
- [ ] **Step 2: Run tests** — `npx vitest run test/stats.test.ts` → expect FAIL
- [ ] **Step 3: Implement** `src/stats.ts`
- [ ] **Step 4: Run all tests** — `npx vitest run` → expect 39 pass (30 existing + 9 new)
- [ ] **Step 5: Commit** — `feat(adblocker): stats counter module with TDD`

---

## Task 2: Integrate Stats into Background Pipeline + Badge

**Files:**
- Modify: `packages/browseros-adblocker/src/background.ts`
- Modify: `packages/browseros-adblocker/manifest.json` (add browserAction)
- Create: `packages/browseros-adblocker/test/stats-integration.test.ts`

### What Changes

**manifest.json** — add browserAction for badge + popup:
```json
"browser_action": {
  "default_icon": { "48": "icon48.png" },
  "default_title": "BrowserOS Ad Blocker",
  "default_popup": "popup.html"
}
```

**background.ts** — add NON-blocking stats listener:

```typescript
import { StatsCollector } from './stats';

const stats = new StatsCollector();

// NON-blocking stats listener — separate from blocker's onBeforeRequest
// This runs AFTER the blocker has already made its decision.
// The blocker's listener returns { cancel: true } synchronously.
// Our listener just counts — no return value, no blocking.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return; // ignore non-tab requests
    // We can't know from this listener if the request was blocked.
    // Instead, we check via the blocker's match() — but that's a second match call.
    // BETTER approach: wrap the blocker's listener.
  },
  { urls: ['http://*/*', 'https://*/*'] },
);

// Actually, the BEST non-blocking approach: override the onBeforeRequest
// that enableBlockingInBrowser registers, to also count after decision.
// But we can't do that without modifying the library.
//
// SIMPLEST non-blocking approach: add our OWN onBeforeRequest that
// pre-matches against the engine and records stats. Since our match
// runs in parallel with the blocker's match (both are synchronous listeners),
// the browser executes both before the request proceeds.
```

**Wait — this is wrong.** We can't have two `onBeforeRequest` listeners and know which one blocked. The blocker's listener returns `{ cancel: true }` but our listener doesn't see that result.

**Correct approach**: We DON'T use a second listener. We **subclass** or **wrap** `WebExtensionBlocker`:

```typescript
// Override the onBeforeRequest to add stats after the decision
const originalOnBeforeRequest = blocker.onBeforeRequest.bind(blocker);
blocker.onBeforeRequest = (browser, details) => {
  const result = originalOnBeforeRequest(browser, details);
  const blocked = result.cancel === true || !!result.redirectUrl;
  // Fire-and-forget stats — does NOT affect return value
  stats.record(details.tabId, details.url, blocked, 'network');
  if (blocked) updateBadge(details.tabId);
  return result; // return IMMEDIATELY, stats were sync O(1)
};
```

This is still synchronous but adds only a Map increment (~0.01ms). The blocking decision is made first, stats happen after, return is immediate. Zero impact.

For **cosmetic** stats: the content script already communicates via `runtime.onMessage`. We add a `stats` message type that the content script sends when it hides elements. This is inherently async.

- [ ] **Step 1: Write integration tests** — test wrapping, badge update, stats recording
- [ ] **Step 2: Implement** — modify background.ts with stats wrapper + badge
- [ ] **Step 3: Add browserAction to manifest.json**
- [ ] **Step 4: Run all tests** — `npx vitest run`
- [ ] **Step 5: Commit** — `feat(adblocker): integrate stats into blocking pipeline with badge`

---

## Task 3: Popup HTML — Stats Dashboard

**Files:**
- Create: `packages/browseros-adblocker/popup.html`
- Create: `packages/browseros-adblocker/src/popup.ts`
- Create: `packages/browseros-adblocker/popup.css`

### Popup Design (like Brave Shields)

```
┌─────────────────────────────┐
│  🛡️ BrowserOS Ad Blocker    │
│                             │
│  This page:                 │
│  ├ Ads blocked:      47    │
│  ├ Trackers blocked: 12    │
│  └ Scripts blocked:  3     │
│                             │
│  ─────────────────────────  │
│  Session totals:            │
│  ├ Total blocked:   1,247  │
│  ├ Domains blocked:   89   │
│  └ Time saved:     ~28s    │
│                             │
│  [⚙️ Settings]              │
└─────────────────────────────┘
```

- Pure HTML/CSS/JS — no React, no framework (keep it <5KB)
- Reads stats from `chrome.storage.local` on open
- Updates in real-time via `chrome.runtime.onMessage`
- Settings button → placeholder for Phase 2 per-site toggle

- [ ] **Step 1: Create popup.html** — minimal HTML structure
- [ ] **Step 2: Create popup.ts** — reads stats, renders numbers
- [ ] **Step 3: Create popup.css** — clean, minimal styling
- [ ] **Step 4: Update rollup.config.js** — add popup.iife.js build target
- [ ] **Step 5: Update manifest.json** — add `default_popup: 'popup.html'`
- [ ] **Step 6: Build + test** — `npm run build && npx vitest run`
- [ ] **Step 7: Commit** — `feat(adblocker): popup stats dashboard`

---

## Task 4: Structured Console Logging

**Files:**
- Create: `packages/browseros-adblocker/src/logger.ts`
- Modify: `packages/browseros-adblocker/src/background.ts`
- Create: `packages/browseros-adblocker/test/logger.test.ts`

### Logger Design

```typescript
export class AdblockLogger {
  private throttleMap = new Map<string, number>(); // domain → last log time
  private throttleMs = 1000; // max 1 log per domain per second
  private enabled = true;

  blocked(tabId: number, url: string, rule?: string): void {
    if (!this.enabled) return;
    let domain = 'unknown';
    try { domain = new URL(url).hostname; } catch {}

    // Throttle: skip if same domain logged <1s ago
    const now = Date.now();
    if (now - (this.throttleMap.get(domain) ?? 0) < this.throttleMs) return;
    this.throttleMap.set(domain, now);

    console.debug(
      `[Adblocker] BLOCKED tab=${tabId} domain=${domain} rule=${rule ?? 'unknown'} url=${url}`
    );
  }

  summary(stats: { blocked: number; allowed: number; domains: number }): void {
    console.info(
      `[Adblocker] Session: ${stats.blocked} blocked, ${stats.allowed} allowed, ${stats.domains} domains`
    );
  }
}
```

- [ ] **Step 1: Write tests** — throttle behavior, format, enable/disable
- [ ] **Step 2: Implement** logger.ts
- [ ] **Step 3: Wire into background.ts** — call after each block
- [ ] **Step 4: Run all tests**
- [ ] **Step 5: Commit** — `feat(adblocker): structured console logging with throttling`

---

## Task 5: Periodic Stats Persistence + Verification Loop

**Files:**
- Modify: `packages/browseros-adblocker/src/background.ts`
- Create: `packages/browseros-adblocker/test/stats-persistence.test.ts`

### What Changes

- Add `STATS_ALARM` that fires every 5 minutes
- On alarm: serialize stats → `chrome.storage.local`
- On startup: restore stats from storage
- On tab close: `chrome.tabs.onRemoved` → `stats.clearTab(tabId)`
- Verification: delegate to 2 fresh @verifier sub-agents

- [ ] **Step 1: Write tests** — persistence round-trip, tab cleanup, alarm interval
- [ ] **Step 2: Implement** — wire persistence into background.ts
- [ ] **Step 3: Run all tests**
- [ ] **Step 4: Verifier loop** — 2 fresh verifiers (coverage + perf)
- [ ] **Step 5: Commit** — `feat(adblocker): periodic stats persistence and tab cleanup`

---

## Task 6: PR Creation

- [ ] Push branch `feat/adblocker-stats`
- [ ] Create PR with verifier approval summary
- [ ] Sleep 5 min → check remote comments → fix loop
- [ ] Merge

---

## Effort Estimate

| Task | Days | Notes |
|------|------|-------|
| Task 1: Stats module + TDD | 0.5 | 9 pure logic tests |
| Task 2: Pipeline integration + badge | 0.5 | Wrapping approach, non-blocking |
| Task 3: Popup HTML dashboard | 0.5 | Pure HTML/CSS, no framework |
| Task 4: Structured logging | 0.25 | Throttled console.debug |
| Task 5: Persistence + verification | 0.5 | Alarm-based flush + 2 verifiers |
| Task 6: PR creation | 0.25 | Review loop |
| **Total** | **~2.5 days** | |

**≤ 7 days** — no split needed.

---

## ⚠️ Callsout

1. **Stats wrapper is sync but O(1)** — Map increment + badge debounce. The blocking decision is already made when we record. Return is immediate. This is as non-blocking as it gets without Web Workers.

2. **Badge requires `browser_action` in manifest** — MV2 only. If BrowserOS ever drops MV2 patch, badge won't work. Popup will still work via `chrome.action` in MV3.

3. **Cosmetic stats are approximate** — we count messages from content script, not actual hidden elements. A single cosmetic rule may hide 0 or many elements. We count "rules applied" not "elements hidden".

4. **`console.debug` hidden by default** — users won't see logs unless they enable verbose in DevTools. This is intentional — no log spam.

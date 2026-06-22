/* global chrome */
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { loadLists } from './filters';
import { StatsCollector } from './stats';
import { AdblockLogger } from './logger';

const CACHE_KEY = 'browseros-adblocker-cached-engine';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const ALARM_NAME = 'browseros-filter-update';
const UPDATE_INTERVAL_MINUTES = 24 * 60;
const STATS_KEY = 'browseros-adblocker-stats';
const STATS_ALARM = 'browseros-stats-flush';
const STATS_FLUSH_MINUTES = 5;

// Uint8Array → base64 (chunked to avoid O(n²) string concat)
function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 32768;
  for (let i = 0; i < data.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, data.length);
    for (let j = i; j < end; j++) {
      binary += String.fromCharCode(data[j]);
    }
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Active blocker instance — kept for hot-swap on filter updates
let activeBlocker: WebExtensionBlocker | null = null;

// Stats + logging (NON-blocking: O(1) Map operations, fire-and-forget async)
const stats = new StatsCollector();
const logger = new AdblockLogger();

// Badge helper — updates browserAction badge with blocked count for a tab
function updateBadge(tabId: number): void {
  const tabStats = stats.getTabStats(tabId);
  const text = tabStats.blocked > 0 ? String(tabStats.blocked) : '';
  try {
    chrome.browserAction.setBadgeText({ text, tabId });
    chrome.browserAction.setBadgeBackgroundColor({ color: '#CC0000', tabId });
  } catch { /* badge not available in some contexts */ }
}

// Cache helpers
export async function saveEngine(data: Uint8Array): Promise<void> {
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      data: toBase64(data),
      timestamp: Date.now(),
    },
  });
}

export async function loadCachedEngine(): Promise<WebExtensionBlocker | null> {
  const result = await chrome.storage.local.get(CACHE_KEY);
  if (!result[CACHE_KEY]) return null;

  try {
    const { data, timestamp } = result[CACHE_KEY];
    if (Date.now() - timestamp > CACHE_TTL) return null;
    return WebExtensionBlocker.deserialize(fromBase64(data));
  } catch {
    return null;
  }
}

// Stats persistence
async function flushStats(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STATS_KEY]: stats.toJSON() });
  } catch { /* storage full, ignore */ }
}

async function restoreStats(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STATS_KEY);
    if (result[STATS_KEY]) {
      const restored = StatsCollector.fromJSON(result[STATS_KEY]);
      const restoredGlobal = restored.getGlobalStats();
      if (restoredGlobal.totalBlocked > 0) {
        // Merge: add restored counters to live session (handles both fresh + existing)
        const current = stats.getGlobalStats();
        // Use restored sessionStart if older than current
        if (restoredGlobal.sessionStart < current.sessionStart) {
          (stats as any)._sessionStart = restoredGlobal.sessionStart;
        }
        // Add restored values on top of current
        (stats as any)._globalBlocked += restoredGlobal.totalBlocked;
        (stats as any)._globalAllowed += restoredGlobal.totalAllowed;
        for (const [cat, val] of Object.entries(restoredGlobal.byCategory)) {
          (stats as any)._globalByCategory[cat] += val;
        }
        for (const d of (restored as any)._globalDomains ?? []) {
          (stats as any)._globalDomains.add(d);
        }
        console.log(`[BrowserOS Adblocker] Restored ${restoredGlobal.totalBlocked} previously blocked`);
      }
    }
  } catch { /* corrupt, ignore */ }
}

// Register stats-aware blocking listener on a blocker
let activeListener: ((details: any) => any) | null = null;

function registerBlockerWithStats(blocker: WebExtensionBlocker): void {
  // Remove previous listener to avoid memory/execution leak
  if (activeListener) {
    try { chrome.webRequest.onBeforeRequest.removeListener(activeListener); } catch { /* ok */ }
  }

  activeListener = (details: { url: string; tabId: number; type: string }) => {
    // @ts-ignore — onBeforeRequest expects WebRequestDetails but blocker uses its own type
    const result = blocker.onBeforeRequest(details);
    const blocked = !!(result?.cancel || result?.redirectUrl);

    // NON-blocking stats: O(1) Map increment, done AFTER blocking decision
    if (details.tabId >= 0) {
      stats.record(details.tabId, details.url, blocked, 'network');
      if (blocked) {
        updateBadge(details.tabId);
        logger.blocked(details.tabId, details.url, 'network');
      }
    }

    return result;
  };

  chrome.webRequest.onBeforeRequest.addListener(
    activeListener,
    { urls: ['http://*/*', 'https://*/*'] },
    ['blocking'],
  );
}

async function loadBlocker(): Promise<WebExtensionBlocker> {
  // 1. Try cache
  const cached = await loadCachedEngine();
  if (cached) {
    registerBlockerWithStats(cached);
    activeBlocker = cached;
    console.log('[BrowserOS Adblocker] Loaded from cache');
    return cached;
  }

  // 2. Try fetching fresh lists
  try {
    const rawLists = await loadLists();
    if (rawLists.length > 0) {
      const blocker = WebExtensionBlocker.parse(rawLists.join('\n'));
      registerBlockerWithStats(blocker);
      await saveEngine(blocker.serialize());
      activeBlocker = blocker;
      console.log(`[BrowserOS Adblocker] Active with ${rawLists.length} filter lists`);
      return blocker;
    }
  } catch (e) {
    console.warn('[BrowserOS Adblocker] Failed to fetch lists:', e);
  }

  // 3. Fallback to prebuilt
  const blocker = await WebExtensionBlocker.fromPrebuiltAdsAndTracking();
  registerBlockerWithStats(blocker);
  activeBlocker = blocker;
  console.log('[BrowserOS Adblocker] Active (prebuilt fallback)');
  return blocker;
}

export async function updateFilters(): Promise<void> {
  const rawLists = await loadLists();
  if (rawLists.length === 0) return;

  const newBlocker = WebExtensionBlocker.parse(rawLists.join('\n'));

  // Hot-swap: enable new blocker first, then disable old one (avoid gap)
  registerBlockerWithStats(newBlocker);
  if (activeBlocker) {
    try { activeBlocker.disableBlockingInBrowser(chrome); } catch { /* ok */ }
  }
  activeBlocker = newBlocker;

  await saveEngine(newBlocker.serialize());
  console.log(`[BrowserOS Adblocker] Updated with ${rawLists.length} lists`);
}

export function startAutoUpdate(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === ALARM_NAME) updateFilters().catch(console.error);
    if (alarm.name === STATS_ALARM) flushStats().catch(console.error);
  });
}

function startStatsPersistence(): void {
  // Periodic flush via alarm
  chrome.alarms.create(STATS_ALARM, { periodInMinutes: STATS_FLUSH_MINUTES });

  // Tab cleanup on close
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    stats.clearTab(tabId);
  });
}

// Export stats for popup access
export { stats, logger, updateBadge };

// Only run in extension context (not in tests)
if (typeof chrome !== 'undefined' && chrome.storage) {
  loadBlocker()
    .then(() => {
      startAutoUpdate();
      startStatsPersistence();
      restoreStats();
    })
    .catch(console.error);
}

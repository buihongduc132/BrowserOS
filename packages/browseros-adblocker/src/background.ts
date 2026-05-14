/* global chrome */
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { fetchFilterList, FILTER_LIST_URLS } from './filters';

const CACHE_KEY = 'browseros-adblocker-cached-engine';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const ALARM_NAME = 'browseros-filter-update';
const UPDATE_INTERVAL_MINUTES = 24 * 60;

// Cache helpers
export async function saveEngine(data: Uint8Array): Promise<void> {
  await chrome.storage.local.set({
    [CACHE_KEY]: JSON.stringify({
      data: Array.from(data),
      timestamp: Date.now(),
    }),
  });
}

export async function loadCachedEngine(): Promise<WebExtensionBlocker | null> {
  const result = await chrome.storage.local.get(CACHE_KEY);
  if (!result[CACHE_KEY]) return null;

  try {
    const { data, timestamp } = JSON.parse(result[CACHE_KEY]);
    if (Date.now() - timestamp > CACHE_TTL) return null;
    return WebExtensionBlocker.deserialize(new Uint8Array(data));
  } catch {
    return null;
  }
}

async function loadBlocker(): Promise<WebExtensionBlocker> {
  // 1. Try cache
  const cached = await loadCachedEngine();
  if (cached) {
    cached.enableBlockingInBrowser(chrome);
    console.log('[BrowserOS Adblocker] Loaded from cache');
    return cached;
  }

  // 2. Try fetching fresh lists
  try {
    const lists = await Promise.allSettled(FILTER_LIST_URLS.map(fetchFilterList));
    const rawLists = lists
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map(r => r.value);

    if (rawLists.length > 0) {
      const blocker = WebExtensionBlocker.parse(rawLists.join('\n'));
      blocker.enableBlockingInBrowser(chrome);
      await saveEngine(blocker.serialize());
      console.log(`[BrowserOS Adblocker] Active with ${rawLists.length} filter lists`);
      return blocker;
    }
  } catch (e) {
    console.warn('[BrowserOS Adblocker] Failed to fetch lists:', e);
  }

  // 3. Fallback to prebuilt
  const blocker = await WebExtensionBlocker.fromPrebuiltAdsAndTracking();
  blocker.enableBlockingInBrowser(chrome);
  console.log('[BrowserOS Adblocker] Active (prebuilt fallback)');
  return blocker;
}

export async function updateFilters(): Promise<void> {
  const lists = await Promise.allSettled(FILTER_LIST_URLS.map(fetchFilterList));
  const rawLists = lists
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value);
  if (rawLists.length === 0) return;

  const blocker = WebExtensionBlocker.parse(rawLists.join('\n'));
  await saveEngine(blocker.serialize());
  console.log(`[BrowserOS Adblocker] Updated with ${rawLists.length} lists`);
}

export function startAutoUpdate(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) updateFilters().catch(console.error);
  });
}

loadBlocker().then(() => startAutoUpdate()).catch(console.error);

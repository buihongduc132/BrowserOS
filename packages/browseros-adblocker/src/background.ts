/* global chrome */
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { loadLists } from './filters';

const CACHE_KEY = 'browseros-adblocker-cached-engine';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const ALARM_NAME = 'browseros-filter-update';
const UPDATE_INTERVAL_MINUTES = 24 * 60;

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

async function loadBlocker(): Promise<WebExtensionBlocker> {
  // 1. Try cache
  const cached = await loadCachedEngine();
  if (cached) {
    cached.enableBlockingInBrowser(chrome);
    activeBlocker = cached;
    console.log('[BrowserOS Adblocker] Loaded from cache');
    return cached;
  }

  // 2. Try fetching fresh lists
  try {
    const rawLists = await loadLists();
    if (rawLists.length > 0) {
      const blocker = WebExtensionBlocker.parse(rawLists.join('\n'));
      blocker.enableBlockingInBrowser(chrome);
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
  blocker.enableBlockingInBrowser(chrome);
  activeBlocker = blocker;
  console.log('[BrowserOS Adblocker] Active (prebuilt fallback)');
  return blocker;
}

export async function updateFilters(): Promise<void> {
  const rawLists = await loadLists();
  if (rawLists.length === 0) return;

  const newBlocker = WebExtensionBlocker.parse(rawLists.join('\n'));

  // Hot-swap: disable old blocker, enable new one
  if (activeBlocker) {
    try { activeBlocker.disableBlockingInBrowser(chrome); } catch { /* ok */ }
  }
  newBlocker.enableBlockingInBrowser(chrome);
  activeBlocker = newBlocker;

  await saveEngine(newBlocker.serialize());
  console.log(`[BrowserOS Adblocker] Updated with ${rawLists.length} lists`);
}

export function startAutoUpdate(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === ALARM_NAME) updateFilters().catch(console.error);
  });
}

// Only run in extension context (not in tests)
if (typeof chrome !== 'undefined' && chrome.storage) {
  loadBlocker().then(() => startAutoUpdate()).catch(console.error);
}

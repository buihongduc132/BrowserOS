import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FiltersEngine, parseFilters } from '@ghostery/adblocker';

/** Helper: create a FiltersEngine from raw filter text lines */
function createEngine(rawFilters: string[]): FiltersEngine {
  const text = rawFilters.join('\n');
  const parsed = parseFilters(text);
  const engine = new FiltersEngine();
  engine.update({
    newNetworkFilters: parsed.networkFilters,
    newCosmeticFilters: parsed.cosmeticFilters,
  });
  return engine;
}

// Mock chrome.storage.local
const mockStorageData: Record<string, string> = {};
const mockStorage = {
  local: {
    async get(key: string) {
      return { [key]: mockStorageData[key] };
    },
    async set(obj: Record<string, string>) {
      Object.assign(mockStorageData, obj);
    },
  },
};

// Mock chrome globally
vi.stubGlobal('chrome', {
  storage: mockStorage,
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
});

// Import after mocks are set up
import { saveEngine, loadCachedEngine } from '../src/background';

describe('cache', () => {
  beforeEach(() => {
    // Clear storage between tests
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
  });

  it('saveEngine() stores serialized data + timestamp to storage.local', async () => {
    const engine = createEngine(['||doubleclick.net^']);
    const serialized = engine.serialize();

    await saveEngine(serialized);

    const stored = mockStorageData['browseros-adblocker-cached-engine'];
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored);
    expect(parsed.data).toBeDefined();
    expect(parsed.timestamp).toBeTypeOf('number');
    expect(parsed.data.length).toBe(serialized.length);
    // Data should be Array.from(Uint8Array)
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it('loadCachedEngine() returns deserialized engine if fresh (< 24h)', async () => {
    const engine = createEngine(['||doubleclick.net^']);
    const serialized = engine.serialize();

    // Store with current timestamp (fresh)
    mockStorageData['browseros-adblocker-cached-engine'] = JSON.stringify({
      data: Array.from(serialized),
      timestamp: Date.now(),
    });

    const result = await loadCachedEngine();
    expect(result).not.toBeNull();
  });

  it('loadCachedEngine() returns null if expired (> 24h)', async () => {
    const engine = createEngine(['||doubleclick.net^']);
    const serialized = engine.serialize();

    // Store with timestamp 25h ago (expired)
    const expiredTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    mockStorageData['browseros-adblocker-cached-engine'] = JSON.stringify({
      data: Array.from(serialized),
      timestamp: expiredTimestamp,
    });

    const result = await loadCachedEngine();
    expect(result).toBeNull();
  });

  it('loadCachedEngine() returns null if storage empty', async () => {
    // Storage is empty (cleared in beforeEach)
    const result = await loadCachedEngine();
    expect(result).toBeNull();
  });

  it('loadCachedEngine() returns null if data corrupt', async () => {
    mockStorageData['browseros-adblocker-cached-engine'] = 'this is not valid json{{{';

    const result = await loadCachedEngine();
    expect(result).toBeNull();
  });
});

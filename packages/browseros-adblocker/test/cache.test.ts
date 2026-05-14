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

// Mock chrome.storage.local — stores objects directly (chrome auto-serializes)
const mockStorageData: Record<string, unknown> = {};
const mockStorage = {
  local: {
    async get(key: string) {
      return { [key]: mockStorageData[key] };
    },
    async set(obj: Record<string, unknown>) {
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

    const stored = mockStorageData['browseros-adblocker-cached-engine'] as { data: string; timestamp: number };
    expect(stored).toBeDefined();
    expect(stored.data).toBeDefined();
    expect(stored.timestamp).toBeTypeOf('number');
    // Data should be base64 string
    expect(typeof stored.data).toBe('string');
  });

  it('loadCachedEngine() returns deserialized engine if fresh (< 24h)', async () => {
    const engine = createEngine(['||doubleclick.net^']);
    const serialized = engine.serialize();

    // Store with current timestamp (fresh) — object, not JSON string
    mockStorageData['browseros-adblocker-cached-engine'] = {
      data: btoa(String.fromCharCode(...serialized)),
      timestamp: Date.now(),
    };

    const result = await loadCachedEngine();
    expect(result).not.toBeNull();
  });

  it('loadCachedEngine() returns null if expired (> 24h)', async () => {
    const engine = createEngine(['||doubleclick.net^']);
    const serialized = engine.serialize();

    // Store with timestamp 25h ago (expired)
    mockStorageData['browseros-adblocker-cached-engine'] = {
      data: btoa(String.fromCharCode(...serialized)),
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    };

    const result = await loadCachedEngine();
    expect(result).toBeNull();
  });

  it('loadCachedEngine() returns null if storage empty', async () => {
    // Storage is empty (cleared in beforeEach)
    const result = await loadCachedEngine();
    expect(result).toBeNull();
  });

  it('loadCachedEngine() returns null if data corrupt', async () => {
    mockStorageData['browseros-adblocker-cached-engine'] = { data: '!!!not-base64!!!', timestamp: Date.now() };

    const result = await loadCachedEngine();
    expect(result).toBeNull();
  });
});

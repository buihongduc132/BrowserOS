import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage data
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

// Mock alarms
const mockAlarmCreate = vi.fn();
const mockAlarmAddListener = vi.fn();

vi.stubGlobal('chrome', {
  storage: mockStorage,
  alarms: {
    create: mockAlarmCreate,
    onAlarm: { addListener: mockAlarmAddListener },
  },
});

import { updateFilters, startAutoUpdate } from '../src/background';

describe('updater', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAlarmCreate.mockReset();
    mockAlarmAddListener.mockReset();
    // Clear storage
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
  });

  it('updateFilters() fetches lists, creates engine, caches it', async () => {
    // Mock fetch to return valid filter lists
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('||doubleclick.net^\n||ads.example.com^'),
    } as Response);

    await updateFilters();

    // Should have cached something
    const stored = mockStorageData['browseros-adblocker-cached-engine'] as { data: string; timestamp: number };
    expect(stored).toBeDefined();
    expect(stored.data).toBeDefined();
    expect(stored.timestamp).toBeTypeOf('number');
  });

  it('updateFilters() handles all-fetch-failure gracefully (no crash)', async () => {
    // Mock fetch to fail all requests
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    // Should not throw
    await expect(updateFilters()).resolves.toBeUndefined();

    // Storage should remain empty (nothing to cache)
    expect(mockStorageData['browseros-adblocker-cached-engine']).toBeUndefined();
  });

  it('startAutoUpdate() creates alarm with correct interval', () => {
    startAutoUpdate();

    expect(mockAlarmCreate).toHaveBeenCalledWith(
      'browseros-filter-update',
      { periodInMinutes: 24 * 60 },
    );
  });

  it('alarm callback triggers updateFilters', async () => {
    // Mock fetch so updateFilters can succeed
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('||ad.com^'),
    } as Response);

    // Call startAutoUpdate to register alarm listener
    startAutoUpdate();

    // The alarm listener was registered
    expect(mockAlarmAddListener).toHaveBeenCalled();

    // Get the callback that was registered
    const alarmCallback = mockAlarmAddListener.mock.calls[0][0] as (alarm: { name: string }) => Promise<void>;

    // Simulate alarm fire with correct name
    alarmCallback({ name: 'browseros-filter-update' });

    // Alarm callback is fire-and-forget; wait for async operations to settle
    await new Promise((r) => setTimeout(r, 50));

    // Should have cached the updated filters
    expect(mockStorageData['browseros-adblocker-cached-engine']).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FILTER_LIST_URLS, fetchFilterList, loadLists } from '../src/filters';

describe('filters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('FILTER_LIST_URLS has 4 entries', () => {
    expect(FILTER_LIST_URLS).toHaveLength(4);
  });

  it('fetchFilterList returns string for valid URL', async () => {
    const mockText = '||ad.example.com^\n||tracker.net^';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockText),
    } as Response);

    const result = await fetchFilterList('https://example.com/list.txt');
    expect(result).toBe(mockText);
  });

  it('fetchFilterList throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(fetchFilterList('https://example.com/missing.txt')).rejects.toThrow(
      'Failed to fetch',
    );
  });

  it('loadLists handles partial failures (some URLs fail, some succeed)', async () => {
    const callCount = { n: 0 };
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount.n++;
      if (callCount.n <= 2) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('||ad.com^'),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 500,
      } as Response);
    });

    const results = await loadLists();
    // At least some succeeded
    expect(results.length).toBeGreaterThan(0);
    // At least some failed (not all 4)
    expect(results.length).toBeLessThan(FILTER_LIST_URLS.length);
  });

  it('loadLists returns empty array when all fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const results = await loadLists();
    expect(results).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { FiltersEngine, Request, parseFilters } from '@ghostery/adblocker';

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

// Standard ad-blocking rules for testing
const TEST_FILTERS = [
  '||doubleclick.net^',
  '||googlesyndication.com^',
  '/pagead/js/',
  '##.ad-container',
  '##.video-ads',
  'youtube.com##.ytp-ad-module',
  'youtube.com##.ytp-ad-text-overlay',
];

describe('blocking', () => {
  it('Request to googlesyndication.com/pagead/js is blocked', () => {
    const engine = createEngine(TEST_FILTERS);
    const result = engine.match(
      Request.fromRawDetails({
        url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        type: 'script',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result.match).toBe(true);
  });

  it('Request to doubleclick.net is blocked', () => {
    const engine = createEngine(TEST_FILTERS);
    const result = engine.match(
      Request.fromRawDetails({
        url: 'https://ad.doubleclick.net/ddm/imp',
        type: 'image',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result.match).toBe(true);
  });

  it('Request to youtube.com itself is NOT blocked (it is first-party)', () => {
    const engine = createEngine(TEST_FILTERS);
    const result = engine.match(
      Request.fromRawDetails({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        type: 'document',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result.match).toBe(false);
  });

  it('Cosmetic filters for youtube.com contain CSS selectors', () => {
    const engine = createEngine(TEST_FILTERS);
    const result = engine.getCosmeticsFilters({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      domain: 'youtube.com',
    });
    expect(result).toBeDefined();
    expect(result.active).toBe(true);
    // styles is a CSS string — should contain youtube-specific selectors
    expect(result.styles).toContain('.ytp-ad-module');
    expect(result.styles).toContain('display: none');
  });
});

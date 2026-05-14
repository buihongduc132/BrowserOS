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

describe('FiltersEngine', () => {
  it('can be initialized empty', () => {
    const engine = new FiltersEngine();
    expect(engine).toBeDefined();
  });

  it('can parse EasyList-style rules', () => {
    const engine = createEngine(['||doubleclick.net^', '||googlesyndication.com^']);
    const result = engine.match(
      Request.fromRawDetails({
        url: 'https://ad.doubleclick.net/ad.js',
        type: 'script',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result.match).toBe(true);
  });

  it('matches known ad URL (||doubleclick.net^)', () => {
    const engine = createEngine(['||doubleclick.net^']);
    const result = engine.match(
      Request.fromRawDetails({
        url: 'https://ad.doubleclick.net/ad.js',
        type: 'script',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result.match).toBe(true);
  });

  it('does NOT match non-ad URL (example.com/style.css)', () => {
    const engine = createEngine(['||doubleclick.net^', '||googlesyndication.com^']);
    const result = engine.match(
      Request.fromRawDetails({
        url: 'https://example.com/style.css',
        type: 'stylesheet',
        sourceUrl: 'https://example.com/',
      }),
    );
    expect(result.match).toBe(false);
  });

  it('returns cosmetic filters for youtube.com hostname', () => {
    const engine = createEngine([
      '##.ad-container',
      '##.video-ads',
      'youtube.com##.ytp-ad-module',
    ]);
    const result = engine.getCosmeticsFilters({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      domain: 'youtube.com',
    });
    expect(result).toBeDefined();
    expect(result.active).toBe(true);
    // styles is a CSS string containing selectors
    expect(result.styles).toContain('.ytp-ad-module');
  });

  it('serializes and deserializes round-trip correctly', () => {
    const engine = createEngine(['||doubleclick.net^', '||googlesyndication.com^', '##.ad-banner']);
    const serialized = engine.serialize();
    const restored = FiltersEngine.deserialize(serialized);

    // Original matches ad URL
    const result1 = engine.match(
      Request.fromRawDetails({
        url: 'https://ad.doubleclick.net/ad.js',
        type: 'script',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result1.match).toBe(true);

    // Restored also matches same ad URL
    const result2 = restored.match(
      Request.fromRawDetails({
        url: 'https://ad.doubleclick.net/ad.js',
        type: 'script',
        sourceUrl: 'https://www.youtube.com/',
      }),
    );
    expect(result2.match).toBe(true);

    // Restored does NOT match non-ad URL
    const result3 = restored.match(
      Request.fromRawDetails({
        url: 'https://example.com/style.css',
        type: 'stylesheet',
        sourceUrl: 'https://example.com/',
      }),
    );
    expect(result3.match).toBe(false);
  });
});

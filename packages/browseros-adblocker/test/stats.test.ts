import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../src/stats';

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

  it('clearTab removes tab stats but preserves global counters', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(1, 'https://tracker.com/pixel', true, 'network');
    stats.clearTab(1);
    expect(stats.getTabStats(1).blocked).toBe(0);
    // Global counters survive tab close
    expect(stats.getGlobalStats().totalBlocked).toBe(2);
    expect(stats.getGlobalStats().totalDomains).toBe(2);
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

  it('sessionStart is set at construction, not recalculated', () => {
    const before = Date.now();
    const s = new StatsCollector();
    const after = Date.now();
    expect(s.getGlobalStats().sessionStart).toBeGreaterThanOrEqual(before);
    expect(s.getGlobalStats().sessionStart).toBeLessThanOrEqual(after);
  });

  it('serializes to/from JSON preserving global counters', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(2, 'https://tracker.com/pixel', true, 'cosmetic');
    const json = stats.toJSON();
    const restored = StatsCollector.fromJSON(json);
    expect(restored.getGlobalStats().totalBlocked).toBe(2);
    expect(restored.getGlobalStats().totalDomains).toBe(2);
    expect(restored.getGlobalStats().byCategory.network).toBe(1);
    expect(restored.getGlobalStats().byCategory.cosmetic).toBe(1);
  });
});

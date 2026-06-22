import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsCollector } from '../src/stats';

describe('Stats integration', () => {
  let stats: StatsCollector;

  beforeEach(() => {
    stats = new StatsCollector();
  });

  it('updateBadge returns text for blocked count > 0', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(1, 'https://tracker.com/pixel', true, 'network');
    const tabStats = stats.getTabStats(1);
    const text = tabStats.blocked > 0 ? String(tabStats.blocked) : '';
    expect(text).toBe('2');
  });

  it('updateBadge returns empty string for 0 blocked', () => {
    stats.record(1, 'https://example.com/style.css', false, undefined);
    const tabStats = stats.getTabStats(1);
    const text = tabStats.blocked > 0 ? String(tabStats.blocked) : '';
    expect(text).toBe('');
  });

  it('stats are recorded for blocked requests', () => {
    stats.record(1, 'https://doubleclick.net/ad.js', true, 'network');
    stats.record(1, 'https://example.com/style.css', false, undefined);
    stats.record(1, 'https://tracker.com/pixel', true, 'network');

    const tab = stats.getTabStats(1);
    expect(tab.blocked).toBe(2);
    expect(tab.allowed).toBe(1);
    expect(tab.byCategory.network).toBe(2);
  });

  it('tab cleanup clears per-tab stats', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(2, 'https://tracker.com/pixel', true, 'network');

    stats.clearTab(1);
    expect(stats.getTabStats(1).blocked).toBe(0);
    expect(stats.getTabStats(2).blocked).toBe(1); // other tab unaffected
  });

  it('stats serialization round-trip preserves counts', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(1, 'https://tracker.com/pixel', true, 'cosmetic');
    stats.record(1, 'https://example.com/style.css', false, undefined);

    const json = stats.toJSON();
    const restored = StatsCollector.fromJSON(json);

    expect(restored.getTabStats(1).blocked).toBe(2);
    expect(restored.getTabStats(1).allowed).toBe(1);
    expect(restored.getTabStats(1).byCategory.network).toBe(1);
    expect(restored.getTabStats(1).byCategory.cosmetic).toBe(1);
  });

  it('global stats reflect all tabs', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(2, 'https://tracker.com/pixel', true, 'network');
    stats.record(3, 'https://example.com/style.css', false, undefined);

    const global = stats.getGlobalStats();
    expect(global.totalBlocked).toBe(2);
    expect(global.totalAllowed).toBe(1);
  });

  it('flush+restore cycle preserves blocked count', () => {
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(2, 'https://tracker.com/pixel', true, 'network');
    const json = stats.toJSON();

    const restored = StatsCollector.fromJSON(json);
    const global = restored.getGlobalStats();
    expect(global.totalBlocked).toBe(2);
  });
});

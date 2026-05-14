import { describe, it, expect } from 'vitest';
import { StatsCollector } from '../src/stats';

describe('Stats persistence', () => {
  it('serializes and restores stats correctly', () => {
    const stats = new StatsCollector();
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(2, 'https://tracker.com/pixel', true, 'cosmetic');
    stats.record(1, 'https://example.com/style.css', false, undefined);

    const json = stats.toJSON();
    const restored = StatsCollector.fromJSON(json);

    expect(restored.getGlobalStats().totalBlocked).toBe(2);
    expect(restored.getGlobalStats().totalAllowed).toBe(1);
    expect(restored.getTabStats(1).blocked).toBe(1);
    expect(restored.getTabStats(1).allowed).toBe(1);
    expect(restored.getTabStats(2).blocked).toBe(1);
    expect(restored.getTabStats(2).byCategory.cosmetic).toBe(1);
  });

  it('handles corrupt JSON gracefully', () => {
    const restored = StatsCollector.fromJSON('not json at all');
    expect(restored.getGlobalStats().totalBlocked).toBe(0);
  });

  it('handles empty object JSON', () => {
    const restored = StatsCollector.fromJSON('{}');
    expect(restored.getGlobalStats().totalBlocked).toBe(0);
  });

  it('handles missing tabs array', () => {
    const restored = StatsCollector.fromJSON('{"tabs": null}');
    expect(restored.getGlobalStats().totalBlocked).toBe(0);
  });

  it('preserves domain sets across serialization', () => {
    const stats = new StatsCollector();
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(1, 'https://tracker.other.com/pixel', true, 'network');

    const json = stats.toJSON();
    const restored = StatsCollector.fromJSON(json);

    const tab = restored.getTabStats(1);
    expect(tab.domains.has('ads.example.com')).toBe(true);
    expect(tab.domains.has('tracker.other.com')).toBe(true);
  });

  it('tab cleanup after serialization round-trip', () => {
    const stats = new StatsCollector();
    stats.record(1, 'https://ads.example.com/ad.js', true, 'network');
    stats.record(2, 'https://tracker.com/pixel', true, 'network');

    const json = stats.toJSON();
    const restored = StatsCollector.fromJSON(json);

    restored.clearTab(1);
    expect(restored.getTabStats(1).blocked).toBe(0);
    expect(restored.getGlobalStats().totalBlocked).toBe(2); // global counters survive tab close
  });
});

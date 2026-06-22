import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdblockLogger } from '../src/logger';

describe('AdblockLogger', () => {
  let logger: AdblockLogger;
  let debugLogs: string[];
  let origDebug: typeof console.debug;

  beforeEach(() => {
    logger = new AdblockLogger();
    debugLogs = [];
    origDebug = console.debug;
    console.debug = (...args: unknown[]) => debugLogs.push(args.join(' '));
  });

  afterEach(() => {
    console.debug = origDebug;
  });

  it('logs blocked requests', () => {
    logger.blocked(1, 'https://ads.example.com/ad.js', 'network');
    expect(debugLogs.length).toBe(1);
    expect(debugLogs[0]).toContain('ads.example.com');
    expect(debugLogs[0]).toContain('BLOCKED');
  });

  it('throttles same domain within 1s', () => {
    logger.blocked(1, 'https://ads.example.com/ad1.js', 'network');
    logger.blocked(1, 'https://ads.example.com/ad2.js', 'network');
    expect(debugLogs.length).toBe(1); // second was throttled
  });

  it('logs different domains independently', () => {
    logger.blocked(1, 'https://ads.example.com/ad.js', 'network');
    logger.blocked(1, 'https://tracker.other.com/pixel', 'network');
    expect(debugLogs.length).toBe(2);
  });

  it('respects enabled flag', () => {
    logger.setEnabled(false);
    logger.blocked(1, 'https://ads.example.com/ad.js', 'network');
    expect(debugLogs.length).toBe(0);
  });

  it('handles invalid URLs gracefully', () => {
    logger.blocked(1, 'not-a-url', 'network');
    expect(debugLogs.length).toBe(1);
    expect(debugLogs[0]).toContain('unknown');
  });
});

/**
 * AdblockLogger — throttled, structured console logging for ad blocking.
 * Uses console.debug (hidden by default in DevTools) with per-domain throttling.
 */
export class AdblockLogger {
  private throttleMap = new Map<string, number>();
  private throttleMs = 1000; // max 1 log per domain per second
  private enabled = true;
  private lastEviction = Date.now();
  private evictionIntervalMs = 60_000; // evict stale entries every 60s

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  private evictStale(): void {
    const now = Date.now();
    if (now - this.lastEviction < this.evictionIntervalMs) return;
    this.lastEviction = now;
    for (const [domain, lastTime] of this.throttleMap) {
      if (now - lastTime > 60_000) this.throttleMap.delete(domain);
    }
  }

  blocked(tabId: number, url: string, category?: string): void {
    if (!this.enabled) return;
    let domain = 'unknown';
    try { domain = new URL(url).hostname; } catch { /* invalid url */ }

    const now = Date.now();
    if (now - (this.throttleMap.get(domain) ?? 0) < this.throttleMs) return;
    this.throttleMap.set(domain, now);

    // Periodic eviction of stale entries
    this.evictStale();

    console.debug(
      `[Adblocker] BLOCKED tab=${tabId} domain=${domain} cat=${category ?? 'unknown'} url=${url}`,
    );
  }

  summary(blocked: number, allowed: number, domains: number): void {
    console.info(
      `[Adblocker] Session: ${blocked} blocked, ${allowed} allowed, ${domains} domains`,
    );
  }
}

/**
 * AdblockLogger — throttled, structured console logging for ad blocking.
 * Uses console.debug (hidden by default in DevTools) with per-domain throttling.
 */
export class AdblockLogger {
  private throttleMap = new Map<string, number>();
  private throttleMs = 1000; // max 1 log per domain per second
  private enabled = true;

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  blocked(tabId: number, url: string, category?: string): void {
    if (!this.enabled) return;
    let domain = 'unknown';
    try { domain = new URL(url).hostname; } catch { /* invalid url */ }

    const now = Date.now();
    if (now - (this.throttleMap.get(domain) ?? 0) < this.throttleMs) return;
    this.throttleMap.set(domain, now);

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

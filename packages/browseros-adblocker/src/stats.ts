export interface TabStats {
  blocked: number;
  allowed: number;
  byCategory: { network: number; cosmetic: number; scriptlet: number };
  domains: Set<string>;
  lastBlockedUrl: string;
}

export interface GlobalStats {
  totalBlocked: number;
  totalAllowed: number;
  byCategory: { network: number; cosmetic: number; scriptlet: number };
  totalDomains: number;
  sessionStart: number;
}

export class StatsCollector {
  private tabs = new Map<number, TabStats>();
  // Cumulative global counters — survive tab close
  private _globalBlocked = 0;
  private _globalAllowed = 0;
  private _globalByCategory = { network: 0, cosmetic: 0, scriptlet: 0 };
  private _globalDomains = new Set<string>();
  private readonly _sessionStart = Date.now();

  record(tabId: number, url: string, blocked: boolean, category?: string): void {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, {
        blocked: 0, allowed: 0,
        byCategory: { network: 0, cosmetic: 0, scriptlet: 0 },
        domains: new Set(), lastBlockedUrl: '',
      });
    }
    const tab = this.tabs.get(tabId)!;
    if (blocked) {
      tab.blocked++;
      if (category && category in tab.byCategory) {
        tab.byCategory[category as keyof typeof tab.byCategory]++;
      }
      try {
        const hostname = new URL(url).hostname;
        tab.domains.add(hostname);
        this._globalDomains.add(hostname);
      } catch { /* invalid url */ }
      tab.lastBlockedUrl = url;
      // Accumulate global counters
      this._globalBlocked++;
      if (category && category in this._globalByCategory) {
        this._globalByCategory[category as keyof typeof this._globalByCategory]++;
      }
    } else {
      tab.allowed++;
      this._globalAllowed++;
    }
  }

  getTabStats(tabId: number): TabStats {
    return this.tabs.get(tabId) ?? {
      blocked: 0, allowed: 0,
      byCategory: { network: 0, cosmetic: 0, scriptlet: 0 },
      domains: new Set(), lastBlockedUrl: '',
    };
  }

  getGlobalStats(): GlobalStats {
    return {
      totalBlocked: this._globalBlocked,
      totalAllowed: this._globalAllowed,
      byCategory: { ...this._globalByCategory },
      totalDomains: this._globalDomains.size,
      sessionStart: this._sessionStart,
    };
  }

  clearTab(tabId: number): void { this.tabs.delete(tabId); }
  reset(): void {
    this.tabs.clear();
    this._globalBlocked = 0;
    this._globalAllowed = 0;
    this._globalByCategory = { network: 0, cosmetic: 0, scriptlet: 0 };
    this._globalDomains.clear();
  }

  toJSON(): string {
    return JSON.stringify({
      _globalBlocked: this._globalBlocked,
      _globalAllowed: this._globalAllowed,
      _globalByCategory: this._globalByCategory,
      _globalDomains: Array.from(this._globalDomains),
      _sessionStart: this._sessionStart,
      tabs: Array.from(this.tabs.entries()).map(([id, s]) => ({
        id, blocked: s.blocked, allowed: s.allowed, byCategory: s.byCategory,
        domains: Array.from(s.domains), lastBlockedUrl: s.lastBlockedUrl,
      })),
    });
  }

  static fromJSON(json: string): StatsCollector {
    const collector = new StatsCollector();
    try {
      const data = JSON.parse(json);
      // Restore global counters
      collector._globalBlocked = data._globalBlocked ?? 0;
      collector._globalAllowed = data._globalAllowed ?? 0;
      collector._globalByCategory = data._globalByCategory ?? { network: 0, cosmetic: 0, scriptlet: 0 };
      collector._globalDomains = new Set(data._globalDomains ?? []);
      // Restore tabs
      for (const t of data.tabs ?? []) {
        collector.tabs.set(t.id, {
          blocked: t.blocked, allowed: t.allowed,
          byCategory: t.byCategory,
          domains: new Set(t.domains ?? []),
          lastBlockedUrl: t.lastBlockedUrl ?? '',
        });
      }
    } catch { /* corrupt, return empty */ }
    return collector;
  }
}

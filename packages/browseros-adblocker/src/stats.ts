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
  sessionStart: number;
}

export class StatsCollector {
  private tabs = new Map<number, TabStats>();

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
      try { tab.domains.add(new URL(url).hostname); } catch { /* invalid url */ }
      tab.lastBlockedUrl = url;
    } else {
      tab.allowed++;
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
    let totalBlocked = 0, totalAllowed = 0;
    const byCategory = { network: 0, cosmetic: 0, scriptlet: 0 };
    for (const tab of this.tabs.values()) {
      totalBlocked += tab.blocked;
      totalAllowed += tab.allowed;
      byCategory.network += tab.byCategory.network;
      byCategory.cosmetic += tab.byCategory.cosmetic;
      byCategory.scriptlet += tab.byCategory.scriptlet;
    }
    return { totalBlocked, totalAllowed, byCategory, sessionStart: Date.now() };
  }

  clearTab(tabId: number): void { this.tabs.delete(tabId); }
  reset(): void { this.tabs.clear(); }

  toJSON(): string {
    return JSON.stringify({
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

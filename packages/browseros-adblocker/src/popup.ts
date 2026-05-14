/* global chrome */

/**
 * Popup script — reads stats from background page and renders in the popup.
 * Uses chrome.extension.getBackgroundPage() for direct access to stats instance.
 */
async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const bg = chrome.extension.getBackgroundPage();
    if (!bg) return;

    // @ts-ignore — stats is exported from background.ts
    const { stats } = bg as any;

    // Tab stats
    const tabStats = stats.getTabStats(tab.id);
    const el = (id: string) => document.getElementById(id);
    if (el('tab-blocked')) el('tab-blocked')!.textContent = String(tabStats.blocked);
    if (el('tab-trackers')) el('tab-trackers')!.textContent = String(tabStats.byCategory.network);
    if (el('tab-scripts')) el('tab-scripts')!.textContent = String(tabStats.byCategory.scriptlet);

    // Global stats
    const global = stats.getGlobalStats();
    if (el('global-blocked')) el('global-blocked')!.textContent = String(global.totalBlocked);

    // Count unique domains across all tabs
    let totalDomains = 0;
    // Access internal tabs map via getTabStats — we need a different approach
    // Sum domains from all tab stats (approximate: count unique from current tab)
    totalDomains = tabStats.domains?.size ?? 0;
    if (el('global-domains')) el('global-domains')!.textContent = String(totalDomains);
  } catch {
    // Background page not available (e.g. in testing or incognito)
    const el = (id: string) => document.getElementById(id);
    if (el('tab-blocked')) el('tab-blocked')!.textContent = '—';
    if (el('tab-trackers')) el('tab-trackers')!.textContent = '—';
    if (el('tab-scripts')) el('tab-scripts')!.textContent = '—';
    if (el('global-blocked')) el('global-blocked')!.textContent = '—';
    if (el('global-domains')) el('global-domains')!.textContent = '—';
  }
}

document.addEventListener('DOMContentLoaded', init);

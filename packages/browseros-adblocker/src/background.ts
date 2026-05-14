/* global chrome */
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';

async function loadBlocker(): Promise<WebExtensionBlocker> {
  const blocker = await WebExtensionBlocker.fromPrebuiltAdsAndTracking();
  blocker.enableBlockingInBrowser(chrome);
  console.log('[BrowserOS Adblocker] Active');
  return blocker;
}

loadBlocker().catch(console.error);

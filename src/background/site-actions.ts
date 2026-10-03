import { browser, type Browser } from 'wxt/browser';
import { setSitePaused } from '../shared/settings';
import { getTabState } from './orchestrator';

export async function pauseSite(tabId: number, paused: boolean): Promise<void> {
  const state = await getTabState(tabId);
  if (!state.site) return;
  await setSitePaused(state.site, paused);
  await browser.tabs.reload(tabId);
}

/**
 * "Withdraw consent on this site": pauses the site (otherwise we would immediately accept again),
 * deletes the site's cookies and storage – where the consent decision lives – and reloads,
 * so the banner shows up again and the user can decide manually.
 */
export async function withdrawConsent(tabId: number): Promise<void> {
  const state = await getTabState(tabId);
  if (!state.url || !state.site) return;
  const url = new URL(state.url);
  await setSitePaused(state.site, true);

  const dataTypes = { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true };
  if (import.meta.env.FIREFOX) {
    // Firefox only supports a hostname filter, and only for cookies + localStorage.
    // (The typings are Chrome's, which call this filter "origins".)
    const hostnames = [...new Set([url.hostname, state.site, `www.${state.site}`])];
    const options = { hostnames } as unknown as Browser.browsingData.RemovalOptions;
    await browser.browsingData.remove(options, { cookies: true, localStorage: true });
  } else {
    const origins = [...new Set([url.origin, `https://${state.site}`, `https://www.${state.site}`])] as [
      string,
      ...string[],
    ];
    await browser.browsingData.remove({ origins }, dataTypes);
  }
  await browser.tabs.reload(tabId);
}

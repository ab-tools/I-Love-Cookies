import { browser } from 'wxt/browser';
import { setSitePaused } from '../shared/settings';
import { getTabState } from './orchestrator';

export async function pauseSite(tabId: number, paused: boolean): Promise<void> {
  const state = await getTabState(tabId);
  if (!state.site) return;
  await setSitePaused(state.site, paused);
  await browser.tabs.reload(tabId);
}

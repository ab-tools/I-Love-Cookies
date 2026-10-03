import { browser } from 'wxt/browser';
import type { ContentScriptMessage } from '@duckduckgo/autoconsent';
import type { UiMessage } from '../shared/messages';
import { getSettings, updateSettings } from '../shared/settings';
import { getTabState, handleContentMessage, onTabRemoved, onTopLevelCommitted } from '../background/orchestrator';
import { RULES_INFO } from '../background/rules';
import { pauseSite, withdrawConsent } from '../background/site-actions';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    // Informed consent first: the extension stays inactive until the user confirmed the onboarding page.
    if (reason === 'install') {
      await browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as { type?: string };
    if (typeof msg?.type !== 'string') return false;

    // Messages from extension pages (popup / options).
    if (msg.type.startsWith('ilc:') && !sender.tab) {
      handleUiMessage(msg as UiMessage).then(sendResponse, (error) => sendResponse({ error: String(error) }));
      return true;
    }

    // Test-only bridge (see content.ts), compiled in only with `wxt build --mode e2e`.
    if (import.meta.env.MODE === 'e2e' && msg.type === 'ilc:e2e' && sender.tab?.id !== undefined) {
      handleE2eMessage(msg as { type: string; action: string }, sender.tab.id).then(sendResponse);
      return true;
    }

    // autoconsent protocol from content scripts.
    if (sender.tab?.id !== undefined && sender.frameId !== undefined) {
      const frameUrl = sender.url || (sender.origin ? `${sender.origin}/` : '');
      void handleContentMessage(msg as ContentScriptMessage, sender.tab.id, sender.frameId, frameUrl, sender.tab.url ?? frameUrl);
    }
    return false;
  });

  browser.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
    if (frameId === 0 && /^https?:/.test(url)) void onTopLevelCommitted(tabId, url);
  });

  browser.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId));
});

async function handleE2eMessage(msg: { action: string }, tabId: number) {
  switch (msg.action) {
    case 'acceptOnboarding':
      await updateSettings({ onboardingAccepted: true, enabled: true });
      return { ok: true };
    case 'getState':
      return getTabState(tabId);
    default:
      return { error: `unknown action ${msg.action}` };
  }
}

async function handleUiMessage(msg: UiMessage) {
  switch (msg.type) {
    case 'ilc:getTabState':
      return { state: await getTabState(msg.tabId), settings: await getSettings(), rules: RULES_INFO };
    case 'ilc:setSitePaused':
      await pauseSite(msg.tabId, msg.paused);
      return { ok: true };
    case 'ilc:withdrawConsent':
      await withdrawConsent(msg.tabId);
      return { ok: true };
  }
}

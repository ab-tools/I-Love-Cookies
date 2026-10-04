import { browser } from 'wxt/browser';
import type { ContentScriptMessage } from '@duckduckgo/autoconsent';
import type { UiMessage } from '../shared/messages';
import { getSettings, updateSettings } from '../shared/settings';
import { getTabState, handleContentMessage, onInPageNavigation, onTabRemoved, onTopLevelCommitted, onTrustedClick } from '../background/orchestrator';
import { RULES_INFO, activeRules } from '../background/rules';
import { RULE_UPDATE_ALARM, checkForRuleUpdate, clearRuleSet, getRuleSet, getRuleUpdateStatus, invalidateRuleSet, scheduleRuleUpdates } from '../background/rule-updates';
import { collectReportSnapshot } from '../background/report-snapshot';
import { pauseSite } from '../background/site-actions';
import { sendReport } from '../background/report-send';

export default defineBackground(() => {
  void scheduleRuleUpdates();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RULE_UPDATE_ALARM) void checkForRuleUpdate();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && changes.settings) || (area === 'local' && changes.ruleSet)) invalidateRuleSet();
    // Rule updates switched off: only the bundled rules apply, the downloaded set is removed.
    const settings = area === 'sync' ? (changes.settings?.newValue as { remoteRules?: boolean } | undefined) : undefined;
    if (settings && settings.remoteRules === false) void clearRuleSet();
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as { type?: string };
    if (typeof msg?.type !== 'string') return false;

    // Messages from extension pages (popup / options – the options page may run in a tab).
    if (msg.type.startsWith('ilc:') && (!sender.tab || sender.url?.startsWith(browser.runtime.getURL('/')))) {
      handleUiMessage(msg as UiMessage).then(sendResponse, (error) => sendResponse({ error: String(error) }));
      return true;
    }

    // Test-only bridge (see content.ts), compiled in only with `wxt build --mode e2e`.
    if (import.meta.env.MODE === 'e2e' && msg.type === 'ilc:e2e' && sender.tab?.id !== undefined) {
      handleE2eMessage(msg as { type: string; action: string }, sender.tab.id).then(sendResponse);
      return true;
    }

    // Real mouse click for a frame during a trusted run.
    if (msg.type === 'ilc:trustedClick' && sender.tab?.id !== undefined && sender.frameId !== undefined) {
      const { x, y } = msg as { x: number; y: number };
      onTrustedClick(sender.tab.id, sender.frameId, x, y).then(sendResponse, () => sendResponse(false));
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

  browser.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
    if (frameId === 0) void onInPageNavigation(tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId));
});

async function handleE2eMessage(msg: { action: string }, tabId: number) {
  switch (msg.action) {
    case 'enable':
      await updateSettings({ enabled: true });
      return { ok: true };
    case 'getState':
      return getTabState(tabId);
    case 'wipe':
      // Fresh-profile equivalent for automated tests: all site data, plus our per-site daily counters.
      await browser.browsingData.remove({ since: 0 }, { cookies: true, localStorage: true, indexedDB: true, cache: true, serviceWorkers: true });
      await browser.storage.local.remove(Object.keys(await browser.storage.local.get(null)).filter((k) => k.startsWith('daily:')));
      return { ok: true };
    case 'disable':
      await updateSettings({ enabled: false });
      return { ok: true };
    case 'force:rule':
    case 'force:api':
    case 'force:none':
      await browser.storage.local.set({ e2eForceStrategy: msg.action.slice('force:'.length) });
      return { ok: true };
    default:
      return { error: `unknown action ${msg.action}` };
  }
}

async function handleUiMessage(msg: UiMessage) {
  switch (msg.type) {
    case 'ilc:getTabState':
      return { state: await getTabState(msg.tabId), settings: await getSettings() };
    case 'ilc:setSitePaused':
      await pauseSite(msg.tabId, msg.paused);
      return { ok: true };
    case 'ilc:report':
      return sendReport(msg.tabId, msg.anonymous, msg.problem, msg.note);
    case 'ilc:collectReport':
      return collectReportSnapshot(msg.tabId);
    case 'ilc:getRuleStatus':
      return { status: await getRuleUpdateStatus(), rules: await rulesInfo() };
    case 'ilc:checkRuleUpdate':
      return { status: await checkForRuleUpdate(), rules: await rulesInfo() };
  }
}

/** Rule counts and versions for the popup and options page. */
async function rulesInfo() {
  const set = await getRuleSet();
  const rules = activeRules(set);
  return { ...RULES_INFO, count: rules.autoconsent.length + rules.consentOMatic.length, update: set?.version };
}

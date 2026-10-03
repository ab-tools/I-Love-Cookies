import { browser } from 'wxt/browser';
import '../../assets/ui.css';
import './style.css';
import type { TabState, UiMessage } from '../../shared/messages';
import type { Settings } from '../../shared/settings';
import { isSitePaused } from '../../shared/settings';
import { buildIssueUrl, searchExistingIssuesUrl } from '../../shared/report';
import { describeState } from '../../shared/describe';
import { localizePage, translate } from '../../shared/i18n';

interface TabInfo {
  state: TabState;
  settings: Settings;
  rules: { upstreamVersion: string; count: number };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function send<T>(message: UiMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

async function main() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? '')) {
    $('status').textContent = translate('status_unavailable');
    $('actions').hidden = true;
    return;
  }
  const tabId = tab.id;
  const info = await send<TabInfo>({ type: 'ilc:getTabState', tabId });
  render(info);

  $<HTMLInputElement>('site-active').addEventListener('change', async (e) => {
    const active = (e.target as HTMLInputElement).checked;
    await send({ type: 'ilc:setSitePaused', tabId, paused: !active });
    window.close();
  });
  $('withdraw').addEventListener('click', async () => {
    await send({ type: 'ilc:withdrawConsent', tabId });
    window.close();
  });
  $('report').addEventListener('click', async () => {
    const url = buildIssueUrl(info.state, { browser: import.meta.env.BROWSER, userAgent: navigator.userAgent });
    await browser.tabs.create({ url });
  });
}

function render({ state, settings, rules }: TabInfo) {
  const { text, tone, details } = describeState(state, translate);
  $('site').textContent = state.site;
  const status = $('status');
  status.textContent = text;
  status.className = `status ${tone}`;
  $('details').textContent = details;
  $('log').textContent = state.log
    .map((e) => `${new Date(e.t).toLocaleTimeString()} [${e.frameId}] ${e.msg}`)
    .join('\n') || translate('popup_logEmpty');
  $('rules-info').textContent = translate('popup_rulesInfo', [String(rules.count), rules.upstreamVersion]);

  const setupNeeded = !settings.onboardingAccepted;
  $('setup').hidden = !setupNeeded;
  $('actions').hidden = setupNeeded;
  $<HTMLInputElement>('site-active').checked = !isSitePaused(settings, state.site);
  const search = $<HTMLAnchorElement>('search-issues');
  search.href = searchExistingIssuesUrl(state.site);
}

$('open-onboarding').addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  window.close();
});
$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  void browser.runtime.openOptionsPage();
  window.close();
});

localizePage();
void main();

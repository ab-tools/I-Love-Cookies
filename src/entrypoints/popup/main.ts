import { browser } from 'wxt/browser';
import '../../assets/ui.css';
import './style.css';
import type { ReportSnapshot, TabState, UiMessage } from '../../shared/messages';
import type { Settings } from '../../shared/settings';
import { exclusionFor } from '../../shared/settings';
import { buildReport, searchExistingIssuesUrl, type Report } from '../../shared/report';
import { describeState } from '../../shared/describe';
import { localizePage, translate } from '../../shared/i18n';

interface TabInfo {
  state: TabState;
  settings: Settings;
  rules: { upstreamVersion: string; count: number; update?: string };
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
  let report: Report | null = null;
  $('report').addEventListener('click', async () => {
    $('actions').hidden = true;
    $('report-preview').hidden = false;
    $('report-text').textContent = translate('popup_reportCollecting');
    const snapshot = await send<ReportSnapshot>({ type: 'ilc:collectReport', tabId }).catch(() => undefined);
    report = buildReport(info.state, { browser: import.meta.env.BROWSER, userAgent: navigator.userAgent }, snapshot);
    $('report-text').textContent = [report.title, '', report.details, ...(report.diagnostics ? ['', JSON.stringify(JSON.parse(report.diagnostics), null, 1)] : [])].join('\n');
    $<HTMLButtonElement>('report-open').disabled = false;
  });
  $('report-open').addEventListener('click', async () => {
    if (report) await browser.tabs.create({ url: report.url });
  });
  $('report-cancel').addEventListener('click', () => {
    $('report-preview').hidden = true;
    $('actions').hidden = false;
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
  $('rules-info').textContent = [
    translate('popup_rulesInfo', [String(rules.count), rules.upstreamVersion]),
    ...(rules.update ? [translate('popup_rulesUpdate', [rules.update])] : []),
  ].join(' · ');

  const setupNeeded = !settings.onboardingAccepted;
  $('setup').hidden = !setupNeeded;
  $('actions').hidden = setupNeeded;
  // Entries other than the site's own domain (parent domains, patterns) can only be changed in the settings.
  const excludedBy = exclusionFor(settings, state.url);
  const byOtherEntry = excludedBy !== null && excludedBy !== state.site;
  const toggle = $<HTMLInputElement>('site-active');
  toggle.checked = excludedBy === null;
  toggle.disabled = byOtherEntry;
  $('excluded-by').hidden = !byOtherEntry;
  $('excluded-by').textContent = byOtherEntry ? translate('popup_excludedBy', [excludedBy]) : '';
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

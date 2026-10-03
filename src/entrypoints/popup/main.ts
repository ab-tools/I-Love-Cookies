import { browser } from 'wxt/browser';
import '../../assets/ui.css';
import './style.css';
import type { TabState, UiMessage } from '../../shared/messages';
import type { Settings } from '../../shared/settings';
import { exclusionFor } from '../../shared/settings';
import { describeState } from '../../shared/describe';
import { localizePage, translate } from '../../shared/i18n';
import { REPORT_DATA_COLLECTION } from '../../shared/constants';

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
  render(await send<TabInfo>({ type: 'ilc:getTabState', tabId }));

  $<HTMLInputElement>('site-active').addEventListener('change', async (e) => {
    const active = (e.target as HTMLInputElement).checked;
    await send({ type: 'ilc:setSitePaused', tabId, paused: !active });
    window.close();
  });
  $('report').addEventListener('click', () => {
    $('report-buttons').hidden = true;
    $('report-choice').hidden = false;
  });
  const report = async (anonymous: boolean) => {
    // Firefox asks before an add-on transmits data; the request must start within the click.
    if (import.meta.env.FIREFOX) {
      void browser.permissions.request({ data_collection: REPORT_DATA_COLLECTION } as unknown as Parameters<typeof browser.permissions.request>[0]).catch(() => false);
    }
    $('report-choice').hidden = true;
    const status = $('report-status');
    status.hidden = false;
    status.className = 'muted small';
    status.textContent = translate(anonymous ? 'popup_reportSending' : 'popup_reportOpening');
    const result = await send<{ ok?: true; error?: string }>({ type: 'ilc:report', tabId, anonymous });
    if (result?.ok) {
      window.close();
      return;
    }
    status.className = 'bad small';
    status.textContent = translate(result?.error === 'consent' ? 'popup_reportNoConsent' : 'popup_reportFailed');
    $('report-choice').hidden = false;
  };
  $('report-github').addEventListener('click', () => void report(false));
  $('report-anonymous').addEventListener('click', () => void report(true));
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

  // Entries other than the site's own domain (parent domains, patterns) can only be changed in the settings.
  const excludedBy = exclusionFor(settings, state.url);
  const byOtherEntry = excludedBy !== null && excludedBy !== state.site;
  const toggle = $<HTMLInputElement>('site-active');
  toggle.checked = excludedBy === null;
  toggle.disabled = byOtherEntry;
  $('excluded-by').hidden = !byOtherEntry;
  $('excluded-by').textContent = byOtherEntry ? translate('popup_excludedBy', [excludedBy]) : '';
}

$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  void browser.runtime.openOptionsPage();
  window.close();
});

localizePage();
void main();

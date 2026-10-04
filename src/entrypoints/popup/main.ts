import { browser } from 'wxt/browser';
import '../../assets/ui.css';
import './style.css';
import type { ReportProblem, TabState, UiMessage } from '../../shared/messages';
import type { Settings } from '../../shared/settings';
import { exclusionFor } from '../../shared/settings';
import { describeState } from '../../shared/describe';
import { localizePage, translate } from '../../shared/i18n';
import { WEBSITE_URL } from '../../shared/constants';

interface TabInfo {
  state: TabState;
  settings: Settings;
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
  // Report dialog: what the user saw, then how to report.
  const dialog = $('report-dialog');
  const problems = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=problem]'));
  const sendButtons = [$<HTMLButtonElement>('report-github'), $<HTMLButtonElement>('report-anonymous')];
  const status = $('report-status');
  const selected = () => problems.find((input) => input.checked)?.value as ReportProblem | undefined;
  const enableSend = () => sendButtons.forEach((button) => (button.disabled = !selected()));
  const closeDialog = () => {
    dialog.hidden = true;
    document.body.classList.remove('dialog-open');
    $('report').focus();
  };
  $('report').addEventListener('click', () => {
    dialog.hidden = false;
    document.body.classList.add('dialog-open');
    status.hidden = true;
    enableSend();
    (problems.find((input) => input.checked) ?? problems[0])?.focus();
  });
  problems.forEach((input) => input.addEventListener('change', enableSend));
  $('report-close').addEventListener('click', closeDialog);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) closeDialog();
  });
  const report = async (anonymous: boolean) => {
    const problem = selected();
    if (!problem) return;
    sendButtons.forEach((button) => (button.disabled = true));
    status.hidden = false;
    status.className = 'muted small';
    status.textContent = translate(anonymous ? 'popup_reportSending' : 'popup_reportOpening');
    const result = await send<{ ok?: true; error?: string }>({ type: 'ilc:report', tabId, anonymous, problem });
    if (result?.ok) {
      window.close();
      return;
    }
    status.className = 'bad small';
    status.textContent = translate('popup_reportFailed');
    enableSend();
  };
  $('report-github').addEventListener('click', () => void report(false));
  $('report-anonymous').addEventListener('click', () => void report(true));
}

function render({ state, settings }: TabInfo) {
  const { text, tone, details } = describeState(state, translate);
  $('site').textContent = state.site;
  const status = $('status');
  status.textContent = text;
  status.className = `status ${tone}`;
  $('details').textContent = details;
  $('log').textContent = state.log
    .map((e) => `${new Date(e.t).toLocaleTimeString()} [${e.frameId}] ${e.msg}`)
    .join('\n') || translate('popup_logEmpty');

  // Entries other than the site's own domain (parent domains, patterns) can only be changed in the settings.
  const excludedBy = exclusionFor(settings, state.url);
  const byOtherEntry = excludedBy !== null && excludedBy !== state.site;
  const toggle = $<HTMLInputElement>('site-active');
  toggle.checked = excludedBy === null;
  toggle.disabled = byOtherEntry;
  $('excluded-by').hidden = !byOtherEntry;
  $('excluded-by').textContent = byOtherEntry ? translate('popup_excludedBy', [excludedBy]) : '';
}

$<HTMLAnchorElement>('more-info').href = WEBSITE_URL;
$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  void browser.runtime.openOptionsPage();
  window.close();
});

localizePage();
void main();

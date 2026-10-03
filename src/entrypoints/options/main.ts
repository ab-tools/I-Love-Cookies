import { browser } from 'wxt/browser';
import '../../assets/ui.css';
import '../../assets/page.css';
import { getSettings, setSitePaused, updateSettings, type Settings } from '../../shared/settings';
import { normalizeExclusion, parseExclusion } from '../../shared/exclusions';
import { localizePage, translate } from '../../shared/i18n';
import type { RuleUpdateStatus } from '../../background/rule-updates';

type BooleanSetting = 'payOrOk' | 'debug' | 'remoteRules';
const TOGGLES: BooleanSetting[] = ['payOrOk', 'debug', 'remoteRules'];

interface RuleInfo {
  status: RuleUpdateStatus;
  rules: { count: number; update?: string };
}

async function render() {
  const settings = await getSettings();
  const exclusionInput = document.getElementById('exclusion-input') as HTMLInputElement;
const exclusionError = document.getElementById('exclusion-error') as HTMLElement;

document.getElementById('exclusion-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const entry = normalizeExclusion(exclusionInput.value);
  const parsed = parseExclusion(entry);
  let error = 'error' in parsed ? translate(`options_exclusionError_${parsed.error}`) : '';
  if (!error && (await getSettings()).pausedSites.includes(entry)) error = translate('options_exclusionDuplicate');
  exclusionError.textContent = error;
  exclusionError.hidden = !error;
  if (error) return;
  exclusionInput.value = '';
  renderPaused(await setSitePaused(entry, true));
});
exclusionInput.addEventListener('input', () => (exclusionError.hidden = true));

for (const key of TOGGLES) {
    (document.getElementById(key) as HTMLInputElement).checked = settings[key];
  }
  renderPaused(settings);
  checkButton.disabled = !settings.remoteRules;
  const { version } = browser.runtime.getManifest();
  (document.getElementById('about') as HTMLElement).textContent = translate('options_aboutText', [version]);
  renderRules((await browser.runtime.sendMessage({ type: 'ilc:getRuleStatus' })) as RuleInfo);
}

function renderRules({ status, rules }: RuleInfo) {
  (document.getElementById('rules-status') as HTMLElement).textContent = rules.update
    ? translate('options_rulesUpdated', [String(rules.count), rules.update])
    : translate('options_rulesBundled', [String(rules.count)]);
  (document.getElementById('rules-checked') as HTMLElement).textContent = status.error
    ? translate('options_rulesError', [status.error])
    : status.checkedAt
      ? translate('options_rulesChecked', [new Date(status.checkedAt).toLocaleString()])
      : translate('options_rulesNever');
}

const checkButton = document.getElementById('rules-check') as HTMLButtonElement;
const remoteRules = document.getElementById('remoteRules') as HTMLInputElement;

async function refreshRules(check: boolean) {
  checkButton.disabled = true;
  try {
    renderRules((await browser.runtime.sendMessage({ type: check ? 'ilc:checkRuleUpdate' : 'ilc:getRuleStatus' })) as RuleInfo);
  } finally {
    checkButton.disabled = !remoteRules.checked;
  }
}

checkButton.addEventListener('click', () => void refreshRules(true));

function renderPaused(settings: Settings) {
  const list = document.getElementById('paused') as HTMLUListElement;
  list.replaceChildren(
    ...settings.pausedSites.map((site) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = site;
      const parsed = parseExclusion(site);
      const kind = document.createElement('span');
      kind.className = 'muted small';
      kind.textContent = 'error' in parsed ? translate(`options_exclusionError_${parsed.error}`) : translate(`options_kind_${parsed.kind}`);
      name.append(' ', kind);
      const resume = document.createElement('button');
      resume.textContent = translate('options_resume');
      resume.addEventListener('click', async () => renderPaused(await setSitePaused(site, false)));
      li.append(name, resume);
      return li;
    }),
  );
  (document.getElementById('paused-empty') as HTMLElement).hidden = settings.pausedSites.length > 0;
}

for (const key of TOGGLES) {
  document.getElementById(key)!.addEventListener('change', async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    await updateSettings({ [key]: checked });
    if (key === 'remoteRules') await refreshRules(checked);
  });
}

localizePage();
void render();

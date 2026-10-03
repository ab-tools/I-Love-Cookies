import { browser } from 'wxt/browser';
import '../../assets/ui.css';
import '../../assets/page.css';
import { getSettings, setSitePaused, updateSettings, type Settings } from '../../shared/settings';
import { localizePage, translate } from '../../shared/i18n';

type BooleanSetting = 'enabled' | 'debug';
const TOGGLES: BooleanSetting[] = ['enabled', 'debug'];

async function render() {
  const settings = await getSettings();
  (document.getElementById('setup') as HTMLElement).hidden = settings.onboardingAccepted;
  for (const key of TOGGLES) {
    (document.getElementById(key) as HTMLInputElement).checked = settings[key];
  }
  renderPaused(settings);
  const { version } = browser.runtime.getManifest();
  (document.getElementById('about') as HTMLElement).textContent = translate('options_aboutText', [version]);
}

function renderPaused(settings: Settings) {
  const list = document.getElementById('paused') as HTMLUListElement;
  list.replaceChildren(
    ...settings.pausedSites.map((site) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = site;
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
  document.getElementById(key)!.addEventListener('change', (e) => {
    void updateSettings({ [key]: (e.target as HTMLInputElement).checked });
  });
}

localizePage();
void render();

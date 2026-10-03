import '../../assets/ui.css';
import '../../assets/page.css';
import { getSettings, updateSettings } from '../../shared/settings';
import { localizePage } from '../../shared/i18n';

const accept = document.getElementById('accept') as HTMLButtonElement;
const done = document.getElementById('done') as HTMLElement;

async function main() {
  const settings = await getSettings();
  if (settings.onboardingAccepted) showDone();

  accept.addEventListener('click', async () => {
    await updateSettings({ onboardingAccepted: true, enabled: true });
    showDone();
  });
}

function showDone() {
  accept.disabled = true;
  done.hidden = false;
}

localizePage();
void main();

import { browser } from 'wxt/browser';

export interface Settings {
  /** Global on/off switch. */
  enabled: boolean;
  /** The extension does nothing until the user confirmed the onboarding page (informed consent). */
  onboardingAccepted: boolean;
  /** Hostnames (without leading "www.") on which the extension is paused. */
  pausedSites: string[];
  /** Verbose autoconsent logging in the page console. */
  debug: boolean;
  /** Download rule updates daily (declarative rules only). */
  remoteRules: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  onboardingAccepted: false,
  pausedSites: [],
  debug: false,
  remoteRules: true,
};

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...((stored.settings as Partial<Settings>) ?? {}) };
}

export async function updateSettings(change: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await getSettings()), ...change };
  await browser.storage.sync.set({ settings });
  return settings;
}

/** "www.example.com" → "example.com"; invalid URLs → "". */
export function siteOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A site is paused if it or one of its parent domains is in the list. */
export function isSitePaused(settings: Settings, site: string): boolean {
  return settings.pausedSites.some((paused) => site === paused || site.endsWith(`.${paused}`));
}

export async function setSitePaused(site: string, paused: boolean): Promise<Settings> {
  const { pausedSites } = await getSettings();
  const next = pausedSites.filter((s) => s !== site);
  if (paused) next.push(site);
  return updateSettings({ pausedSites: next.sort() });
}

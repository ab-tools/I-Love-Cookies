import { browser } from 'wxt/browser';
import { matchingExclusion } from './exclusions';

export interface Settings {
  /** Off only in test builds that measure pages without the extension acting. */
  enabled: boolean;
  /** Excluded sites: domains, address prefixes, wildcard patterns or /regular expressions/ (see exclusions.ts). */
  pausedSites: string[];
  /** Verbose autoconsent logging in the page console. */
  debug: boolean;
  /** Download rule updates daily (declarative rules only). */
  remoteRules: boolean;
  /** Also accept "consent or pay" walls (always with the free option). */
  payOrOk: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pausedSites: [],
  debug: false,
  remoteRules: true,
  payOrOk: true,
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

/** The exclusion entry that pauses the extension on this URL, or null. */
export function exclusionFor(settings: Settings, url: string): string | null {
  return matchingExclusion(settings.pausedSites, url);
}

/** Adds or removes one exclusion entry (a site's domain from the popup, or any entry from the settings). */
export async function setSitePaused(entry: string, paused: boolean): Promise<Settings> {
  const { pausedSites } = await getSettings();
  const next = pausedSites.filter((s) => s !== entry);
  if (paused) next.push(entry);
  return updateSettings({ pausedSites: next.sort() });
}

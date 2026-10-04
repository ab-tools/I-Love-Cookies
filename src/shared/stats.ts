import { browser } from 'wxt/browser';

/** How many banners the extension answered for the user (kept only in local storage). */
export interface Stats {
  handled: number;
  /** When counting started (ms). */
  since: number;
}

const KEY = 'stats';
/** Conservative estimate of the time a user spends on one banner. */
export const SECONDS_PER_BANNER = 3;

export async function getStats(): Promise<Stats> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Stats> | undefined;
  return { handled: stored?.handled ?? 0, since: stored?.since ?? Date.now() };
}

// Increments from several tabs run one after another, so none is lost.
let queue: Promise<unknown> = Promise.resolve();

export function countHandled(): Promise<void> {
  const next = queue.then(async () => {
    const stats = await getStats();
    await browser.storage.local.set({ [KEY]: { handled: stats.handled + 1, since: stats.since } });
  });
  queue = next.catch(() => undefined);
  return next;
}

/** Time saved for a number of banners, e.g. "45 sec", "12 min", "3.5 hr" (localized units). */
export function formatTimeSaved(banners: number, locale?: string): string {
  const seconds = banners * SECONDS_PER_BANNER;
  const format = (value: number, unit: 'second' | 'minute' | 'hour' | 'day', digits = 0) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(value);
  if (seconds < 60) return format(seconds, 'second');
  if (seconds < 3600) return format(Math.round(seconds / 60), 'minute');
  if (seconds < 48 * 3600) return format(seconds / 3600, 'hour', 1);
  return format(seconds / 86400, 'day', 1);
}

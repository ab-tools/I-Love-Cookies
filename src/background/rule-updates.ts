import { browser } from 'wxt/browser';
import { LIMITS, RULE_UPDATE_URL } from '../shared/constants';
import { compareVersions, sha256Hex, validateRuleSet, type RuleSet } from '../shared/rule-set';
import { getSettings } from '../shared/settings';
import { allSnippets } from './snippets';

export const RULE_UPDATE_ALARM = 'ilc:ruleUpdate';
/** One more try soon after a checksum mismatch (the download cache may still serve the previous file). */
export const RULE_RETRY_ALARM = 'ilc:ruleUpdateRetry';
const RETRY_MINUTES = 30;

/** Result of the last update check (shown on the options page). */
export interface RuleUpdateStatus {
  checkedAt?: number;
  /** Version of the active downloaded set, if any. */
  version?: string;
  /** The last check failed or the downloaded set was rejected. */
  error?: string;
}

interface StoredRuleSet {
  set: RuleSet;
  sha256: string;
}

const SNIPPET_IDS: ReadonlySet<string> = new Set(Object.keys(allSnippets));

let cached: Promise<RuleSet | null> | null = null;

/** The active downloaded rule set (null: bundled rules only). */
export function getRuleSet(): Promise<RuleSet | null> {
  cached ??= loadRuleSet();
  return cached;
}

async function loadRuleSet(): Promise<RuleSet | null> {
  const [{ remoteRules }, { ruleSet }] = await Promise.all([getSettings(), browser.storage.local.get('ruleSet')]);
  const stored = ruleSet as StoredRuleSet | undefined;
  if (!remoteRules || !stored) return null;
  // Re-check on load: an extension update can make a stored set unusable (snippets, version range).
  const errors = validateRuleSet(stored.set, SNIPPET_IDS, browser.runtime.getManifest().version);
  return errors.length ? null : stored.set;
}

export async function getRuleUpdateStatus(): Promise<RuleUpdateStatus> {
  const { ruleUpdateStatus } = await browser.storage.local.get('ruleUpdateStatus');
  const set = await getRuleSet();
  return { ...((ruleUpdateStatus as RuleUpdateStatus) ?? {}), version: set?.version };
}

async function fetchLimited(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > LIMITS.ruleSetMaxBytes) throw new Error('rule set too large');
  return bytes;
}

/**
 * Downloads the published rule set if its checksum changed, validates it and activates it when it is newer
 * than the active one. Any failure keeps the active set (or the bundled rules).
 */
export async function checkForRuleUpdate(): Promise<RuleUpdateStatus> {
  const status: RuleUpdateStatus = { checkedAt: Date.now() };
  try {
    if (!(await getSettings()).remoteRules) throw new Error('rule updates are switched off');
    const { ruleSet } = await browser.storage.local.get('ruleSet');
    const stored = ruleSet as StoredRuleSet | undefined;
    const expected = new TextDecoder().decode(await fetchLimited(`${RULE_UPDATE_URL}.sha256`)).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('invalid checksum file');
    if (expected !== stored?.sha256) {
      const bytes = await fetchLimited(RULE_UPDATE_URL);
      if ((await sha256Hex(bytes)) !== expected) throw new Error('checksum mismatch');
      const set = JSON.parse(new TextDecoder().decode(bytes)) as RuleSet;
      const errors = validateRuleSet(set, SNIPPET_IDS, browser.runtime.getManifest().version);
      if (errors.length) throw new Error(`rule set rejected: ${errors.slice(0, 3).join('; ')}`);
      if (!stored || compareVersions(set.version, stored.set.version) > 0) {
        await browser.storage.local.set({ ruleSet: { set, sha256: expected } satisfies StoredRuleSet });
        cached = null;
      }
    }
  } catch (error) {
    status.error = String(error instanceof Error ? error.message : error).slice(0, 300);
    if (status.error === 'checksum mismatch') await browser.alarms.create(RULE_RETRY_ALARM, { delayInMinutes: RETRY_MINUTES });
  }
  await browser.storage.local.set({ ruleUpdateStatus: status });
  return getRuleUpdateStatus();
}

/** Removes the downloaded set; the bundled rules apply again. */
export async function clearRuleSet(): Promise<void> {
  await browser.storage.local.remove('ruleSet');
  cached = null;
}

/** Daily check, first one shortly after start. */
export async function scheduleRuleUpdates(): Promise<void> {
  const existing = await browser.alarms.get(RULE_UPDATE_ALARM);
  if (!existing) {
    await browser.alarms.create(RULE_UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: LIMITS.ruleUpdateHours * 60 });
  }
}

/** Settings or stored set changed (also from another extension context). */
export function invalidateRuleSet(): void {
  cached = null;
}

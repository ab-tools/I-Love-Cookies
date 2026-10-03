import { browser } from 'wxt/browser';
import { LIMITS } from '../shared/constants';
import type { FrameSnapshot, IlcContentMessage, ReportSnapshot } from '../shared/messages';
import { runSnippet } from './orchestrator';
import { getRuleSet } from './rule-updates';

const MAX_FRAMES = 6;

const timeout = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

async function frameSnapshot(tabId: number, frameId: number): Promise<FrameSnapshot | null> {
  const message: IlcContentMessage = { type: 'ilc:reportSnapshot' };
  const answer = browser.tabs.sendMessage(tabId, message, { frameId }).then(
    (r) => (r ?? null) as FrameSnapshot | null,
    () => null,
  );
  return Promise.race([answer, timeout(LIMITS.snapshotTimeoutMs, null)]);
}

/** Structured report data from all frames of a tab: the top frame plus frames with consent UI. */
export async function collectReportSnapshot(tabId: number): Promise<ReportSnapshot> {
  const frames = (await browser.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [{ frameId: 0 }];
  const snapshots = await Promise.all(frames.map((f) => frameSnapshot(tabId, f.frameId)));
  const relevant = snapshots.filter((s): s is FrameSnapshot => !!s && (s.top || s.cmps.length > 0 || !!s.banner));
  const signals = await Promise.race([runSnippet(tabId, 0, 'ILC_READ_CONSENT_SIGNALS', [0]).catch(() => null), timeout(LIMITS.snapshotTimeoutMs, null)]);
  return {
    frames: relevant.sort((a, b) => Number(b.top) - Number(a.top)).slice(0, MAX_FRAMES),
    signals,
    ruleSet: (await getRuleSet())?.version,
  };
}

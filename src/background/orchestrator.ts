/**
 * One state machine per tab document:
 *   popupFound ──► strategy (rule / API / shadow click) ──► result ──► verify ──► outcome
 *
 * Single actor per tab, per-document and per-site daily attempt limits, inactive until onboarding
 * is accepted and on paused sites.
 */
import { browser } from 'wxt/browser';
import type { BackgroundMessage, Config, ContentScriptMessage } from '@duckduckgo/autoconsent';
import { LIMITS } from '../shared/constants';
import type { FrameVerification, IlcContentMessage, Phase, Strategy, TabState } from '../shared/messages';
import { getSettings, isSitePaused, siteOf } from '../shared/settings';
import { evaluateOutcome, isSuccess, type ConsentSignals, type VerificationResult } from '../shared/verifier';
import { rulesForFrame } from './rules';
import { allSnippets } from './snippets';
import { strategyFor } from './strategy';
import { updateBadge } from './badge';

type Snippets = Record<string, (...args: unknown[]) => unknown>;
const SNIPPETS = allSnippets as unknown as Snippets;

const states = new Map<number, TabState>();
const queues = new Map<number, Promise<unknown>>();
const doneTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Incremented on every top-level navigation; async work started for an older document is dropped. */
const documentIds = new Map<number, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const version = () => browser.runtime.getManifest().version;

// ---------------------------------------------------------------------------------------------
// State handling
// ---------------------------------------------------------------------------------------------

function freshState(tabId: number, url: string): TabState {
  return {
    tabId,
    url,
    site: siteOf(url),
    phase: 'idle',
    attempts: {},
    extensionVersion: version(),
    log: [],
  };
}

async function loadState(tabId: number): Promise<TabState | undefined> {
  if (states.has(tabId)) return states.get(tabId);
  // The service worker may have been restarted – recover from session storage.
  const key = `tab:${tabId}`;
  const stored = (await browser.storage.session.get(key))[key] as TabState | undefined;
  if (stored) states.set(tabId, stored);
  return stored;
}

async function saveState(state: TabState): Promise<void> {
  states.set(state.tabId, state);
  await browser.storage.session.set({ [`tab:${state.tabId}`]: state });
  await updateBadge(state);
}

/** Serialises all work per tab so concurrent frame messages cannot corrupt the state. */
function withTab<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(tabId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(
    tabId,
    next.catch(() => undefined),
  );
  return next;
}

function log(state: TabState, frameId: number, msg: string) {
  state.log.push({ t: Date.now(), frameId, msg });
  if (state.log.length > LIMITS.logEntries) state.log.splice(0, state.log.length - LIMITS.logEntries);
}

function setPhase(state: TabState, phase: Phase) {
  state.phase = phase;
}

// ---------------------------------------------------------------------------------------------
// Per-site daily loop guard
// ---------------------------------------------------------------------------------------------

interface DailyCounter {
  day: string;
  attempts: number;
  failures: number;
}

const today = () => new Date().toISOString().slice(0, 10);

async function getDaily(site: string): Promise<DailyCounter> {
  const key = `daily:${site}`;
  const stored = (await browser.storage.local.get(key))[key] as DailyCounter | undefined;
  return stored && stored.day === today() ? stored : { day: today(), attempts: 0, failures: 0 };
}

async function bumpDaily(site: string, field: 'attempts' | 'failures'): Promise<void> {
  const counter = await getDaily(site);
  counter[field]++;
  await browser.storage.local.set({ [`daily:${site}`]: counter });
}

// ---------------------------------------------------------------------------------------------
// Communication helpers
// ---------------------------------------------------------------------------------------------

async function sendToFrame(tabId: number, frameId: number, message: BackgroundMessage | IlcContentMessage) {
  return browser.tabs.sendMessage(tabId, message, { frameId });
}

/** Ask a frame something; resolves to null if the frame is gone or does not answer in time. */
async function askFrame<T>(tabId: number, frameId: number, message: IlcContentMessage, timeoutMs: number) {
  return Promise.race([
    sendToFrame(tabId, frameId, message).then(
      (r) => (r ?? null) as T | null,
      () => null,
    ),
    sleep(timeoutMs).then(() => null),
  ]);
}

export async function runSnippet(tabId: number, frameId: number, snippetId: string): Promise<unknown> {
  const func = SNIPPETS[snippetId];
  if (!func) throw new Error(`unknown snippet ${snippetId}`);
  const [injection] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: func as () => unknown,
  });
  return injection?.result;
}

function autoconsentConfig(enabled: boolean, debug: boolean): Partial<Config> {
  return {
    enabled,
    // We decide per popup what to do (strategy registry), so autoconsent only detects.
    autoAction: null,
    // Never hide banners: prehide/cosmetic rules leave half-broken sites (overlays, scroll locks).
    enablePrehide: false,
    enableCosmeticRules: false,
    // Generated rules are opt-out only; autoconsent's heuristic cannot opt in.
    enableGeneratedRules: false,
    enableHeuristicDetection: false,
    heuristicMode: 'off',
    enablePopupMutationObserver: true,
    detectRetries: 20,
    isMainWorld: false,
    logs: {
      lifecycle: debug,
      rulesteps: debug,
      detectionsteps: false,
      evals: debug,
      errors: debug,
      messages: false,
      waits: false,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Content script messages (autoconsent protocol)
// ---------------------------------------------------------------------------------------------

export function handleContentMessage(msg: ContentScriptMessage, tabId: number, frameId: number, frameUrl: string, tabUrl: string) {
  switch (msg.type) {
    case 'init':
      return withTab(tabId, () => onInit(tabId, frameId, msg.url || frameUrl, tabUrl));
    case 'eval':
      return onEval(tabId, frameId, msg.id, msg.snippetId);
    case 'cmpDetected':
      return withTab(tabId, async () => {
        const state = await loadState(tabId);
        if (!state) return;
        log(state, frameId, `CMP detected: ${msg.cmp}`);
        state.cmp ??= msg.cmp;
        await saveState(state);
      });
    case 'popupFound':
      return withTab(tabId, () => onPopupFound(tabId, frameId, msg.cmp));
    case 'optInResult':
      return withTab(tabId, () => onOptInResult(tabId, frameId, msg.cmp, msg.result));
    case 'autoconsentDone':
      return withTab(tabId, () => onDone(tabId, frameId, msg.cmp, msg.totalClicks));
    case 'autoconsentError':
      return withTab(tabId, async () => {
        const state = await loadState(tabId);
        if (!state) return;
        log(state, frameId, `autoconsent error: ${JSON.stringify(msg.details).slice(0, 200)}`);
        await saveState(state);
      });
    default:
      // 'report', 'visualDelay', 'selfTestResult', 'optOutResult': not needed.
      return undefined;
  }
}

async function onInit(tabId: number, frameId: number, frameUrl: string, tabUrl: string) {
  // Normally created by onTopLevelCommitted; missing e.g. for tabs that were open before installation.
  const state = (await loadState(tabId)) ?? freshState(tabId, tabUrl);
  const settings = await getSettings();
  const daily = await getDaily(state.site);

  let pausedReason: string | undefined;
  if (!settings.onboardingAccepted) pausedReason = 'setup not completed';
  else if (!settings.enabled) pausedReason = 'switched off';
  else if (isSitePaused(settings, state.site)) pausedReason = 'paused on this site';
  else if (daily.failures >= LIMITS.failuresPerSitePerDay) pausedReason = 'too many failures today';
  else if (daily.attempts >= LIMITS.attemptsPerSitePerDay) pausedReason = 'too many attempts today';

  if (frameId === 0) {
    if (pausedReason) {
      state.pausedReason = pausedReason;
      setPhase(state, pausedReason.startsWith('too many') ? 'stuck' : 'paused');
      log(state, frameId, `inactive: ${pausedReason}`);
    } else if (state.phase === 'paused' || state.phase === 'stuck') {
      state.pausedReason = undefined;
      setPhase(state, 'idle');
    }
    await saveState(state);
  }

  await sendToFrame(tabId, frameId, {
    type: 'initResp',
    rules: rulesForFrame(frameUrl, frameId === 0),
    config: autoconsentConfig(!pausedReason, settings.debug) as Config,
  }).catch(() => undefined);
}

async function onEval(tabId: number, frameId: number, id: string, snippetId?: string) {
  let result: unknown = false;
  try {
    result = snippetId ? await runSnippet(tabId, frameId, snippetId) : false;
  } catch {
    result = false;
  }
  await sendToFrame(tabId, frameId, { type: 'evalResp', id, result }).catch(() => undefined);
}

async function onPopupFound(tabId: number, frameId: number, cmp: string, waiting = false) {
  const state = await loadState(tabId);
  if (!state || state.phase === 'paused' || state.phase === 'stuck') return;

  // Single actor per tab: another frame is clicking right now → retry shortly (the claim is released as soon
  // as that frame reports its result, at the latest when it expires).
  const now = Date.now();
  if (state.claim && state.claim.frameId !== frameId && state.claim.until > now) {
    if (!waiting) {
      log(state, frameId, `popup ${cmp} waits for frame ${state.claim.frameId}`);
      await saveState(state);
    }
    const docId = documentIds.get(tabId);
    setTimeout(() => {
      if (documentIds.get(tabId) === docId) void withTab(tabId, () => onPopupFound(tabId, frameId, cmp, true));
    }, Math.min(250, state.claim.until - now + 50));
    return;
  }

  const attempts = (state.attempts[frameId] ?? 0) + 1;
  if (attempts > LIMITS.attemptsPerDocument) {
    log(state, frameId, `popup ${cmp} shown again – attempt limit reached`);
    setPhase(state, 'stuck');
    state.pausedReason = 'banner keeps coming back';
    await saveState(state);
    return;
  }
  state.attempts[frameId] = attempts;
  await bumpDaily(state.site, 'attempts');

  const strategy = strategyFor(cmp);
  state.cmp = cmp;
  state.frameId = frameId;
  state.apiTried = false;
  state.outcome = undefined;
  state.reasons = undefined;
  state.actionUrl = state.url;
  state.claim = { frameId, until: now + LIMITS.claimMs };
  setPhase(state, 'acting');

  if (strategy.primary === 'shadow' && strategy.shadowAccept) {
    log(state, frameId, `popup ${cmp}: clicking "accept all" inside shadow DOM`);
    state.strategy = 'shadow';
    await saveState(state);
    // The button may render a moment after the popup was detected.
    for (let i = 0; i < 6; i++) {
      const clicked = await askFrame<boolean>(tabId, frameId, { type: 'ilc:shadowClick', chain: strategy.shadowAccept }, 2000);
      if (clicked) {
        state.claim = undefined;
        await saveState(state);
        void scheduleVerify(tabId, frameId, LIMITS.settleMs);
        return;
      }
      await sleep(500);
    }
    log(state, frameId, 'shadow DOM button not found – falling back to rule');
  }

  if (strategy.primary === 'api' && strategy.api) {
    log(state, frameId, `popup ${cmp}: calling CMP API (${strategy.api})`);
    state.strategy = 'api';
    state.apiTried = true;
    await saveState(state);
    const ok = await runSnippet(tabId, frameId, strategy.api).catch(() => false);
    if (ok) {
      state.claim = undefined;
      await saveState(state);
      void scheduleVerify(tabId, frameId, 0);
      return;
    }
    log(state, frameId, 'CMP API not available – falling back to rule');
  }

  state.strategy = 'rule';
  log(state, frameId, `popup ${cmp}: clicking "accept all" (autoconsent rule)`);
  await saveState(state);
  await sendToFrame(tabId, frameId, { type: 'optIn' }).catch(() => undefined);
}

async function onOptInResult(tabId: number, frameId: number, cmp: string, result: boolean) {
  const state = await loadState(tabId);
  if (!state) return;
  if (state.claim?.frameId === frameId) state.claim = undefined;

  if (!result) {
    // Top-frame companions of iframe CMPs (e.g. sourcepoint-top) "fail" because the real dialog lives in
    // a child frame. Give that frame time to take over before declaring failure.
    log(state, frameId, `rule for ${cmp} did not complete – waiting for other frames`);
    await saveState(state);
    const docId = documentIds.get(tabId);
    setTimeout(() => {
      if (documentIds.get(tabId) !== docId) return;
      void withTab(tabId, () => onRuleFailed(tabId, frameId, cmp));
    }, LIMITS.doneTimeoutMs);
    return;
  }

  log(state, frameId, `rule for ${cmp} done`);
  setPhase(state, 'verifying');
  await saveState(state);
  // Usually autoconsentDone follows immediately. Intermediate CMPs (e.g. a top frame that only waits
  // for its consent iframe) never send it – verify anyway after a timeout.
  const key = `${tabId}:${frameId}`;
  clearTimeout(doneTimers.get(key));
  doneTimers.set(
    key,
    setTimeout(() => void scheduleVerify(tabId, frameId, 0), LIMITS.doneTimeoutMs),
  );
}

async function onRuleFailed(tabId: number, frameId: number, cmp: string) {
  const state = await loadState(tabId);
  // Another frame took over (or the document is already done) – nothing to do.
  if (!state || state.frameId !== frameId || state.phase !== 'acting') return;
  await tryApiFallback(state, frameId, cmp);
  // Even without an API the rule may have worked late (e.g. slow iframe) – the verifier decides.
  void scheduleVerify(tabId, frameId, 0);
}

async function onDone(tabId: number, frameId: number, cmp: string, clicks: number) {
  const state = await loadState(tabId);
  if (!state) return;
  log(state, frameId, `${cmp}: finished with ${clicks} click(s)`);
  await saveState(state);
  void scheduleVerify(tabId, frameId, LIMITS.settleMs);
}

/** Returns true if a CMP API exists for this CMP and the call succeeded. */
async function tryApiFallback(state: TabState, frameId: number, cmp: string): Promise<boolean> {
  const { api } = strategyFor(cmp);
  if (!api || state.apiTried) return false;
  state.apiTried = true;
  log(state, frameId, `trying CMP API fallback (${api})`);
  const ok = Boolean(await runSnippet(state.tabId, frameId, api).catch(() => false));
  log(state, frameId, ok ? 'CMP API called' : 'CMP API not available');
  if (ok) state.strategy = 'api' satisfies Strategy;
  await saveState(state);
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------------------------

function scheduleVerify(tabId: number, frameId: number, delayMs: number) {
  const key = `${tabId}:${frameId}`;
  clearTimeout(doneTimers.get(key));
  doneTimers.delete(key);
  const docId = documentIds.get(tabId);
  return sleep(delayMs).then(() => {
    if (documentIds.get(tabId) !== docId) return; // page navigated meanwhile – handled by onNavigation
    return withTab(tabId, () => verify(tabId, frameId, docId));
  });
}

async function verify(tabId: number, frameId: number, docId: number | undefined) {
  const state = await loadState(tabId);
  if (!state || state.phase === 'done') return;
  setPhase(state, 'verifying');
  await saveState(state);

  const verifyMsg = { type: 'ilc:verify', shadowChain: state.cmp ? strategyFor(state.cmp).shadowAccept : undefined } as const;
  let frame = await askFrame<FrameVerification>(tabId, frameId, verifyMsg, LIMITS.verifyTimeoutMs);
  if (frame?.popupVisible && state.cmp && (await tryApiFallback(state, frameId, state.cmp))) {
    await sleep(LIMITS.settleMs);
    frame = await askFrame<FrameVerification>(tabId, frameId, verifyMsg, LIMITS.verifyTimeoutMs);
  }
  const top = frameId === 0 ? frame : await askFrame<FrameVerification>(tabId, 0, { type: 'ilc:verify' }, 2000);
  const signals = (await runSnippet(tabId, 0, 'ILC_READ_CONSENT_SIGNALS').catch(() => null)) as ConsentSignals | null;
  if (documentIds.get(tabId) !== docId) return;

  const result = evaluateOutcome({
    popupVisible: frame ? frame.popupVisible : null,
    navigatedAway: false,
    signals,
  });
  if (top?.scrollLocked) result.reasons.push('page scrolling still locked');
  await finish(state, frameId, result);
}

async function finish(state: TabState, frameId: number, result: VerificationResult) {
  // A later failure in another frame must not overwrite a verified success in this document.
  if (isSuccess(state.outcome) && !isSuccess(result.outcome) && state.frameId !== frameId) {
    log(state, frameId, `ignored ${result.outcome} from frame ${frameId}`);
    await saveState(state);
    return;
  }
  state.outcome = result.outcome;
  state.reasons = result.reasons;
  state.claim = undefined;
  setPhase(state, 'done');
  log(state, frameId, `result: ${result.outcome} – ${result.reasons.join('; ')}`);
  if (!isSuccess(result.outcome)) await bumpDaily(state.site, 'failures');
  await saveState(state);
}

// ---------------------------------------------------------------------------------------------
// Navigation / tab lifecycle
// ---------------------------------------------------------------------------------------------

/** Rough registrable domain (last two labels) – good enough to relate consent.x.com and x.com. */
function baseDomain(site: string): string {
  return site.split('.').slice(-2).join('.');
}

export function onTopLevelCommitted(tabId: number, url: string) {
  documentIds.set(tabId, (documentIds.get(tabId) ?? 0) + 1);
  return withTab(tabId, async () => {
    const previous = await loadState(tabId);
    const next = freshState(tabId, url);
    const acting = previous && (previous.phase === 'acting' || previous.phase === 'verifying');
    if (previous && acting && baseDomain(previous.site) === baseDomain(next.site)) {
      // CMPs often reload or redirect right after "accept all" (e.g. consent.example.com → example.com)
      // – that's a success signal, not an error.
      next.cmp = previous.cmp;
      next.strategy = previous.strategy;
      next.outcome = 'LIKELY_FULL';
      next.reasons = ['page reloaded / navigated after consent was given'];
      next.phase = 'done';
      next.log = previous.log;
      log(next, 0, 'page reloaded after consent');
    }
    await saveState(next);
  });
}

export async function onTabRemoved(tabId: number) {
  states.delete(tabId);
  queues.delete(tabId);
  documentIds.delete(tabId);
  await browser.storage.session.remove(`tab:${tabId}`);
}

export async function getTabState(tabId: number, url?: string): Promise<TabState> {
  return (await loadState(tabId)) ?? freshState(tabId, url ?? '');
}

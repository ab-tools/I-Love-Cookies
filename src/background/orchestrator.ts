/**
 * One state machine per tab document:
 *   popupFound ──► strategy (rule / API / button click) ──► result ──► verify ──► outcome
 *
 * Single actor per tab, per-document and per-site daily attempt limits, inactive on excluded sites.
 */
import { browser } from 'wxt/browser';
import type { BackgroundMessage, Config, ContentScriptMessage } from '@duckduckgo/autoconsent';
import { LIMITS } from '../shared/constants';
import type { FrameVerification, IlcContentMessage, PausedReason, Phase, Strategy, TabState, Viewport } from '../shared/messages';
import { english } from '../shared/i18n';
import { baseDomain, returnsToCallback } from '../shared/navigation';
import { exclusionFor, getSettings, siteOf } from '../shared/settings';
import { evaluateOutcome, isSuccess, type ConsentSignals, type VerificationResult } from '../shared/verifier';
import { rulesForFrame } from './rules';
import { allSnippets } from './snippets';
import { effectiveStrategy } from './strategy';
import { updateBadge } from './badge';
import type { HeuristicScan } from '../content/heuristic/controller';
import type { HeuristicResult } from '../content/heuristic/flow';
import type { FrameInfo } from '../content/frames';
import { attachDebugger, detachDebugger, trustedClick, trustedClicksAvailable } from './trusted-click';

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

/** Sites whose consent dialog only reacts to real mouse clicks: answered with them right away next time. */
const trustedKey = (site: string) => `trustedClicks:${baseDomain(site)}`;
async function needsTrustedClicks(site: string): Promise<boolean> {
  return Boolean((await browser.storage.local.get(trustedKey(site)))[trustedKey(site)]);
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

export async function runSnippet(tabId: number, frameId: number, snippetId: string, args: unknown[] = []): Promise<unknown> {
  const func = SNIPPETS[snippetId];
  if (!func) throw new Error(`unknown snippet ${snippetId}`);
  const [injection] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: func as (...a: unknown[]) => unknown,
    args,
  });
  return injection?.result;
}

/** Remembers the dataLayer position right before we act (see readConsentSignals). */
async function markSignals(state: TabState) {
  state.signalMark = Number(await runSnippet(state.tabId, 0, 'ILC_MARK_CONSENT_SIGNALS').catch(() => 0)) || 0;
}

/** Calls a CMP API snippet until the CMP reports ready (snippet returns true) or the timeout expires. */
async function runApi(tabId: number, frameId: number, snippetId: string): Promise<boolean> {
  const deadline = Date.now() + LIMITS.apiReadyTimeoutMs;
  do {
    if (await runSnippet(tabId, frameId, snippetId).catch(() => false)) return true;
    await sleep(LIMITS.apiPollMs);
  } while (Date.now() < deadline);
  return false;
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
    case 'ilc:heuristicFound' as string:
      return withTab(tabId, () => onHeuristicFound(tabId, frameId, msg as unknown as HeuristicScan));
    case 'ilc:userDecided' as string:
      return withTab(tabId, () => onUserDecided(tabId, frameId));
    case 'ilc:pageClick' as string:
      return runSnippet(tabId, frameId, 'ILC_CLICK_MARKED', [(msg as unknown as { token: string }).token]).catch(() => false);
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

  let pausedReason: PausedReason | undefined;
  if (!settings.enabled) pausedReason = 'off';
  else if (exclusionFor(settings, tabUrl)) pausedReason = 'sitePaused';
  else if (daily.failures >= LIMITS.failuresPerSitePerDay) pausedReason = 'failuresToday';
  else if (daily.attempts >= LIMITS.attemptsPerSitePerDay) pausedReason = 'attemptsToday';

  if (frameId === 0) {
    if (pausedReason) {
      state.pausedReason = pausedReason;
      setPhase(state, pausedReason === 'failuresToday' || pausedReason === 'attemptsToday' ? 'stuck' : 'paused');
      log(state, frameId, `inactive: ${english(`reason_${pausedReason}`)}`);
    } else if (state.phase === 'paused' || state.phase === 'stuck') {
      state.pausedReason = undefined;
      setPhase(state, 'idle');
    }
    await saveState(state);
  }

  await sendToFrame(tabId, frameId, {
    type: 'initResp',
    rules: await rulesForFrame(frameUrl, frameId === 0),
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

async function onPopupFound(tabId: number, frameId: number, cmp: string, waiting = false, deferred = false) {
  const state = await loadState(tabId);
  if (!state || state.phase === 'paused' || state.phase === 'stuck') return;

  // Consent-O-Matic rules only act if no autoconsent rule handles the popup.
  if (cmp.startsWith('com-') && !deferred) {
    const docId = documentIds.get(tabId);
    setTimeout(() => {
      if (documentIds.get(tabId) === docId) void withTab(tabId, () => onPopupFound(tabId, frameId, cmp, false, true));
    }, LIMITS.lowPriorityDelayMs);
    return;
  }
  if (cmp.startsWith('com-') && state.cmp && !state.cmp.startsWith('com-') && state.phase !== 'idle') {
    log(state, frameId, `popup ${cmp} ignored – handled by ${state.cmp}`);
    await saveState(state);
    return;
  }

  // Single actor per tab: another frame is clicking right now → retry shortly (the claim is released as soon
  // as that frame reports its result, at the latest when it expires).
  const now = Date.now();
  if (state.claim && state.claim.until > now && !(state.claim.frameId === frameId && state.cmp === cmp)) {
    if (!waiting) {
      log(state, frameId, `popup ${cmp} waits for frame ${state.claim.frameId}`);
      await saveState(state);
    }
    const docId = documentIds.get(tabId);
    setTimeout(() => {
      if (documentIds.get(tabId) === docId) void withTab(tabId, () => onPopupFound(tabId, frameId, cmp, true, deferred));
    }, Math.min(250, state.claim.until - now + 50));
    return;
  }

  // A second rule matching the same, already accepted popup.
  if (state.phase === 'done' && isSuccess(state.outcome) && state.cmp !== cmp) {
    log(state, frameId, `popup ${cmp} ignored – consent already given via ${state.cmp}`);
    await saveState(state);
    return;
  }

  const attempts = (state.attempts[frameId] ?? 0) + 1;
  if (attempts > LIMITS.attemptsPerDocument) {
    log(state, frameId, `popup ${cmp} shown again – attempt limit reached`);
    setPhase(state, 'stuck');
    state.pausedReason = 'keepsComingBack';
    await saveState(state);
    return;
  }
  state.attempts[frameId] = attempts;
  // Rules that confirm an age check (named "ilc-age-…") act only while age checks are switched on.
  if (cmp.startsWith('ilc-age-') && !(await getSettings()).ageGates) {
    state.pausedReason = 'ageGate';
    setPhase(state, 'paused');
    log(state, frameId, english('reason_ageGate'));
    await saveState(state);
    return;
  }
  if (await leaveToUser(state, frameId, { cmp })) return;
  await bumpDaily(state.site, 'attempts');

  const strategy = await effectiveStrategy(cmp);
  state.cmp = cmp;
  state.frameId = frameId;
  state.apiTried = false;
  state.outcome = undefined;
  state.reasons = undefined;
  state.actionUrl = state.url;
  state.claim = { frameId, until: now + LIMITS.claimMs };
  setPhase(state, 'acting');
  await markSignals(state);

  if (strategy.primary === 'click' && strategy.acceptButton) {
    log(state, frameId, `popup ${cmp}: clicking "accept all" button`);
    state.strategy = 'click';
    await saveState(state);
    // The button may render a moment after the popup was detected.
    const docId = documentIds.get(tabId);
    for (let i = 0; i < 6; i++) {
      const clicked = await askFrame<boolean>(tabId, frameId, { type: 'ilc:click', chain: strategy.acceptButton }, 5000);
      if (clicked) {
        state.claim = undefined;
        await saveState(state);
        void scheduleVerify(tabId, frameId, LIMITS.settleMs);
        return;
      }
      await sleep(500);
      // No answer because the click reloaded the page: the navigation handler takes over, no fallback.
      if (clicked === null && documentIds.get(tabId) !== docId) return;
    }
    log(state, frameId, 'accept button not found – falling back to rule');
  }

  if (strategy.primary === 'api' && strategy.api) {
    log(state, frameId, `popup ${cmp}: calling CMP API (${strategy.api})`);
    state.strategy = 'api';
    state.apiTried = true;
    await saveState(state);
    const ok = await runApi(tabId, frameId, strategy.api);
    if (ok) {
      state.claim = undefined;
      await saveState(state);
      void scheduleVerify(tabId, frameId, LIMITS.settleMs);
      return;
    }
    log(state, frameId, 'CMP API not available – falling back to rule');
  }

  state.strategy = 'rule';
  log(state, frameId, `popup ${cmp}: clicking "accept all" (autoconsent rule)`);
  await saveState(state);
  await sendToFrame(tabId, frameId, { type: 'ilc:optIn', cmp }).catch(() => undefined);
}

async function onOptInResult(tabId: number, frameId: number, cmp: string, result: boolean) {
  const state = await loadState(tabId);
  if (!state) return;
  if (state.claim?.frameId === frameId) state.claim = undefined;

  if (!result) {
    // Top-frame companions of iframe CMPs (e.g. sourcepoint-top) "fail" because the real dialog lives in
    // a child frame. Give that frame time to take over before declaring failure.
    const companion = /-top$/i.test(cmp);
    log(state, frameId, `rule for ${cmp} did not complete${companion ? ' – waiting for other frames' : ''}`);
    await saveState(state);
    const docId = documentIds.get(tabId);
    setTimeout(
      () => {
        if (documentIds.get(tabId) !== docId) return;
        void withTab(tabId, () => onRuleFailed(tabId, frameId, cmp));
      },
      companion ? LIMITS.doneTimeoutMs : LIMITS.ruleFailedGraceMs,
    );
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
    setTimeout(() => void scheduleVerify(tabId, frameId, LIMITS.settleMs), LIMITS.doneTimeoutMs),
  );
}

async function onRuleFailed(tabId: number, frameId: number, cmp: string) {
  const state = await loadState(tabId);
  // Another frame took over (or the document is already done) – nothing to do.
  if (!state || state.frameId !== frameId || state.phase !== 'acting') return;
  if (!(await tryApiFallback(state, frameId, cmp))) {
    // The rule clicked nothing (e.g. an unknown variant of the CMP's UI): its own popup selectors may not
    // match the banner, so ask the generic scan whether a consent banner is still shown.
    const scan = await askFrame<HeuristicScan>(tabId, frameId, { type: 'ilc:heuristicScan' }, 2000);
    if (scan && scan.decision !== 'none') {
      await finish(state, frameId, { outcome: 'FAILED', reasons: [`rule for ${cmp} did not complete, a consent banner is still shown`] });
      return;
    }
  }
  // The rule may still have worked late (e.g. slow iframe) – the verifier decides.
  void scheduleVerify(tabId, frameId, LIMITS.settleMs);
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
  const { api } = await effectiveStrategy(cmp);
  if (!api || state.apiTried) return false;
  state.apiTried = true;
  log(state, frameId, `trying CMP API fallback (${api})`);
  const ok = await runApi(state.tabId, frameId, api);
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

  const verifyMsg = {
    type: 'ilc:verify',
    cmp: state.strategy === 'heuristic' ? undefined : state.cmp,
    heuristic: state.strategy === 'heuristic',
    acceptButton: state.cmp && state.strategy !== 'heuristic' ? (await effectiveStrategy(state.cmp)).acceptButton : undefined,
  } as const;
  let frame = await askFrame<FrameVerification>(tabId, frameId, verifyMsg, LIMITS.verifyTimeoutMs);
  // Banners often close with an animation (slow on busy machines): look again before falling back or failing.
  if (frame?.popupVisible || frame?.popupOnScreen) {
    await sleep(LIMITS.closeAnimationMs);
    if (documentIds.get(tabId) !== docId) return;
    frame = await askFrame<FrameVerification>(tabId, frameId, verifyMsg, LIMITS.verifyTimeoutMs);
  }
  if ((frame?.popupVisible || frame?.popupOnScreen) && state.cmp && (await tryApiFallback(state, frameId, state.cmp))) {
    await sleep(LIMITS.settleMs);
    frame = await askFrame<FrameVerification>(tabId, frameId, verifyMsg, LIMITS.verifyTimeoutMs);
  }
  const top = frameId === 0 ? frame : await askFrame<FrameVerification>(tabId, 0, { type: 'ilc:verify' }, 2000);
  const signals = (await runSnippet(tabId, 0, 'ILC_READ_CONSENT_SIGNALS', [state.signalMark ?? 0]).catch(() => null)) as ConsentSignals | null;
  if (documentIds.get(tabId) !== docId) return;

  const result = evaluateOutcome({
    popupVisible: frame ? frame.popupVisible : null,
    popupOnScreen: frame?.popupOnScreen ?? false,
    popupCheckable: frame?.popupCheckable ?? false,
    navigatedAway: false,
    signals,
  });
  if (result.outcome === 'LIKELY_FULL') {
    // Nothing machine-readable confirms the result: make sure no consent banner with an accept button is left
    // (e.g. an older UI variant of the CMP that its rule does not know).
    const scan = await askFrame<HeuristicScan>(tabId, frameId, { type: 'ilc:heuristicScan' }, 2000);
    if (scan?.decision === 'click' && scan.score >= LIMITS.leftoverBannerMinScore) {
      result.outcome = 'FAILED';
      result.reasons = ['a consent banner with an accept button is still shown'];
    }
  }
  if (top?.scrollLocked) {
    const unlocked = isSuccess(result.outcome) && (await askFrame<boolean>(tabId, 0, { type: 'ilc:unlockScroll' }, 2000));
    result.reasons.push(unlocked ? 'scroll lock left by the banner removed' : 'page scrolling still locked');
  }
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
  if (state.trustedTried) {
    void detachDebugger(state.tabId);
    if (state.strategy === 'heuristic' && isSuccess(result.outcome)) await browser.storage.local.set({ [trustedKey(state.site)]: Date.now() });
  }
  if (result.outcome === 'FAILED' && state.strategy === 'heuristic' && !state.trustedTried && trustedClicksAvailable()) {
    const docId = documentIds.get(state.tabId);
    setTimeout(() => {
      if (documentIds.get(state.tabId) === docId) void withTab(state.tabId, () => trustedRetry(state.tabId));
    }, 500);
  }
  if (result.outcome === 'FAILED' && state.strategy !== 'heuristic' && !state.heuristicTried) {
    const docId = documentIds.get(state.tabId);
    setTimeout(() => {
      if (documentIds.get(state.tabId) === docId) void withTab(state.tabId, () => heuristicFallback(state.tabId));
    }, 500);
  }
}

// ---------------------------------------------------------------------------------------------
// Generic heuristic (banners no rule handles)
// ---------------------------------------------------------------------------------------------

async function onHeuristicFound(tabId: number, frameId: number, scan: HeuristicScan) {
  const state = await loadState(tabId);
  if (!state || state.phase === 'paused' || state.phase === 'stuck') return;
  log(state, frameId, `generic banner ${scan.fingerprint} (score ${scan.score}): ${scan.buttons.join(' | ')}`);
  await saveState(state);
  // Rules get a head start: act only if nothing handled a popup in the meantime.
  const docId = documentIds.get(tabId);
  setTimeout(() => {
    if (documentIds.get(tabId) !== docId) return;
    void withTab(tabId, async () => {
      const current = await loadState(tabId);
      if (current?.phase === 'idle') await runHeuristic(tabId, frameId);
    });
  }, LIMITS.heuristicGraceMs);
}

/** After a rule failed: look for a banner in every frame and handle the best one generically. */
async function heuristicFallback(tabId: number) {
  const state = await loadState(tabId);
  if (!state || state.heuristicTried || state.phase !== 'done' || state.outcome !== 'FAILED') return;
  const best = await bestBanner(tabId);
  if (!best) return;
  log(state, best.frameId, `rule failed – generic banner ${best.scan.fingerprint}: ${best.scan.buttons.join(' | ')}`);
  await runHeuristic(tabId, best.frameId);
}

/** The frame with the most convincing banner the heuristic can answer. */
async function bestBanner(tabId: number): Promise<{ frameId: number; scan: HeuristicScan } | null> {
  const frames = (await browser.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [{ frameId: 0 }];
  let best: { frameId: number; scan: HeuristicScan } | null = null;
  for (const { frameId } of frames) {
    const scan = await askFrame<HeuristicScan>(tabId, frameId, { type: 'ilc:heuristicScan' }, 2000);
    if (!scan || scan.decision === 'none') continue;
    if (!best || scan.score > best.scan.score || (scan.score === best.scan.score && scan.top)) best = { frameId, scan };
  }
  return best;
}

/** The generic answer did not take: some pages only react to real mouse clicks – answer once more with those. */
async function trustedRetry(tabId: number) {
  const state = await loadState(tabId);
  if (!state || state.trustedTried || state.phase !== 'done' || state.outcome !== 'FAILED' || state.strategy !== 'heuristic') return;
  const best = await bestBanner(tabId);
  if (!best) return;
  state.trustedTried = true;
  await saveState(state);
  if (!(await attachDebugger(tabId))) return;
  log(state, best.frameId, `generic banner ${best.scan.fingerprint}: answering with real mouse clicks`);
  await runHeuristic(tabId, best.frameId, true);
  const current = await loadState(tabId);
  if (current?.phase !== 'acting' && current?.phase !== 'verifying') await detachDebugger(tabId);
}

/** Real mouse click requested by a frame during a trusted run. */
export async function onTrustedClick(tabId: number, frameId: number, x: number, y: number): Promise<boolean> {
  return trustedClick(tabId, frameId, x, y, locateFrame);
}

/** Position of a frame's <iframe> in its parent frame (null if it cannot be identified). */
async function locateFrame(tabId: number, frameId: number, parentFrameId: number): Promise<FrameInfo | null> {
  const token = crypto.randomUUID();
  await sendToFrame(tabId, frameId, { type: 'ilc:announceFrame', token }).catch(() => undefined);
  await sleep(150);
  return askFrame<FrameInfo>(tabId, parentFrameId, { type: 'ilc:frameInfo', token }, 2000);
}

/** A child frame's banner only counts if its <iframe> is a visible overlay in the top frame. */
async function isVisibleOverlayFrame(tabId: number, frameId: number): Promise<boolean> {
  const token = crypto.randomUUID();
  await sendToFrame(tabId, frameId, { type: 'ilc:announceFrame', token }).catch(() => undefined);
  await sleep(300);
  const info = await askFrame<FrameInfo>(tabId, 0, { type: 'ilc:frameInfo', token }, 2000);
  if (info) return info.visible && info.area >= LIMITS.minFrameOverlayArea;
  // The <iframe> could not be identified (the page may swallow messages): a frame covering a large part of
  // the top viewport is an overlay.
  const [frame, top] = await Promise.all([
    askFrame<Viewport>(tabId, frameId, { type: 'ilc:viewport' }, 2000),
    askFrame<Viewport>(tabId, 0, { type: 'ilc:viewport' }, 2000),
  ]);
  return Boolean(frame && top && frame.width * frame.height >= LIMITS.unlinkedFrameMinArea * top.width * top.height);
}

async function runHeuristic(tabId: number, frameId: number, trusted = false) {
  const state = await loadState(tabId);
  if (!state || (state.heuristicTried && !trusted)) return;
  if (frameId !== 0 && !(await isVisibleOverlayFrame(tabId, frameId))) {
    log(state, frameId, 'generic banner in a frame that is not a visible overlay – ignored');
    await saveState(state);
    return;
  }
  const now = Date.now();
  if (state.claim && state.claim.until > now) return;
  if (await leaveToUser(state, frameId, { heuristic: true })) return;
  if (!trusted && !state.trustedTried && trustedClicksAvailable() && (await needsTrustedClicks(state.site)) && (await attachDebugger(tabId))) {
    trusted = true;
    state.trustedTried = true;
    log(state, frameId, 'generic banner: this site needs real mouse clicks');
  }
  state.heuristicTried = true;
  state.cmp ??= 'generic banner';
  state.strategy = 'heuristic';
  state.frameId = frameId;
  state.outcome = undefined;
  state.reasons = undefined;
  state.actionUrl = state.url;
  state.claim = { frameId, until: now + LIMITS.heuristicActMs };
  setPhase(state, 'acting');
  await markSignals(state);
  log(state, frameId, 'generic banner: accepting');
  await saveState(state);
  await bumpDaily(state.site, 'attempts');

  const result = await askFrame<HeuristicResult>(tabId, frameId, { type: 'ilc:heuristicAct', trusted }, LIMITS.heuristicActMs);
  state.claim = undefined;
  if (!result?.done) {
    await finish(state, frameId, { outcome: 'FAILED', reasons: [`generic banner: ${result?.reason ?? 'no answer from frame'}`] });
    return;
  }
  const toggles = result.toggled ? `, ${result.toggled} toggles switched on` : '';
  log(state, frameId, `generic banner: clicked ${result.clicked.map((c) => `"${c}"`).join(' → ')}${toggles}`);
  await saveState(state);
  void scheduleVerify(tabId, frameId, LIMITS.settleMs);
}

/** With pay-or-OK walls switched off in the settings: pauses the document if the banner offers a paid option. */
async function leaveToUser(state: TabState, frameId: number, banner: { cmp?: string; heuristic?: boolean }): Promise<boolean> {
  if ((await getSettings()).payOrOk) return false;
  const wall = await askFrame<boolean>(state.tabId, frameId, { type: 'ilc:payOrOkCheck', ...banner }, 2000);
  if (!wall) return false;
  state.pausedReason = 'payOrOk';
  state.claim = undefined;
  setPhase(state, 'paused');
  log(state, frameId, english('reason_payOrOk'));
  await saveState(state);
  return true;
}

async function onUserDecided(tabId: number, frameId: number) {
  const state = await loadState(tabId);
  if (!state || state.phase === 'done') return;
  state.pausedReason = 'userDecided';
  setPhase(state, 'paused');
  log(state, frameId, 'user clicked in the banner – staying out');
  await saveState(state);
}

// ---------------------------------------------------------------------------------------------
// Navigation / tab lifecycle
// ---------------------------------------------------------------------------------------------


export function onTopLevelCommitted(tabId: number, url: string) {
  documentIds.set(tabId, (documentIds.get(tabId) ?? 0) + 1);
  return withTab(tabId, async () => {
    const previous = await loadState(tabId);
    if (previous?.trustedTried) void detachDebugger(tabId);
    const next = freshState(tabId, url);
    const acting = previous && (previous.phase === 'acting' || previous.phase === 'verifying');
    // After consent, sites reload, move within the same site, or a separate consent page returns to its callback URL.
    const expected = previous && (baseDomain(previous.site) === baseDomain(next.site) || returnsToCallback(previous.actionUrl ?? previous.url, url));
    if (previous && acting && previous.strategy === 'heuristic' && !expected) {
      // A generic click must never lead to another site.
      next.cmp = previous.cmp;
      next.strategy = previous.strategy;
      next.outcome = 'UNSAFE';
      next.reasons = [`generic banner click navigated to ${url.split('?')[0]}`];
      next.phase = 'done';
      next.log = previous.log;
      log(next, 0, 'navigation after generic click – UNSAFE');
      await bumpDaily(next.site, 'failures');
    } else if (previous && acting && expected) {
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

/** Single-page apps: a banner may appear after an in-page navigation, as long as none was handled yet. */
export async function onInPageNavigation(tabId: number) {
  const state = await loadState(tabId);
  if (state?.phase === 'idle') await sendToFrame(tabId, 0, { type: 'ilc:rescan' }).catch(() => undefined);
}

export async function onTabRemoved(tabId: number) {
  void detachDebugger(tabId);
  states.delete(tabId);
  queues.delete(tabId);
  documentIds.delete(tabId);
  await browser.storage.session.remove(`tab:${tabId}`);
}

export async function getTabState(tabId: number, url?: string): Promise<TabState> {
  return (await loadState(tabId)) ?? freshState(tabId, url ?? '');
}

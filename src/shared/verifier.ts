/** Decides whether a banner was answered with maximum consent. Pure functions. */

export type Outcome = 'FULL' | 'LIKELY_FULL' | 'PARTIAL' | 'FAILED' | 'UNSAFE';

/** IAB TCF v2 state read via __tcfapi in the page's MAIN world. */
export interface TcfSignal {
  eventStatus?: string;
  gdprApplies?: boolean;
  /** Purpose IDs disclosed by the CMP and how many of them are consented. */
  purposesTotal: number;
  purposesConsented: number;
  /** Purpose 1 (store/access information on a device) – the basis of every consent. */
  storageConsented?: boolean;
  vendorsConsented: number;
}

/** Google Consent Mode v2 state read from the dataLayer. */
export interface GcmSignal {
  /** true if a `consent update` command was found (not only `default`). */
  updated: boolean;
  /** Consent types and their latest value, e.g. { ad_storage: 'granted' }. */
  values: Record<string, string>;
}

export interface ConsentSignals {
  tcf: TcfSignal | null;
  gcm: GcmSignal | null;
}

export interface VerificationInput {
  /** Is the CMP popup still visible? null = unknown (e.g. the frame was removed together with the banner). */
  popupVisible: boolean | null;
  /** The CMP's dialog element is on screen (reliable, unlike CMP-specific popup checks). */
  popupOnScreen?: boolean;
  /** popupOnScreen could be checked (the dialog element is known). */
  popupCheckable?: boolean;
  /** The page navigated to a different URL as a result of our action. */
  navigatedAway: boolean;
  signals: ConsentSignals | null;
}

export interface VerificationResult {
  outcome: Outcome;
  reasons: string[];
}

export const GCM_TYPES = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'] as const;

/** What the site itself reports about the consent state (TCF first, then Google Consent Mode). */
export function readSignals(signals: ConsentSignals | null): { verdict: 'full' | 'partial' | 'none'; reason?: string } {
  const tcf = signals?.tcf;
  if (tcf && tcf.gdprApplies !== false && tcf.purposesTotal > 0 && tcf.eventStatus !== 'cmpuishown') {
    // TCF does not say which purposes a site requests; purposes it never asks for stay false
    // (for consent and legitimate interest alike).
    const full = tcf.storageConsented !== false && tcf.purposesConsented > 0;
    const reason = `TCF: ${tcf.purposesConsented}/${tcf.purposesTotal} purposes, ${tcf.vendorsConsented} vendors consented`;
    return { verdict: full ? 'full' : 'partial', reason };
  }
  const gcm = signals?.gcm;
  if (gcm?.updated && GCM_TYPES.some((t) => t in gcm.values)) {
    // CMPs also update their own per-vendor/purpose keys; some sites map one standard type to "denied"
    // although every choice was granted. Judge by all updated keys.
    const keys = Object.keys(gcm.values);
    const granted = keys.filter((k) => gcm.values[k] === 'granted');
    const full = gcm.values.ad_storage !== 'denied' && granted.length >= keys.length * 0.9;
    return { verdict: full ? 'full' : 'partial', reason: `Consent Mode: ${granted.length}/${keys.length} granted` };
  }
  return { verdict: 'none' };
}

export function evaluateOutcome(input: VerificationInput): VerificationResult {
  if (input.navigatedAway) {
    return { outcome: 'UNSAFE', reasons: ['page navigated to a different URL after our action'] };
  }
  const signals = readSignals(input.signals);

  if (input.popupOnScreen) {
    return { outcome: 'FAILED', reasons: ['consent dialog still on screen', ...(signals.reason ? [signals.reason] : [])] };
  }
  // The CMP still reports its popup, but its dialog element is not on screen: the CMP check is stale.
  const popupVisible = input.popupVisible === true && input.popupCheckable ? false : input.popupVisible;
  if (popupVisible === true) {
    // Some CMP rules keep reporting their (now hidden) container as visible. If the site itself
    // confirms full consent, trust the site.
    if (signals.verdict === 'full') {
      return { outcome: 'FULL', reasons: [signals.reason!, 'popup check inconclusive, site confirms consent'] };
    }
    return { outcome: 'FAILED', reasons: ['consent popup is still visible', ...(signals.reason ? [signals.reason] : [])] };
  }

  const reasons = [popupVisible === false ? 'consent popup closed' : 'consent popup frame removed'];
  if (signals.verdict !== 'none') {
    reasons.push(signals.reason!);
    return { outcome: signals.verdict === 'full' ? 'FULL' : 'PARTIAL', reasons };
  }
  reasons.push('no machine-readable consent signal (TCF / Consent Mode) available');
  return { outcome: 'LIKELY_FULL', reasons };
}

export function isSuccess(outcome: Outcome | undefined): boolean {
  return outcome === 'FULL' || outcome === 'LIKELY_FULL';
}

/** Decides whether a banner was answered with maximum consent. Pure functions. */

export type Outcome = 'FULL' | 'LIKELY_FULL' | 'PARTIAL' | 'FAILED' | 'UNSAFE';

/** IAB TCF v2 state read via __tcfapi in the page's MAIN world. */
export interface TcfSignal {
  eventStatus?: string;
  gdprApplies?: boolean;
  /** Purpose IDs disclosed by the CMP and how many of them are consented. */
  purposesTotal: number;
  purposesConsented: number;
  /** Purposes for which the user objected to legitimate interest. */
  legitimateInterestObjected: number;
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
    const full = tcf.purposesConsented === tcf.purposesTotal && tcf.legitimateInterestObjected === 0;
    const reason =
      `TCF: ${tcf.purposesConsented}/${tcf.purposesTotal} purposes, ${tcf.vendorsConsented} vendors consented` +
      (tcf.legitimateInterestObjected ? `, ${tcf.legitimateInterestObjected} LI objections` : '');
    return { verdict: full ? 'full' : 'partial', reason };
  }
  const gcm = signals?.gcm;
  if (gcm?.updated) {
    const known = GCM_TYPES.filter((t) => t in gcm.values);
    const granted = known.filter((t) => gcm.values[t] === 'granted');
    if (known.length > 0) {
      return {
        verdict: granted.length === known.length ? 'full' : 'partial',
        reason: `Consent Mode: ${granted.length}/${known.length} granted`,
      };
    }
  }
  return { verdict: 'none' };
}

export function evaluateOutcome(input: VerificationInput): VerificationResult {
  if (input.navigatedAway) {
    return { outcome: 'UNSAFE', reasons: ['page navigated to a different URL after our action'] };
  }
  const signals = readSignals(input.signals);

  if (input.popupVisible === true) {
    // Some CMP rules keep reporting their (now hidden) container as visible. If the site itself
    // confirms full consent, trust the site.
    if (signals.verdict === 'full') {
      return { outcome: 'FULL', reasons: [signals.reason!, 'popup check inconclusive, site confirms consent'] };
    }
    return { outcome: 'FAILED', reasons: ['consent popup is still visible', ...(signals.reason ? [signals.reason] : [])] };
  }

  const reasons = [input.popupVisible === false ? 'consent popup closed' : 'consent popup frame removed'];
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

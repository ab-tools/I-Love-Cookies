import type { Outcome } from './verifier';

export type Phase =
  | 'idle' // nothing detected (yet)
  | 'acting' // a strategy is clicking / calling the CMP API
  | 'verifying'
  | 'done' // verified, see outcome
  | 'paused' // disabled for this site / globally / onboarding not accepted
  | 'stuck'; // loop guard hit – needs attention

/**
 * rule = autoconsent opt-in rule · api = CMP JavaScript API · click = known accept button (also in shadow DOM)
 * · heuristic = generic banner detection without a rule
 */
export type Strategy = 'rule' | 'api' | 'click' | 'heuristic';

export interface LogEntry {
  t: number;
  frameId: number;
  msg: string;
}

/** Everything the popup needs to know about a tab. Persisted in storage.session. */
export interface TabState {
  tabId: number;
  url: string;
  site: string;
  phase: Phase;
  pausedReason?: string;
  cmp?: string;
  frameId?: number;
  strategy?: Strategy;
  /** dataLayer length right before we acted. */
  signalMark?: number;
  /** Generic heuristic already used in this document. */
  heuristicTried?: boolean;
  /** API fallback already tried for the current popup. */
  apiTried?: boolean;
  outcome?: Outcome;
  reasons?: string[];
  /** popupFound events handled per frame in this document (loop guard). */
  attempts: Record<number, number>;
  /** Frame that currently holds the claim and until when. */
  claim?: { frameId: number; until: number };
  /** URL at the time we acted – used to tell a CMP reload from a navigation away. */
  actionUrl?: string;
  extensionVersion: string;
  log: LogEntry[];
}

/** Messages from extension pages (popup / options) to the background. */
export type UiMessage =
  | { type: 'ilc:getTabState'; tabId: number }
  | { type: 'ilc:setSitePaused'; tabId: number; paused: boolean }
  | { type: 'ilc:withdrawConsent'; tabId: number };

/** Messages from the background to our part of the content script. */
export type IlcContentMessage =
  /** acceptButton: the popup counts as on screen while this element is visible. */
  | { type: 'ilc:verify'; cmp?: string; acceptButton?: readonly string[]; heuristic?: boolean }
  /** Opt in with exactly this CMP (several rules may have detected the same popup). */
  | { type: 'ilc:optIn'; cmp: string }
  | { type: 'ilc:click'; chain: readonly string[] }
  | { type: 'ilc:heuristicScan' }
  /** Child frame: post the token to the parent so the top frame can find its <iframe>. */
  | { type: 'ilc:announceFrame'; token: string }
  /** Top frame: visibility and size of the <iframe> that announced the token. */
  | { type: 'ilc:frameInfo'; token: string }
  /** After verified consent: remove a scroll lock the banner left behind. */
  | { type: 'ilc:unlockScroll' }
  /** In-page navigation: look for new banners. */
  | { type: 'ilc:rescan' }
  | { type: 'ilc:heuristicAct' };

export interface FrameVerification {
  /** autoconsent's popup check; null if no CMP instance in this frame */
  popupVisible: boolean | null;
  /** The CMP's dialog element is actually on screen. */
  popupOnScreen: boolean;
  /** popupOnScreen is meaningful (the CMP's dialog element is known). */
  popupCheckable: boolean;
  scrollLocked: boolean;
  url: string;
}

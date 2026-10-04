import type { Outcome } from './verifier';
import type { ButtonClass } from '../content/heuristic/text';

export type Phase =
  | 'idle' // nothing detected (yet)
  | 'acting' // a strategy is clicking / calling the CMP API
  | 'verifying'
  | 'done' // verified, see outcome
  | 'paused' // excluded site, left to the user, or switched off
  | 'stuck'; // loop guard hit – needs attention

/**
 * rule = autoconsent opt-in rule · api = CMP JavaScript API · click = known accept button (also in shadow DOM)
 * · heuristic = generic banner detection without a rule
 */
/** Why the extension is inactive on a page (translated as reason_<code>). */
export type PausedReason = 'off' | 'sitePaused' | 'failuresToday' | 'attemptsToday' | 'keepsComingBack' | 'userDecided' | 'payOrOk';

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
  pausedReason?: PausedReason;
  cmp?: string;
  frameId?: number;
  strategy?: Strategy;
  /** dataLayer length right before we acted. */
  signalMark?: number;
  /** Generic heuristic already used in this document. */
  heuristicTried?: boolean;
  /** Generic heuristic already repeated with real mouse clicks. */
  trustedTried?: boolean;
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
  | { type: 'ilc:report'; tabId: number; anonymous: boolean }
  | { type: 'ilc:collectReport'; tabId: number }
  | { type: 'ilc:getRuleStatus' }
  | { type: 'ilc:checkRuleUpdate' };

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
  /** Size of the frame's viewport. */
  | { type: 'ilc:viewport' }
  /** After verified consent: remove a scroll lock the banner left behind. */
  | { type: 'ilc:unlockScroll' }
  /** In-page navigation: look for new banners. */
  | { type: 'ilc:rescan' }
  /** trusted: click with real mouse events (the browser's debugger interface). */
  | { type: 'ilc:heuristicAct'; trusted?: boolean }
  /** Problem report: describe this frame's consent UI. */
  | { type: 'ilc:reportSnapshot' }
  /** Does the banner (of this CMP, or the generic one) offer a paid option? */
  | { type: 'ilc:payOrOkCheck'; cmp?: string; heuristic?: boolean };

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

/** A consent banner as described in problem reports. */
export interface BannerSnapshot {
  /** Selectors of up to three ancestors and the banner element, outermost first. */
  path: string[];
  /** The banner renders into a shadow root. */
  shadow: boolean;
  score: number;
  /** Share of the viewport covered (0..1). */
  area: number;
  /** Start of the banner text. */
  text: string;
  buttons: { label: string; cls: ButtonClass; selector: string }[];
}

export interface FrameSnapshot {
  /** Without query string and fragment. */
  url: string;
  top: boolean;
  /** CMPs detected by rules in this frame, and those whose popup was found. */
  cmps: string[];
  popups: string[];
  banner?: BannerSnapshot;
  /** Hosts of third-party scripts (top frame only). */
  scriptHosts?: string[];
  scrollLocked: boolean;
}

/** Structured part of a problem report, collected when the user opens the report preview. */
export interface ReportSnapshot {
  frames: FrameSnapshot[];
  /** TCF / Google Consent Mode state as read from the page. */
  signals: unknown;
  /** Version of the active downloaded rule set. */
  ruleSet?: string;
}

export interface Viewport {
  width: number;
  height: number;
}

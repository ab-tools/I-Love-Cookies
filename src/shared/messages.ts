import type { Outcome } from './verifier';

export type Phase =
  | 'idle' // nothing detected (yet)
  | 'acting' // a strategy is clicking / calling the CMP API
  | 'verifying'
  | 'done' // verified, see outcome
  | 'paused' // disabled for this site / globally / onboarding not accepted
  | 'stuck'; // loop guard hit – needs attention

/** rule = autoconsent declarative opt-in · api = CMP JavaScript API · shadow = click inside (closed) shadow DOM */
export type Strategy = 'rule' | 'api' | 'shadow';

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
  /** shadowChain: if given, the popup counts as visible while this (shadow DOM) element is visible. */
  | { type: 'ilc:verify'; shadowChain?: readonly string[] }
  | { type: 'ilc:shadowClick'; chain: readonly string[] };

export interface FrameVerification {
  /** null if no CMP instance in this frame */
  popupVisible: boolean | null;
  scrollLocked: boolean;
  url: string;
}

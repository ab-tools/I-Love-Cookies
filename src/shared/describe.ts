import type { TabState } from './messages';
import { english, type MessageKey, type Translate } from './i18n';

export interface StateDescription {
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  details: string;
}

/** Human-readable status line for the popup. Pure – unit tested. */
export function describeState(state: TabState, t: Translate = english): StateDescription {
  const via = !state.cmp
    ? ''
    : state.strategy === 'heuristic'
      ? t('via_heuristic')
      : t(state.strategy === 'api' ? 'via_api' : state.strategy === 'click' ? 'via_button' : 'via_rule', [state.cmp]);
  const reason = state.pausedReason ? t(`reason_${state.pausedReason}` as MessageKey) : '';
  switch (state.phase) {
    case 'paused':
      return { text: t('status_paused'), tone: 'muted', details: reason };
    case 'stuck':
      return { text: t('status_stuck'), tone: 'bad', details: reason || t('details_report') };
    case 'acting':
      return { text: t('status_acting'), tone: 'muted', details: via };
    case 'verifying':
      return { text: t('status_verifying'), tone: 'muted', details: via };
    case 'done':
      switch (state.outcome) {
        case 'FULL':
          return { text: t('status_accepted'), tone: 'ok', details: t('details_viaConfirmed', [via]) };
        case 'LIKELY_FULL':
          return { text: t('status_accepted'), tone: 'ok', details: t('details_via', [via]) };
        case 'PARTIAL':
          return { text: t('status_partial'), tone: 'warn', details: (state.reasons ?? []).join(' · ') };
        case 'UNSAFE':
          return { text: t('status_unsafe'), tone: 'bad', details: t('details_report') };
        default:
          return { text: t('status_failed'), tone: 'bad', details: (state.reasons ?? []).join(' · ') };
      }
    default:
      return state.cmp
        ? { text: t('status_cmpOnly'), tone: 'muted', details: t('details_noPopup', [state.cmp]) }
        : { text: t('status_noBanner'), tone: 'muted', details: '' };
  }
}

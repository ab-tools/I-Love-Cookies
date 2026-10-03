import type { TabState } from './messages';

export interface StateDescription {
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  details: string;
}

/** Human-readable status line for the popup. Pure – unit tested. */
export function describeState(state: TabState): StateDescription {
  const via = !state.cmp ? '' : state.strategy === 'api' ? `${state.cmp} API` : `${state.cmp} ${state.strategy === 'shadow' ? 'button' : 'rule'}`;
  switch (state.phase) {
    case 'paused':
      return { text: 'Paused', tone: 'muted', details: state.pausedReason ?? '' };
    case 'stuck':
      return { text: 'Needs attention', tone: 'bad', details: state.pausedReason ?? 'Please report this site.' };
    case 'acting':
      return { text: 'Accepting cookies…', tone: 'muted', details: via };
    case 'verifying':
      return { text: 'Checking result…', tone: 'muted', details: via };
    case 'done':
      switch (state.outcome) {
        case 'FULL':
          return { text: 'All cookies accepted', tone: 'ok', details: `via ${via} · confirmed by the site` };
        case 'LIKELY_FULL':
          return { text: 'All cookies accepted', tone: 'ok', details: `via ${via}` };
        case 'PARTIAL':
          return { text: 'Partly accepted', tone: 'warn', details: (state.reasons ?? []).join(' · ') };
        case 'UNSAFE':
          return { text: 'Unexpected navigation', tone: 'bad', details: 'Please report this site.' };
        default:
          return { text: 'Could not accept', tone: 'bad', details: (state.reasons ?? []).join(' · ') };
      }
    default:
      return state.cmp
        ? { text: 'Consent manager found', tone: 'muted', details: `${state.cmp} – no banner shown` }
        : { text: 'No cookie banner detected', tone: 'muted', details: '' };
  }
}

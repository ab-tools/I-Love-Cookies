import { browser } from 'wxt/browser';
import type { TabState } from '../shared/messages';

const GREEN = '#2e7d32';
const AMBER = '#f9a825';
const RED = '#c62828';
const GREY = '#757575';

export function badgeFor(state: TabState): { text: string; color: string } {
  switch (state.phase) {
    case 'acting':
    case 'verifying':
      return { text: '…', color: GREY };
    case 'stuck':
      return { text: '!', color: RED };
    case 'done':
      if (state.outcome === 'FULL' || state.outcome === 'LIKELY_FULL') return { text: '✓', color: GREEN };
      if (state.outcome === 'PARTIAL') return { text: '~', color: AMBER };
      return { text: '!', color: RED };
    default:
      return { text: '', color: GREY };
  }
}

export async function updateBadge(state: TabState): Promise<void> {
  const { text, color } = badgeFor(state);
  try {
    await browser.action.setBadgeText({ tabId: state.tabId, text });
    if (text) await browser.action.setBadgeBackgroundColor({ tabId: state.tabId, color });
  } catch {
    // tab already closed
  }
}

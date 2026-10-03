import { ISSUE_TEMPLATE, REPO_URL } from './constants';
import type { TabState } from './messages';

/** GitHub rejects very long URLs; keep well below its ~8 KB limit. */
const MAX_URL_LENGTH = 7000;

export interface ReportContext {
  browser: string;
  userAgent: string;
}

/** Only scheme + host + path – never query strings or fragments (they can contain personal data). */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
}

export function buildReportDetails(state: TabState, ctx: ReportContext): string {
  const lines = [
    `extension: ${state.extensionVersion}`,
    `browser: ${ctx.browser} (${ctx.userAgent})`,
    `phase: ${state.phase}${state.pausedReason ? ` (${state.pausedReason})` : ''}`,
    `cmp: ${state.cmp ?? 'none detected'}`,
    `strategy: ${state.strategy ?? '-'}${state.apiTried ? ' (+api fallback)' : ''}`,
    `outcome: ${state.outcome ?? '-'}`,
    ...(state.reasons ?? []).map((r) => `  - ${r}`),
    '',
    'log:',
    ...state.log.map((e) => `  +${Math.round((e.t - (state.log[0]?.t ?? e.t)) / 100) / 10}s [frame ${e.frameId}] ${e.msg}`),
  ];
  return lines.join('\n');
}

export function buildIssueUrl(state: TabState, ctx: ReportContext): string {
  const site = state.site || 'unknown site';
  const title = `[Site] ${site}: ${state.outcome ?? state.phase}${state.cmp ? ` (${state.cmp})` : ''}`;
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title,
    url: sanitizeUrl(state.url),
    browser: ctx.browser,
  });
  const base = `${REPO_URL}/issues/new?${params.toString()}&details=`;
  let details = buildReportDetails(state, ctx);
  // Trim the details from the end (newest log lines) until the URL fits.
  while (base.length + encodeURIComponent(details).length > MAX_URL_LENGTH && details.length > 200) {
    details = details.slice(0, Math.floor(details.length * 0.8)) + '\n…(truncated)';
  }
  return base + encodeURIComponent(details);
}

export function searchExistingIssuesUrl(site: string): string {
  const q = encodeURIComponent(`is:issue ${site}`);
  return `${REPO_URL}/issues?q=${q}`;
}

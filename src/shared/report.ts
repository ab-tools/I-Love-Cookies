import { ISSUE_TEMPLATE, REPO_URL } from './constants';
import type { ReportProblem, ReportSnapshot, TabState } from './messages';

/** GitHub rejects very long URLs; keep well below its ~8 KB limit. */
const MAX_URL_LENGTH = 7000;

export interface ReportContext {
  browser: string;
  userAgent: string;
  /** Commit the extension was built from. */
  build?: string;
  /** Settings that change what the extension does, e.g. "pay-or-OK on, age checks on, rule updates on". */
  settings?: string;
}

/** Options of the issue form's "What happened?" field. */
export const PROBLEM_LABELS: Record<ReportProblem, string> = {
  bannerVisible: 'The cookie banner stayed visible',
  wrongClick: 'The extension clicked something wrong (subscription, login, link …)',
  pageBroken: 'The site is broken / not scrollable after accepting',
  other: 'Other',
};

/** Longest note the user can add to a report. */
export const MAX_NOTE_LENGTH = 500;

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
    `extension: ${state.extensionVersion}${ctx.build ? ` (build ${ctx.build})` : ''}`,
    ...(ctx.settings ? [`settings: ${ctx.settings}`] : []),
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

export interface Report {
  title: string;
  /** Human-readable summary and action log. */
  details: string;
  /** Structured page data (JSON) for analysing the banner; empty without a snapshot. */
  diagnostics: string;
  /** Prefilled GitHub issue form. */
  url: string;
}

/** Smaller variants of the snapshot, used when the issue URL would get too long. */
function compactSnapshot(snapshot: ReportSnapshot, level: number): ReportSnapshot {
  const frames = snapshot.frames.slice(0, level > 1 ? 3 : 6).map((f) => ({
    ...f,
    scriptHosts: level > 1 ? undefined : f.scriptHosts?.slice(0, 10),
    banner: f.banner && {
      ...f.banner,
      path: f.banner.path.slice(-2),
      text: level > 1 ? '' : f.banner.text.slice(0, 120),
      buttons: f.banner.buttons.slice(0, level > 1 ? 5 : 8),
    },
  }));
  return { ...snapshot, frames, signals: level > 1 ? undefined : snapshot.signals };
}

export function buildReport(state: TabState, ctx: ReportContext, snapshot?: ReportSnapshot, problem?: ReportProblem, note?: string): Report {
  const site = state.site || 'unknown site';
  const title = `[Site] ${site}: ${state.outcome ?? state.phase}${state.cmp ? ` (${state.cmp})` : ''}`;
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title,
    url: sanitizeUrl(state.url),
    browser: ctx.browser,
    ...(problem ? { problem: PROBLEM_LABELS[problem] } : {}),
    ...(note?.trim() ? { notes: note.trim().slice(0, MAX_NOTE_LENGTH) } : {}),
  });
  const base = `${REPO_URL}/issues/new?${params.toString()}`;
  const length = (details: string, diagnostics: string) =>
    base.length +
    '&details='.length +
    encodeURIComponent(details).length +
    (diagnostics ? '&diagnostics='.length + encodeURIComponent(diagnostics).length : 0);

  const lines = buildReportDetails(state, ctx).split('\n');
  const logStart = lines.indexOf('log:') + 1;
  let details = lines.join('\n');
  let diagnostics = snapshot ? JSON.stringify(snapshot) : '';
  // Shorten the log (newest lines first, the summary stays), then the snapshot, then cut the details.
  for (let keep = lines.length; length(details, diagnostics) > MAX_URL_LENGTH && keep > logStart + 5; keep--) {
    details = [...lines.slice(0, keep - 1), '  …(truncated)'].join('\n');
  }
  for (let level = 1; snapshot && level <= 2 && length(details, diagnostics) > MAX_URL_LENGTH; level++) {
    diagnostics = JSON.stringify(compactSnapshot(snapshot, level));
  }
  while (length(details, diagnostics) > MAX_URL_LENGTH && details.length > 200) {
    details = details.slice(0, Math.floor(details.length * 0.8)) + '\n…(truncated)';
  }
  if (length(details, diagnostics) > MAX_URL_LENGTH) diagnostics = '';
  const url = `${base}&details=${encodeURIComponent(details)}${diagnostics ? `&diagnostics=${encodeURIComponent(diagnostics)}` : ''}`;
  return { title, details, diagnostics, url };
}

export function buildIssueUrl(state: TabState, ctx: ReportContext, snapshot?: ReportSnapshot, problem?: ReportProblem, note?: string): string {
  return buildReport(state, ctx, snapshot, problem, note).url;
}

export function searchExistingIssuesUrl(site: string): string {
  const q = encodeURIComponent(`is:issue ${site}`);
  return `${REPO_URL}/issues?q=${q}`;
}

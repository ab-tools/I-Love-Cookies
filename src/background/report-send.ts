import { browser } from 'wxt/browser';
import { REPO_URL, REPORT_API_URL } from '../shared/constants';
import { buildReport, sanitizeUrl } from '../shared/report';
import { exclusionFor, getSettings } from '../shared/settings';
import { getTabState } from './orchestrator';
import { collectReportSnapshot } from './report-snapshot';

/**
 * Reports the tab's page: via GitHub opens the prefilled issue form (the user submits it with their account);
 * anonymously sends the same content to the report service, which files the issue and returns its address.
 */
export async function sendReport(tabId: number, anonymous: boolean): Promise<{ ok: true } | { error: string }> {
  const state = await getTabState(tabId);
  const snapshot = await collectReportSnapshot(tabId).catch(() => undefined);
  const settings = await getSettings();
  const onOff = (value: boolean) => (value ? 'on' : 'off');
  const excluded = exclusionFor(settings, state.url);
  const report = buildReport(
    state,
    {
      browser: import.meta.env.BROWSER,
      userAgent: navigator.userAgent,
      build: __ILC_BUILD__,
      settings: `pay-or-OK ${onOff(settings.payOrOk)}, age checks ${onOff(settings.ageGates)}, rule updates ${onOff(settings.remoteRules)}${excluded ? ', site excluded' : ''}`,
    },
    snapshot,
  );
  if (!anonymous) {
    await browser.tabs.create({ url: report.url });
    return { ok: true };
  }
  try {
    const response = await fetch(REPORT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        site: state.site,
        url: sanitizeUrl(state.url),
        browser: `${import.meta.env.BROWSER} (${navigator.userAgent})`,
        extensionVersion: state.extensionVersion,
        language: navigator.language,
        title: report.title,
        details: report.details,
        diagnostics: report.diagnostics,
      }),
    });
    const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
    const issue = typeof body?.url === 'string' ? body.url : '';
    if (!response.ok || !issue.toLowerCase().startsWith(`${REPO_URL.toLowerCase()}/issues/`)) return { error: `HTTP ${response.status}` };
    await browser.tabs.create({ url: issue });
    return { ok: true };
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error) };
  }
}

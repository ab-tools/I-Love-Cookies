import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFrameSnapshot, offersPaidOption, selectorOf } from '../../src/content/report-snapshot';
import { buildReport } from '../../src/shared/report';
import type { ReportSnapshot, TabState } from '../../src/shared/messages';

const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    const [x = 10, y = 10, w = 120, h = 30] = (this.getAttribute('data-rect') ?? '').split(',').filter(Boolean).map(Number);
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} } as DOMRect;
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  document.body.innerHTML = '';
});

const BANNER_TEXT = 'We and our 312 partners use cookies to personalise ads and measure traffic. You can change your consent at any time.';

describe('report snapshot', () => {
  it('builds short selectors without generated names', () => {
    document.body.innerHTML = `
      <button id="accept-all">a</button>
      <button id="btn-8f3k2x9" class="css-1x2y3z cookie-btn primary">b</button>
      <a class="x" data-testid="uc-accept">c</a>`;
    const [a, b, c] = Array.from(document.querySelectorAll('button,a'));
    expect(selectorOf(a!)).toBe('button#accept-all');
    expect(selectorOf(b!)).toBe('button.cookie-btn.primary');
    expect(selectorOf(c!)).toBe('a.x[data-testid="uc-accept"]');
  });

  it('describes the consent banner with classified buttons, CMPs and script hosts', () => {
    document.body.innerHTML = `
      <script type="text/x-test" src="https://cdn.consent.example/loader.js"></script>
      <div id="consent-root"><div id="cmp" class="cookie-banner" style="position:fixed" data-rect="0,500,1024,260">${BANNER_TEXT}
        <button id="accept">Accept all</button><button id="reject">Reject all</button><button id="more">Settings</button></div></div>`;
    const snapshot = collectFrameSnapshot({ cmps: ['didomi'], popups: [], cmpContainers: [], knownBanner: null });
    expect(snapshot.top).toBe(true);
    expect(snapshot.cmps).toEqual(['didomi']);
    expect(snapshot.scriptHosts).toEqual(['cdn.consent.example']);
    expect(snapshot.banner?.path).toEqual(['div#consent-root', 'div#cmp']);
    expect(snapshot.banner?.text).toContain('312 partners');
    expect(snapshot.banner?.buttons).toEqual([
      { label: 'Accept all', cls: 'ACCEPT_ALL', selector: 'button#accept' },
      { label: 'Reject all', cls: 'REJECT', selector: 'button#reject' },
      { label: 'Settings', cls: 'SETTINGS', selector: 'button#more' },
    ]);
  });

  it('recognises "consent or pay" walls by their paid option', () => {
    document.body.innerHTML = `
      <div id="wall" style="position:fixed" data-rect="0,0,1024,700">${BANNER_TEXT}
        <button>Einwilligen und weiter</button><button>Jetzt abonnieren</button></div>
      <div id="plain" data-rect="0,0,400,200">${BANNER_TEXT}<button>Accept all</button><button>Reject all</button></div>`;
    expect(offersPaidOption(document.getElementById('wall'))).toBe(true);
    expect(offersPaidOption(document.getElementById('plain'))).toBe(false);
    expect(offersPaidOption(null)).toBe(false);
  });

  it('falls back to the detected CMP container', () => {
    document.body.innerHTML = `<div id="cmp-box" data-rect="0,0,400,200">Hello <button>OK</button></div>`;
    const snapshot = collectFrameSnapshot({ cmps: ['x'], popups: ['x'], cmpContainers: ['#cmp-box', '<invalid'], knownBanner: null });
    expect(snapshot.banner?.path).toEqual(['div#cmp-box']);
  });
});

describe('report with banner data', () => {
  const state: TabState = {
    tabId: 1,
    url: 'https://www.example.com/a?x=1',
    site: 'example.com',
    phase: 'done',
    outcome: 'FAILED',
    attempts: {},
    extensionVersion: '0.1.0',
    log: Array.from({ length: 60 }, (_, i) => ({ t: 1000 + i, frameId: 0, msg: `step ${i} ${'x'.repeat(80)}` })),
  };
  const banner = {
    path: ['div#a', 'div#b'],
    shadow: false,
    score: 8,
    area: 0.3,
    text: 'cookies '.repeat(40),
    buttons: Array.from({ length: 12 }, (_, i) => ({ label: `Button ${i}`, cls: 'OTHER' as const, selector: `button#b${i}` })),
  };
  const snapshot: ReportSnapshot = {
    frames: Array.from({ length: 6 }, (_, i) => ({
      url: `https://frame${i}.example/`,
      top: i === 0,
      cmps: ['didomi'],
      popups: [],
      banner,
      scriptHosts: Array.from({ length: 25 }, (_, j) => `host${j}.example`),
      scrollLocked: false,
    })),
    signals: { tcf: { gdprApplies: true } },
    ruleSet: '2026.10.4',
  };

  it('adds the snapshot as JSON and keeps the URL below the limit', () => {
    const report = buildReport(state, { browser: 'chrome', userAgent: 'UA' }, snapshot);
    expect(report.url.length).toBeLessThanOrEqual(7000);
    const diagnostics = new URL(report.url).searchParams.get('diagnostics')!;
    expect(JSON.parse(diagnostics).frames[0].banner.buttons.length).toBeGreaterThan(0);
    expect(report.details).toContain('outcome: FAILED');
    expect(report.url).not.toContain('x%3D1');
  });

  it('keeps the full snapshot when there is room', () => {
    const small = { ...snapshot, frames: [{ ...snapshot.frames[0]!, scriptHosts: ['a.example'] }] };
    const report = buildReport({ ...state, log: [] }, { browser: 'chrome', userAgent: 'UA' }, small);
    expect(JSON.parse(report.diagnostics)).toEqual(small);
  });
});

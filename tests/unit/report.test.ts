import { describe, expect, it } from 'vitest';
import type { TabState } from '../../src/shared/messages';
import { buildIssueUrl, sanitizeUrl } from '../../src/shared/report';
import { describeState } from '../../src/shared/describe';
import { exclusionFor, siteOf, DEFAULT_SETTINGS } from '../../src/shared/settings';

const state = (partial: Partial<TabState> = {}): TabState => ({
  tabId: 1,
  url: 'https://www.example.com/article?session=secret#comments',
  site: 'example.com',
  phase: 'done',
  cmp: 'didomi',
  strategy: 'rule',
  outcome: 'FAILED',
  reasons: ['consent popup is still visible'],
  attempts: {},
  extensionVersion: '0.1.0',
  log: [{ t: 1000, frameId: 0, msg: 'CMP detected: didomi' }],
  ...partial,
});

describe('report', () => {
  it('strips query strings and fragments from URLs', () => {
    expect(sanitizeUrl('https://www.example.com/a?b=c#d')).toBe('https://www.example.com/a');
    expect(sanitizeUrl('not a url')).toBe('');
  });

  it('builds a prefilled GitHub issue URL without personal data', () => {
    const url = new URL(buildIssueUrl(state(), { browser: 'chrome', userAgent: 'UA' }));
    expect(url.pathname).toMatch(/\/issues\/new$/);
    expect(url.searchParams.get('template')).toBe('site-report.yml');
    expect(url.searchParams.get('url')).toBe('https://www.example.com/article');
    expect(url.searchParams.get('title')).toBe('[Site] example.com: FAILED (didomi)');
    expect(url.searchParams.get('details')).toContain('CMP detected: didomi');
    expect(url.toString()).not.toContain('secret');
  });

  it('prefills what happened and the user note', () => {
    const url = new URL(buildIssueUrl(state(), { browser: 'chrome', userAgent: 'UA' }, undefined, 'other', '  Video does not start  '));
    expect(url.searchParams.get('problem')).toBe('Other');
    expect(url.searchParams.get('notes')).toBe('Video does not start');
    expect(new URL(buildIssueUrl(state(), { browser: 'chrome', userAgent: 'UA' }, undefined, 'bannerVisible', '')).searchParams.has('notes')).toBe(false);
  });

  it('names the build and the settings that change behaviour', () => {
    const details = new URL(
      buildIssueUrl(state(), { browser: 'chrome', userAgent: 'UA', build: 'abc1234', settings: 'pay-or-OK on, age checks off, rule updates on' }),
    ).searchParams.get('details');
    expect(details).toContain('extension: 0.1.0 (build abc1234)');
    expect(details).toContain('settings: pay-or-OK on, age checks off, rule updates on');
  });

  it('keeps the URL below GitHub limits even with a long log', () => {
    const log = Array.from({ length: 60 }, (_, i) => ({ t: 1000 + i, frameId: i, msg: 'x'.repeat(200) }));
    expect(buildIssueUrl(state({ log }), { browser: 'firefox', userAgent: 'UA' }).length).toBeLessThan(7500);
  });
});

describe('describeState', () => {
  it('describes success, failure and pause', () => {
    expect(describeState(state({ outcome: 'FULL' })).text).toBe('All cookies accepted');
    expect(describeState(state({ outcome: 'FULL', strategy: 'api' })).details).toContain('didomi API');
    expect(describeState(state()).tone).toBe('bad');
    expect(describeState(state({ phase: 'paused', pausedReason: 'sitePaused' })).details).toBe(
      'paused on this site',
    );
    expect(describeState(state({ phase: 'idle', cmp: undefined })).text).toBe('No cookie banner detected');
  });
});

describe('settings helpers', () => {
  it('normalises sites and matches paused parent domains', () => {
    expect(siteOf('https://www.spiegel.de/x')).toBe('spiegel.de');
    expect(siteOf(undefined)).toBe('');
    const settings = { ...DEFAULT_SETTINGS, pausedSites: ['example.com'] };
    expect(exclusionFor(settings, 'https://www.example.com/')).toBe('example.com');
    expect(exclusionFor(settings, 'https://shop.example.com/x')).toBe('example.com');
    expect(exclusionFor(settings, 'https://notexample.com/')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { AutoConsentCMPRule } from '@duckduckgo/autoconsent';
import bundle from '../../src/rules/generated/rules.json';
import { RULES_INFO, rulesForFrame, selectRules } from '../../src/background/rules';
import { allSnippets } from '../../src/background/snippets';

const rules = (bundle as unknown as { autoconsent: AutoConsentCMPRule[] }).autoconsent;

const rule = (name: string, runContext?: AutoConsentCMPRule['runContext']): AutoConsentCMPRule => ({
  name,
  runContext,
  detectCmp: [],
  detectPopup: [],
  optIn: [{ click: 'button' }],
  optOut: [],
});

describe('generated rule bundle', () => {
  it('contains a meaningful number of rules', () => {
    expect(RULES_INFO.count).toBeGreaterThan(250);
  });

  it('only contains rules that can opt in (never hide-only or opt-out-only rules)', () => {
    for (const r of rules) {
      expect(r.optIn?.length, r.name).toBeGreaterThan(0);
      expect(r.cosmetic, r.name).toBeFalsy();
      expect(r.name.startsWith('auto_'), r.name).toBe(false);
    }
  });

  it('only references bundled MAIN-world snippets in eval steps', () => {
    const missing: string[] = [];
    const walk = (steps: AutoConsentCMPRule['optIn'] | undefined, rule: string) => {
      for (const step of steps ?? []) {
        if (step.eval && !(step.eval in allSnippets)) missing.push(`${rule}: ${step.eval}`);
        walk(step.then, rule);
        walk(step.else, rule);
        walk(step.any, rule);
        if (step.if) walk([step.if], rule);
      }
    };
    for (const r of rules) {
      for (const steps of [r.detectCmp, r.detectPopup, r.optIn]) walk(steps, r.name);
    }
    expect(missing).toEqual([]);
  });

  it('keeps well-known CMPs', () => {
    const names = new Set(rules.map((r) => r.name));
    for (const name of ['didomi', 'cookieyes', 'usercentrics-api', 'quantcast', 'Sirdata', 'osano']) {
      expect(names.has(name), name).toBe(true);
    }
  });
});

describe('selectRules', () => {
  const sample = [
    rule('main-only'),
    rule('frame-only', { main: false, frame: true }),
    rule('both', { main: true, frame: true }),
    rule('site-specific', { urlPattern: '^https://(www\\.)?example\\.com/' }),
    rule('broken-pattern', { urlPattern: '(' }),
  ];

  it('uses autoconsent defaults (main frame only)', () => {
    expect(selectRules(sample, { url: 'https://other.org/', mainFrame: true }).map((r) => r.name)).toEqual([
      'main-only',
      'both',
    ]);
    expect(selectRules(sample, { url: 'https://other.org/', mainFrame: false }).map((r) => r.name)).toEqual([
      'frame-only',
      'both',
    ]);
  });

  it('applies url patterns and drops invalid ones', () => {
    const names = selectRules(sample, { url: 'https://www.example.com/page', mainFrame: true }).map((r) => r.name);
    expect(names).toContain('site-specific');
    expect(names).not.toContain('broken-pattern');
  });

  it('sends far fewer rules to iframes than to the main frame', async () => {
    const top = (await rulesForFrame('https://news.example/', true)).autoconsent.length;
    const frame = (await rulesForFrame('https://cdn.example/frame', false)).autoconsent.length;
    expect(frame).toBeLessThan(top / 3);
  });
});

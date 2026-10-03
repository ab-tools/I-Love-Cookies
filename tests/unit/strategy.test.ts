import { describe, expect, it } from 'vitest';
import bundle from '../../src/rules/generated/rules.json';
import { CMP_STRATEGIES, strategyFor } from '../../src/background/strategy';
import { allSnippets, ilcSnippets } from '../../src/background/snippets';

// Code-based CMPs implemented in autoconsent's lib/cmps/*.ts (not part of rules.json).
const CODE_CMPS = [
  'Admiral',
  'consentmanager.net',
  'Conversant',
  'Cybotcookiebot',
  'Evidon',
  'Klaro',
  'Onetrust',
  'Sourcepoint-frame',
  'tiktok.com',
  'TrustArc-top',
  'Uniconsent',
];

describe('CMP strategy registry', () => {
  const known = new Set([...(bundle as { autoconsent: { name: string }[] }).autoconsent.map((r) => r.name), ...CODE_CMPS]);

  it('only references CMP names that autoconsent can detect', () => {
    for (const name of Object.keys(CMP_STRATEGIES)) {
      expect(known.has(name), name).toBe(true);
    }
  });

  it('only references bundled API snippets', () => {
    for (const [name, strategy] of Object.entries(CMP_STRATEGIES)) {
      if (strategy.api) expect(ilcSnippets[strategy.api], name).toBeTypeOf('function');
    }
  });

  it('defaults to the declarative rule for unknown CMPs', () => {
    expect(strategyFor('some-new-cmp')).toEqual({ primary: 'rule' });
  });
});

describe('MAIN-world snippets', () => {
  it('include autoconsent built-ins and our own snippets', () => {
    expect(allSnippets).toHaveProperty('EVAL_USERCENTRICS_API_3');
    expect(allSnippets).toHaveProperty('ILC_READ_CONSENT_SIGNALS');
  });

  it('are self-contained (no references to imports or module scope)', () => {
    for (const [id, fn] of Object.entries(ilcSnippets)) {
      // Re-create each function from its source in an empty scope – this is what executeScript does.
      const recreated = new Function(`return (${fn.toString()})`)();
      expect(recreated, id).toBeTypeOf('function');
      expect(fn.toString(), id).not.toMatch(/\b(import|require)\b/);
    }
  });

  it('API snippets return false when the CMP is not present', async () => {
    for (const [id, fn] of Object.entries(ilcSnippets)) {
      if (id === 'ILC_READ_CONSENT_SIGNALS') continue;
      expect(await (fn as () => unknown)(), id).toBe(false);
    }
  });

  it('calls the documented accept-all API', async () => {
    let called = false;
    (window as unknown as Record<string, unknown>).Didomi = { setUserAgreeToAll: () => (called = true) };
    expect(await ilcSnippets.ILC_API_DIDOMI()).toBe(true);
    expect(called).toBe(true);
    delete (window as unknown as Record<string, unknown>).Didomi;
  });

  it('reads TCF and Consent Mode signals', async () => {
    const w = window as unknown as Record<string, unknown>;
    w.__tcfapi = (cmd: string, _v: number, cb: (data: unknown, ok: boolean) => void) => {
      if (cmd !== 'addEventListener') return;
      cb(
        {
          eventStatus: 'useractioncomplete',
          gdprApplies: true,
          listenerId: 1,
          purpose: { consents: { 1: true, 2: true, 3: false }, legitimateInterests: { 2: true, 3: false } },
          vendor: { consents: { 1: true, 2: true } },
        },
        true,
      );
    };
    function gtag(..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    }
    w.dataLayer = [];
    gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' });
    gtag('consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted' });

    const signals = (await ilcSnippets.ILC_READ_CONSENT_SIGNALS()) as {
      tcf: Record<string, unknown>;
      gcm: { updated: boolean; values: Record<string, string> };
    };
    expect(signals.tcf).toMatchObject({ purposesTotal: 3, purposesConsented: 2, storageConsented: true, legitimateInterestObjected: 1, vendorsConsented: 2 });
    expect(signals.gcm).toEqual({ updated: true, values: { ad_storage: 'granted', analytics_storage: 'granted' } });
    delete w.__tcfapi;
    delete w.dataLayer;
  });
});

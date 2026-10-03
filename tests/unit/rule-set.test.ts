import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { compareVersions, mergeRules, sha256Hex, validateRuleSet, type RuleSet } from '../../src/shared/rule-set';
import { checkForRuleUpdate, getRuleSet, getRuleUpdateStatus, invalidateRuleSet } from '../../src/background/rule-updates';
import { activeRules } from '../../src/background/rules';
import { strategyFor } from '../../src/background/strategy';
import { RULE_UPDATE_URL } from '../../src/shared/constants';
import { updateSettings } from '../../src/shared/settings';

const SNIPPETS = new Set(['EVAL_KNOWN']);

const rule = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  detectCmp: [{ exists: '#cmp' }],
  detectPopup: [{ visible: '#cmp' }],
  optIn: [{ waitForThenClick: '#cmp .accept-all' }],
  optOut: [],
  ...extra,
});

const set = (extra: Partial<RuleSet> = {}): RuleSet => ({ format: 1, version: '2026.10.4.1', autoconsent: [rule('new-cmp') as never], ...extra });

describe('rule set validation', () => {
  it('accepts declarative rules that use bundled snippets', () => {
    const data = set({
      autoconsent: [rule('a', { optIn: [{ if: { visible: '#x' }, then: [{ click: '#x' }], else: [{ eval: 'EVAL_KNOWN' }] }] }) as never],
      consentOMatic: [{ name: 'com', detectors: [], methods: [{ name: 'DO_CONSENT', action: { type: 'list', actions: [{ type: 'click', target: { selector: '#y' } }] } }] }],
      disabled: ['old-rule'],
      strategies: { Onetrust: { primary: 'api' } },
      minExtensionVersion: '0.1.0',
    });
    expect(validateRuleSet(data, SNIPPETS, '0.1.0')).toEqual([]);
  });

  it('rejects unknown snippets, hiding steps, cosmetic rules and missing opt-in steps', () => {
    const errors = validateRuleSet(
      set({
        autoconsent: [
          rule('eval', { optIn: [{ eval: 'EVAL_REMOTE_CODE' }] }),
          rule('hide', { optIn: [{ hide: '#cmp' }] }),
          rule('cosmetic', { cosmetic: true }),
          rule('empty', { optIn: [] }),
          rule('bad-pattern', { runContext: { urlPattern: '(' } }),
        ] as never,
      }),
      SNIPPETS,
      '0.1.0',
    );
    expect(errors.join('\n')).toMatch(/unknown snippet EVAL_REMOTE_CODE/);
    expect(errors.join('\n')).toMatch(/step "hide" not allowed/);
    expect(errors.join('\n')).toMatch(/key "cosmetic" not allowed/);
    expect(errors.join('\n')).toMatch(/empty\)\.optIn: non-empty step list expected/);
    expect(errors.join('\n')).toMatch(/invalid pattern/);
  });

  it('rejects sets for other extension versions and unknown formats', () => {
    expect(validateRuleSet(set({ minExtensionVersion: '0.2.0' }), SNIPPETS, '0.1.9')).toEqual(['needs extension 0.2.0']);
    expect(validateRuleSet(set({ maxExtensionVersion: '0.1.0' }), SNIPPETS, '0.1.1')).toHaveLength(1);
    expect(validateRuleSet({ ...set(), format: 2 }, SNIPPETS, '0.1.0')).toHaveLength(1);
    expect(validateRuleSet('nope', SNIPPETS, '0.1.0')).toHaveLength(1);
  });

  it('compares dotted versions numerically', () => {
    expect(compareVersions('2026.10.10', '2026.10.9')).toBe(1);
    expect(compareVersions('1.0', '1')).toBe(0);
    expect(compareVersions('0.1.0', '0.2')).toBe(-1);
  });

  it('merges by name, keeps positions and removes disabled rules', () => {
    const bundled = [{ name: 'a', v: 1 }, { name: 'b', v: 1 }, { name: 'c', v: 1 }];
    expect(mergeRules(bundled, [{ name: 'b', v: 2 }, { name: 'd', v: 2 }], ['c'])).toEqual([
      { name: 'a', v: 1 },
      { name: 'b', v: 2 },
      { name: 'd', v: 2 },
    ]);
  });

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('rule updates', () => {
  let files: Record<string, string>;

  async function publish(data: unknown, checksum?: string) {
    const body = JSON.stringify(data);
    files = {
      [RULE_UPDATE_URL]: body,
      [`${RULE_UPDATE_URL}.sha256`]: `${checksum ?? (await sha256Hex(new TextEncoder().encode(body).buffer as ArrayBuffer))}  rules.json\n`,
    };
  }

  beforeEach(() => {
    fakeBrowser.reset();
    fakeBrowser.runtime.getManifest = () => ({ manifest_version: 3, name: 'test', version: '0.1.0' });
    invalidateRuleSet();
    files = {};
    vi.stubGlobal('fetch', async (url: string) => {
      const body = files[url];
      return body === undefined ? new Response('', { status: 404 }) : new Response(body);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('activates a valid, newer rule set and merges it into the bundled rules', async () => {
    const bundledCount = activeRules(null).autoconsent.length;
    await publish(set({ disabled: [activeRules(null).autoconsent[0]!.name] }));
    const status = await checkForRuleUpdate();
    expect(status).toMatchObject({ version: '2026.10.4.1' });
    expect(status.error).toBeUndefined();
    const merged = activeRules(await getRuleSet()).autoconsent;
    expect(merged).toHaveLength(bundledCount);
    expect(merged.map((r) => r.name)).toContain('new-cmp');
  });

  it('keeps the active set on checksum mismatch, invalid content or an older version', async () => {
    await publish(set());
    await checkForRuleUpdate();

    await publish(set({ version: '2026.10.5' }), 'a'.repeat(64));
    expect((await checkForRuleUpdate()).error).toBe('checksum mismatch');

    await publish(set({ version: '2026.10.6', autoconsent: [rule('x', { optIn: [{ eval: 'NOT_BUNDLED' }] }) as never] }));
    expect((await checkForRuleUpdate()).error).toMatch(/rule set rejected/);

    await publish(set({ version: '2026.1.1' }));
    expect((await checkForRuleUpdate()).error).toBeUndefined();

    expect((await getRuleUpdateStatus()).version).toBe('2026.10.4.1');
  });

  it('uses only the bundled rules when updates are switched off', async () => {
    await publish(set());
    await checkForRuleUpdate();
    await updateSettings({ remoteRules: false });
    invalidateRuleSet();
    expect(await getRuleSet()).toBeNull();
    expect((await checkForRuleUpdate()).error).toMatch(/switched off/);
  });

  it('lets a rule set choose the strategy per CMP', () => {
    expect(strategyFor('Onetrust').primary).toBe('rule');
    expect(strategyFor('Onetrust', { Onetrust: { primary: 'api' } }).primary).toBe('api');
    expect(strategyFor('Cybotcookiebot', { Cybotcookiebot: { primary: 'rule' } }).primary).toBe('rule');
    expect(strategyFor('some-new-cmp', { 'some-new-cmp': { primary: 'api' } }).primary).toBe('rule');
  });
});

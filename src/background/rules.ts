import type { AutoConsentCMPRule, RuleBundle } from '@duckduckgo/autoconsent';
import bundle from '../rules/generated/rules.json';
import consentOMatic from '../rules/consent-o-matic.json';
import type { ComRule } from '../content/consent-o-matic';
import { mergeRules, type RuleSet } from '../shared/rule-set';
import { getRuleSet } from './rule-updates';

interface GeneratedBundle {
  upstreamVersion: string;
  builtAt: string;
  autoconsent: AutoConsentCMPRule[];
}

const BUNDLE = bundle as unknown as GeneratedBundle;

export const RULES_INFO = {
  upstreamVersion: BUNDLE.upstreamVersion,
  builtAt: BUNDLE.builtAt,
  count: BUNDLE.autoconsent.length + (consentOMatic as unknown[]).length,
};

const patternCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  if (!patternCache.has(pattern)) {
    try {
      patternCache.set(pattern, new RegExp(pattern));
    } catch {
      patternCache.set(pattern, null);
    }
  }
  return patternCache.get(pattern)!;
}

/**
 * Pre-filters rules for one frame so we don't post the whole bundle to every iframe.
 * Mirrors autoconsent's run-context semantics (default: { main: true, frame: false }).
 */
export function selectRules(
  rules: readonly AutoConsentCMPRule[],
  ctx: { url: string; mainFrame: boolean },
): AutoConsentCMPRule[] {
  return rules.filter((rule) => {
    const main = rule.runContext?.main ?? true;
    const frame = rule.runContext?.frame ?? false;
    if (ctx.mainFrame ? !main : !frame) return false;
    const pattern = rule.runContext?.urlPattern;
    if (pattern) {
      const re = compile(pattern);
      if (!re || !re.test(ctx.url)) return false;
    }
    return true;
  });
}

export type IlcRuleBundle = RuleBundle & { consentOMatic: ComRule[] };

const BUNDLED_COM = consentOMatic as unknown as ComRule[];
let merged: { set: RuleSet | null; autoconsent: AutoConsentCMPRule[]; consentOMatic: ComRule[] } | null = null;

/** Bundled rules with the active downloaded rule set applied. */
export function activeRules(set: RuleSet | null): { autoconsent: AutoConsentCMPRule[]; consentOMatic: ComRule[] } {
  if (merged?.set !== set) {
    merged = {
      set,
      autoconsent: set ? mergeRules(BUNDLE.autoconsent, set.autoconsent, set.disabled) : BUNDLE.autoconsent,
      consentOMatic: set ? mergeRules(BUNDLED_COM, set.consentOMatic, set.disabled) : BUNDLED_COM,
    };
  }
  return merged;
}

export async function rulesForFrame(url: string, mainFrame: boolean): Promise<IlcRuleBundle> {
  const rules = activeRules(await getRuleSet());
  return { autoconsent: selectRules(rules.autoconsent, { url, mainFrame }), consentOMatic: rules.consentOMatic };
}

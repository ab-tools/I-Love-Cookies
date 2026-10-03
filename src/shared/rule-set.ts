import type { AutoConsentCMPRule } from '@duckduckgo/autoconsent';
import type { ComRule } from '../content/consent-o-matic';

/**
 * Downloadable rule update. Data only: declarative autoconsent / Consent-O-Matic rules, names of bundled
 * rules to switch off and per-CMP strategy choices. Code (`eval` snippets) always comes from the extension.
 */
export interface RuleSet {
  format: 1;
  /** Dotted numbers, e.g. "2026.10.3.1"; only newer sets replace the active one. */
  version: string;
  /** Inclusive range of extension versions the set was made for. */
  minExtensionVersion?: string;
  maxExtensionVersion?: string;
  /** Added rules; a rule with the name of a bundled rule replaces it. */
  autoconsent?: AutoConsentCMPRule[];
  consentOMatic?: ComRule[];
  /** Bundled rules (autoconsent or Consent-O-Matic) to switch off by name. */
  disabled?: string[];
  /** Strategy per CMP name ('api' = the CMP's JavaScript API first). */
  strategies?: Record<string, { primary: 'rule' | 'api' }>;
}

const RULE_KEYS = new Set([
  'name',
  'prehideSelectors',
  'runContext',
  'intermediate',
  'detectCmp',
  'detectPopup',
  'optIn',
  'optOut',
  'openCmp',
  'test',
  'minimumRuleStepVersion',
  'comment',
  'vendorUrl',
]);

/** Step keys of autoconsent's rule format, without the steps that hide or restyle page content. */
const STEP_KEYS = new Set([
  'optional',
  'comment',
  'exists',
  'visible',
  'check',
  'eval',
  'waitFor',
  'waitForVisible',
  'timeout',
  'click',
  'all',
  'waitForThenClick',
  'retry',
  'retryInterval',
  'wait',
  'if',
  'then',
  'else',
  'any',
  'negated',
  'cookieContains',
]);
const SELECTOR_KEYS = ['exists', 'visible', 'waitFor', 'waitForVisible', 'click', 'waitForThenClick'] as const;

/** Consent-O-Matic actions our interpreter runs (others, like hide/close, are ignored anyway). */
const COM_ACTIONS = new Set(['list', 'click', 'multiclick', 'consent', 'ifcss', 'ifallowall', 'ifallownone', 'waitcss', 'wait', 'foreach', 'runrooted', 'runmethod', 'hide', 'close', 'slide']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSelector = (v: unknown) => typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string'));
const VERSION = /^\d+(\.\d+){0,3}$/;

/** -1 / 0 / 1 for dotted numeric versions ("1.10" > "1.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function checkSteps(steps: unknown, path: string, snippets: ReadonlySet<string>, errors: string[], required = false) {
  if (steps === undefined && !required) return;
  if (!Array.isArray(steps) || (required && steps.length === 0)) {
    errors.push(`${path}: ${required ? 'non-empty ' : ''}step list expected`);
    return;
  }
  steps.forEach((step, i) => checkStep(step, `${path}[${i}]`, snippets, errors));
}

function checkStep(step: unknown, path: string, snippets: ReadonlySet<string>, errors: string[]) {
  if (!isObject(step)) {
    errors.push(`${path}: object expected`);
    return;
  }
  for (const key of Object.keys(step)) if (!STEP_KEYS.has(key)) errors.push(`${path}: step "${key}" not allowed`);
  for (const key of SELECTOR_KEYS) if (key in step && !isSelector(step[key])) errors.push(`${path}.${key}: selector expected`);
  if ('eval' in step && !(typeof step.eval === 'string' && snippets.has(step.eval))) errors.push(`${path}.eval: unknown snippet ${String(step.eval)}`);
  for (const key of ['wait', 'timeout', 'retry', 'retryInterval'] as const) {
    if (key in step && !(typeof step[key] === 'number' && step[key] >= 0 && step[key] <= 30000)) errors.push(`${path}.${key}: number 0..30000 expected`);
  }
  if ('cookieContains' in step && typeof step.cookieContains !== 'string') errors.push(`${path}.cookieContains: string expected`);
  if ('if' in step) {
    checkStep(step.if, `${path}.if`, snippets, errors);
    checkSteps(step.then, `${path}.then`, snippets, errors, true);
    checkSteps(step.else, `${path}.else`, snippets, errors);
  }
  if ('any' in step) checkSteps(step.any, `${path}.any`, snippets, errors, true);
}

function checkRule(rule: unknown, path: string, snippets: ReadonlySet<string>, errors: string[]) {
  if (!isObject(rule) || typeof rule.name !== 'string' || !rule.name) {
    errors.push(`${path}: rule with a name expected`);
    return;
  }
  path = `${path} (${rule.name})`;
  for (const key of Object.keys(rule)) if (!RULE_KEYS.has(key)) errors.push(`${path}: key "${key}" not allowed`);
  if (rule.prehideSelectors !== undefined && !(Array.isArray(rule.prehideSelectors) && rule.prehideSelectors.every((s) => typeof s === 'string'))) {
    errors.push(`${path}.prehideSelectors: string list expected`);
  }
  if (rule.runContext !== undefined) {
    const pattern = isObject(rule.runContext) ? rule.runContext.urlPattern : undefined;
    if (!isObject(rule.runContext)) errors.push(`${path}.runContext: object expected`);
    else if (pattern !== undefined) {
      try {
        new RegExp(String(pattern));
      } catch {
        errors.push(`${path}.runContext.urlPattern: invalid pattern`);
      }
    }
  }
  checkSteps(rule.detectCmp, `${path}.detectCmp`, snippets, errors, true);
  checkSteps(rule.detectPopup, `${path}.detectPopup`, snippets, errors, true);
  checkSteps(rule.optIn, `${path}.optIn`, snippets, errors, true);
  for (const key of ['optOut', 'openCmp', 'test'] as const) checkSteps(rule[key], `${path}.${key}`, snippets, errors);
}

function checkComActions(value: unknown, path: string, errors: string[], depth = 0) {
  if (depth > 20) {
    errors.push(`${path}: nested too deeply`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkComActions(v, `${path}[${i}]`, errors, depth + 1));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (['action', 'actions', 'trueAction', 'falseAction', 'toggleAction'].includes(key)) {
      if (isObject(child) && typeof child.type === 'string' && !COM_ACTIONS.has(child.type)) errors.push(`${path}.${key}: unknown action ${child.type}`);
      checkComActions(child, `${path}.${key}`, errors, depth + 1);
    } else if (key === 'consents' || key === 'methods') {
      checkComActions(child, `${path}.${key}`, errors, depth + 1);
    }
  }
}

function checkComRule(rule: unknown, path: string, errors: string[]) {
  if (!isObject(rule) || typeof rule.name !== 'string' || !rule.name || !Array.isArray(rule.detectors) || !Array.isArray(rule.methods)) {
    errors.push(`${path}: Consent-O-Matic rule with name, detectors and methods expected`);
    return;
  }
  checkComActions(rule.methods, `${path} (${rule.name}).methods`, errors);
}

/**
 * Checks a downloaded rule set. `snippets`: IDs of the snippets bundled with the extension – rules may only
 * reference those. Returns the errors; an empty list means the set is usable.
 */
export function validateRuleSet(data: unknown, snippets: ReadonlySet<string>, extensionVersion: string): string[] {
  const errors: string[] = [];
  if (!isObject(data)) return ['rule set: object expected'];
  if (data.format !== 1) errors.push(`format ${String(data.format)} not supported`);
  if (typeof data.version !== 'string' || !VERSION.test(data.version)) errors.push('version: dotted numbers expected');
  for (const key of ['minExtensionVersion', 'maxExtensionVersion'] as const) {
    if (data[key] !== undefined && !(typeof data[key] === 'string' && VERSION.test(data[key]))) errors.push(`${key}: dotted numbers expected`);
  }
  if (typeof data.minExtensionVersion === 'string' && compareVersions(extensionVersion, data.minExtensionVersion) < 0) {
    errors.push(`needs extension ${data.minExtensionVersion}`);
  }
  if (typeof data.maxExtensionVersion === 'string' && compareVersions(extensionVersion, data.maxExtensionVersion) > 0) {
    errors.push(`made for extension ≤ ${data.maxExtensionVersion}`);
  }
  if (data.autoconsent !== undefined) {
    if (!Array.isArray(data.autoconsent)) errors.push('autoconsent: list expected');
    else data.autoconsent.forEach((rule, i) => checkRule(rule, `autoconsent[${i}]`, snippets, errors));
  }
  if (data.consentOMatic !== undefined) {
    if (!Array.isArray(data.consentOMatic)) errors.push('consentOMatic: list expected');
    else data.consentOMatic.forEach((rule, i) => checkComRule(rule, `consentOMatic[${i}]`, errors));
  }
  if (data.disabled !== undefined && !(Array.isArray(data.disabled) && data.disabled.every((n) => typeof n === 'string'))) {
    errors.push('disabled: list of rule names expected');
  }
  if (data.strategies !== undefined) {
    if (!isObject(data.strategies)) errors.push('strategies: object expected');
    else {
      for (const [cmp, s] of Object.entries(data.strategies)) {
        if (!isObject(s) || (s.primary !== 'rule' && s.primary !== 'api')) errors.push(`strategies.${cmp}: primary 'rule' or 'api' expected`);
      }
    }
  }
  return errors;
}

/** Bundled rules with a rule set applied: disabled rules removed, same-name rules replaced, new ones added. */
export function mergeRules<T extends { name: string }>(bundled: readonly T[], added: readonly T[] | undefined, disabled: readonly string[] | undefined): T[] {
  const off = new Set(disabled ?? []);
  const byName = new Map<string, T>();
  for (const rule of bundled) if (!off.has(rule.name)) byName.set(rule.name, rule);
  for (const rule of added ?? []) byName.set(rule.name, rule);
  return [...byName.values()];
}

/** Lowercase hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

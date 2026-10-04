/**
 * Interpreter for Consent-O-Matic rules (MIT, github.com/cavi-au/Consent-O-Matic), always granting every
 * consent category. Each rule becomes an autoconsent-compatible CMP, so detection, claiming and
 * verification run through the same pipeline as autoconsent rules. "hide" and "close" are never executed.
 */
import type AutoConsent from '@duckduckgo/autoconsent';
import { realisticClick, shadowRootOf } from './dom';

type TextFilter = string | string[];

export interface ComTarget {
  selector: string;
  textFilter?: TextFilter;
  styleFilters?: { option: string; value: string; negated?: boolean }[];
  displayFilter?: boolean;
  iframeFilter?: boolean;
  childFilter?: ComLocator;
  childFilterNegated?: boolean;
}

export interface ComLocator {
  target: ComTarget;
  parent?: ComTarget;
}

export type ComMatcher = ComLocator & {
  type: 'css' | 'checkbox' | 'url' | 'onoff';
  negated?: boolean;
  url?: string | string[];
  regexp?: boolean;
  onMatcher?: ComMatcher;
  offMatcher?: ComMatcher;
};

export type ComAction = Partial<ComLocator> & {
  type: string;
  actions?: ComAction[];
  action?: ComAction;
  trueAction?: ComAction;
  falseAction?: ComAction;
  consents?: ComConsent[];
  negated?: boolean;
  retries?: number;
  waitTime?: number;
  ignoreOldRoot?: boolean;
  method?: string;
  dragTarget?: ComLocator;
  axis?: string;
};

export interface ComConsent {
  type: string;
  matcher?: ComMatcher;
  toggleAction?: ComAction;
  trueAction?: ComAction;
  falseAction?: ComAction;
}

export interface ComRule {
  name: string;
  detectors: { presentMatcher: ComMatcher | ComMatcher[]; showingMatcher?: ComMatcher | ComMatcher[] }[];
  methods: { name: string; action?: ComAction; custom?: boolean }[];
}

type AutoCMP = AutoConsent['rules'][number];
type Root = Element | Document;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asArray = <T>(value: T | T[] | undefined | null): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

function topFrameUrl(): string {
  if (window === window.top) return location.href;
  const ancestors = location.ancestorOrigins;
  return ancestors?.length ? ancestors[ancestors.length - 1]! : document.referrer;
}

/** Element search with Consent-O-Matic's filter semantics. */
export class ComFinder {
  base: Root | null = null;

  findElements(options: ComTarget, parent: Root | null): Element[] {
    let candidates: Element[];
    if (options.selector.trim() === ':scope') {
      const root = parent ?? this.base;
      candidates = root instanceof Element ? [root] : [];
    } else {
      let top: Root | ShadowRoot = parent ?? this.base ?? document;
      if (top instanceof Element) top = shadowRootOf(top) ?? top;
      try {
        candidates = Array.from(top.querySelectorAll(options.selector));
      } catch {
        return [];
      }
    }
    const filters = asArray(options.textFilter).map((t) => t.toLowerCase().replace(/\s{2,}/g, ' '));
    if (filters.length) {
      candidates = candidates.filter((el) => {
        const text = (el.textContent ?? '').toLowerCase().replace(/\s{2,}/g, ' ');
        return filters.some((f) => text.includes(f));
      });
    }
    if (options.styleFilters) {
      candidates = candidates.filter((el) => {
        const style = getComputedStyle(el) as unknown as Record<string, string>;
        return options.styleFilters!.every((f) => (style[f.option] === f.value) !== Boolean(f.negated));
      });
    }
    if (options.displayFilter != null) {
      candidates = candidates.filter((el) => ((el as HTMLElement).offsetHeight !== 0) === options.displayFilter);
    }
    if (options.iframeFilter != null) {
      const inFrame = window !== window.top;
      candidates = candidates.filter(() => inFrame === options.iframeFilter);
    }
    if (options.childFilter) {
      candidates = candidates.filter((el) => {
        const previous = this.base;
        this.base = el;
        const found = this.find(options.childFilter!)[0]?.target != null;
        this.base = previous;
        return found !== Boolean(options.childFilterNegated);
      });
    }
    return candidates;
  }

  find(locator: ComLocator, multiple = false): { parent: Element | null; target: Element | null }[] {
    const results: { parent: Element | null; target: Element | null }[] = [];
    const parents = locator.parent ? this.findElements(locator.parent, null) : [null];
    for (const parent of multiple ? parents : parents.slice(0, 1)) {
      const targets = this.findElements(locator.target, parent);
      for (const target of multiple ? targets : targets.slice(0, 1)) results.push({ parent, target });
    }
    return results.length ? results : [{ parent: null, target: null }];
  }

  findOne(locator: ComLocator): Element | null {
    return this.find(locator)[0]?.target ?? null;
  }
}

export class ComEngine {
  readonly finder = new ComFinder();
  clicks = 0;

  constructor(private readonly rule: ComRule) {}

  matches(matcher: ComMatcher): boolean {
    switch (matcher.type) {
      case 'css':
        return this.finder.findOne(matcher) != null;
      case 'checkbox': {
        const box = this.finder.findOne(matcher) as HTMLInputElement | null;
        if (!box) throw new Error('checkbox not found');
        return matcher.negated ? !box.checked : box.checked;
      }
      case 'url': {
        const url = topFrameUrl();
        const matched = asArray(matcher.url).some((u) => (matcher.regexp ? new RegExp(u).test(url) : url.includes(u)));
        return matcher.negated ? !matched : matched;
      }
      case 'onoff': {
        const on = matcher.onMatcher && this.finder.findOne(matcher.onMatcher) != null;
        const off = matcher.offMatcher && this.finder.findOne(matcher.offMatcher) != null;
        if (on === off) throw new Error('onoff state unknown');
        return Boolean(on);
      }
      default:
        return false;
    }
  }

  private detector() {
    return this.rule.detectors.find((d) => {
      const present = asArray(d.presentMatcher);
      return present.length > 0 && present.every((m) => this.safeMatch(m));
    });
  }

  private safeMatch(matcher: ComMatcher): boolean {
    try {
      return this.matches(matcher);
    } catch {
      return false;
    }
  }

  isPresent(): boolean {
    return this.detector() != null;
  }

  isShowing(): boolean {
    const detector = this.detector();
    if (!detector) return false;
    const showing = asArray(detector.showingMatcher);
    return showing.every((m) => this.safeMatch(m));
  }

  /** Plain CSS selectors of the visible dialog, used to verify it closed. */
  dialogSelectors(): string[] {
    return this.rule.detectors
      .flatMap((d) => asArray(d.showingMatcher))
      .filter((m) => m.type === 'css' && !m.parent && !m.target.textFilter && !m.target.childFilter)
      .map((m) => m.target.selector);
  }

  async run(action: ComAction | undefined): Promise<void> {
    if (!action) return;
    switch (action.type) {
      case 'list':
        for (const a of action.actions ?? []) await this.run(a);
        return;
      case 'click': {
        const target = this.finder.findOne(action as ComLocator);
        if (target) {
          await realisticClick(target);
          this.clicks++;
          await sleep(100);
        }
        return;
      }
      case 'multiclick':
        for (const { target } of this.finder.find(action as ComLocator, true)) {
          if (target) {
            (target as HTMLElement).click();
            this.clicks++;
          }
        }
        return;
      case 'consent':
        // Maximum consent: every category enabled.
        for (const consent of action.consents ?? []) await this.enable(consent);
        return;
      case 'ifcss':
        await this.run(this.finder.findOne(action as ComLocator) ? action.trueAction : action.falseAction);
        return;
      case 'ifallowall':
        await this.run(action.trueAction);
        return;
      case 'ifallownone':
        await this.run(action.falseAction);
        return;
      case 'waitcss': {
        const retries = action.retries ?? 10;
        const wait = action.waitTime ?? 250;
        for (let i = 0; i <= retries; i++) {
          const found = this.finder.findOne(action as ComLocator) != null;
          if (found !== Boolean(action.negated)) return;
          await sleep(wait);
        }
        return;
      }
      case 'wait':
        await sleep(Math.min(action.waitTime ?? 250, 5000));
        return;
      case 'foreach': {
        const previous = this.finder.base;
        for (const { target } of this.finder.find(action as ComLocator, true)) {
          if (!target) continue;
          this.finder.base = target;
          await this.run(action.action);
        }
        this.finder.base = previous;
        return;
      }
      case 'runrooted': {
        const previous = this.finder.base;
        if (action.ignoreOldRoot) this.finder.base = null;
        const root = this.finder.findOne(action as ComLocator);
        if (root) {
          this.finder.base = root;
          await this.run(action.action);
        }
        this.finder.base = previous;
        return;
      }
      case 'runmethod': {
        const method = this.rule.methods.find((m) => m.name === action.method?.toUpperCase() && m.custom);
        await this.run(method?.action);
        return;
      }
      default:
        // hide, close, slide: never executed – banners are answered, not hidden.
        return;
    }
  }

  private async enable(consent: ComConsent): Promise<void> {
    if (consent.toggleAction) {
      if (consent.matcher && !this.safeMatch(consent.matcher)) await this.run(consent.toggleAction);
      return;
    }
    if (consent.matcher?.type === 'onoff') {
      if (!this.safeMatch(consent.matcher)) await this.run(consent.trueAction);
      return;
    }
    await this.run(consent.trueAction);
  }

  async method(name: string): Promise<boolean> {
    const method = this.rule.methods.find((m) => m.name === name);
    if (!method?.action) return false;
    await this.run(method.action);
    return true;
  }
}

/** A Consent-O-Matic rule as autoconsent CMP (generic, runs in every frame). */
export class ConsentOMaticCMP implements AutoCMP {
  readonly name: string;
  readonly hasSelfTest = false;
  readonly isIntermediate = false;
  readonly isCosmetic = false;
  readonly runContext = { main: true, frame: true };
  readonly prehideSelectors: string[];
  private readonly engine: ComEngine;

  constructor(rule: ComRule) {
    this.name = `com-${rule.name}`;
    this.engine = new ComEngine(rule);
    this.prehideSelectors = this.engine.dialogSelectors();
  }

  checkRunContext() {
    return true;
  }
  checkFrameContext() {
    return true;
  }
  hasMatchingUrlPattern() {
    return false;
  }
  async detectCmp() {
    return this.engine.isPresent();
  }
  async detectPopup() {
    return this.engine.isShowing();
  }
  async optIn() {
    const opened = await this.engine.method('OPEN_OPTIONS');
    const consented = await this.engine.method('DO_CONSENT');
    const saved = await this.engine.method('SAVE_CONSENT');
    return (opened || consented || saved) && this.engine.clicks > 0;
  }
  async optOut() {
    return false;
  }
  async openCmp() {
    return false;
  }
  async test() {
    return false;
  }
}

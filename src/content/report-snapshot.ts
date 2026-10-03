import { isOnScreen, shadowRootOf } from './dom';
import { isScrollLocked } from './scroll';
import { consentScore, deepText, findConsentBanners } from './heuristic/banner';
import { extractButtons } from './heuristic/candidates';
import { sanitizeUrl } from '../shared/report';
import type { BannerSnapshot, FrameSnapshot } from '../shared/messages';

const MAX_TEXT = 300;
const MAX_BUTTONS = 12;
const MAX_SCRIPT_HOSTS = 25;

/** Classes that look generated ("css-1x2y3z", "a8f3k2") say nothing about the banner. */
const GENERATED = /\d.*\d|^(?=[^-]*\d)[a-z0-9]{5,}$/i;

/** Short, mostly stable CSS selector for one element. */
export function selectorOf(el: Element): string {
  let selector = el.tagName.toLowerCase();
  if (el.id && !GENERATED.test(el.id)) return `${selector}#${CSS.escape(el.id)}`;
  const classes = [...el.classList].filter((c) => !GENERATED.test(c)).slice(0, 3);
  selector += classes.map((c) => `.${CSS.escape(c)}`).join('');
  for (const attr of ['data-testid', 'data-action', 'data-role', 'aria-label', 'name']) {
    const value = el.getAttribute(attr);
    if (value && value.length <= 40) return `${selector}[${attr}="${value.replace(/"/g, '\\"')}"]`;
  }
  return selector;
}

/** Selector path from the outermost of up to three ancestors down to the element. */
function pathOf(el: Element): string[] {
  const path = [selectorOf(el)];
  for (let p = el.parentElement; p && path.length < 4 && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    path.unshift(selectorOf(p));
  }
  return path;
}

export function snapshotBanner(element: Element): BannerSnapshot {
  const text = deepText(element);
  const rect = element.getBoundingClientRect();
  const viewport = Math.max(1, window.innerWidth * window.innerHeight);
  return {
    path: pathOf(element),
    shadow: shadowRootOf(element) !== null,
    score: consentScore(text),
    area: Math.round((Math.max(0, rect.width) * Math.max(0, rect.height) * 100) / viewport) / 100,
    text: text.slice(0, MAX_TEXT),
    buttons: extractButtons(element)
      .slice(0, MAX_BUTTONS)
      .map((b) => ({ label: b.label.replace(/\s+/g, ' ').slice(0, 60), cls: b.cls, selector: selectorOf(b.element) })),
  };
}

/**
 * The banner to describe: the generic detection's best match, else the detected CMP's dialog, else – in a
 * consent iframe, whose whole document is the banner – the body.
 */
export function bannerElement(cmpContainers: readonly string[], knownBanner: Element | null): Element | null {
  const [found] = findConsentBanners();
  if (found) return found.element;
  if (knownBanner?.isConnected) return knownBanner;
  for (const selector of cmpContainers) {
    try {
      const el = Array.from(document.querySelectorAll(selector)).find(isOnScreen);
      if (el) return el;
    } catch {
      // invalid selector in a rule
    }
  }
  if (window !== window.top && document.body && consentScore(deepText(document.body)) >= 2) return document.body;
  return null;
}

/** "Consent or pay" wall: the banner offers a paid option (subscription, ad-free plan) next to consent. */
export function offersPaidOption(banner: Element | null): boolean {
  return !!banner && extractButtons(banner).some((b) => b.cls === 'PAY');
}

function scriptHosts(): string[] {
  const own = location.hostname;
  const hosts = new Set<string>();
  for (const script of Array.from(document.scripts)) {
    try {
      const host = script.src ? new URL(script.src).hostname : '';
      if (host && host !== own) hosts.add(host);
    } catch {
      // ignore
    }
  }
  return [...hosts].sort().slice(0, MAX_SCRIPT_HOSTS);
}

/**
 * What a problem report needs to know about this frame: detected CMPs, the visible consent banner (structure,
 * short text, buttons with their classified labels) and third-party script hosts. No page content beyond the
 * banner, no query strings.
 */
export function collectFrameSnapshot(info: {
  cmps: readonly string[];
  popups: readonly string[];
  cmpContainers: readonly string[];
  knownBanner: Element | null;
}): FrameSnapshot {
  const top = window === window.top;
  const element = bannerElement(info.cmpContainers, info.knownBanner);
  return {
    url: sanitizeUrl(location.href),
    top,
    cmps: [...info.cmps],
    popups: [...info.popups],
    banner: element ? snapshotBanner(element) : undefined,
    scriptHosts: top ? scriptHosts() : undefined,
    scrollLocked: isScrollLocked(),
  };
}

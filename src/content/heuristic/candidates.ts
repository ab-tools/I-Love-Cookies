import { isOnScreen, shadowRootOf } from '../dom';
import { ACCEPTING, classifyLabel, isConsentNoun, type ButtonClass } from './text';

export interface ButtonCandidate {
  element: HTMLElement;
  label: string;
  cls: ButtonClass;
  /** Following this element would leave the page (link to another URL or new tab). */
  navigates: boolean;
  /** Visual weight: height first (call-to-action buttons are tall, text links and strips flat), then width. */
  prominence: number;
}

/** Real controls. */
const CLICKABLE = 'button,[role=button],a,input[type=button],input[type=submit],[onclick]';
/** Elements styled as buttons – only used when they contain no other control (not whole button groups). */
const BUTTON_LIKE = '[class*="btn"],[class*="button"],[tabindex="0"]';
/** Close icons without text ("<div class=close><i class=icon-close></i></div>"). */
const CLOSE_ICON = '[class*="close" i],[id*="close" i],[aria-label*="close" i],[title*="close" i]';
const CLOSE_NAME = /(^|[-_\s])(close|closer|close-?btn|close-?button|close-?icon)([-_\s]|$)|(icon|eico|ico|fa)-(close|times|x)\b/i;
/** Ids and classes of accept-all buttons whose label is only a noun ("Consent"). */
const ACCEPT_NAME = /(^|[-_\s])(accept|allow|agree|all|cta-consent)([-_\s]|$)/i;

const nameOf = (el: Element) => `${el.id} ${el.getAttribute('class') ?? ''}`;

function labelOf(el: HTMLElement): string {
  const text =
    el.innerText?.trim() ||
    (el as HTMLInputElement).value?.trim() ||
    el.getAttribute('aria-label')?.trim() ||
    el.getAttribute('title')?.trim() ||
    '';
  if (text) return text;
  // Custom elements (<music-button>Accept</music-button>): the inner button shows the host's slotted text.
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const host = root.host as HTMLElement;
    const hosted = host.innerText?.trim() || host.getAttribute('aria-label')?.trim();
    if (hosted && hosted.length <= 80) return hosted;
  }
  if (CLOSE_NAME.test(nameOf(el)) || CLOSE_NAME.test(nameOf(el.firstElementChild ?? el))) return '×';
  // Icon fonts / CSS-generated labels
  const before = getComputedStyle(el, '::before').content;
  const after = getComputedStyle(el, '::after').content;
  return [before, after].filter((c) => c && c !== 'none' && c !== 'normal').join(' ').replace(/^"|"$/g, '');
}

/** Addresses of consent endpoints ("/cookies/accept", "?cookie_all=1", "/dismiss-notice"). */
const CONSENT_ENDPOINT = /cookie|consent|accept|agree|allow|dismiss|gdpr|dsgvo|opt-?in/i;

/** Information pages a consent banner links to – never a consent endpoint. */
const INFO_PAGE = /polic|privacy|datenschutz|richtlinie|impressum|imprint|legal|terms|agb|conditions|cookie-?(info|notice|statement|erklaerung)/i;

/**
 * Following the element would leave the page. Accepting links to the same site (consent endpoints like
 * "/cookies/accept" or "?cookie_all=1" that return to the page) do not count; other links, other sites and new tabs do.
 */
function navigatesAway(el: HTMLElement, accepting: boolean): boolean {
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return false;
  const href = (anchor.getAttribute('href') ?? '').trim();
  // In-page anchors and script links do not leave the page (even with a target attribute).
  if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return false;
  if (anchor.target && anchor.target !== '_self') return true;
  try {
    // Same page with only a different query (e.g. "?do=AcceptConsent") is a consent action, not leaving.
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return true;
    if (url.pathname === location.pathname) return false;
    return !accepting || INFO_PAGE.test(url.pathname) || !CONSENT_ENDPOINT.test(url.pathname + url.search);
  } catch {
    return true;
  }
}

/**
 * The element at the button's centre is the button itself. Covered by another part of the banner: a decoy or
 * hidden control, never clicked. Covered by something outside the banner (another popup on top of it): still
 * the banner's button.
 */
function isHitTestable(el: HTMLElement, banner: Element, box: Element = el): boolean {
  const rect = box.getBoundingClientRect();
  const root = el.getRootNode() as Document | ShadowRoot;
  const hit = (root.elementFromPoint ?? document.elementFromPoint).call(root, rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit) return true; // no layout information (e.g. tests) – do not block
  if (hit === el || el.contains(hit) || hit.contains(el)) return true;
  // Hit-testing inside a custom element (<music-button>) can report its host.
  for (let r = el.getRootNode(); r instanceof ShadowRoot; r = r.host.getRootNode()) if (hit === r.host || hit.contains(r.host)) return true;
  return !banner.contains(hit) && !(shadowRootOf(banner)?.contains(hit) ?? false) && !hit.contains(banner);
}

/**
 * Script-driven controls without button markup: short, labelled leaf elements with a pointer cursor. Never
 * labels or anything tied to a form control – clicking those would switch a setting instead of answering.
 */
function pointerControls(root: Element | ShadowRoot, known: Set<HTMLElement>): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('div,span,li,p'))) {
    if (known.has(el) || el.closest(`${CLICKABLE},label`) || el.querySelector(`${CLICKABLE},${BUTTON_LIKE},input,select,textarea,label`)) continue;
    if (el.parentElement?.querySelector(':scope > input, :scope > label')) continue;
    const text = el.innerText?.trim() ?? '';
    if (!text || text.length > 40 || el.children.length > 2) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    // The outermost element with the pointer cursor carries the click handler.
    const parent = el.parentElement;
    if (parent && parent !== root && getComputedStyle(parent).cursor === 'pointer' && (parent.innerText?.trim() ?? '') === text) continue;
    found.push(el);
  }
  return found;
}

function clickablesIn(root: Element | ShadowRoot, found: HTMLElement[] = []): HTMLElement[] {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(CLICKABLE))) found.push(el);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(BUTTON_LIKE))) {
    if (!el.matches(CLICKABLE) && !el.querySelector(`${CLICKABLE},${BUTTON_LIKE}`) && !el.closest(CLICKABLE)) found.push(el);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(CLOSE_ICON))) {
    if (el.matches(CLICKABLE) || el.closest(CLICKABLE) || el.querySelector(`${CLICKABLE},${BUTTON_LIKE}`) || (el.innerText ?? '').trim().length > 2) continue;
    if (CLOSE_NAME.test(nameOf(el)) || el.matches('[aria-label*="close" i],[title*="close" i]')) found.push(el);
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = shadowRootOf(el);
    if (shadow) clickablesIn(shadow, found);
  }
  return found;
}

/** Clickable, visible, hit-testable elements inside a banner with their classified labels. */
export function extractButtons(banner: Element): ButtonCandidate[] {
  const roots: (Element | ShadowRoot)[] = [banner];
  const own = shadowRootOf(banner);
  if (own) roots.push(own);
  const elements = new Set(roots.flatMap((r) => clickablesIn(r)));
  for (const el of roots.flatMap((r) => pointerControls(r, elements))) elements.add(el);
  // Keep the outermost clickable of nested ones (<button><span role=button>…</span></button>).
  // Tabs of a dialog ("Consent | Details | About") are navigation, category switches are settings – no answers.
  for (const el of elements) if (el.closest('[role=tab],[role=tablist],[role=switch],[role=checkbox]') || el.matches('[aria-checked],input[type=checkbox]')) elements.delete(el);
  // A "clickable" around several controls or a lot of text is a container (e.g. a dialog with onclick), not a button.
  for (const el of [...elements]) {
    const inner = [...elements].filter((other) => other !== el && el.contains(other));
    if (inner.length >= 2 || (inner.length >= 1 && (el.innerText ?? '').trim().length > 60)) elements.delete(el);
  }
  const outermost = [...elements].filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (elements.has(p as HTMLElement)) return false;
    return true;
  });
  return outermost
    .flatMap((el) => {
      // Links sized only by their content (0 px high) are seen – and clicked – through their first visible
      // child; the click bubbles up to the link, while a handler on the child would not see a click on the link.
      const box = isOnScreen(el) ? el : (Array.from(el.querySelectorAll<HTMLElement>('*')).find(isOnScreen) ?? null);
      if (!box || !isHitTestable(el, banner, box) || (el as HTMLButtonElement).disabled) return [];
      const label = labelOf(el);
      const rect = box.getBoundingClientRect();
      // Buttons with a description under the label ("Accept all", then ": consent to all cookies …"): the first line decides.
      const firstLine = label.split('\n')[0]!.trim();
      let cls = classifyLabel(label.length > 48 && firstLine ? firstLine : label);
      // "Consent" next to "Consent to selected": the bare noun is the accept-all button when its name says so.
      if (cls === 'OTHER' && isConsentNoun(label) && ACCEPT_NAME.test(nameOf(el))) cls = 'ACCEPT_ALL';
      return label ? [{ element: box, label, cls, navigates: navigatesAway(el, ACCEPTING.has(cls)), prominence: Math.round(Math.min(rect.height, 64) * 1000 + Math.min(rect.width, 400)) }] : [];
    });
}

import { isOnScreen, shadowRootOf } from '../dom';
import { classifyLabel, type ButtonClass } from './text';

export interface ButtonCandidate {
  element: HTMLElement;
  label: string;
  cls: ButtonClass;
  /** Following this element would leave the page (link to another URL or new tab). */
  navigates: boolean;
}

/** Real controls. */
const CLICKABLE = 'button,[role=button],a,input[type=button],input[type=submit],[onclick]';
/** Elements styled as buttons – only used when they contain no other control (not whole button groups). */
const BUTTON_LIKE = '[class*="btn"],[class*="button"],[tabindex="0"]';

function labelOf(el: HTMLElement): string {
  const text =
    el.innerText?.trim() ||
    (el as HTMLInputElement).value?.trim() ||
    el.getAttribute('aria-label')?.trim() ||
    el.getAttribute('title')?.trim() ||
    '';
  if (text) return text;
  // Icon fonts / CSS-generated labels
  const before = getComputedStyle(el, '::before').content;
  const after = getComputedStyle(el, '::after').content;
  return [before, after].filter((c) => c && c !== 'none' && c !== 'normal').join(' ').replace(/^"|"$/g, '');
}

function navigatesAway(el: HTMLElement): boolean {
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return false;
  const href = anchor.getAttribute('href') ?? '';
  // In-page anchors and script links do not leave the page (even with a target attribute).
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
  if (anchor.target && anchor.target !== '_self') return true;
  try {
    // Same page with only a different query (e.g. "?do=AcceptConsent") is a consent action, not leaving.
    const url = new URL(anchor.href, location.href);
    return url.origin !== location.origin || url.pathname !== location.pathname;
  } catch {
    return true;
  }
}

/**
 * The element at the button's centre is the button itself. Covered by another part of the banner: a decoy or
 * hidden control, never clicked. Covered by something outside the banner (another popup on top of it): still
 * the banner's button.
 */
function isHitTestable(el: HTMLElement, banner: Element): boolean {
  const rect = el.getBoundingClientRect();
  const root = el.getRootNode() as Document | ShadowRoot;
  const hit = (root.elementFromPoint ?? document.elementFromPoint).call(root, rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit) return true; // no layout information (e.g. tests) – do not block
  if (hit === el || el.contains(hit) || hit.contains(el)) return true;
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
  const outermost = [...elements].filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (elements.has(p as HTMLElement)) return false;
    return true;
  });
  return outermost
    .filter((el) => isOnScreen(el) && isHitTestable(el, banner) && !(el as HTMLButtonElement).disabled)
    .map((el) => {
      const label = labelOf(el);
      return { element: el, label, cls: classifyLabel(label), navigates: navigatesAway(el) };
    })
    .filter((b) => b.label.length > 0);
}

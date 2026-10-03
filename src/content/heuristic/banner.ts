import { isOnScreen, shadowRootOf } from '../dom';

/** Consent wording: strong words alone identify a banner, weak words only support it. */
const STRONG =
  /cookie|consent|einwillig|zustimmung|gdpr|dsgvo|rgpd|toestemming|souhlas|zgod[ay]|consentimiento|consenso|samtykke|samtycke|suostum|evästee|sütik|kolačić|piškot|slapuk|sīkdat|küpsis|çerez|куки|cookies/i;
const WEAK =
  /partner|vendor|anbieter|fournisseur|proveedor|fornitor|tracking|personali[sz]|werbung|advertis|publicit|pubblicit|reklam|analy|datenschutz|privacy|confidentialit|privacidad|privatnost|adatvédel|prywatnoś|soukromí|integritet|privatliv|yksityisyy|ιδιωτικ|защит|gizlilik/gi;

/** Dialogs that are not about consent. */
const NEGATIVE_TEXT =
  /newsletter|subscribe to our|anmelden zum|age verification|altersverifikation|are you (over|18)|bist du (über|18)|year of birth|geburtsjahr|choose (your )?(country|region|language)|wähle (dein )?(land|sprache)|select your (country|region|location)|install (our|the) app|download (our|the) app|push.?notification|benachrichtigungen/i;

const NAVIGATION = 'header,nav,footer,[role=banner],[role=navigation],[role=contentinfo],[role=menu],[role=tooltip]';
const CLICKABLE = 'button,[role=button],a,input[type=button],input[type=submit],[onclick],[class*="btn"],[class*="button"]';

export interface Banner {
  element: Element;
  /** Text of the element including (open and closed) shadow DOM. */
  text: string;
  score: number;
  /** Share of the viewport covered (0..1). */
  area: number;
}

/** Visible text of an element including its shadow trees. */
export function deepText(element: Element): string {
  const parts = [(element as HTMLElement).innerText ?? element.textContent ?? ''];
  const collect = (root: Element | ShadowRoot) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const shadow = shadowRootOf(el);
      if (shadow) {
        parts.push(shadow.textContent ?? '');
        collect(shadow);
      }
    }
  };
  const own = shadowRootOf(element);
  if (own) {
    parts.push(own.textContent ?? '');
    collect(own);
  }
  collect(element);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function consentScore(text: string): number {
  const strong = (text.match(new RegExp(STRONG.source, 'gi')) ?? []).length;
  const weak = (text.match(WEAK) ?? []).length;
  if (strong === 0) return 0;
  return Math.min(strong, 5) * 2 + Math.min(weak, 5);
}

function isOverlayLike(el: Element): boolean {
  if (el.matches('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]')) return true;
  const position = getComputedStyle(el).position;
  return position === 'fixed' || position === 'sticky';
}

function hasHardNegative(el: Element, text: string): boolean {
  if (NEGATIVE_TEXT.test(text)) return true;
  const root = shadowRootOf(el) ?? el;
  if (root.querySelector('input[type=email],input[type=password],input[type=tel],input[type=date],input[type=search]')) return true;
  if (Array.from(root.querySelectorAll('select')).some((s) => s.options.length >= 10)) return true;
  if (root.querySelector('a[href*="apps.apple.com"],a[href*="play.google.com"]')) return true;
  return false;
}

/** All overlay-like elements, including those inside open and closed shadow roots. */
function overlayElements(root: Document | ShadowRoot | Element, found: Element[] = []): Element[] {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    // Pages lock scrolling with position: fixed on <html>/<body> – never banners themselves.
    if (el === document.documentElement || el === document.body) continue;
    if (isOverlayLike(el)) found.push(el);
    const shadow = shadowRootOf(el);
    if (shadow) overlayElements(shadow, found);
  }
  return found;
}

/**
 * Consent banners in this document, best first. A banner must be an on-screen overlay/dialog with consent
 * wording and at least one clickable element, and must not look like a newsletter, login, age or region dialog.
 */
export function findConsentBanners(doc: Document = document): Banner[] {
  const overlays = overlayElements(doc);
  const set = new Set(overlays);
  const viewport = Math.max(1, window.innerWidth * window.innerHeight);
  const banners: Banner[] = [];
  for (const el of overlays) {
    // outermost overlay only
    let parent: Element | null = el.parentElement;
    let nested = false;
    while (parent) {
      if (set.has(parent)) {
        nested = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (nested || el.matches(NAVIGATION) || !isOnScreen(el)) continue;
    const rect = el.getBoundingClientRect();
    const area = (Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) * (Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / viewport;
    if (area < 0.01) continue;
    const text = deepText(el);
    const score = consentScore(text);
    if (score < 2 || text.length < 40) continue;
    const root = shadowRootOf(el) ?? el;
    if (!root.querySelector(CLICKABLE) && !el.querySelector(CLICKABLE)) continue;
    if (hasHardNegative(el, text)) continue;
    banners.push({ element: el, text: text.slice(0, 2000), score, area });
  }
  return banners.sort((a, b) => b.score - a.score || b.area - a.area);
}

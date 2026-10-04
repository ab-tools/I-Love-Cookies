import { isOnScreen, isVisible, shadowRootOf } from '../dom';
import { extractButtons } from './candidates';

/** Consent wording: strong words alone identify a banner, weak words only support it. */
const STRONG =
  /cookie|consent|einwillig|zustimmung|gdpr|dsgvo|rgpd|toestemming|souhlas|zgod[ay]|consentimiento|consenso|samtykke|samtycke|suostum|evästee|sütik|kolačić|piškot|slapuk|sīkdat|küpsis|çerez|куки|cookies|privacy (choices|preferences|settings)|datenschutz-?(einstellungen|präferenzen)|préférences de confidentialité/i;
const WEAK =
  /partner|vendor|anbieter|fournisseur|proveedor|fornitor|tracking|personali[sz]|werbung|advertis|publicit|pubblicit|reklam|analy|datenschutz|privacy|confidentialit|privacidad|privatnost|adatvédel|prywatnoś|soukromí|integritet|privatliv|yksityisyy|ιδιωτικ|защит|gizlilik/gi;

/** Dialogs that are not about consent: age gates, region / language choices. */
const NEGATIVE_TEXT =
  /age verification|altersverifikation|are you (over|18)|bist du (über|18)|year of birth|geburtsjahr|ihr alter|dein alter|your age|volljährig|of legal age|\b(18|21) (jahre|years|ans|años|anni|jaar|lat)\b|\b(18|21)\+|mayor de edad|maggiorenne|majeur|meerderjarig|pełnoletn|choose (your )?(country|region|language)|wähle (dein )?(land|sprache)|select your (country|region|location)/i;

/** GDPR's parental-consent note ("If you are under 16 …") in ordinary consent banners is no age gate. */
const PARENTAL_CONSENT = /[^.!?]*\b(under|unter|moins de|menos de|meno di|onder|poniżej|alatti)\s+1[3-8]\b[^.!?]*/gi;
/** "If you agree and are over 18, click …": a condition for consenting, not an age gate. */
const AGE_CONDITION = /[^.!?]*\b(if|wenn|falls|si|se|jeśli|jeżeli|pokud|ha|dacă|om)\b[^.!?]*\b1[3-8]\b[^.!?]*/gi;
const CONSENT_WORD = /cookie|consent|zustimm|einwillig|accept|akzept|acept|accett|erlaub|zgod|souhlas/i;
/** Adult sites: their combined age-and-cookie dialogs are age gates. */
const ADULT_SITE = /nur für erwachsene|adults? only|for adults|adult (content|website|site)|sexually explicit|pornogra/i;

const ageGateText = (text: string) =>
  ADULT_SITE.test(text) ||
  NEGATIVE_TEXT.test(text.replace(PARENTAL_CONSENT, '').replace(AGE_CONDITION, (s) => (CONSENT_WORD.test(s) ? '' : s)));

/** Newsletter / app / notification prompts – unless the consent wording is strong (banners mention them too). */
const SOFT_NEGATIVE_TEXT = /newsletter|subscribe to our|anmelden zum|install (our|the) app|download (our|the) app|push.?notification|benachrichtigungen/i;
const STRONG_CONSENT_SCORE = 6;
/** A whole frame document counts as a banner only with clear consent wording. */
const FRAME_DOCUMENT_MIN_SCORE = 4;

const NAVIGATION = 'header,nav,footer,main,article,[role=banner],[role=navigation],[role=contentinfo],[role=main],[role=menu],[role=tooltip]';
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

function hasHardNegative(el: Element, text: string, score: number): boolean {
  if (ageGateText(text)) return true;
  if (score < STRONG_CONSENT_SCORE && SOFT_NEGATIVE_TEXT.test(text)) return true;
  const root = shadowRootOf(el) ?? el;
  // Only visible fields: consent-or-pay walls keep a hidden login form for subscribers.
  if (Array.from(root.querySelectorAll('input[type=email],input[type=password],input[type=tel],input[type=date],input[type=search]')).some(isVisible)) return true;
  if (Array.from(root.querySelectorAll('select')).some((s) => s.options.length >= 10 && isVisible(s))) return true;
  if (root.querySelector('a[href*="apps.apple.com"],a[href*="play.google.com"]')) return true;
  return false;
}

const NAMED_LIKE_CONSENT = /cookie|consent|gdpr|privacy|banner|cmp|\b(fixed|sticky)\b/i;

/**
 * Cheap pre-filter before computing styles: fixed elements have no offsetParent; dialogs, elements named like
 * consent UI and utility classes like "sticky" (sticky elements keep an offsetParent) are always checked.
 */
function mayBeOverlay(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.offsetParent === null || el.style.position === 'fixed' || el.style.position === 'sticky') return true;
  if (el.matches('dialog,[role=dialog],[role=alertdialog],[aria-modal]')) return true;
  return NAMED_LIKE_CONSENT.test(`${el.id} ${el.getAttribute('class') ?? ''}`);
}

/** All overlay-like elements, including those inside open and closed shadow roots. */
function overlayElements(root: Document | ShadowRoot | Element, found: Element[] = []): Element[] {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    // Pages lock scrolling with position: fixed on <html>/<body> – never banners themselves.
    if (el === document.documentElement || el === document.body) continue;
    if (mayBeOverlay(el) && isOverlayLike(el)) found.push(el);
    const shadow = shadowRootOf(el);
    if (shadow) overlayElements(shadow, found);
  }
  return found;
}

/**
 * Sticky bars with generated class names pass none of the cheap pre-filters: check the few ancestors of text
 * mentioning cookies instead.
 */
function overlaysAroundConsentText(doc: Document, found: Set<Element>): void {
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (/cookie|consent|einwillig|zustimm/i.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  for (let node = walker.nextNode(), n = 0; node && n < 50; node = walker.nextNode(), n++) {
    let el = node.parentElement;
    for (let depth = 0; el && depth < 8 && el !== doc.body && el !== doc.documentElement; depth++, el = el.parentElement) {
      if (found.has(el)) break;
      if (isOverlayLike(el)) {
        found.add(el);
        break;
      }
    }
  }
}

/**
 * Consent banners in this document, best first. A banner must be an on-screen overlay/dialog with consent
 * wording and at least one clickable element, and must not look like a newsletter, login, age or region dialog.
 */
export function findConsentBanners(doc: Document = document): Banner[] {
  const all = new Set(overlayElements(doc));
  overlaysAroundConsentText(doc, all);
  const viewport = Math.max(1, window.innerWidth * window.innerHeight);
  const areaOf = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return ((Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) * (Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0))) / viewport;
  };
  // Only visible overlays count – an invisible wrapper must not hide the dialog inside it.
  const set = new Set([...all].filter((el) => !el.matches(NAVIGATION) && isOnScreen(el) && areaOf(el) >= 0.01));
  const banners: Banner[] = [];
  for (const el of set) {
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
    if (nested) continue;
    const area = areaOf(el);
    const text = deepText(el);
    let score = consentScore(text);
    // Privacy dialogs without the usual words ("Choose how we use your personal information"): an "accept all"
    // button next to privacy wording identifies them.
    if (score < 2 && (text.match(WEAK) ?? []).length >= 2 && extractButtons(el).some((b) => b.cls === 'ACCEPT_ALL')) score = 2;
    if (score < 2 || text.length < 40) continue;
    const root = shadowRootOf(el) ?? el;
    if (!root.querySelector(CLICKABLE) && !el.querySelector(CLICKABLE)) continue;
    if (hasHardNegative(el, text, score)) continue;
    banners.push({ element: el, text: text.slice(0, 2000), score, area });
  }
  // A consent page loaded into an iframe is the whole document, not an overlay inside it. (Acting on it still
  // requires the <iframe> to be a visible overlay in the page.)
  if (!banners.length && window !== window.top && doc.body && isOnScreen(doc.body)) {
    const text = deepText(doc.body);
    const score = consentScore(text);
    if (score >= FRAME_DOCUMENT_MIN_SCORE && text.length >= 40 && doc.body.querySelector(CLICKABLE) && !hasHardNegative(doc.body, text, score)) {
      banners.push({ element: doc.body, text: text.slice(0, 2000), score, area: 1 });
    }
  }
  return banners.sort((a, b) => b.score - a.score || b.area - a.area);
}

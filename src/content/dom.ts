import { browser } from 'wxt/browser';

/**
 * Open *or closed* shadow root of an element. Closed roots are only reachable from the isolated world of a
 * content script: Chrome via chrome.dom.openOrClosedShadowRoot, Firefox via element.openOrClosedShadowRoot.
 */
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    const firefoxRoot = (el as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot;
    if (firefoxRoot) return firefoxRoot;
    const dom = (browser as unknown as { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } }).dom;
    return dom?.openOrClosedShadowRoot?.(el) ?? null;
  } catch {
    return null;
  }
}

/**
 * Selector chain through nested shadow roots: every selector but the last selects shadow hosts,
 * the last one selects the target elements inside the innermost roots.
 * Example: ['tb-banner-wrapper', 'tb-banner-footer', 'tb-action-button', 'button.accept-button']
 */
export function deepQueryAll(chain: readonly string[], root: ParentNode = document): Element[] {
  let scopes: ParentNode[] = [root];
  for (let i = 0; i < chain.length; i++) {
    const found = scopes.flatMap((scope) => Array.from(scope.querySelectorAll(chain[i]!)));
    if (i === chain.length - 1) return found;
    scopes = found.map(shadowRootOf).filter((r): r is ShadowRoot => r !== null);
  }
  return [];
}

export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // checkVisibility also covers hidden or transparent ancestors.
  const check = (el as Element & { checkVisibility?: (options: object) => boolean }).checkVisibility;
  if (check && !check.call(el, { opacityProperty: true, visibilityProperty: true })) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/** Visible and at least partly inside the viewport. */
export function isOnScreen(el: Element): boolean {
  if (!isVisible(el)) return false;
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

/** On screen with at least 30 % of its height – a banner that slid out leaves only an edge behind. */
export function isMostlyOnScreen(el: Element): boolean {
  if (!isOnScreen(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return true;
  const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return visible / rect.height >= 0.3;
}

let pageWorldClick: ((el: HTMLElement) => void) | null = null;

/**
 * Clicks that must run in the page's world: the content script's CSP blocks "javascript:" link targets.
 * Without a handler (tests) such links are clicked here.
 */
export function setPageWorldClick(handler: (el: HTMLElement) => void): void {
  pageWorldClick = handler;
}

let trustedClick: ((x: number, y: number) => Promise<void>) | null = null;

/** Real mouse clicks at a viewport position (by the browser, for pages that ignore synthetic events); null ends them. */
export function setTrustedClick(handler: ((x: number, y: number) => Promise<void>) | null): void {
  trustedClick = handler;
}

/** Real clicks are ours right now (not the user's). */
export const trustedClicksOn = (): boolean => trustedClick !== null;

/**
 * Clicks like a user would: pointer/mouse events at the element's centre, then click() – or a real mouse click
 * while trusted clicks are on. Resolves once the click was delivered.
 */
export async function realisticClick(el: Element): Promise<void> {
  (el as HTMLElement).scrollIntoView?.({ block: 'center' });
  const rect = el.getBoundingClientRect();
  if (trustedClick) return trustedClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  const scriptLink = el.closest('a[href]') as HTMLAnchorElement | null;
  if (pageWorldClick && scriptLink?.getAttribute('href')?.trim().toLowerCase().startsWith('javascript:') && scriptLink.getRootNode() === document) {
    pageWorldClick(scriptLink);
    return;
  }
  (el as HTMLElement).click();
}

/** Clicks the first visible element matched by a shadow selector chain. */
export function clickDeep(chain: readonly string[]): boolean {
  const target = deepQueryAll(chain).find(isVisible);
  if (!target) return false;
  void realisticClick(target);
  return true;
}

/**
 * Clicks until the button disappears: banners often render their buttons before the page attached the
 * click handlers. Resolves false if the button was never found.
 */
export async function clickDeepUntilGone(chain: readonly string[], attempts = 4, intervalMs = 800): Promise<boolean> {
  if (!clickDeep(chain)) return false;
  for (let i = 1; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (!isDeepVisible(chain)) break;
    clickDeep(chain);
  }
  return true;
}

export function isDeepVisible(chain: readonly string[]): boolean {
  return deepQueryAll(chain).some(isOnScreen);
}

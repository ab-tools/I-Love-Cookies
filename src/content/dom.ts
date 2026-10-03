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

/** Clicks like a user would: pointer/mouse events at the element's centre, then click(). */
export function realisticClick(el: Element): void {
  (el as HTMLElement).scrollIntoView?.({ block: 'center' });
  const rect = el.getBoundingClientRect();
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
  (el as HTMLElement).click();
}

/** Clicks the first visible element matched by a shadow selector chain. */
export function clickDeep(chain: readonly string[]): boolean {
  const target = deepQueryAll(chain).find(isVisible);
  if (!target) return false;
  realisticClick(target);
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

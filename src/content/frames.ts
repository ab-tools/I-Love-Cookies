import { isOnScreen, shadowRootOf } from './dom';

export interface FrameInfo {
  visible: boolean;
  /** Share of the top viewport covered by the iframe (0..1). */
  area: number;
}

const announced = new Map<string, FrameInfo>();

/** All iframes of the page, including those inside (open and closed) shadow roots. */
function iframes(root: Document | ShadowRoot = document, found: HTMLIFrameElement[] = []): HTMLIFrameElement[] {
  found.push(...Array.from(root.querySelectorAll('iframe')));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = shadowRootOf(el);
    if (shadow) iframes(shadow, found);
  }
  return found;
}

/** Top frame: maps tokens posted by child frames to their <iframe> element's visibility and size. */
export function listenForFrameTokens() {
  if (window !== window.top) return;
  window.addEventListener('message', (event) => {
    const token = (event.data as { ilcFrameToken?: unknown } | null)?.ilcFrameToken;
    if (typeof token !== 'string') return;
    const frame = iframes().find((f) => f.contentWindow === event.source);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const covered =
      Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    announced.set(token, { visible: isOnScreen(frame), area: covered / Math.max(1, innerWidth * innerHeight) });
  });
}

/** Child frame: tells the top frame which <iframe> it is. */
export function announceFrame(token: string) {
  window.parent.postMessage({ ilcFrameToken: token }, '*');
}

export function frameInfo(token: string): FrameInfo | null {
  return announced.get(token) ?? null;
}

/** True if the top document cannot be scrolled although its content is taller than the viewport. */
export function isScrollLocked(doc: Document = document, win: Window = window): boolean {
  if (win !== win.top) return false;
  const html = doc.documentElement;
  const body = doc.body;
  if (!html || !body) return false;
  const contentTaller = Math.max(html.scrollHeight, body.scrollHeight) > win.innerHeight + 10;
  if (!contentTaller) return false;
  const locked = (el: Element) => {
    const style = win.getComputedStyle(el);
    return style.overflowY === 'hidden' || style.overflowY === 'clip' || style.overflow === 'hidden';
  };
  const bodyFixed = win.getComputedStyle(body).position === 'fixed';
  return locked(html) || locked(body) || bodyFixed;
}

/** Another dialog covering most of the viewport (then the lock is intended). */
function largeOverlayOpen(doc: Document, win: Window): boolean {
  const viewport = win.innerWidth * win.innerHeight;
  return Array.from(doc.querySelectorAll<HTMLElement>('body *')).some((el) => {
    if (el.offsetParent !== null) return false;
    const style = win.getComputedStyle(el);
    if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height > viewport * 0.5 && el.childElementCount > 0;
  });
}

/**
 * Removes a scroll lock that the consent banner left behind. Only called after consent was verified;
 * does nothing while another large dialog is open.
 */
export function unlockScroll(doc: Document = document, win: Window = window): boolean {
  if (!isScrollLocked(doc, win) || largeOverlayOpen(doc, win)) return false;
  for (const el of [doc.documentElement, doc.body]) {
    el.style.setProperty('overflow', 'auto', 'important');
  }
  const body = doc.body;
  if (win.getComputedStyle(body).position === 'fixed') {
    // Common lock: body { position: fixed; top: -<scroll offset> } – restore the offset.
    const offset = -parseInt(body.style.top || '0', 10) || 0;
    body.style.setProperty('position', 'static', 'important');
    body.style.removeProperty('top');
    win.scrollTo(0, offset);
  }
  return !isScrollLocked(doc, win);
}

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

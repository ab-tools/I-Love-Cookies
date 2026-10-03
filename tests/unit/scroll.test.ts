import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isScrollLocked, unlockScroll } from '../../src/content/scroll';

describe('scroll lock cleanup', () => {
  beforeEach(() => {
    // Content taller than the viewport.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 5000 });
    document.documentElement.style.overflow = 'hidden';
  });
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.body.innerHTML = '';
  });

  it('removes a lock that the banner left behind', () => {
    expect(isScrollLocked()).toBe(true);
    expect(unlockScroll()).toBe(true);
    expect(isScrollLocked()).toBe(false);
  });

  it('keeps the lock while another large dialog is open', () => {
    document.body.innerHTML = '<div id="modal" style="position:fixed"><p>Newsletter</p></div>';
    const modal = document.getElementById('modal')!;
    Object.defineProperty(modal, 'offsetParent', { configurable: true, get: () => null });
    modal.getBoundingClientRect = () => ({ width: innerWidth, height: innerHeight }) as DOMRect;
    expect(unlockScroll()).toBe(false);
    expect(isScrollLocked()).toBe(true);
  });
});

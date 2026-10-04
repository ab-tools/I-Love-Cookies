import type { ButtonCandidate } from './candidates';
import { heuristicOptions } from './options';

export type Decision =
  | { action: 'click'; button: ButtonCandidate; kind: 'accept_all' | 'accept' | 'acknowledge' | 'age' | 'close' }
  | { action: 'settings'; button: ButtonCandidate }
  /** The banner is a settings layer already: select / switch on everything, then save with this button. */
  | { action: 'save'; button: ButtonCandidate }
  /** The accept button is disabled until categories are chosen: switch everything on, then decide again. */
  | { action: 'toggles' }
  | { action: 'none'; reason: string };

/** Never clicked, whatever the label says. */
export function isVetoed(button: ButtonCandidate): boolean {
  return button.navigates || button.cls === 'PAY' || button.cls === 'LOGIN' || button.cls === 'REJECT';
}

/**
 * Maximum-consent decision for a banner's buttons:
 * accept all > accept > acknowledge (OK / got it) > confirm an age check (if switched on) > select everything and
 * save (banners that show their categories right away; `hasToggles`: switchable categories) > open the settings >
 * close a notice that offers nothing else.
 * Paid, login, reject and navigating buttons are removed before anything is chosen.
 */
export function decide(buttons: readonly ButtonCandidate[], hasToggles = false, lockedAccept = false): Decision {
  const allowed = buttons.filter((b) => !isVetoed(b));
  // The most prominent button of a class: real buttons before links and other clickable elements, then the
  // visually heaviest (call-to-action buttons over inline info links and expander strips).
  const rank = (b: ButtonCandidate) => (b.element.closest('button,input,[role=button]') ? 2 : b.element.closest('a') ? 1 : 0);
  const better = (a: ButtonCandidate, b: ButtonCandidate) => rank(a) > rank(b) || (rank(a) === rank(b) && a.prominence > b.prominence);
  const first = (cls: ButtonCandidate['cls']) =>
    allowed.filter((b) => b.cls === cls).reduce<ButtonCandidate | undefined>((best, b) => (!best || better(b, best) ? b : best), undefined);

  const acceptAll = first('ACCEPT_ALL');
  if (acceptAll) return { action: 'click', button: acceptAll, kind: 'accept_all' };
  const accept = first('ACCEPT');
  if (accept) return { action: 'click', button: accept, kind: 'accept' };
  const acknowledge = first('ACKNOWLEDGE');
  if (acknowledge) return { action: 'click', button: acknowledge, kind: 'acknowledge' };
  const age = heuristicOptions.ageGates ? first('AGE_CONFIRM') : undefined;
  if (age) return { action: 'click', button: age, kind: 'age' };
  const save = first('SAVE');
  const selectAll = first('SELECT_ALL');
  if (save && (hasToggles || selectAll)) return { action: 'save', button: save };
  // A notice whose only answer is "Confirm" / "Save" (no categories, no reject) is acknowledged with it.
  if (save && !hasToggles && !buttons.some((b) => b.cls === 'REJECT')) return { action: 'click', button: save, kind: 'acknowledge' };
  // "Select all" without a save button is the banner's accept-all button.
  if (selectAll) return { action: 'click', button: selectAll, kind: 'accept_all' };
  const settings = first('SETTINGS');
  if (settings) return { action: 'settings', button: settings };
  if (hasToggles && lockedAccept) return { action: 'toggles' };
  // Nothing to consent to: closed so the page is usable as if there never was a banner.
  const close = first('CLOSE');
  if (close) return { action: 'click', button: close, kind: 'close' };
  return { action: 'none', reason: buttons.length ? 'no accepting button' : 'no buttons' };
}

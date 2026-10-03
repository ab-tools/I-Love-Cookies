import type { ButtonCandidate } from './candidates';

export type Decision =
  | { action: 'click'; button: ButtonCandidate; kind: 'accept_all' | 'accept' | 'acknowledge' }
  | { action: 'settings'; button: ButtonCandidate }
  /** The banner is a settings layer already: select / switch on everything, then save with this button. */
  | { action: 'save'; button: ButtonCandidate }
  | { action: 'none'; reason: string };

/** Never clicked, whatever the label says. */
export function isVetoed(button: ButtonCandidate): boolean {
  return button.navigates || button.cls === 'PAY' || button.cls === 'LOGIN' || button.cls === 'REJECT';
}

/**
 * Maximum-consent decision for a banner's buttons:
 * accept all > accept > acknowledge (OK / got it) > select everything and save (banners that show their
 * categories right away; `hasToggles`: switchable categories) > open the settings > nothing.
 * Paid, login, reject and navigating buttons are removed before anything is chosen.
 */
export function decide(buttons: readonly ButtonCandidate[], hasToggles = false): Decision {
  const allowed = buttons.filter((b) => !isVetoed(b));
  // The most prominent button of a class: call-to-action buttons are large, inline info links small.
  const first = (cls: ButtonCandidate['cls']) =>
    allowed.filter((b) => b.cls === cls).reduce<ButtonCandidate | undefined>((best, b) => (!best || b.area > best.area ? b : best), undefined);

  const acceptAll = first('ACCEPT_ALL');
  if (acceptAll) return { action: 'click', button: acceptAll, kind: 'accept_all' };
  const accept = first('ACCEPT');
  if (accept) return { action: 'click', button: accept, kind: 'accept' };
  const acknowledge = first('ACKNOWLEDGE');
  if (acknowledge) return { action: 'click', button: acknowledge, kind: 'acknowledge' };
  const save = first('SAVE');
  if (save && (hasToggles || first('SELECT_ALL'))) return { action: 'save', button: save };
  const settings = first('SETTINGS');
  if (settings) return { action: 'settings', button: settings };
  return { action: 'none', reason: buttons.length ? 'no accepting button' : 'no buttons' };
}

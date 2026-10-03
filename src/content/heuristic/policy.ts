import type { ButtonCandidate } from './candidates';

export type Decision =
  | { action: 'click'; button: ButtonCandidate; kind: 'accept_all' | 'accept' | 'acknowledge' }
  | { action: 'settings'; button: ButtonCandidate }
  | { action: 'none'; reason: string };

/** Never clicked, whatever the label says. */
export function isVetoed(button: ButtonCandidate): boolean {
  return button.navigates || button.cls === 'PAY' || button.cls === 'LOGIN' || button.cls === 'REJECT';
}

/**
 * Maximum-consent decision for a banner's buttons:
 * accept all > accept > acknowledge (OK / got it) > open the settings > nothing.
 * Paid, login, reject and navigating buttons are removed before anything is chosen.
 */
export function decide(buttons: readonly ButtonCandidate[]): Decision {
  const allowed = buttons.filter((b) => !isVetoed(b));
  const first = (cls: ButtonCandidate['cls']) => allowed.find((b) => b.cls === cls);

  const acceptAll = first('ACCEPT_ALL');
  if (acceptAll) return { action: 'click', button: acceptAll, kind: 'accept_all' };
  const accept = first('ACCEPT');
  if (accept) return { action: 'click', button: accept, kind: 'accept' };
  const acknowledge = first('ACKNOWLEDGE');
  if (acknowledge) return { action: 'click', button: acknowledge, kind: 'acknowledge' };
  const settings = first('SETTINGS');
  if (settings) return { action: 'settings', button: settings };
  return { action: 'none', reason: buttons.length ? 'no accepting button' : 'no buttons' };
}

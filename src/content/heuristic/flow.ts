import { realisticClick, shadowRootOf } from '../dom';
import { findConsentBanners } from './banner';
import { extractButtons, type ButtonCandidate } from './candidates';
import { decide, isVetoed } from './policy';

export interface HeuristicResult {
  done: boolean;
  /** Labels of the clicked buttons, in order. */
  clicked: string[];
  toggled: number;
  /** More toggles than we enable (e.g. long vendor lists) – result may be partial. */
  partial: boolean;
  reason?: string;
}

const MAX_TOGGLES = 80;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toggleElements(root: Element | ShadowRoot, found: HTMLElement[] = []): HTMLElement[] {
  found.push(...Array.from(root.querySelectorAll<HTMLElement>('input[type=checkbox],[role=switch],[role=checkbox]')));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = shadowRootOf(el);
    if (shadow) toggleElements(shadow, found);
  }
  return found;
}

const isOn = (el: HTMLElement) => (el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true');
const isDisabled = (el: HTMLElement) =>
  (el as HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true';

/** Switches every consent toggle on. Toggles that are already on are never touched (on LI tabs that would object). */
export async function enableAllToggles(container: Element): Promise<{ toggled: number; total: number }> {
  const roots: (Element | ShadowRoot)[] = [container];
  const own = shadowRootOf(container);
  if (own) roots.push(own);
  const toggles = [...new Set(roots.flatMap((r) => toggleElements(r)))].filter((t) => !isDisabled(t));
  let toggled = 0;
  for (const toggle of toggles.slice(0, MAX_TOGGLES)) {
    if (isOn(toggle)) continue;
    const label = toggle instanceof HTMLInputElement ? toggle.labels?.[0] : null;
    const target = toggle.getBoundingClientRect().width > 0 ? toggle : (label ?? toggle);
    realisticClick(target);
    await sleep(30);
    if (!isOn(toggle)) toggle.click(); // custom widgets sometimes only react to a plain click
    if (isOn(toggle)) toggled++;
  }
  return { toggled, total: toggles.length };
}

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

function click(button: ButtonCandidate, result: HeuristicResult) {
  realisticClick(button.element);
  result.clicked.push(button.label);
}

/**
 * Gives maximum consent on a banner: click "accept all" / "accept" / "OK"; otherwise open the settings,
 * use "accept all" there, or select / switch on everything and save.
 */
export async function acceptBanner(banner: Element): Promise<HeuristicResult> {
  const result: HeuristicResult = { done: false, clicked: [], toggled: 0, partial: false };
  const decision = decide(extractButtons(banner));
  if (decision.action === 'click') {
    click(decision.button, result);
    result.done = true;
    return result;
  }
  if (decision.action === 'none') {
    result.reason = decision.reason;
    return result;
  }

  // Settings layer: may replace the banner, open a new dialog or expand in place.
  click(decision.button, result);
  await sleep(400);
  const layer =
    (await waitFor(() => {
      const candidates = [banner, ...findConsentBanners().map((b) => b.element)].filter((el) => el.isConnected);
      return candidates.find((el) => extractButtons(el).some((b) => !isVetoed(b) && ['ACCEPT_ALL', 'SAVE', 'SELECT_ALL'].includes(b.cls)));
    }, 3000)) ?? null;
  if (!layer) {
    result.reason = 'settings layer without accept / save button';
    return result;
  }

  const buttons = extractButtons(layer).filter((b) => !isVetoed(b));
  const acceptAll = buttons.find((b) => b.cls === 'ACCEPT_ALL');
  if (acceptAll) {
    click(acceptAll, result);
    result.done = true;
    return result;
  }
  const selectAll = buttons.find((b) => b.cls === 'SELECT_ALL');
  if (selectAll) {
    click(selectAll, result);
    await sleep(300);
  }
  const { toggled, total } = await enableAllToggles(layer);
  result.toggled = toggled;
  result.partial = total > MAX_TOGGLES;

  const save = extractButtons(layer).find((b) => !isVetoed(b) && (b.cls === 'SAVE' || b.cls === 'ACCEPT'));
  if (!save) {
    result.reason = 'no save button';
    return result;
  }
  click(save, result);
  result.done = true;
  return result;
}

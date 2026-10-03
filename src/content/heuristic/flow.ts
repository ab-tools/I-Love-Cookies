import { isOnScreen, realisticClick, shadowRootOf } from '../dom';
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

/** The container has category switches the user could turn on. */
export function hasToggles(container: Element): boolean {
  const roots: (Element | ShadowRoot)[] = [container];
  const own = shadowRootOf(container);
  if (own) roots.push(own);
  return roots.flatMap((r) => toggleElements(r)).some((t) => !isDisabled(t));
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
  const decision = decide(extractButtons(banner), hasToggles(banner));
  if (decision.action === 'save') return selectAllAndSave(banner, result);
  if (decision.action === 'click') {
    click(decision.button, result);
    result.done = true;
    // Not awaited: accepting often removes the frame, which must answer first.
    void confirmFollowUp(banner, decision.button.label);
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

  const acceptAll = extractButtons(layer).find((b) => !isVetoed(b) && b.cls === 'ACCEPT_ALL');
  if (acceptAll) {
    click(acceptAll, result);
    result.done = true;
    return result;
  }
  return selectAllAndSave(layer, result);
}

/**
 * Some banners ask once more after accepting ("… will reload to apply your cookie preferences. OK"): if the
 * banner then only offers a confirming button (no reject), click it.
 */
async function confirmFollowUp(banner: Element, clicked: string): Promise<void> {
  await sleep(800);
  if (!banner.isConnected) return;
  const buttons = extractButtons(banner).filter((b) => !isVetoed(b));
  if (extractButtons(banner).some((b) => b.cls === 'REJECT')) return;
  const confirm = buttons.find((b) => ['ACKNOWLEDGE', 'ACCEPT', 'ACCEPT_ALL'].includes(b.cls) && b.label !== clicked);
  if (confirm) realisticClick(confirm.element);
}

/** Settings layer: "select all" if offered, every category switched on (never off), then save. */
async function selectAllAndSave(layer: Element, result: HeuristicResult): Promise<HeuristicResult> {
  const selectAll = extractButtons(layer).find((b) => !isVetoed(b) && b.cls === 'SELECT_ALL');
  if (selectAll) {
    click(selectAll, result);
    await sleep(300);
  }
  const { toggled, total } = await enableAllToggles(layer);
  result.toggled = toggled;
  result.partial = total > MAX_TOGGLES;

  // "Select all" may relabel or move the save button: look in the layer, then in any consent banner now shown.
  const saveIn = (el: Element) =>
    extractButtons(el).find((b) => !isVetoed(b) && (b.cls === 'ACCEPT_ALL' || b.cls === 'SAVE' || b.cls === 'ACCEPT'));
  let save = (layer.isConnected ? saveIn(layer) : undefined) ?? findConsentBanners().map((b) => saveIn(b.element)).find(Boolean);
  if (!save && layer.isConnected) {
    // Switching categories on can expand texts and push the save button out of view.
    const controls = layer.querySelectorAll<HTMLElement>('button,input[type=submit],input[type=button],[role=button]');
    controls[controls.length - 1]?.scrollIntoView?.({ block: 'center' });
    await sleep(200);
    save = saveIn(layer);
  }
  if (!save) {
    // "Select all" or a switched category answered the banner by itself (it closed): the verifier decides.
    if ((selectAll || toggled > 0) && !(layer.isConnected && isOnScreen(layer))) {
      result.done = true;
      return result;
    }
    result.reason = 'no save button';
    return result;
  }
  click(save, result);
  result.done = true;
  return result;
}

import { isOnScreen, realisticClick, shadowRootOf } from '../dom';
import { findConsentBanners } from './banner';
import { ACCEPT_ALL_NAME, extractButtons, nameOf, type ButtonCandidate } from './candidates';
import { heuristicOptions } from './options';
import { decide, isVetoed } from './policy';
import { ACCEPTING, agreesTo, classifyLabel } from './text';

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
    // "Functional only" is no category to switch on; "I am 18 or older" only with age checks switched on.
    const cls = classifyLabel((label?.innerText ?? toggle.getAttribute('aria-label') ?? '').slice(0, 64));
    if (cls === 'REJECT' || (cls === 'AGE_CONFIRM' && !heuristicOptions.ageGates)) continue;
    const target = toggle.getBoundingClientRect().width > 0 ? toggle : (label ?? toggle);
    await realisticClick(target);
    await sleep(30);
    if (!isOn(toggle)) toggle.click(); // custom widgets sometimes only react to a plain click
    if (isOn(toggle)) toggled++;
  }
  return { toggled, total: toggles.length };
}

/** An accepting button that is disabled (it unlocks once categories are chosen). */
export function lockedAccept(container: Element): boolean {
  const roots: (Element | ShadowRoot)[] = [container];
  const own = shadowRootOf(container);
  if (own) roots.push(own);
  return roots
    .flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>('button[disabled],button[aria-disabled=true],[role=button][aria-disabled=true]')))
    .some((b) => ACCEPTING.has(classifyLabel(b.innerText ?? '')) || ACCEPT_ALL_NAME.test(nameOf(b)));
}

/** The container has category switches the user could turn on. */
export function hasToggles(container: Element): boolean {
  const roots: (Element | ShadowRoot)[] = [container];
  const own = shadowRootOf(container);
  if (own) roots.push(own);
  return roots.flatMap((r) => toggleElements(r)).some((t) => !isDisabled(t));
}

/**
 * Ticks required "I accept the cookie settings" checkboxes (accepting label of their own), without which the
 * accept button does nothing. Category and other checkboxes are left alone.
 */
function consentCheckboxes(container: Element): HTMLElement[] {
  const roots: (Element | ShadowRoot)[] = [container];
  const own = shadowRootOf(container);
  if (own) roots.push(own);
  return roots.flatMap((r) => toggleElements(r)).filter((box) => {
    if (isOn(box) || isDisabled(box)) return false;
    const root = box.getRootNode() as Document | ShadowRoot;
    const label =
      (box instanceof HTMLInputElement ? box.labels?.[0] : null) ??
      (box.id ? root.querySelector<HTMLElement>(`label[for="${CSS.escape(box.id)}"]`) : null) ??
      box.closest('label');
    // Without a <label>: the short text next to the box.
    const nearby = box.parentElement?.innerText ?? '';
    const text = label?.innerText ?? box.getAttribute('aria-label') ?? (nearby.length <= 120 ? nearby : '');
    // "I confirm I am over 18 and accept …" – an age confirmation, when age checks are switched on.
    return agreesTo(text) || (heuristicOptions.ageGates && classifyLabel(text.slice(0, 64)) === 'AGE_CONFIRM');
  });
}

/** An unticked "I accept" checkbox – the answer of banners whose button appears only once it is ticked. */
export function hasConsentCheckbox(container: Element): boolean {
  return consentCheckboxes(container).length > 0;
}

async function tickConsentCheckboxes(container: Element): Promise<void> {
  for (const box of consentCheckboxes(container)) {
    // The box itself: its label often holds links to the policies.
    if (box.getBoundingClientRect().width > 0) await realisticClick(box);
    if (!isOn(box)) box.click();
    await sleep(100);
  }
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

async function click(button: ButtonCandidate, result: HeuristicResult) {
  result.clicked.push(button.label);
  await realisticClick(button.element);
}

/**
 * Gives maximum consent on a banner: click "accept all" / "accept" / "OK"; otherwise open the settings,
 * use "accept all" there, or select / switch on everything and save.
 */
export async function acceptBanner(banner: Element): Promise<HeuristicResult> {
  const result: HeuristicResult = { done: false, clicked: [], toggled: 0, partial: false };
  const initial = extractButtons(banner);
  let decision = decide(initial, hasToggles(banner), lockedAccept(banner));
  // "☐ Accept all" without a visible button: the button appears once the box is ticked.
  if (decision.action === 'none' && hasConsentCheckbox(banner)) {
    await tickConsentCheckboxes(banner);
    await sleep(400);
    decision = decide(extractButtons(banner), false);
  }
  if (decision.action === 'toggles') {
    const { toggled } = await enableAllToggles(banner);
    result.toggled = toggled;
    await sleep(300);
    decision = decide(extractButtons(banner));
  }
  if (decision.action === 'save') return selectAllAndSave(banner, result);
  if (decision.action === 'click') {
    // Categories shown as checkboxes next to the buttons: all switched on before accepting.
    if ((decision.kind === 'accept_all' || decision.kind === 'accept') && hasToggles(banner)) result.toggled += (await enableAllToggles(banner)).toggled;
    await tickConsentCheckboxes(banner);
    await click(decision.button, result);
    result.done = true;
    // Not awaited: accepting often removes the frame, which must answer first.
    void confirmFollowUp(banner, decision.button, new Set(initial.map((b) => b.label)));
    return result;
  }
  if (decision.action === 'none' || decision.action === 'toggles') {
    result.reason = decision.action === 'none' ? decision.reason : 'accept button stays locked';
    return result;
  }

  // Settings layer: may replace the banner, open a new dialog or expand in place.
  await click(decision.button, result);
  await sleep(400);
  const layer =
    (await waitFor(() => {
      const candidates = [banner, ...findConsentBanners().map((b) => b.element)].filter((el) => el.isConnected);
      return candidates.find((el) => extractButtons(el).some((b) => !isVetoed(b) && ['ACCEPT_ALL', 'SAVE', 'SELECT_ALL'].includes(b.cls)));
    }, 3000)) ?? null;
  if (!layer) {
    // A notice whose "settings" only explain ("More information") but that can be closed ("Hide").
    const close = initial.find((b) => !isVetoed(b) && b.cls === 'CLOSE' && b.element.isConnected && isOnScreen(b.element));
    if (close) {
      await click(close, result);
      result.done = true;
      return result;
    }
    result.reason = 'settings layer without accept / save button';
    return result;
  }

  const acceptAll = extractButtons(layer).find((b) => !isVetoed(b) && b.cls === 'ACCEPT_ALL');
  if (acceptAll) {
    await click(acceptAll, result);
    result.done = true;
    return result;
  }
  return selectAllAndSave(layer, result);
}

/**
 * Some banners need a second step after accepting: a confirmation ("… will reload to apply your cookie
 * preferences. OK"), an "accept all" the first click unlocked, or – where "accept all" only switched every
 * purpose on in a preferences dialog – saving.
 */
async function confirmFollowUp(
  banner: Element,
  clicked: ButtonCandidate,
  before: ReadonlySet<string>,
  step = 1,
  textBefore = (banner as HTMLElement).innerText ?? '',
): Promise<void> {
  await sleep(800);
  if (!banner.isConnected || !isOnScreen(banner)) return;
  const all = extractButtons(banner);
  const buttons = all.filter((b) => !isVetoed(b));
  // An answer that only appeared through the click: "accept all" enabled after "read more", or the next step
  // of a banner that asks one category at a time ("Performance cookies? Disable | Sounds good" – the same
  // buttons with a new text).
  const text = (banner as HTMLElement).innerText ?? '';
  const nextStep = (b: ButtonCandidate) => (b.cls === 'ACCEPT' || b.cls === 'ACKNOWLEDGE') && (!before.has(b.label) || text !== textBefore);
  const unlocked = buttons.find((b) => b.cls === 'ACCEPT_ALL' && !before.has(b.label)) ?? (step < 6 ? buttons.find(nextStep) : undefined);
  if (unlocked) {
    await realisticClick(unlocked.element);
    if (unlocked.cls !== 'ACCEPT_ALL') await confirmFollowUp(banner, unlocked, new Set([...before, ...all.map((b) => b.label)]), step + 1, text);
    return;
  }
  const save = clicked.cls === 'ACCEPT_ALL' || clicked.cls === 'SELECT_ALL' ? buttons.find((b) => b.cls === 'SAVE') : undefined;
  if (save) {
    void realisticClick(save.element);
    return;
  }
  // Toggle buttons per category: the clicked "Accept …" now reads "Reject …". Switch the other categories on the
  // same way, then close / save the dialog.
  if (ACCEPTING.has(clicked.cls) && all.some((b) => b.element === clicked.element && b.cls === 'REJECT')) {
    for (const other of buttons.filter((b) => b.element !== clicked.element && (b.cls === 'ACCEPT' || b.cls === 'ACCEPT_ALL'))) {
      await realisticClick(other.element);
      await sleep(300);
    }
    const done = extractButtons(banner).find((b) => !isVetoed(b) && ['SAVE', 'ACKNOWLEDGE', 'CLOSE'].includes(b.cls));
    if (done) await realisticClick(done.element);
    return;
  }
  // A category's "Allow" did not close the notice: finish with its save / close button ("Close this notice –
  // I hereby allow the use of data for all purposes").
  if (clicked.cls === 'ACCEPT') {
    const finish = buttons.find((b) => b.cls === 'SAVE') ?? buttons.find((b) => b.cls === 'CLOSE');
    if (finish) {
      void realisticClick(finish.element);
      return;
    }
  }
  if (all.some((b) => b.cls === 'REJECT')) return;
  const confirming = heuristicOptions.ageGates ? ['ACKNOWLEDGE', 'ACCEPT', 'ACCEPT_ALL', 'AGE_CONFIRM'] : ['ACKNOWLEDGE', 'ACCEPT', 'ACCEPT_ALL'];
  const confirm = buttons.find((b) => confirming.includes(b.cls) && b.label !== clicked.label);
  if (confirm) void realisticClick(confirm.element);
}

/** Settings layer: "select all" if offered, every category switched on (never off), then save. */
async function selectAllAndSave(layer: Element, result: HeuristicResult): Promise<HeuristicResult> {
  const selectAll = extractButtons(layer).find((b) => !isVetoed(b) && b.cls === 'SELECT_ALL');
  if (selectAll) {
    await click(selectAll, result);
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
  await click(save, result);
  result.done = true;
  return result;
}

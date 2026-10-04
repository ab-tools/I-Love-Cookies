import { browser } from 'wxt/browser';
import type { FrameInfo } from '../content/frames';

/**
 * Real mouse clicks for pages that ignore synthetic events: input sent through the browser's debugger interface
 * (Chromium only). The debugger stays attached for one generic run and is detached afterwards.
 */
interface Debuggee {
  tabId: number;
}
interface DebuggerApi {
  attach(target: Debuggee, version: string): Promise<void>;
  detach(target: Debuggee): Promise<void>;
  sendCommand(target: Debuggee, method: string, params?: object): Promise<unknown>;
}

const DETACH_AFTER_MS = 30000;
/** The infobar a new debugger session shows resizes the viewport: let the layout settle before measuring. */
const SETTLE_MS = 600;

const sessions = new Map<number, ReturnType<typeof setTimeout>>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function api(): DebuggerApi | null {
  return ((browser as unknown as { debugger?: DebuggerApi }).debugger ?? null) as DebuggerApi | null;
}

export function trustedClicksAvailable(): boolean {
  return api() !== null;
}

/** Attaches the debugger to the tab (until detachDebugger or a timeout). */
export async function attachDebugger(tabId: number): Promise<boolean> {
  const dbg = api();
  if (!dbg) return false;
  const attached = sessions.has(tabId);
  if (!attached) {
    try {
      await dbg.attach({ tabId }, '1.3');
    } catch {
      return false;
    }
  }
  clearTimeout(sessions.get(tabId));
  sessions.set(tabId, setTimeout(() => void detachDebugger(tabId), DETACH_AFTER_MS));
  if (!attached) await sleep(SETTLE_MS);
  return true;
}

export async function detachDebugger(tabId: number): Promise<void> {
  if (!sessions.has(tabId)) return;
  clearTimeout(sessions.get(tabId));
  sessions.delete(tabId);
  await api()?.detach({ tabId }).catch(() => undefined);
}

/** Position of a frame's viewport in the tab's viewport: the offsets of the <iframe> elements up to the top. */
async function frameOffset(
  tabId: number,
  frameId: number,
  locate: (tabId: number, frameId: number, parentFrameId: number) => Promise<FrameInfo | null>,
): Promise<{ x: number; y: number } | null> {
  let x = 0;
  let y = 0;
  for (let id = frameId, depth = 0; id !== 0; depth++) {
    if (depth > 4) return null;
    const frame = await browser.webNavigation.getFrame({ tabId, frameId: id }).catch(() => null);
    if (!frame || frame.parentFrameId < 0) return null;
    const info = await locate(tabId, id, frame.parentFrameId);
    if (!info) return null;
    x += info.left;
    y += info.top;
    id = frame.parentFrameId;
  }
  return { x, y };
}

/**
 * Clicks at a position in a frame's viewport (CSS pixels). locate finds the <iframe> of a frame in its parent.
 * The tab must be attached (attachDebugger).
 */
export async function trustedClick(
  tabId: number,
  frameId: number,
  x: number,
  y: number,
  locate: (tabId: number, frameId: number, parentFrameId: number) => Promise<FrameInfo | null>,
): Promise<boolean> {
  const dbg = api();
  if (!dbg || !sessions.has(tabId)) return false;
  const offset = frameId === 0 ? { x: 0, y: 0 } : await frameOffset(tabId, frameId, locate);
  if (!offset) return false;
  // Input coordinates are in device-independent pixels: CSS pixels times the page zoom.
  const zoom = await browser.tabs.getZoom(tabId).catch(() => 1);
  const at = { x: (x + offset.x) * zoom, y: (y + offset.y) * zoom };
  try {
    await dbg.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    await dbg.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
    await dbg.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
    return true;
  } catch {
    return false;
  }
}

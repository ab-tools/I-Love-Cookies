// autoconsent from its TS sources, so its snippet registry can be extended.
import AutoConsent from '@autoconsent-src/web';
import { snippets } from '@autoconsent-src/eval-snippets';
import type { BackgroundMessage, ContentScriptMessage } from '@duckduckgo/autoconsent';
import { ilcSnippets } from '../background/snippets';
import { browser } from 'wxt/browser';
import type { FrameVerification, IlcContentMessage } from '../shared/messages';
import { isScrollLocked } from '../content/scroll';
import { clickDeep, isDeepVisible, isOnScreen } from '../content/dom';

/**
 * Runs in every frame at document_start (isolated world).
 * autoconsent only *detects* here (autoAction=null); the background decides what to do and sends `optIn`.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main() {
    // Lets rule eval steps use our snippet IDs; they are executed by the background.
    Object.assign(snippets, ilcSnippets);

    const consent = new AutoConsent(async (message: ContentScriptMessage) => {
      try {
        await browser.runtime.sendMessage(message);
      } catch {
        // background restarting or extension reloaded – autoconsent retries where needed
      }
    });

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as IlcContentMessage | { type?: string };
      if (msg?.type === 'ilc:verify') {
        verifyFrame(consent, (msg as Extract<IlcContentMessage, { type: 'ilc:verify' }>).acceptButton).then(sendResponse, () =>
          sendResponse(null),
        );
        return true;
      }
      if (msg?.type === 'ilc:click') {
        sendResponse(clickDeep((msg as Extract<IlcContentMessage, { type: 'ilc:click' }>).chain));
        return false;
      }
      if (typeof msg?.type === 'string' && !msg.type.startsWith('ilc:')) {
        void consent.receiveMessageCallback(message as BackgroundMessage);
      }
      return false;
    });

    // Test-only bridge for WebDriver-based E2E tests (Firefox), compiled in only with `wxt build --mode e2e`.
    if (import.meta.env.MODE === 'e2e' && window === window.top) {
      window.addEventListener('message', async (event) => {
        if (event.source !== window || typeof event.data?.ilcE2E !== 'string') return;
        const result = await browser.runtime.sendMessage({ type: 'ilc:e2e', action: event.data.ilcE2E });
        window.postMessage({ ilcE2EResult: result }, '*');
      });
    }
  },
});

async function verifyFrame(consent: AutoConsent, acceptButton?: readonly string[]): Promise<FrameVerification> {
  const cmp = consent.foundCmp;
  let popupVisible: boolean | null = null;
  if (cmp) {
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000));
    popupVisible = await Promise.race([cmp.detectPopup().catch(() => false), timeout]);
  }
  // The CMP's own dialog container (its prehide selectors) or known accept button still on screen.
  const popupOnScreen =
    (acceptButton !== undefined && isDeepVisible(acceptButton)) ||
    (cmp?.prehideSelectors ?? []).some((selector) => {
      try {
        return Array.from(document.querySelectorAll(selector)).some(isOnScreen);
      } catch {
        return false;
      }
    });
  return { popupVisible, popupOnScreen, scrollLocked: isScrollLocked(), url: location.href };
}

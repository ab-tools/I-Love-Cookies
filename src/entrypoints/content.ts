// autoconsent from its TS sources, so its snippet registry can be extended.
import AutoConsent from '@autoconsent-src/web';
import { snippets } from '@autoconsent-src/eval-snippets';
import type { BackgroundMessage, Config, ContentScriptMessage, RuleBundle } from '@duckduckgo/autoconsent';
import { ilcSnippets } from '../background/snippets';
import { browser } from 'wxt/browser';
import type { FrameVerification, IlcContentMessage } from '../shared/messages';
import { isScrollLocked, unlockScroll } from '../content/scroll';
import { clickDeepUntilGone, isDeepVisible, isOnScreen } from '../content/dom';
import { ConsentOMaticCMP, type ComRule } from '../content/consent-o-matic';
import { HeuristicController } from '../content/heuristic/controller';
import { announceFrame, frameInfo, listenForFrameTokens } from '../content/frames';
import { bannerElement, collectFrameSnapshot, offersPaidOption } from '../content/report-snapshot';

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

    const send = async (message: unknown) => {
      try {
        await browser.runtime.sendMessage(message);
      } catch {
        // background restarting or extension reloaded – autoconsent retries where needed
      }
    };
    const heuristic: HeuristicController = new HeuristicController(
      (message) => void send(message),
      (): boolean => consent.state.detectedPopups.length > 0,
    );
    const consent: IlcAutoConsent = new IlcAutoConsent(send, heuristic);

    listenForFrameTokens();

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as IlcContentMessage | { type?: string };
      if (msg?.type === 'ilc:verify') {
        verifyFrame(consent, heuristic, msg as Extract<IlcContentMessage, { type: 'ilc:verify' }>).then(sendResponse, () =>
          sendResponse(null),
        );
        return true;
      }
      if (msg?.type === 'ilc:optIn') {
        void consent.optInWith((msg as Extract<IlcContentMessage, { type: 'ilc:optIn' }>).cmp);
        return false;
      }
      if (msg?.type === 'ilc:announceFrame') {
        announceFrame((msg as Extract<IlcContentMessage, { type: 'ilc:announceFrame' }>).token);
        return false;
      }
      if (msg?.type === 'ilc:frameInfo') {
        sendResponse(frameInfo((msg as Extract<IlcContentMessage, { type: 'ilc:frameInfo' }>).token));
        return false;
      }
      if (msg?.type === 'ilc:unlockScroll') {
        sendResponse(unlockScroll());
        return false;
      }
      if (msg?.type === 'ilc:rescan') {
        heuristic.rescan();
        return false;
      }
      if (msg?.type === 'ilc:heuristicScan') {
        sendResponse(heuristic.scan());
        return false;
      }
      if (msg?.type === 'ilc:heuristicAct') {
        heuristic.act().then(sendResponse, (error: unknown) => sendResponse({ done: false, clicked: [], toggled: 0, partial: false, reason: String(error) }));
        return true;
      }
      if (msg?.type === 'ilc:reportSnapshot') {
        sendResponse(
          collectFrameSnapshot({
            cmps: consent.state.detectedCmps,
            popups: consent.state.detectedPopups,
            cmpContainers: consent.rules.filter((r) => consent.state.detectedCmps.includes(r.name)).flatMap((r) => r.prehideSelectors ?? []),
            knownBanner: heuristic.lastBanner,
          }),
        );
        return false;
      }
      if (msg?.type === 'ilc:payOrOkCheck') {
        const { cmp, heuristic: generic } = msg as Extract<IlcContentMessage, { type: 'ilc:payOrOkCheck' }>;
        const containers = cmp ? (consent.rules.find((r) => r.name === cmp)?.prehideSelectors ?? []) : [];
        const banner = generic && heuristic.lastBanner?.isConnected ? heuristic.lastBanner : bannerElement(containers, heuristic.lastBanner);
        sendResponse(offersPaidOption(banner));
        return false;
      }
      if (msg?.type === 'ilc:click') {
        clickDeepUntilGone((msg as Extract<IlcContentMessage, { type: 'ilc:click' }>).chain).then(sendResponse, () => sendResponse(false));
        return true;
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

/** autoconsent plus Consent-O-Matic rules and the generic heuristic (both only when enabled). */
class IlcAutoConsent extends AutoConsent {
  constructor(
    send: (message: ContentScriptMessage) => Promise<void>,
    private readonly heuristic: HeuristicController,
  ) {
    super(send);
  }

  override parseDeclarativeRules(bundle: RuleBundle & { consentOMatic?: ComRule[] }) {
    super.parseDeclarativeRules(bundle);
    for (const rule of bundle.consentOMatic ?? []) this.rules.push(new ConsentOMaticCMP(rule));
  }

  /** autoconsent keeps only the last found CMP; several rules may match one popup – use the named one. */
  async optInWith(name: string) {
    const cmp = this.rules.find((rule) => rule.name === name);
    if (cmp) this.foundCmp = cmp;
    return this.doOptIn();
  }

  cmpNamed(name: string | undefined) {
    return (name && this.rules.find((rule) => rule.name === name)) || this.foundCmp;
  }

  override initialize(config: Partial<Config>, declarativeRules: RuleBundle | null) {
    super.initialize(config, declarativeRules);
    if (config.enabled) this.heuristic.start();
  }
}

async function verifyFrame(
  consent: IlcAutoConsent,
  heuristic: HeuristicController,
  { cmp: cmpName, acceptButton, heuristic: byHeuristic }: Extract<IlcContentMessage, { type: 'ilc:verify' }>,
): Promise<FrameVerification> {
  if (byHeuristic) {
    const onScreen = heuristic.bannerOnScreen();
    return { popupVisible: onScreen, popupOnScreen: onScreen === true, popupCheckable: onScreen !== null, scrollLocked: isScrollLocked(), url: location.href };
  }
  const cmp = consent.cmpNamed(cmpName);
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
  const popupCheckable = acceptButton !== undefined || (cmp?.prehideSelectors ?? []).length > 0;
  return { popupVisible, popupOnScreen, popupCheckable, scrollLocked: isScrollLocked(), url: location.href };
}

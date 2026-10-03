import { isOnScreen } from '../dom';
import { findConsentBanners } from './banner';
import { extractButtons } from './candidates';
import { acceptBanner, type HeuristicResult } from './flow';
import { decide } from './policy';

export interface HeuristicScan {
  score: number;
  area: number;
  fingerprint: string;
  /** Up to 10 "CLASS:label" entries for logs and reports. */
  buttons: string[];
  decision: 'click' | 'settings' | 'none';
  top: boolean;
}

/** Scan schedule after load; banners usually appear within a few seconds, lazy ones on first interaction. */
const SCAN_DELAYS_MS = [2500, 5000, 9000, 15000, 25000];
const MIN_FRAME = { width: 300, height: 150 };

function fingerprint(el: Element): string {
  return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '');
}

/** Generic banner handling in one frame: finds banners no rule handles, acts when the background says so. */
export class HeuristicController {
  private banner: Element | null = null;
  private readonly reported = new Set<string>();
  private userDecided = false;

  constructor(
    private readonly report: (message: { type: string } & Record<string, unknown>) => void,
    private readonly cmpPopupFound: () => boolean,
  ) {}

  start() {
    const begin = () => {
      for (const delay of SCAN_DELAYS_MS) setTimeout(() => this.autoReport(), delay);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
    else begin();
    // A real user click inside the banner: the user decides, we stay out.
    document.addEventListener(
      'click',
      (event) => {
        if (!event.isTrusted || !this.banner || this.userDecided) return;
        if (event.composedPath().includes(this.banner)) {
          this.userDecided = true;
          this.report({ type: 'ilc:userDecided' });
        }
      },
      true,
    );
  }

  scan(): HeuristicScan | null {
    if (window.innerWidth < MIN_FRAME.width || window.innerHeight < MIN_FRAME.height) return null;
    const [banner] = findConsentBanners();
    if (!banner) return null;
    this.banner = banner.element;
    const buttons = extractButtons(banner.element);
    return {
      score: banner.score,
      area: Math.round(banner.area * 100) / 100,
      fingerprint: fingerprint(banner.element),
      buttons: buttons.slice(0, 10).map((b) => `${b.cls}:${b.label}`.slice(0, 60)),
      decision: decide(buttons).action,
      top: window === window.top,
    };
  }

  private autoReport() {
    if (this.userDecided || this.cmpPopupFound()) return;
    const scan = this.scan();
    if (!scan || scan.decision === 'none' || this.reported.has(scan.fingerprint)) return;
    this.reported.add(scan.fingerprint);
    this.report({ type: 'ilc:heuristicFound', ...scan });
  }

  async act(): Promise<HeuristicResult> {
    if (this.userDecided) return { done: false, clicked: [], toggled: 0, partial: false, reason: 'user decided' };
    if (!this.banner?.isConnected) this.scan();
    if (!this.banner) return { done: false, clicked: [], toggled: 0, partial: false, reason: 'banner gone' };
    return acceptBanner(this.banner);
  }

  /** null if this frame never had a heuristic banner. Containers often stay in the page empty, so the banner
   * counts as shown only while it still has visible, clickable buttons. */
  bannerOnScreen(): boolean | null {
    if (!this.banner) return null;
    return this.banner.isConnected && isOnScreen(this.banner) && extractButtons(this.banner).length > 0;
  }
}

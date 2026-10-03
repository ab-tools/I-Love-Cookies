import { browser } from 'wxt/browser';
import type { Strategy } from '../shared/messages';
import type { ilcSnippets } from './snippets';
import measured from './strategy-data.json';

export type ApiSnippetId = Extract<keyof typeof ilcSnippets, `ILC_API_${string}`>;

/**
 * Per-CMP strategy, keyed by autoconsent CMP name. Default: autoconsent's opt-in rule.
 * `api` (the CMP's accept-all JavaScript call) is the fallback when the rule fails or the popup stays open.
 * strategy-data.json (measured on real sites) makes the API primary
 * where it measured clearly better than the rule.
 */
export interface CmpStrategy {
  primary: Strategy;
  api?: ApiSnippetId;
  /** "Accept all" button as selector chain through shadow roots (strategy 'click'); also used to verify the UI closed. */
  acceptButton?: readonly string[];
}

const withApi = (id: ApiSnippetId): CmpStrategy => ({ primary: 'rule', api: id });

const USERCENTRICS_ACCEPT = [
  '#usercentrics-cmp-ui, #usercentrics-root',
  'button[data-action-type="accept"], button[data-testid="uc-accept-all-button"]',
];

export const CMP_STRATEGIES: Record<string, CmpStrategy> = {
  Onetrust: withApi('ILC_API_ONETRUST'),
  // Current Cookiebot dialog ("Alle zulassen"); older variants fall back to the rule.
  Cybotcookiebot: { primary: 'click', api: 'ILC_API_COOKIEBOT', acceptButton: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll'] },
  'cookiebot.be': withApi('ILC_API_COOKIEBOT'),
  // Accept button in Usercentrics' shadow DOM (v3 and v2 UI).
  'usercentrics-api': { primary: 'click', api: 'ILC_API_USERCENTRICS', acceptButton: USERCENTRICS_ACCEPT },
  'usercentrics-button': { primary: 'click', api: 'ILC_API_USERCENTRICS', acceptButton: USERCENTRICS_ACCEPT },
  didomi: withApi('ILC_API_DIDOMI'),
  'consentmanager.net': withApi('ILC_API_CONSENTMANAGER'),
  // Its rule only saves the default selection; the banner's own "Accept" button accepts everything.
  'consentmanager-ncmp': {
    primary: 'click',
    api: 'ILC_API_CONSENTMANAGER',
    acceptButton: ['#ncmp__tool .ncmp__banner-btns button.ncmp__btn:not(.ncmp__btn-border)'],
  },
  'Complianz banner': withApi('ILC_API_COMPLIANZ'),
  'Complianz categories': withApi('ILC_API_COMPLIANZ'),
  'Complianz optin': withApi('ILC_API_COMPLIANZ'),
  'Complianz opt-out': withApi('ILC_API_COMPLIANZ'),
  cookieyes: withApi('ILC_API_COOKIEYES'),
  iubenda: withApi('ILC_API_IUBENDA'),
  'iubenda-rti': withApi('ILC_API_IUBENDA'),
  // Buttons live in nested *closed* shadow roots; the API alone stores consent but leaves the banner open.
  'ilc-iubenda-teamblue': {
    primary: 'click',
    api: 'ILC_API_IUBENDA',
    acceptButton: ['tb-banner-wrapper', 'tb-banner-footer', 'tb-action-button', 'button.accept-button'],
  },
  Klaro: withApi('ILC_API_KLARO'),
  cookiehub: withApi('ILC_API_COOKIEHUB'),
  'civic-cookie-control': withApi('ILC_API_CIVIC'),
  'cookiefirst.com': withApi('ILC_API_COOKIEFIRST'),
  shopify: withApi('ILC_API_SHOPIFY'),
};

interface MeasuredStrategy {
  primary: Strategy;
}
const MEASURED = (measured as { strategies: Record<string, MeasuredStrategy> }).strategies;

export function strategyFor(cmp: string): CmpStrategy {
  const base = CMP_STRATEGIES[cmp] ?? { primary: 'rule' };
  return MEASURED[cmp]?.primary === 'api' && base.api ? { ...base, primary: 'api' } : base;
}

/**
 * Strategy actually used. E2E builds can force one strategy for measurements
 * ('rule' = rule only without API fallback, 'api' = API first).
 */
export async function effectiveStrategy(cmp: string): Promise<CmpStrategy> {
  const strategy = strategyFor(cmp);
  if (import.meta.env.MODE !== 'e2e') return strategy;
  const { e2eForceStrategy } = await browser.storage.local.get('e2eForceStrategy');
  if (e2eForceStrategy === 'rule') return { primary: 'rule' };
  if (e2eForceStrategy === 'api' && strategy.api) return { ...strategy, primary: 'api' };
  return strategy;
}

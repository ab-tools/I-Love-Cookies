import type { Strategy } from '../shared/messages';
import type { ilcSnippets } from './snippets';

export type ApiSnippetId = Extract<keyof typeof ilcSnippets, `ILC_API_${string}`>;

/**
 * Per-CMP strategy, keyed by autoconsent CMP name. Default: autoconsent's opt-in rule.
 * `api` (the CMP's accept-all JavaScript call) is the fallback when the rule fails or the popup stays open.
 */
export interface CmpStrategy {
  primary: Strategy;
  api?: ApiSnippetId;
  /** Shadow-DOM selector chain of the "accept all" button (strategy 'shadow'); also used to verify the UI closed. */
  shadowAccept?: readonly string[];
}

const withApi = (id: ApiSnippetId): CmpStrategy => ({ primary: 'rule', api: id });

export const CMP_STRATEGIES: Record<string, CmpStrategy> = {
  Onetrust: withApi('ILC_API_ONETRUST'),
  Cybotcookiebot: withApi('ILC_API_COOKIEBOT'),
  'cookiebot.be': withApi('ILC_API_COOKIEBOT'),
  'usercentrics-api': withApi('ILC_API_USERCENTRICS'),
  'usercentrics-button': withApi('ILC_API_USERCENTRICS'),
  didomi: withApi('ILC_API_DIDOMI'),
  'consentmanager.net': withApi('ILC_API_CONSENTMANAGER'),
  'consentmanager-ncmp': withApi('ILC_API_CONSENTMANAGER'),
  'Complianz banner': withApi('ILC_API_COMPLIANZ'),
  'Complianz categories': withApi('ILC_API_COMPLIANZ'),
  'Complianz optin': withApi('ILC_API_COMPLIANZ'),
  'Complianz opt-out': withApi('ILC_API_COMPLIANZ'),
  cookieyes: withApi('ILC_API_COOKIEYES'),
  iubenda: withApi('ILC_API_IUBENDA'),
  'iubenda-rti': withApi('ILC_API_IUBENDA'),
  // Buttons live in nested *closed* shadow roots; the API alone stores consent but leaves the banner open.
  'ilc-iubenda-teamblue': {
    primary: 'shadow',
    api: 'ILC_API_IUBENDA',
    shadowAccept: ['tb-banner-wrapper', 'tb-banner-footer', 'tb-action-button', 'button.accept-button'],
  },
  Klaro: withApi('ILC_API_KLARO'),
  cookiehub: withApi('ILC_API_COOKIEHUB'),
  'civic-cookie-control': withApi('ILC_API_CIVIC'),
  'cookiefirst.com': withApi('ILC_API_COOKIEFIRST'),
  shopify: withApi('ILC_API_SHOPIFY'),
};

export function strategyFor(cmp: string): CmpStrategy {
  return CMP_STRATEGIES[cmp] ?? { primary: 'rule' };
}

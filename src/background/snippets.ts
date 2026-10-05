// @ts-nocheck – page globals (OneTrust, Cookiebot, __tcfapi, …) are untyped by nature.
/**
 * Functions run in the page's MAIN world via scripting.executeScript. They are serialised, so each one
 * must be self-contained (no imports, no module-level references). Rules reference them by ID.
 */
import { snippets as autoconsentSnippets } from '@autoconsent-src/eval-snippets';

/** Current dataLayer length – Consent Mode updates after this mark are reactions to our action. */
function markConsentSignals() {
  return Array.isArray(window.dataLayer) ? window.dataLayer.length : 0;
}

/**
 * Reads IAB TCF v2 + Google Consent Mode state. Never modifies anything. Returns ConsentSignals.
 * Consent Mode: only `update` commands pushed after `mark` (sites also push their stored state on load).
 */
function readConsentSignals(mark = 0) {
  const readGcm = () => {
    const dl = window.dataLayer;
    if (!Array.isArray(dl)) return null;
    // gtag() pushes `arguments` objects: ['consent', 'default' | 'update', {...}]
    const isConsent = (entry, command) =>
      entry && typeof entry === 'object' && entry[0] === 'consent' && entry[1] === command && entry[2] && typeof entry[2] === 'object';
    const merge = (target, entry) => {
      for (const key of Object.keys(entry[2])) if (typeof entry[2][key] === 'string') target[key] = entry[2][key];
    };
    // State before our action (defaults and earlier updates) …
    const before = {};
    for (const entry of dl.slice(0, mark)) if (isConsent(entry, 'default') || isConsent(entry, 'update')) merge(before, entry);
    // … and the user's choice: `update` commands after it. Types a site never updates keep its own defaults.
    const values = {};
    for (const entry of dl.slice(mark)) if (isConsent(entry, 'update')) merge(values, entry);
    const keys = Object.keys(values);
    // Sites that only restate their unchanged state (and apply consent on the next page load) say nothing.
    if (!keys.length || keys.every((key) => before[key] === values[key])) return null;
    return { updated: true, values };
  };
  const readTcf = () =>
    new Promise((resolve) => {
      if (typeof window.__tcfapi !== 'function') {
        resolve(null);
        return;
      }
      let finished = false;
      const finish = (value) => {
        if (!finished) {
          finished = true;
          resolve(value);
        }
      };
      setTimeout(() => finish(null), 1500);
      try {
        window.__tcfapi('addEventListener', 2, (tcData, success) => {
          if (!success || !tcData || finished) return;
          if (tcData.eventStatus === 'cmpuishown') return; // user has not decided yet
          try {
            window.__tcfapi('removeEventListener', 2, () => {}, tcData.listenerId);
          } catch (e) {
            /* ignore */
          }
          const consents = (tcData.purpose && tcData.purpose.consents) || {};
          const ids = Object.keys(consents);
          finish({
            eventStatus: tcData.eventStatus,
            gdprApplies: tcData.gdprApplies,
            purposesTotal: ids.length,
            purposesConsented: ids.filter((id) => consents[id]).length,
            storageConsented: Boolean(consents['1']),
            vendorsConsented: Object.values((tcData.vendor && tcData.vendor.consents) || {}).filter(Boolean).length,
          });
        });
      } catch (e) {
        finish(null);
      }
    });
  return readTcf().then((tcf) => ({ tcf, gcm: readGcm() }));
}

/* Documented "accept all" APIs of consent management platforms. Return true if the API was called. */
function apiOneTrust() {
  if (window.OneTrust && typeof window.OneTrust.AllowAll === 'function') {
    window.OneTrust.AllowAll();
    return true;
  }
  return false;
}
function apiCookiebot() {
  const cb = window.Cookiebot || window.CookieConsent;
  if (cb && typeof cb.submitCustomConsent === 'function') {
    cb.submitCustomConsent(true, true, true);
    if (typeof cb.hide === 'function') cb.hide();
    return true;
  }
  return false;
}
async function apiUsercentrics() {
  if (window.__ucCmp && typeof window.__ucCmp.acceptAllConsents === 'function') {
    if (typeof window.__ucCmp.isInitialized === 'function' && !(await window.__ucCmp.isInitialized())) return false;
    await window.__ucCmp.acceptAllConsents();
    if (typeof window.__ucCmp.saveConsents === 'function') await window.__ucCmp.saveConsents();
    if (typeof window.__ucCmp.closeCmp === 'function') await window.__ucCmp.closeCmp();
    return true;
  }
  if (window.UC_UI && typeof window.UC_UI.acceptAllConsents === 'function') {
    if (typeof window.UC_UI.isInitialized === 'function' && !window.UC_UI.isInitialized()) return false;
    await window.UC_UI.acceptAllConsents();
    if (typeof window.UC_UI.closeCMP === 'function') window.UC_UI.closeCMP();
    return true;
  }
  return false;
}
function apiDidomi() {
  if (!window.Didomi && !window.didomiOnReady) return false;
  // didomiOnReady runs the callback once the SDK is ready (immediately if it already is).
  return new Promise((resolve) => {
    window.didomiOnReady = window.didomiOnReady || [];
    window.didomiOnReady.push((didomi) => {
      didomi.setUserAgreeToAll();
      resolve(true);
    });
    setTimeout(() => resolve(false), 900);
  });
}
function apiConsentmanager() {
  if (typeof window.__cmp === 'function') {
    window.__cmp('setConsent', 1);
    return true;
  }
  return false;
}
function apiComplianz() {
  if (typeof window.cmplz_accept_all === 'function') {
    window.cmplz_accept_all();
    return true;
  }
  return false;
}
function apiCookieYes() {
  if (typeof window.performBannerAction === 'function') {
    window.performBannerAction('accept_all');
    return true;
  }
  return false;
}
function apiIubenda() {
  if (window._iub && window._iub.cs && window._iub.cs.api && typeof window._iub.cs.api.acceptAll === 'function') {
    window._iub.cs.api.acceptAll();
    return true;
  }
  return false;
}
/** iubenda: true while the user has not decided yet (used to detect banners rendered in closed shadow DOM). */
// Must answer quickly: autoconsent gives eval snippets only 1 s. The rule waits for the lazy API instead.
function iubendaNeedsConsent() {
  const api = window._iub && window._iub.cs && window._iub.cs.api;
  return Boolean(api && typeof api.isConsentGiven === 'function' && !api.isConsentGiven());
}
/** Civic keeps its notice and panel as fixed elements just outside the viewport after consent. */
function civicPopupShown() {
  return ['#ccc-notify', '#ccc-module'].some((sel) => {
    const el = document.querySelector(sel);
    if (!el || getComputedStyle(el).display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  });
}
function apiKlaro() {
  if (window.klaro && typeof window.klaro.getManager === 'function') {
    const manager = window.klaro.getManager();
    manager.changeAll(true);
    manager.saveAndApplyConsents();
    return true;
  }
  return false;
}
function apiCookieHub() {
  if (window.cookiehub && typeof window.cookiehub.allowAll === 'function') {
    window.cookiehub.allowAll();
    return true;
  }
  return false;
}
function apiCivic() {
  if (window.CookieControl && typeof window.CookieControl.acceptAll === 'function') {
    window.CookieControl.acceptAll();
    return true;
  }
  return false;
}
function apiCookieFirst() {
  if (window.CookieFirst && typeof window.CookieFirst.acceptAllCategories === 'function') {
    window.CookieFirst.acceptAllCategories();
    return true;
  }
  return false;
}
function apiShopify() {
  const cp = window.Shopify && window.Shopify.customerPrivacy;
  if (cp && typeof cp.setTrackingConsent === 'function') {
    return new Promise((resolve) => {
      cp.setTrackingConsent({ analytics: true, marketing: true, preferences: true, sale_of_data: true }, () => resolve(true));
      setTimeout(() => resolve(true), 2000);
    });
  }
  return false;
}

/** CCM19: its consent buttons ignore synthetic mouse clicks; a plain click event runs the button's own handler. */
function acceptCcm19() {
  const button = document.querySelector('#ccm-widget .ccm--save-settings[data-full-consent="true"]');
  if (!button) return false;
  button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  return true;
}

/**
 * Google Funding Choices notice for legitimate interest only (floating "Privacy and cookie settings" panel in a
 * shadow root, no consent button): opens the data preferences, where "accept all" is offered.
 */
function openFundingChoicesPreferences() {
  for (const host of Array.from(document.querySelectorAll('body > div'))) {
    const link = host.shadowRoot?.querySelector('.fc-navigate-to-data-preferences') as HTMLElement | null | undefined;
    if (link) {
      link.click();
      return true;
    }
  }
  return false;
}

/** Clicks the element the content script marked (links whose "javascript:" target only runs in the page's world). */
function clickMarked(token: string) {
  const el = document.querySelector(`[data-ilc-click="${token}"]`) as HTMLElement | null;
  if (!el) return false;
  el.removeAttribute('data-ilc-click');
  el.click();
  return true;
}

export const ilcSnippets = {
  ILC_READ_CONSENT_SIGNALS: readConsentSignals,
  ILC_MARK_CONSENT_SIGNALS: markConsentSignals,
  ILC_API_ONETRUST: apiOneTrust,
  ILC_API_COOKIEBOT: apiCookiebot,
  ILC_API_USERCENTRICS: apiUsercentrics,
  ILC_API_DIDOMI: apiDidomi,
  ILC_API_CONSENTMANAGER: apiConsentmanager,
  ILC_API_COMPLIANZ: apiComplianz,
  ILC_API_COOKIEYES: apiCookieYes,
  ILC_API_IUBENDA: apiIubenda,
  ILC_IUBENDA_NEEDS_CONSENT: iubendaNeedsConsent,
  ILC_API_KLARO: apiKlaro,
  ILC_API_COOKIEHUB: apiCookieHub,
  ILC_API_CIVIC: apiCivic,
  ILC_CIVIC_POPUP_SHOWN: civicPopupShown,
  ILC_API_COOKIEFIRST: apiCookieFirst,
  ILC_API_SHOPIFY: apiShopify,
  ILC_CCM19_ACCEPT: acceptCcm19,
  ILC_CLICK_MARKED: clickMarked,
  ILC_FC_OPEN_PREFERENCES: openFundingChoicesPreferences,
};

/** All snippets that may run in a page: autoconsent's built-ins + ours. */
export const allSnippets = { ...autoconsentSnippets, ...ilcSnippets };

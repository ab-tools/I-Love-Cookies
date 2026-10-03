// @ts-nocheck – page globals (OneTrust, Cookiebot, __tcfapi, …) are untyped by nature.
/**
 * Functions run in the page's MAIN world via scripting.executeScript. They are serialised, so each one
 * must be self-contained (no imports, no module-level references). Rules reference them by ID.
 */
import { snippets as autoconsentSnippets } from '@autoconsent-src/eval-snippets';

/** Reads IAB TCF v2 + Google Consent Mode state. Never modifies anything. Returns ConsentSignals. */
function readConsentSignals() {
  const readGcm = () => {
    const dl = window.dataLayer;
    if (!Array.isArray(dl)) return null;
    let updated = false;
    const values = {};
    for (const entry of dl) {
      // gtag() pushes `arguments` objects: ['consent', 'default' | 'update', {...}]
      if (entry && typeof entry === 'object' && entry[0] === 'consent' && entry[2] && typeof entry[2] === 'object') {
        if (entry[1] === 'update') updated = true;
        if (entry[1] === 'update' || entry[1] === 'default') {
          for (const key of Object.keys(entry[2])) {
            if (typeof entry[2][key] === 'string') values[key] = entry[2][key];
          }
        }
      }
    }
    return Object.keys(values).length ? { updated, values } : null;
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
          const li = (tcData.purpose && tcData.purpose.legitimateInterests) || {};
          const ids = Object.keys(consents);
          finish({
            eventStatus: tcData.eventStatus,
            gdprApplies: tcData.gdprApplies,
            purposesTotal: ids.length,
            purposesConsented: ids.filter((id) => consents[id]).length,
            storageConsented: Boolean(consents['1']),
            // A purpose disclosed for legitimate interest but set to false means the user objected.
            legitimateInterestObjected: Object.keys(li).filter((id) => li[id] === false && !consents[id]).length,
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
    await window.__ucCmp.acceptAllConsents();
    if (typeof window.__ucCmp.saveConsents === 'function') await window.__ucCmp.saveConsents();
    if (typeof window.__ucCmp.closeCmp === 'function') await window.__ucCmp.closeCmp();
    return true;
  }
  if (window.UC_UI && typeof window.UC_UI.acceptAllConsents === 'function') {
    await window.UC_UI.acceptAllConsents();
    if (typeof window.UC_UI.closeCMP === 'function') window.UC_UI.closeCMP();
    return true;
  }
  return false;
}
function apiDidomi() {
  if (window.Didomi && typeof window.Didomi.setUserAgreeToAll === 'function') {
    window.Didomi.setUserAgreeToAll();
    return true;
  }
  return false;
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

export const ilcSnippets = {
  ILC_READ_CONSENT_SIGNALS: readConsentSignals,
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
  ILC_API_COOKIEFIRST: apiCookieFirst,
  ILC_API_SHOPIFY: apiShopify,
};

/** All snippets that may run in a page: autoconsent's built-ins + ours. */
export const allSnippets = { ...autoconsentSnippets, ...ilcSnippets };

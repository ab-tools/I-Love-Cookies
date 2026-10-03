import { browser } from 'wxt/browser';
import en from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, substitutions?: string[]) => string;

const fill = (message: string, substitutions: string[]) =>
  substitutions.reduce((text, value, i) => text.replaceAll(`$${i + 1}`, value), message);

/** English messages – used where the browser's i18n API is not available (tests, background logs). */
export const english: Translate = (key, substitutions = []) => fill(en[key]?.message ?? key, substitutions);

/** Messages in the browser's UI language, English as fallback. */
export const translate: Translate = (key, substitutions = []) => {
  try {
    const getMessage = browser.i18n.getMessage as (name: string, substitutions?: string[]) => string;
    return getMessage(key, substitutions) || english(key, substitutions);
  } catch {
    return english(key, substitutions);
  }
};

/** Fills elements marked with data-i18n (text), data-i18n-html (own markup) and data-i18n-title. */
export function localizePage(t: Translate = translate) {
  document.documentElement.lang = browser.i18n?.getUILanguage?.() ?? 'en';
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml as MessageKey);
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as MessageKey);
  const title = document.querySelector<HTMLElement>('title[data-i18n]');
  if (title) document.title = title.textContent ?? document.title;
}

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { english } from '../../src/shared/i18n';

const load = (locale: string) =>
  JSON.parse(readFileSync(`public/_locales/${locale}/messages.json`, 'utf8')) as Record<string, { message: string }>;
const en = load('en');
const placeholders = (text: string) => (text.match(/\$\d/g) ?? []).sort().join();

describe('translations', () => {
  for (const locale of readdirSync('public/_locales').filter((l) => l !== 'en')) {
    it(`${locale} has every message with the same placeholders`, () => {
      const messages = load(locale);
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(placeholders(messages[key]!.message), key).toBe(placeholders(en[key]!.message));
      }
    });
  }

  it('fills placeholders', () => {
    expect(english('popup_rulesInfo', ['631', '16.44.0'])).toBe('631 rules · autoconsent 16.44.0');
  });
});

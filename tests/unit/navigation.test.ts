import { describe, expect, it } from 'vitest';
import { baseDomain, returnsToCallback } from '../../src/shared/navigation';

describe('navigation after consent', () => {
  it('relates subdomains of one site', () => {
    expect(baseDomain('consent.example.com')).toBe('example.com');
  });

  it('recognises a consent page returning to its callback URL', () => {
    const consentPage =
      'https://myprivacy.dpgmedia.nl/consent?siteKey=x&callbackUrl=https%3A%2F%2Fwww.libelle.nl%2Fprivacygate-confirm%3FredirectUri%3D%252F';
    expect(returnsToCallback(consentPage, 'https://www.libelle.nl/')).toBe(true);
    expect(returnsToCallback(consentPage, 'https://evil.example/')).toBe(false);
    expect(returnsToCallback('https://www.example.com/', 'https://other.org/')).toBe(false);
  });
});

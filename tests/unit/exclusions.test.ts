import { describe, expect, it } from 'vitest';
import { matchingExclusion, normalizeExclusion, parseExclusion } from '../../src/shared/exclusions';

const kind = (entry: string) => {
  const parsed = parseExclusion(entry);
  return 'error' in parsed ? 'error' : parsed.kind;
};

describe('site exclusions', () => {
  it('normalises user input', () => {
    expect(normalizeExclusion('  https://WWW.Example.com/Forum?x=1#top ')).toBe('example.com/forum');
    expect(normalizeExclusion('/^News\\.example\\.de$/i')).toBe('/^News\\.example\\.de$/i');
  });

  it('recognises domains, addresses, wildcards and expressions', () => {
    expect(kind('example.com')).toBe('domain');
    expect(kind('example.com/forum')).toBe('prefix');
    expect(kind('*.example.*')).toBe('wildcard');
    expect(kind('/^news\\./')).toBe('regex');
    expect(kind('/(unclosed/')).toBe('error');
    expect(kind('not a domain')).toBe('error');
    expect(kind('localhost')).toBe('error');
  });

  it('matches domains with their subdomains', () => {
    const entries = ['example.com'];
    expect(matchingExclusion(entries, 'https://example.com/')).toBe('example.com');
    expect(matchingExclusion(entries, 'https://www.example.com/a')).toBe('example.com');
    expect(matchingExclusion(entries, 'https://shop.example.com/')).toBe('example.com');
    expect(matchingExclusion(entries, 'https://notexample.com/')).toBeNull();
  });

  it('matches address prefixes on host and path', () => {
    const entries = ['example.com/forum'];
    expect(matchingExclusion(entries, 'https://www.example.com/forum/thread?id=1')).toBe('example.com/forum');
    expect(matchingExclusion(entries, 'https://example.com/shop')).toBeNull();
  });

  it('matches wildcards against the host, or host and path when they contain a slash', () => {
    expect(matchingExclusion(['*.example.*'], 'https://shop.example.co.uk/')).toBe('*.example.*');
    expect(matchingExclusion(['*.example.*'], 'https://www.example.de/')).toBe('*.example.*');
    expect(matchingExclusion(['*.example.*'], 'https://example.de/')).toBe('*.example.*');
    expect(matchingExclusion(['*.example.*'], 'https://notexample.de/')).toBeNull();
    expect(matchingExclusion(['shop.*.de'], 'https://shop.foo.de/x')).toBe('shop.*.de');
    expect(matchingExclusion(['example.com/*/admin*'], 'https://example.com/de/admin/users')).toBe('example.com/*/admin*');
    expect(matchingExclusion(['example.com/*/admin*'], 'https://example.com/admin')).toBeNull();
    // Regex characters in wildcard entries are literal.
    expect(matchingExclusion(['ex+ample.com*'], 'https://exxample.com/')).toBeNull();
  });

  it('matches regular expressions against host and path, with and without www', () => {
    expect(matchingExclusion(['/^news\\.[a-z]+\\.de\\//'], 'https://news.foo.de/')).toBe('/^news\\.[a-z]+\\.de\\//');
    expect(matchingExclusion(['/^www\\.example\\.org/'], 'https://www.example.org/')).toBe('/^www\\.example\\.org/');
    expect(matchingExclusion(['/^example\\.org\\/login/'], 'https://www.example.org/login')).toBe('/^example\\.org\\/login/');
    expect(matchingExclusion(['/EXAMPLE/i'], 'https://example.org/')).toBe('/EXAMPLE/i');
  });

  it('ignores invalid entries and non-web URLs', () => {
    expect(matchingExclusion(['/(/', 'bad entry'], 'https://example.com/')).toBeNull();
    expect(matchingExclusion(['example.com'], 'not a url')).toBeNull();
  });
});

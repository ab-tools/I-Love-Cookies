/**
 * Site exclusions. An entry is one of
 * - a domain: "example.com" (also matches its subdomains),
 * - an address prefix: "example.com/forum",
 * - a wildcard pattern: "*.example.*", "example.com/forum/*" ("*" stands for any characters; a leading "*." also
 *   matches the bare domain),
 * - a regular expression between slashes: "/^news\.[a-z]+\.de$/".
 * Prefixes, wildcards and expressions are matched against host + path (no scheme, query or fragment); a
 * wildcard without "/" is matched against the host only. A leading "www." is ignored except in expressions.
 */
export type ExclusionKind = 'domain' | 'prefix' | 'wildcard' | 'regex';
/** Why an entry cannot be used: an invalid regular expression, or neither a domain, address nor pattern. */
export type ExclusionError = 'regex' | 'entry';

export interface Exclusion {
  entry: string;
  kind: ExclusionKind;
  matches: (url: string) => boolean;
}

const REGEX_ENTRY = /^\/(.+)\/([imsu]*)$/;
const stripWww = (host: string) => host.replace(/^www\./, '');

function target(url: string): { host: string; rawHost: string; path: string } | null {
  try {
    const u = new URL(url);
    return { host: stripWww(u.hostname.toLowerCase()), rawHost: u.hostname.toLowerCase(), path: u.pathname };
  } catch {
    return null;
  }
}

/** Cleans user input: trims, drops the scheme, lowercases (except expressions) and a leading "www.". */
export function normalizeExclusion(input: string): string {
  const entry = input.trim();
  if (REGEX_ENTRY.test(entry)) return entry;
  return stripWww(entry.replace(/^[a-z]+:\/\//i, '').toLowerCase()).replace(/[?#].*$/, '');
}

export function parseExclusion(entry: string): Exclusion | { error: ExclusionError } {
  const regex = REGEX_ENTRY.exec(entry);
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(regex[1]!, regex[2]);
    } catch {
      return { error: 'regex' };
    }
    return {
      entry,
      kind: 'regex',
      matches: (url) => {
        const t = target(url);
        return !!t && (re.test(t.rawHost + t.path) || re.test(t.host + t.path));
      },
    };
  }
  if (!entry || /\s/.test(entry)) return { error: 'entry' };
  if (entry.includes('*')) {
    const withPath = entry.includes('/');
    // A leading "*." also matches the bare domain ("*.example.com" = example.com and its subdomains).
    const subdomains = entry.startsWith('*.');
    const source = (subdomains ? entry.slice(2) : entry).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${subdomains ? '(?:.*\\.)?' : ''}${source}$`, 'i');
    return {
      entry,
      kind: 'wildcard',
      matches: (url) => {
        const t = target(url);
        return !!t && [t.host, t.rawHost].some((host) => re.test(withPath ? host + t.path : host));
      },
    };
  }
  if (!/^[a-z0-9.-]+(\/.*)?$/i.test(entry) || !entry.includes('.')) return { error: 'entry' };
  if (entry.includes('/')) {
    return {
      entry,
      kind: 'prefix',
      matches: (url) => {
        const t = target(url);
        return !!t && (t.host + t.path).startsWith(entry);
      },
    };
  }
  return {
    entry,
    kind: 'domain',
    matches: (url) => {
      const t = target(url);
      return !!t && (t.host === entry || t.host.endsWith(`.${entry}`));
    },
  };
}

const cache = new Map<string, Exclusion | null>();

/** The first entry that excludes this URL, or null. Invalid entries never match. */
export function matchingExclusion(entries: readonly string[], url: string): string | null {
  for (const entry of entries) {
    if (!cache.has(entry)) {
      const parsed = parseExclusion(entry);
      cache.set(entry, 'error' in parsed ? null : parsed);
    }
    if (cache.get(entry)?.matches(url)) return entry;
  }
  return null;
}

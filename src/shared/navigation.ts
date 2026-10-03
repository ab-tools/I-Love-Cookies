/** A consent page (e.g. myprivacy.example-media.com/consent?callbackUrl=…) returning to the URL it was given. */
export function returnsToCallback(from: string, to: string): boolean {
  let decoded = from;
  for (let i = 0; i < 3; i++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      break;
    }
  }
  try {
    const query = decoded.slice(decoded.indexOf('?') + 1);
    return decoded.includes('?') && query.includes(new URL(to).origin);
  } catch {
    return false;
  }
}

/** Rough registrable domain (last two labels) – good enough to relate consent.x.com and x.com. */
export function baseDomain(site: string): string {
  return site.split('.').slice(-2).join('.');
}

/**
 * The 12-character code that signs a temporary event device in (Pack 18.1). Crockford base32: no I, L, O or U, so a code read off a screen or a
 * phone camera is hard to mistype. Pure helpers only: nothing here reads the address bar, storage or the network.
 * The code is a credential. It must never reach a URL, query string, log, console or analytics call, and it is never shown after sign-in.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 12;

const tidy = (s: string) => s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/** `k7q2 m9xd-4trh` -> `K7Q2M9XD4TRH`; the look-alikes O, I, L read as 0, 1, 1. Returns null for anything that cannot be a code. */
export function normalizeDeviceCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const c = tidy(input);
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/** `K7Q2M9XD4TRH` -> `K7Q2-M9XD-4TRH`. Anything that is not a full code is returned unchanged. */
export function formatDeviceCode(code: string): string {
  const c = normalizeDeviceCode(code);
  return c ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}` : code;
}

/** What a person has typed so far, tidied as they type: upper case, look-alikes fixed, only code characters, a dash after each four. */
export function formatTyping(input: string): string {
  const c = tidy(input).split('').filter(ch => CODE_ALPHABET.includes(ch)).slice(0, CODE_LENGTH).join('');
  return c.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * The code carried by a QR link's fragment: `#c=K7Q2M9XD4TRH` (dashes or lower case also accepted). Only the fragment is read, never the query
 * string: a fragment is not sent to any server and not kept in referrers. Returns null when there is no valid code.
 */
export function parseCodeFragment(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === 'c') {
      let v = part.slice(eq + 1);
      try { v = decodeURIComponent(v); } catch { return null; }
      return normalizeDeviceCode(v);
    }
  }
  return null;
}

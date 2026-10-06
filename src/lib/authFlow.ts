/**
 * Pack 18: the words and small rules around email + password sign-in. Everything here is about wording and URLs; Supabase Auth does the actual
 * authentication, and nothing here ever stores or inspects a password beyond "is it long enough / do the two copies match".
 *
 * No account enumeration: a wrong password and an unknown email read the same; "forgot password" and "create account" answer the same whether or
 * not the address already has an account.
 */

export const MIN_PASSWORD = 8;

interface AuthLikeError { code?: string; message?: string; status?: number; name?: string }

export type AuthContextName = 'sign_in' | 'sign_up' | 'reset_request' | 'new_password' | 'change_password' | 'resend';

/** A Supabase Auth error in words a person can act on. Never says whether an email address has an account. */
export function authErrorMessage(error: unknown, context: AuthContextName): string {
  const e = (error ?? {}) as AuthLikeError;
  const code = e.code ?? '';
  const m = (e.message ?? '').toLowerCase();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You are offline. Nothing was sent; try again when you have signal.';
  if (m.includes('failed to fetch') || m.includes('network') || e.name === 'AuthRetryableFetchError') return 'Could not reach BuhurtOS. Check your signal and try again.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429 || m.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
  switch (code) {
    case 'invalid_credentials': return context === 'change_password' ? 'Your current password is not right.' : 'That email and password do not match. Check them, or use "Forgot password?".';
    case 'email_not_confirmed': return 'Confirm your email address first: open the link in the email we sent when you created the account. You can ask for it again below.';
    case 'weak_password': return `Choose a stronger password: at least ${MIN_PASSWORD} characters, not a common one.`;
    case 'same_password': return 'Your new password must be different from the old one.';
    case 'current_password_invalid':
    case 'current_password_required': return 'Your current password is not right.';
    case 'reauthentication_needed': return 'For your security, confirm it is you with the code we email you.';
    case 'reauthentication_not_valid': return 'That code is not right or has expired. Ask for a new one.';
    case 'otp_expired': return 'This link has expired or was already used. Ask for a new one.';
    case 'email_address_invalid':
    case 'validation_failed': return 'Enter a valid email address.';
    case 'signup_disabled':
    case 'email_provider_disabled': return 'New accounts cannot be created with email and password right now. Use an email code or Google instead.';
    // Only possible when the project does not ask new accounts to confirm their email. Worded so it does not confirm that this exact address exists.
    case 'user_already_exists':
    case 'email_exists': return 'Could not create an account with that email. If you already have one, sign in or use "Forgot password?".';
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found': return 'Your sign-in has expired. Sign in again.';
    default: break;
  }
  if (m.includes('invalid login credentials')) return 'That email and password do not match. Check them, or use "Forgot password?".';
  return 'Something went wrong. Please try again.';
}

/** Client-side check before asking Supabase (Supabase checks again). Null = fine. */
export function newPasswordProblem(password: string, confirm?: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return 'Use at most 72 characters.';
  if (confirm !== undefined && confirm !== password) return 'The two passwords do not match.';
  return null;
}

export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * Where to go after signing in: only a path inside BuhurtOS. Anything else (another site, "//host", "javascript:") becomes the home page, so a
 * crafted link can never bounce someone off-site after they sign in.
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  let p = next.trim();
  try { p = decodeURIComponent(p); } catch { return fallback; }
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\') || /[\r\n]/.test(p)) return fallback;
  if (/^\/(sign-in|reset-password)(\/|\?|$)/.test(p)) return fallback;   // never loop back into the auth pages
  return p;
}

/** Absolute URL for an email link (verification / reset) that comes back to this BuhurtOS deployment. */
export function siteUrl(origin: string, base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${origin}${b}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The path inside the app (no deploy base), for "come back here afterwards". */
export function appPath(pathname: string, search: string, hash: string, base: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const inside = b && pathname.startsWith(b) ? pathname.slice(b.length) || '/' : pathname;
  return inside + search + hash;
}

export interface AuthUrlError { code: string; description: string }

/** The error Supabase puts on a link it could not honour (expired, used, invalid), in the query or the hash. */
export function authUrlError(href: string): AuthUrlError | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (k: string) => url.searchParams.get(k) ?? hash.get(k);
  const code = get('error_code') ?? get('error');
  if (!code) return null;
  return { code, description: get('error_description') ?? '' };
}

/** Did this page load come from an email/OAuth link that carried a one-time code (PKCE) or tokens? */
export function hadAuthCode(href: string): boolean {
  try {
    const url = new URL(href);
    return url.searchParams.has('code') || /(^|[#&])(access_token|token_hash)=/.test(url.hash) || url.searchParams.has('token_hash');
  } catch { return false; }
}

/** Plain words for a link error. */
export function linkErrorMessage(e: AuthUrlError): string {
  if (e.code === 'otp_expired' || /expired|invalid/i.test(e.description)) return 'This link has expired or was already used. Ask for a new one below.';
  if (e.code === 'access_denied') return 'This link could not be used. It may have expired or been used already. Ask for a new one below.';
  return 'This link could not be used. Ask for a new one below.';
}

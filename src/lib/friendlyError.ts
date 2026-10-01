/**
 * One place that turns errors into words a person can act on. The raw detail is logged for us and never shown.
 * Errors the database raises on purpose (our own function messages) are written to be read, so they pass through.
 */
interface PgLikeError { message?: string; code?: string; details?: string; status?: number }

const SAFE_CODES = new Set(['22023', 'P0001', 'P0002', '28000', '42501']);

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = (error ?? {}) as PgLikeError;
  console.error('[BuhurtOS]', error);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You are offline. Your changes are not lost; try again when you have signal.';
  if (e.code && SAFE_CODES.has(e.code) && e.message) {
    if (e.code === '42501') return 'You do not have permission to do that.';
    if (e.code === '28000') return 'Please sign in first.';
    return capitalise(e.message);
  }
  const m = (e.message ?? '').toLowerCase();
  if (m.includes('rate limit') || e.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('invalid') && (m.includes('token') || m.includes('otp') || m.includes('code'))) return 'That code is not right or has expired. Request a new one.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Could not reach BuhurtOS. Check your signal and try again.';
  return fallback;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

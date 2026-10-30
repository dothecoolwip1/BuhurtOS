/**
 * How a Lyst screen's background reads behave after a failed read (seven-profile rehearsal 2026-10-30: under Supabase 503s and 10-40 s answers,
 * desks replayed queued reads straight after each failure and one desk stayed on "No signal" until it was reloaded).
 *  - Background polls back off with jitter after consecutive failures, capped at 10 s so a desk is never long behind once the server answers.
 *    A person's own refresh, the browser coming back online and the tab coming back to the front always read at once.
 *  - An expired sign-in is not "no signal": the session is refreshed (at most every 20 s) and the read tried again.
 */
export const POLL_BACKOFF_CAP_MS = 10_000;
export function pollBackoffMs(failures: number, baseMs: number, random: () => number = Math.random): number {
  if (failures <= 0) return 0;
  const cap = Math.min(POLL_BACKOFF_CAP_MS, baseMs * 2 ** Math.min(failures - 1, 4));
  return Math.round(cap * (0.8 + random() * 0.4));
}

/** The server refused the request because the sign-in token has expired (PostgREST PGRST301/PGRST303, HTTP 401, or our own 'sign in required'). */
export function isExpiredSignIn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; status?: number; message?: string };
  if (e.code === 'PGRST301' || e.code === 'PGRST303' || e.code === '28000') return true;
  if (e.status === 401) return true;
  return /jwt (is )?expired|invalid jwt/i.test(e.message ?? '');
}

/** One session refresh at a time, and not more than once every `minGapMs`. */
export function sessionRefresher(refresh: () => Promise<unknown>, minGapMs = 20_000, now: () => number = Date.now) {
  let last = -Infinity; let running: Promise<boolean> | null = null;
  return (): Promise<boolean> => {
    if (running) return running;
    if (now() - last < minGapMs) return Promise.resolve(false);
    last = now();
    running = refresh().then(() => true, () => false).finally(() => { running = null; });
    return running;
  };
}

/**
 * Send a command whose id makes a repeat harmless (a typed-in paper sheet, a hold cleared...) and try it again, with the SAME arguments, when the
 * answer never came (no signal, a 5xx, the app's own time-out). A refusal from the server is never retried. Rehearsal 2026-10-30: "Could not save
 * the paper sheet" during the Supabase slowdown, and a manual retry then succeeded.
 */
export async function sendWithRetry<T>(send: () => Promise<T>, unknownOutcome: (e: unknown) => boolean, delaysMs: readonly number[] = [1000, 3000],
  wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await send(); }
    catch (e) { if (i >= delaysMs.length || !unknownOutcome(e)) throw e; await wait(delaysMs[i]); }
  }
}

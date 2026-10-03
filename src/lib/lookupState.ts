import type { AsyncState } from './useAsync';

/**
 * What a lookup of "maybe one thing" (or "a list that may be empty") currently means for the screen.
 * "No value yet" and "no value exists" are different facts: only `none` may be worded as an absence.
 *   loading: no answer yet. A held `null` while a lookup runs counts as no answer; a found value stays `found` during a reload
 *   error:   the lookup failed; offer Retry, never say the thing does not exist
 *   found:   there is a value (a non-empty list counts)
 *   none:    the lookup finished successfully and there is nothing
 */
export type LookupState = 'loading' | 'error' | 'found' | 'none';

export function lookupState<T>(s: Pick<AsyncState<T | null | undefined | readonly unknown[]>, 'data' | 'error' | 'loading'>): LookupState {
  if (s.error != null) return 'error';
  const d = s.data;
  if (d === undefined) return s.loading ? 'loading' : 'none';
  // A null that is still being replaced by a running lookup is not an answer yet.
  if (d === null) return s.loading ? 'loading' : 'none';
  if (Array.isArray(d)) return d.length > 0 ? 'found' : 'none';
  return 'found';
}

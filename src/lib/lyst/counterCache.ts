import type { CounterState } from '../../data/lyst';
import type { CounterStorage } from './counterJournal';

const key = (user: string) => `bos-counter-state:v1:${user}`;
/** Device/account scoped, no credential material. Keeping a context is not
 * authorization: every delivery still checks the seat and run on the server. */
export function readCounterCache(storage: CounterStorage, user: string): CounterState | null {
  try {
    const value = JSON.parse(storage.getItem(key(user)) ?? 'null') as { version: number; state: CounterState } | null;
    const s = value?.state;
    if (value?.version !== 1 || !s || typeof s.server_now !== 'string' || !s.seat || s.seat.status !== 'active'
      || !s.match_id || s.match_id !== s.seat.match_id || !s.prepared_run || s.prepared_run.match_id !== s.match_id
      || s.event?.closed || s.final || s.waiting) return null;
    return s;
  } catch { return null; }
}
export function saveCounterCache(storage: CounterStorage, user: string, state: CounterState): boolean {
  try {
    const value = JSON.stringify({ version: 1, state });
    storage.setItem(key(user), value);
    return storage.getItem(key(user)) === value;
  } catch { return false; }
}

import { useSyncExternalStore } from 'react';

/**
 * Sample mode shows clearly labelled invented teams, events and scores so screens can be reviewed.
 * It is off by default and never on for a first-time visitor. `?sample=1` (or the owner's switch under Platform) turns it on and it stays on
 * in this browser (localStorage: refreshes, other tabs, restarts, signing out and in) until `?sample=0`, "Leave sample mode" or the switch
 * turns it off again.
 */
export const SAMPLE_KEY = 'bos-sample';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Applies a `?sample=` request to storage and returns whether sample mode is on. Only an explicit `1` stored by this browser turns it on.
 * A flag left in sessionStorage by the older session-only version is carried over once, then removed.
 */
export function initSampleMode(search: string, local: Store, session?: Store): boolean {
  const q = new URLSearchParams(search).get('sample');
  if (session) {
    try { if (session.getItem(SAMPLE_KEY) === '1' && q !== '0') local.setItem(SAMPLE_KEY, '1'); session.removeItem(SAMPLE_KEY); } catch { /* ignore */ }
  }
  if (q === '1') local.setItem(SAMPLE_KEY, '1');
  if (q === '0') local.removeItem(SAMPLE_KEY);
  return local.getItem(SAMPLE_KEY) === '1';
}

let on = false;
try {
  on = initSampleMode(window.location.search, localStorage, sessionStorage);
  // Drop ?sample= from the address once it is applied, so a refresh after "Leave sample mode" does not switch it back on.
  const url = new URL(window.location.href);
  if (url.searchParams.has('sample')) { url.searchParams.delete('sample'); history.replaceState(history.state, '', url.pathname + url.search + url.hash); }
} catch { /* storage can be blocked; sample mode just stays off */ }

const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
export function setSampleMode(value: boolean) {
  on = value;
  try { if (value) localStorage.setItem(SAMPLE_KEY, '1'); else localStorage.removeItem(SAMPLE_KEY); } catch { /* ignore */ }
  notify();
}
// Another tab switched it: follow at once.
try {
  window.addEventListener('storage', e => {
    if (e.key !== SAMPLE_KEY && e.key !== null) return;
    const next = e.key === null ? false : e.newValue === '1';
    if (next !== on) { on = next; notify(); }
  });
} catch { /* ignore */ }

export function useSampleMode(): boolean {
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => on);
}

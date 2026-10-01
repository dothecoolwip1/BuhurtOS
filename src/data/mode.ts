import { useSyncExternalStore } from 'react';

/**
 * Sample mode shows clearly labelled invented teams, events and scores so screens can be reviewed.
 * It is off by default and never on for a first-time visitor: only `?sample=1` turns it on, `?sample=0` turns it off.
 */
const KEY = 'bos-sample';
let on = false;
try {
  const q = new URLSearchParams(window.location.search).get('sample');
  if (q === '1') sessionStorage.setItem(KEY, '1');
  if (q === '0') sessionStorage.removeItem(KEY);
  on = sessionStorage.getItem(KEY) === '1';
} catch { /* storage can be blocked; sample mode just stays off */ }

const subs = new Set<() => void>();
export function setSampleMode(value: boolean) {
  on = value;
  try { if (value) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  subs.forEach(f => f());
}
export function useSampleMode(): boolean {
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => on);
}

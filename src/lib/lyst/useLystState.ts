import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCounterState, fetchLystState, type CounterState, type LystState } from '../../data/lyst';
import { supabase } from '../supabase';
import { ServerClock, remainingMs, type LystTimer } from './timer';
import { realtimeChannel } from '../realtimeChannel';
import { readCounterCache, saveCounterCache } from './counterCache';
import { classifyRpcError } from '../scoreSender';

const POLL_MS = 2500;

/** A re-render source for a ticking clock: only runs while `active`, and reads the DEVICE clock (the server offset is added by the caller). */
export function useNow(active: boolean, everyMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    // a tab coming back from sleep must show the true time at once, not after the next tick
    const wake = () => setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', wake); };
  }, [active, everyMs]);
  return now;
}

interface Source<S> { fetch: () => Promise<{ state: S; sentAt: number; receivedAt: number }>; serverNow: (s: S) => string }

/**
 * Polls a server state and keeps a measured server-clock offset. Realtime tells us "something changed" and we read again (the safety net is the poll).
 * Answers older than the one already shown are dropped, so a slow poll can never put the screen back in time.
 */
function useServerState<S>(src: Source<S>, enabled: boolean, nudge: { table: string; filter?: string }[] | null, key: string) {
  const [state, setState] = useState<S | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [offline, setOffline] = useState(false);
  /** Device time at which the request behind the shown state was SENT: lets a caller ignore an answer that was already in flight when something else happened. */
  const [sentAt, setSentAt] = useState(0);
  const clock = useRef(new ServerClock());
  const newest = useRef(0);
  const inFlight = useRef<number | null>(null);
  const generation = useRef(0);
  const again = useRef(false);
  const live = useRef(true);
  const srcRef = useRef(src);
  srcRef.current = src;

  const apply = useCallback((s: S, sentAt?: number, receivedAt?: number) => {
    const at = Date.parse(srcRef.current.serverNow(s));
    if (Number.isFinite(at) && sentAt !== undefined && receivedAt !== undefined) clock.current.sample(at, sentAt, receivedAt);
    if (Number.isFinite(at)) { if (at < newest.current) return; newest.current = at; }
    setState(s); setError(null); setOffline(false); if (sentAt !== undefined) setSentAt(sentAt);
  }, []);

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    if (inFlight.current === epoch) { again.current = true; return; }
    inFlight.current = epoch;
    try {
      do {
        again.current = false;
        try { const r = await srcRef.current.fetch(); if (live.current && generation.current === epoch) apply(r.state, r.sentAt, r.receivedAt); }
        catch (e) {
          if (!live.current || generation.current !== epoch) break;
          // no signal: keep showing the last true state (the server clock keeps running) and say so
          if (classifyRpcError(e) !== 'reject' || (typeof navigator !== 'undefined' && navigator.onLine === false)) setOffline(true); else setError(e);
        }
      } while (again.current && live.current && generation.current === epoch);
    } finally { if (inFlight.current === epoch) inFlight.current = null; }
  }, [apply]);

  useEffect(() => {
    generation.current++; inFlight.current = null;
    live.current = true; newest.current = 0; setState(null); setError(null); setOffline(false); setSentAt(0);
    clock.current = new ServerClock();
    if (!enabled) return () => { live.current = false; };
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    const on = () => { void refresh(); };
    window.addEventListener('online', on);
    document.addEventListener('visibilitychange', on);
    let debounce: number | undefined;
    const channel = nudge && nudge.length > 0
      ? nudge.reduce((ch, n) => ch.on('postgres_changes', { event: '*', schema: 'public', table: n.table, ...(n.filter ? { filter: n.filter } : {}) }, () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => { void refresh(); }, 250); }),
          realtimeChannel(`lyst-${key}`)).subscribe()
      : null;
    return () => {
      live.current = false; generation.current++; window.clearInterval(poll); window.clearTimeout(debounce);
      window.removeEventListener('online', on); document.removeEventListener('visibilitychange', on);
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, refresh]);

  return { state, error, offline, refresh, apply, sentAt, clock: clock.current };
}

/** The lyst tablet's state for one match. */
export function useLystState(matchId: string, eventId: string, enabled = true) {
  const src = useRef<Source<LystState>>({ fetch: () => fetchLystState(matchId), serverNow: s => s.server_now });
  src.current = { fetch: () => fetchLystState(matchId), serverNow: s => s.server_now };
  const r = useServerState<LystState>(src.current, enabled, [
    { table: 'lyst_timer', filter: `event_id=eq.${eventId}` }, { table: 'lyst_rounds', filter: `match_id=eq.${matchId}` }, { table: 'match_discipline', filter: `match_id=eq.${matchId}` }
  ], `tablet-${matchId}`);
  /** Take a timer answer straight from a command (it is authoritative and newer than whatever is shown). */
  const applyTimer = useCallback((timer: LystState['timer'], serverNow: string, sentAt: number, receivedAt: number) => {
    const at = Date.parse(serverNow);
    if (Number.isFinite(at)) r.clock.sample(at, sentAt, receivedAt);
    // the full state is read again straight away; this puts the new clock on screen without waiting for that
    if (!r.state) { void r.refresh(); return; }
    r.apply({ ...(r.state as LystState), timer, server_now: serverNow } as LystState);
    void r.refresh();
  }, [r]);
  return { ...r, applyTimer };
}

/** The counter's phone state (their own seat only). */
export function useCounterState(enabled = true, userKey = '') {
  const src = useRef<Source<CounterState>>({ fetch: fetchCounterState, serverNow: s => s.server_now });
  const result = useServerState<CounterState>(src.current, enabled, null, `counter-${userKey}`);
  const storage = useMemo(() => ({ getItem: (k: string) => localStorage.getItem(k), setItem: (k: string, v: string) => localStorage.setItem(k, v) }), []);
  const cached = useMemo(() => readCounterCache(storage, userKey), [storage, userKey]);
  const [savedState, setSavedState] = useState<CounterState | null>(null);
  const [cacheFailed,setCacheFailed]=useState(false);
  useEffect(() => { if (result.state) { const saved=saveCounterCache(storage,userKey,result.state);setSavedState(saved?result.state:null);setCacheFailed(!saved); } }, [result.state, storage, userKey]);
  return { ...result, state: result.state ?? cached, cached: !result.state && !!cached,
    cacheFailed,cacheDurable: result.state ? savedState === result.state : !!cached, offline: result.offline || (!result.state && !!cached) };
}

/** Milliseconds to show for a timer, from server state and the measured offset. */
export const showMs = (t: LystTimer | null | undefined, clock: ServerClock, deviceNow: number): number => (t ? remainingMs(t, clock.now(deviceNow)) : 0);

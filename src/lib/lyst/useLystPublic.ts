import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLystPublic, type LystPublic } from '../../data/lyst';
import { supabase } from '../supabase';
import { ServerClock } from './timer';

/**
 * Official lyst state for the public display (and, later, Broadcast). Public view, official data only. Polls every few seconds and is nudged by realtime; a dropped
 * connection keeps the last true state on screen. The clock is derived from the SERVER's time on every answer, so a display with a wrong clock still shows the right time.
 */
export function useLystPublic(eventId: string | undefined, enabled: boolean) {
  const [rows, setRows] = useState<LystPublic[]>([]);
  /** Device time of the last successful read (for "is this data stale?"). */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const clock = useRef(new ServerClock());
  const live = useRef(true);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (!eventId || busy.current) return;
    busy.current = true;
    try {
      const r = await fetchLystPublic(eventId);
      const at = r.rows[0]?.server_now ? Date.parse(r.rows[0].server_now) : NaN;
      if (Number.isFinite(at)) clock.current.sample(at, r.sentAt, r.receivedAt);
      if (live.current) { setRows(r.rows); setUpdatedAt(Date.now()); }
    } catch { /* no signal or no access: keep what is on screen */ } finally { busy.current = false; }
  }, [eventId]);
  useEffect(() => {
    live.current = true;
    if (!eventId || !enabled) { setRows([]); return () => { live.current = false; }; }
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    let debounce: number | undefined;
    const nudge = () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => { void refresh(); }, 200); };
    const channel = supabase.channel(`lyst-public-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lyst_timer', filter: `event_id=eq.${eventId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lyst_rounds', filter: `event_id=eq.${eventId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_discipline', filter: `event_id=eq.${eventId}` }, nudge)
      .subscribe();
    return () => { live.current = false; window.clearInterval(poll); window.clearTimeout(debounce); void supabase.removeChannel(channel); };
  }, [eventId, enabled, refresh]);
  return { rows, clock: clock.current, updatedAt };
}

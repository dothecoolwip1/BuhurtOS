import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { realtimeChannel } from './realtimeChannel';

/**
 * Tells a screen when a competition of the event became official (or was reopened) or the event was closed / reopened, so it re-reads the
 * event. Realtime on the two rows (competitions and events are in the publication since Pack 09C), debounced, with a slow poll as the fallback
 * the rest of the live screens also rely on. The callback is the caller's; this hook never fetches anything itself.
 */
export const RECORD_POLL_MS = 20_000;
export function useEventRecordWatch(eventId: string | undefined, onChange: () => void, pollMs = RECORD_POLL_MS): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!eventId) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const fire = () => { clearTimeout(t); t = setTimeout(() => cb.current(), 400); };
    const channel = realtimeChannel(`event-record-${eventId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'competitions', filter: `event_id=eq.${eventId}` }, fire)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, fire)
      .subscribe();
    const poll = window.setInterval(() => { if (!document.hidden) cb.current(); }, pollMs);
    return () => { clearTimeout(t); window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [eventId, pollMs]);
}

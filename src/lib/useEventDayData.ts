import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { fetchCompetitionMatchesOrdered, fetchEntries, type CompetitionEntry, type CompetitionMatch } from '../data/matches';
import { LiveSync, realtimeFilter, type Connection } from './liveSync';

interface OneCompetition { matches: CompetitionMatch[]; entries: CompetitionEntry[] }
export interface EventDayData {
  matches: CompetitionMatch[]; entries: CompetitionEntry[];
  loading: boolean; error: unknown; updatedAt: number | null; connection: Connection;
  /** Re-read everything now (after an action, or when the organizer asks). Resolves when done. */
  refresh: () => Promise<void>;
}

const loadOne = async (id: string): Promise<OneCompetition> => {
  const [matches, entries] = await Promise.all([fetchCompetitionMatchesOrdered(id), fetchEntries(id)]);
  return { matches, entries };
};

/**
 * Live matches and entries for one event's competitions, for the Event day screen. Same machinery as the public screens (LiveSync: realtime on the
 * event's competitions, a refetch of only the competition that changed, a polling fallback, and "live" claimed only after a full re-read), but without
 * standings, which the Command Center does not use. The last good data stays on screen if a refresh fails.
 */
export function useEventDayData(competitionIds: readonly string[]): EventDayData {
  const [data, setData] = useState<Record<string, OneCompetition>>({});
  const [state, setState] = useState<{ loading: boolean; error: unknown; updatedAt: number | null; connection: Connection }>({ loading: true, error: undefined, updatedAt: null, connection: 'connecting' });
  const syncRef = useRef<LiveSync<OneCompetition> | null>(null);
  const key = competitionIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setData({}); setState({ loading: false, error: undefined, updatedAt: null, connection: 'connecting' }); return; }
    setState(s => ({ ...s, loading: true }));
    const sync = new LiveSync<OneCompetition>({
      ids, fetchOne: loadOne,
      onData: (patch, full) => { setData(d => (full ? patch : { ...d, ...patch })); setState(s => ({ ...s, loading: false, error: undefined, updatedAt: Date.now() })); },
      onConnection: connection => setState(s => ({ ...s, connection })),
      onError: error => setState(s => ({ ...s, loading: false, error }))
    });
    syncRef.current = sync;
    sync.start();
    const filter = realtimeFilter(ids);
    const onRow = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row = (payload.new && 'competition_id' in payload.new ? payload.new : payload.old) as { competition_id?: string } | undefined;
      sync.change(row?.competition_id);
    };
    const channel = supabase.channel(`event-day-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', ...(filter ? { filter } : {}) }, onRow)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', ...(filter ? { filter } : {}) }, onRow)
      .subscribe(status => { void sync.status(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'); });
    return () => { sync.stop(); syncRef.current = null; void supabase.removeChannel(channel); };
  }, [key]);

  const refresh = useCallback(async () => { await syncRef.current?.fullLoad(); }, []);
  const all = Object.values(data);
  return { matches: all.flatMap(d => d.matches), entries: all.flatMap(d => d.entries), refresh, ...state };
}

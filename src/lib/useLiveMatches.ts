import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchCompetitionMatches, fetchEntries, fetchStandings, type CompetitionEntry, type CompetitionMatch, type Standing } from '../data/matches';
import { LiveSync, realtimeFilter, type Connection } from './liveSync';
import { trackEvent } from './analytics';

export interface LiveCompetitionData { matches: CompetitionMatch[]; entries: CompetitionEntry[]; standings: Standing[] }
/**
 * `connection` is what the screen may claim: 'live' only after the realtime channel is subscribed AND everything was re-read since;
 * 'polling' means the page is refreshing every few seconds instead (no realtime, or just reconnecting); 'connecting' is the first load.
 */
export interface LiveState { data: Record<string, LiveCompetitionData>; loading: boolean; error: unknown; updatedAt: number | null; connection: Connection }

export const POLL_MS = 15_000;

async function loadOne(id: string): Promise<LiveCompetitionData> {
  const [matches, entries, standings] = await Promise.all([fetchCompetitionMatches(id), fetchEntries(id), fetchStandings(id)]);
  return { matches, entries, standings };
}

/**
 * Live matches, entries and standings for the given competitions (one event).
 * Realtime is filtered on the server to these competitions; a change in one competition re-reads that competition only; and the screen
 * only says it is live after a full re-read following (re)connection. See liveSync.ts, which holds the logic and its tests.
 */
export function useLiveMatches(competitionIds: readonly string[]): LiveState {
  const [state, setState] = useState<LiveState>({ data: {}, loading: true, error: undefined, updatedAt: null, connection: 'connecting' });
  const key = competitionIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setState({ data: {}, loading: false, error: undefined, updatedAt: null, connection: 'connecting' }); return; }
    setState(s => ({ ...s, loading: true }));
    const sync = new LiveSync<LiveCompetitionData>({
      ids,
      fetchOne: loadOne,
      onData: (patch, full) => setState(s => ({ ...s, data: full ? patch : { ...s.data, ...patch }, loading: false, error: undefined, updatedAt: Date.now() })),
      onConnection: connection => { setState(s => ({ ...s, connection })); trackEvent('live_connection', { status: connection }); },
      onError: error => { setState(s => ({ ...s, loading: false, error })); trackEvent('live_refresh_failed'); }   // the last good data stays on screen
    });
    sync.start();
    const filter = realtimeFilter(ids);
    const onRow = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row = (payload.new && 'competition_id' in payload.new ? payload.new : payload.old) as { competition_id?: string } | undefined;
      sync.change(row?.competition_id);
    };
    const channel = supabase.channel(`live-matches-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', ...(filter ? { filter } : {}) }, onRow)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', ...(filter ? { filter } : {}) }, onRow)
      .subscribe(status => { void sync.status(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'); });
    return () => { sync.stop(); void supabase.removeChannel(channel); };
  }, [key]);

  return state;
}

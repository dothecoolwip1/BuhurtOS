import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { fetchCompetitionMatches, type CompetitionMatch } from '../data/matches';
import { fetchLiveScores, type LiveScore } from '../data/liveScores';
import { LiveSync, realtimeFilter, type Connection } from './liveSync';

interface One { matches: CompetitionMatch[]; scores: LiveScore[] }
export interface ArenaData { matches: CompetitionMatch[]; scores: LiveScore[]; loading: boolean; error: unknown; updatedAt: number | null; connection: Connection; refresh: () => Promise<void> }

const loadOne = async (id: string): Promise<One> => {
  const [matches, scores] = await Promise.all([fetchCompetitionMatches(id), fetchLiveScores(id)]);
  return { matches, scores };
};

/**
 * Matches and running scores for the venue display: the same LiveSync the public event page uses (realtime per competition, a 15 s polling
 * fallback while the socket is down, a slow safety refresh while live), plus the live-score table on the same channel. A screen left open all day
 * holds one channel and a few timers; a dropped connection falls back to polling and recovers on its own.
 */
export function useArenaData(competitionIds: readonly string[]): ArenaData {
  const [data, setData] = useState<Record<string, One>>({});
  const [state, setState] = useState<{ loading: boolean; error: unknown; updatedAt: number | null; connection: Connection }>({ loading: true, error: undefined, updatedAt: null, connection: 'connecting' });
  const syncRef = useRef<LiveSync<One> | null>(null);
  const key = competitionIds.join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setData({}); setState({ loading: false, error: undefined, updatedAt: null, connection: 'connecting' }); return; }
    setState(s => ({ ...s, loading: true }));
    const sync = new LiveSync<One>({
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
    const channel = supabase.channel(`arena-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', ...(filter ? { filter } : {}) }, onRow)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_live_scores', ...(filter ? { filter } : {}) }, onRow)
      .subscribe(status => { void sync.status(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'); });
    return () => { sync.stop(); syncRef.current = null; void supabase.removeChannel(channel); };
  }, [key]);
  const all = Object.values(data);
  return { matches: all.flatMap(d => d.matches), scores: all.flatMap(d => d.scores), refresh: async () => { await syncRef.current?.fullLoad(); }, ...state };
}

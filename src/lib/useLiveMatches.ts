import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { fetchCompetitionMatches, fetchEntries, fetchStandings, type CompetitionEntry, type CompetitionMatch, type Standing } from '../data/matches';

export interface LiveCompetitionData { matches: CompetitionMatch[]; entries: CompetitionEntry[]; standings: Standing[] }
export interface LiveState { data: Record<string, LiveCompetitionData>; loading: boolean; error: unknown; updatedAt: number | null }

export const POLL_MS = 15_000;
const DEBOUNCE_MS = 400;

async function loadAll(ids: readonly string[]): Promise<Record<string, LiveCompetitionData>> {
  const parts = await Promise.all(ids.map(async id => {
    const [matches, entries, standings] = await Promise.all([fetchCompetitionMatches(id), fetchEntries(id), fetchStandings(id)]);
    return [id, { matches, entries, standings }] as const;
  }));
  return Object.fromEntries(parts);
}

/**
 * Live matches, entries and standings for the given competitions (one event). Subscribes to realtime changes on `matches`
 * and refetches (debounced); polls every 15 s whenever the realtime channel is not connected. Everything is cleaned up on unmount.
 * The matches table has no event column, so the subscription is unfiltered and changes are matched to our competitions client-side.
 */
export function useLiveMatches(competitionIds: readonly string[]): LiveState {
  const [state, setState] = useState<LiveState>({ data: {}, loading: true, error: undefined, updatedAt: null });
  const key = competitionIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setState({ data: {}, loading: false, error: undefined, updatedAt: null }); return; }
    let alive = true;
    let inFlight = false;
    let again = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (inFlight) { again = true; return; }
      inFlight = true;
      try {
        const data = await loadAll(ids);
        if (alive) setState({ data, loading: false, error: undefined, updatedAt: Date.now() });
      } catch (error) {
        if (alive) setState(s => ({ ...s, loading: false, error })); // keep the last good data on screen
      } finally {
        inFlight = false;
        if (again && alive) { again = false; void run(); }
      }
    };
    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; } };
    const startPolling = () => { if (!pollTimer) pollTimer = setInterval(() => { void run(); }, POLL_MS); };

    setState(s => ({ ...s, loading: true }));
    void run();
    startPolling(); // fallback until realtime reports it is connected
    const channel = supabase.channel(`live-matches-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, payload => {
        const row = (payload.new && 'competition_id' in payload.new ? payload.new : payload.old) as { competition_id?: string } | undefined;
        if (row?.competition_id && !ids.includes(row.competition_id)) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => { void run(); }, DEBOUNCE_MS);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { stopPolling(); void run(); } // catch up on anything missed while connecting
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling();
      });

    return () => { alive = false; stopPolling(); clearTimeout(debounce); void supabase.removeChannel(channel); };
  }, [key]);

  return state;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Announcement, EventRecord, MatchRecord, MatchStatus, RosterEntry, ScoreRound, UserContext } from '../types';
import { demoUser } from '../data/demo';
import { loadEventSnapshot } from '../lib/repository';
import { isSupabaseConfigured, subscribeToEvent, supabase } from '../lib/supabase';
import { validateScore } from '../lib/scoring';
import { advanceWinner } from '../lib/bracket';
import { enqueueMutation, flushMutationQueue, listMutations } from '../lib/offlineQueue';
import { loadUserContext } from '../lib/userContext';

interface AppStateValue {
  loading: boolean;
  error: string | null;
  event: EventRecord | null;
  matches: MatchRecord[];
  roster: RosterEntry[];
  announcements: Announcement[];
  user: UserContext | null;
  online: boolean;
  pendingCount: number;
  dataMode: 'demo' | 'supabase';
  reload: () => Promise<void>;
  updateCompliance: (entryId: string, field: 'checkedIn' | 'armorCleared' | 'medicalCleared' | 'waiverConfirmed' | 'weighInCleared', value: boolean) => Promise<void>;
  finalizeResult: (matchId: string, rounds: ScoreRound[], forfeit?: { side: 1 | 2; reason: string }) => Promise<void>;
  reorderMatch: (matchId: string, direction: -1 | 1) => Promise<void>;
  setMatchStatus: (matchId: string, status: MatchStatus) => Promise<void>;
  syncNow: () => Promise<void>;
  refreshQueue: () => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [user, setUser] = useState<UserContext | null>(isSupabaseConfigured ? null : demoUser);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(async () => setPendingCount((await listMutations()).length), []);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const requestedEventId = typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('event') ?? undefined;
      const snap = await loadEventSnapshot(requestedEventId);
      setEvent(snap.event);
      setMatches(snap.matches);
      setRoster(snap.roster);
      setAnnouncements(snap.announcements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load event data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    refreshPending();
  }, [reload, refreshPending]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return setUser(null);
      setUser(await loadUserContext(data.user.id, data.user.email ?? 'Signed in user'));
    }).catch(() => setUser(null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) setUser(null);
      else loadUserContext(session.user.id, session.user.email ?? 'Signed in user').then(setUser).catch(() => setUser(null));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  useEffect(() => {
    if (!event || !supabase) return;
    const client = supabase;
    const channel = subscribeToEvent(event.id, reload);
    return () => { if (channel) client.removeChannel(channel); };
  }, [event?.id, reload]);

  const updateCompliance = useCallback(async (entryId: string, field: 'checkedIn' | 'armorCleared' | 'medicalCleared' | 'waiverConfirmed' | 'weighInCleared', value: boolean) => {
    const before = roster.find(r => r.id === entryId);
    if (!before) return;
    setRoster(current => current.map(r => r.id === entryId ? { ...r, [field]: value } : r));
    if (!supabase) {
      const overrides = JSON.parse(localStorage.getItem('buhurtos-demo-roster-overrides') ?? '{}');
      overrides[entryId] = { ...(overrides[entryId] ?? {}), [field]: value };
      localStorage.setItem('buhurtos-demo-roster-overrides', JSON.stringify(overrides));
      return;
    }
    if (!online) {
      await enqueueMutation({ entity: 'event_roster_entries', entityId: entryId, operation: 'update', payload: { [field]: value }, baseVersion: JSON.stringify(before) });
      await refreshPending();
      return;
    }
    const client = supabase;
    const column = { checkedIn: 'checked_in', armorCleared: 'armor_cleared', medicalCleared: 'medical_cleared', waiverConfirmed: 'waiver_confirmed', weighInCleared: 'weigh_in_cleared' }[field];
    const { error: writeError } = await client.from('event_roster_entries').update({ [column]: value }).eq('id', entryId);
    if (writeError) {
      setRoster(current => current.map(r => r.id === entryId ? before : r));
      throw writeError;
    }
  }, [roster, online, refreshPending]);

  const finalizeResult = useCallback(async (matchId: string, rounds: ScoreRound[], forfeit?: { side: 1 | 2; reason: string }) => {
    const match = matches.find(m => m.id === matchId);
    if (!match) throw new Error('Match not found.');
    const validation = validateScore(match.scoringConfig, rounds, forfeit);
    if (!validation.valid || !validation.result) throw new Error(validation.errors.join(' '));

    if (supabase && online) {
      const client = supabase;
      const { error: rpcError } = await client.rpc('submit_match_result', {
        p_match_id: match.id,
        p_rounds: rounds,
        p_forfeit_side: forfeit?.side ?? null,
        p_forfeit_reason: forfeit?.reason ?? null,
        p_expected_status: match.status
      });
      if (rpcError) throw rpcError;
      await reload();
      return;
    }

    let next = matches.map(m => m.id === matchId ? { ...m, rounds, resultSummary: validation.result, status: 'finalized' as const } : m);
    const winnerSide = validation.result.winnerSide;
    if (winnerSide) {
      const winnerId = match.participants.find(p => p.sideIndex === winnerSide)?.rosterEntryId;
      if (winnerId) next = advanceWinner(next, matchId, winnerId);
    }
    setMatches(next);
    if (!supabase) { localStorage.setItem('buhurtos-demo-matches', JSON.stringify(next)); return; }
    if (!online) {
      await enqueueMutation({ entity: 'match_result', entityId: match.id, operation: 'rpc', payload: { rounds, forfeit }, baseVersion: match.status });
      await refreshPending();
    }
  }, [matches, online, reload, refreshPending]);

  const reorderMatch = useCallback(async (matchId: string, direction: -1 | 1) => {
    const ordered = [...matches].sort((a, b) => a.scheduledOrder - b.scheduledOrder);
    const index = ordered.findIndex(m => m.id === matchId);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;
    [ordered[index].scheduledOrder, ordered[swapIndex].scheduledOrder] = [ordered[swapIndex].scheduledOrder, ordered[index].scheduledOrder];
    const reordered = [...ordered].sort((a, b) => a.scheduledOrder - b.scheduledOrder);
    setMatches(reordered);
    if (!supabase) { localStorage.setItem('buhurtos-demo-matches', JSON.stringify(reordered)); return; }
    if (!online) {
      await enqueueMutation({ entity: 'fight_card_order', entityId: matchId, operation: 'rpc', payload: { direction } });
      await refreshPending();
      return;
    }
    const client = supabase;
    const { error: rpcError } = await client.rpc('reorder_match', { p_match_id: matchId, p_direction: direction });
    if (rpcError) throw rpcError;
  }, [matches, online, refreshPending]);

  const setMatchStatus = useCallback(async (matchId: string, status: MatchStatus) => {
    const match = matches.find(m => m.id === matchId);
    if (!match || match.status === status) return;
    const previous = match.status;
    const exclusive = new Set<MatchStatus>(['active', 'on_deck', 'in_the_hole']);
    const nextMatches = matches.map(m => {
      if (m.id === matchId) return { ...m, status };
      if (exclusive.has(status) && m.eventId === match.eventId && m.fightCardId === match.fightCardId && m.status === status) return { ...m, status: 'scheduled' as MatchStatus };
      return m;
    });
    setMatches(nextMatches);
    if (!supabase) {
      localStorage.setItem('buhurtos-demo-matches', JSON.stringify(nextMatches));
      return;
    }
    if (!online) {
      await enqueueMutation({ entity: 'match_status', entityId: match.id, operation: 'rpc', payload: { status }, baseVersion: previous });
      await refreshPending();
      return;
    }
    const client = supabase;
    const { error: rpcError } = await client.rpc('set_match_status', { p_match_id: match.id, p_status: status, p_expected_status: previous });
    if (rpcError) {
      setMatches(matches);
      throw rpcError;
    }
    await reload();
  }, [matches, online, refreshPending, reload]);

  const syncNow = useCallback(async () => {
    const client = supabase;
    if (!client || !online) return;
    await flushMutationQueue(async mutation => {
      if (mutation.operation === 'rpc' && mutation.entity === 'match_result') {
        const payload = mutation.payload as any;
        const { error: e } = await client.rpc('submit_match_result', { p_match_id: mutation.entityId, p_rounds: payload.rounds, p_forfeit_side: payload.forfeit?.side ?? null, p_forfeit_reason: payload.forfeit?.reason ?? null, p_expected_status: mutation.baseVersion ?? 'scheduled' });
        if (e) return { ok: false, conflict: e.code === 'P0001' || e.code === '40001', error: e.message };
        return { ok: true };
      }
      if (mutation.operation === 'rpc' && mutation.entity === 'match_status') {
        const payload = mutation.payload as { status: MatchStatus };
        const { error: e } = await client.rpc('set_match_status', { p_match_id: mutation.entityId, p_status: payload.status, p_expected_status: mutation.baseVersion ?? 'scheduled' });
        if (e) return { ok: false, conflict: e.code === 'P0001' || /changed since/i.test(e.message), error: e.message };
        return { ok: true };
      }
      if (mutation.operation === 'rpc' && mutation.entity === 'fight_card_order') {
        const payload = mutation.payload as { direction: -1 | 1 };
        const { error: e } = await client.rpc('reorder_match', { p_match_id: mutation.entityId, p_direction: payload.direction });
        return e ? { ok: false, error: e.message } : { ok: true };
      }
      if (mutation.operation === 'update' && mutation.entity === 'event_roster_entries') {
        const payload = mutation.payload as Record<string, unknown>;
        const mapped: Record<string, unknown> = {};
        const map: Record<string, string> = { checkedIn: 'checked_in', armorCleared: 'armor_cleared', medicalCleared: 'medical_cleared', waiverConfirmed: 'waiver_confirmed', weighInCleared: 'weigh_in_cleared' };
        const base = mutation.baseVersion ? JSON.parse(mutation.baseVersion) as Record<string, unknown> : null;
        const { data: current, error: readError } = await client.from('event_roster_entries').select('checked_in,armor_cleared,medical_cleared,waiver_confirmed,weigh_in_cleared').eq('id', mutation.entityId).single();
        if (readError) return { ok: false, error: readError.message };
        for (const [key, value] of Object.entries(payload)) {
          const column = map[key] ?? key;
          mapped[column] = value;
          if (base) {
            const before = base[key];
            const remote = (current as Record<string, unknown>)[column];
            if (remote !== before && remote !== value) return { ok: false, conflict: true, error: `Roster field ${key} changed on another device.` };
          }
        }
        const { error: e } = await client.from('event_roster_entries').update(mapped).eq('id', mutation.entityId);
        return e ? { ok: false, error: e.message } : { ok: true };
      }
      return { ok: false, error: 'Unsupported queued mutation type.' };
    });
    await refreshPending();
    await reload();
  }, [online, refreshPending, reload]);

  useEffect(() => {
    if (!online || pendingCount === 0 || !supabase) return;
    const timer = window.setTimeout(() => { syncNow().catch(err => setError(err instanceof Error ? err.message : 'Background sync failed.')); }, 350);
    return () => window.clearTimeout(timer);
  }, [online, pendingCount, syncNow]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'BuhurtOS_SYNC_REQUEST') syncNow().catch(() => undefined);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [syncNow]);

  const value = useMemo<AppStateValue>(() => ({ loading, error, event, matches, roster, announcements, user, online, pendingCount, dataMode: isSupabaseConfigured ? 'supabase' : 'demo', reload, updateCompliance, finalizeResult, reorderMatch, setMatchStatus, syncNow, refreshQueue: refreshPending }), [loading, error, event, matches, roster, announcements, user, online, pendingCount, reload, updateCompliance, finalizeResult, reorderMatch, setMatchStatus, syncNow, refreshPending]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider.');
  return ctx;
}

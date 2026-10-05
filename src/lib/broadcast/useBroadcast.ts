import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEvent } from '../../data/api';
import { fetchBroadcastConfig, fetchSides, DEFAULT_BROADCAST, type BroadcastSettings } from '../../data/broadcast';
import type { SideSource } from './sides';
import type { Sponsor } from './sponsors';
import { broadcastScene, type Scene } from './state';
import { arenaFields, buildArena, nextArenaTick, pickField, type ArenaView } from '../arena';
import { eventPhase, todayIso } from '../careerView';
import { supabase } from '../supabase';
import { useArenaData } from '../useArenaData';
import { useAsync } from '../useAsync';
import { useEventRecordWatch } from '../useEventRecordWatch';
import { useLystPublic } from '../lyst/useLystPublic';
import type { ServerClock } from '../lyst/timer';

/** Fallback polling while realtime is down: tighter than the venue display, because a result is what the audience waits to see. */
const BROADCAST_POLL_MS = 5_000;
/** Data older than this is flagged (the overlay keeps showing the last true state, and recovers by itself when the server answers again). */
export const STALE_AFTER_MS = 20_000;

export interface BroadcastData {
  loading: boolean; error: unknown; notPublic: boolean;
  event: { id: string; slug: string; name: string; startsOn: string; endsOn: string; closedAt: string | null } | null;
  field: string; fields: string[];
  view: ArenaView | null; scene: Scene | null;
  settings: BroadcastSettings; sponsors: Sponsor[];
  sides: Record<string, SideSource>;
  clock: ServerClock; stale: boolean; connection: string;
}

/**
 * Everything the broadcast and the public livestream block need, assembled from state that ALREADY exists: the Arena's matches/queue/live-score sync, Pack 13's
 * official lyst state and server clock, the event's broadcast options and sponsors, and the two sides' public presentation records. Read-only. Nothing here
 * keeps a copy of a score or a clock: every value is recomputed from the latest server answers.
 */
export function useBroadcast(slug: string, fieldParam: string | null | undefined): BroadcastData {
  const [recordKey, setRecordKey] = useState(0);
  const loaded = useAsync(() => fetchEvent(slug), [slug, recordKey]);
  const event = loaded.data?.event;
  useEventRecordWatch(event?.id, () => setRecordKey(k => k + 1));
  const competitions = useMemo(() => loaded.data?.competitions ?? [], [loaded.data]);
  const ids = useMemo(() => (event?.status === 'published' ? competitions.map(c => c.id) : []), [event?.status, competitions]);
  const live = useArenaData(ids, { pollMs: BROADCAST_POLL_MS });
  const lyst = useLystPublic(event?.id, ids.length > 0);
  const fields = useMemo(() => arenaFields(live.matches), [live.matches]);
  const field = pickField(fields, fieldParam);

  // the result card has a time limit: wake exactly when it runs out (the Arena's own rule), and keep a coarse tick for "match complete" -> "winner"
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = nextArenaTick(live.matches, field, now);
    const id = window.setTimeout(() => setNow(Date.now()), t === null ? 1000 : Math.max(50, Math.min(t - now, 1000)));
    return () => window.clearTimeout(id);
  }, [live.matches, field, now]);
  useEffect(() => { setNow(Date.now()); }, [live.updatedAt, lyst.updatedAt]);

  const view = useMemo(
    () => (event ? buildArena({ matches: live.matches, scores: live.scores, competitions, field, now, lyst: lyst.rows }) : null),
    [event, live.matches, live.scores, competitions, field, now, lyst.rows]
  );

  // options and sponsors: read once, refreshed by realtime and by a slow poll (public tables)
  const [config, setConfig] = useState<{ settings: BroadcastSettings; sponsors: Sponsor[] }>({ settings: DEFAULT_BROADCAST, sponsors: [] });
  const eventId = event?.id;
  useEffect(() => {
    if (!eventId || event?.status !== 'published') return;
    let alive = true, debounce: number | undefined;
    const load = () => { void fetchBroadcastConfig(eventId).then(c => { if (alive) setConfig({ settings: c.settings, sponsors: c.sponsors }); }, () => undefined); };
    load();
    const poll = window.setInterval(() => { if (!document.hidden) load(); }, 30_000);
    const nudge = () => { window.clearTimeout(debounce); debounce = window.setTimeout(load, 300); };
    const channel = supabase.channel(`broadcast-cfg-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_broadcast', filter: `event_id=eq.${eventId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_sponsors', filter: `event_id=eq.${eventId}` }, nudge)
      .subscribe();
    return () => { alive = false; window.clearInterval(poll); window.clearTimeout(debounce); void supabase.removeChannel(channel); };
  }, [eventId, event?.status]);

  // the sides of the fight on screen, the next fight and the ones after it
  const scene = useMemo(() => (view && event ? broadcastScene(view, { phase: eventPhase(event.startsOn, event.endsOn, todayIso()), nowMs: lyst.clock.now(now) }) : null), [view, event, lyst.clock, now]);
  const entryKey = scene ? [scene.fight, scene.next, ...scene.following.slice(0, 2)].flatMap(f => (f ? [f.entryA ?? '', f.entryB ?? ''] : [])).filter(Boolean).sort().join(',') : '';
  const [sides, setSides] = useState<Record<string, SideSource>>({});
  const recordsKey = useRef('');
  useEffect(() => {
    if (!entryKey) return;
    let alive = true;
    const key = `${entryKey}|${config.settings.showRecords}`;
    if (recordsKey.current === key) return;
    recordsKey.current = key;
    void fetchSides(entryKey.split(','), config.settings.showRecords).then(r => { if (alive) setSides(prev => ({ ...prev, ...r })); }, () => { recordsKey.current = ''; });
    return () => { alive = false; };
  }, [entryKey, config.settings.showRecords]);
  // a finished fight changes the record shown next time: forget what was fetched when a result lands
  const finalCount = live.matches.filter(m => m.queueState === 'final').length;
  useEffect(() => { recordsKey.current = ''; }, [finalCount]);

  const lastOk = Math.max(live.updatedAt ?? 0, lyst.updatedAt ?? 0);
  const stale = lastOk > 0 && now - lastOk > STALE_AFTER_MS;
  return {
    loading: loaded.loading && !loaded.data, error: loaded.error, notPublic: !loaded.loading && loaded.error == null && (!loaded.data || event?.status !== 'published'),
    event: event ? { id: event.id, slug: event.slug, name: event.name, startsOn: event.startsOn, endsOn: event.endsOn, closedAt: event.closedAt ?? null } : null,
    field, fields, view, scene, settings: config.settings, sponsors: config.sponsors, sides, clock: lyst.clock, stale, connection: live.connection
  };
}

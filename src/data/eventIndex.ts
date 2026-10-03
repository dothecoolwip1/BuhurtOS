import { fetchEvents, type LiveEvent } from './api';
import { fetchOrgLites, fetchSeasons } from './careers';
import { loadSynthetic } from './synthetic';
import { supabase } from '../lib/supabase';
import { indexEvents, type EventRole, type IndexedEvent } from '../lib/eventFilters';
import type { OrgLite } from '../lib/careerView';
import { useAsync, type AsyncState } from '../lib/useAsync';

/**
 * The one loader behind the Events list, the Calendar, My events and the platform list: every event the viewer may see (the database
 * decides: published for everyone, drafts for their staff), labelled with test-data flags, organizations and the viewer's own
 * relationships. Fetched once per page; the views only filter and sort.
 */
export interface EventIndex { events: IndexedEvent[]; orgs: OrgLite[]; signedIn: boolean }

/** The signed-in person's relationships to events, from the database (never from platform-wide powers). */
export async function fetchMyEventRelations(): Promise<Map<string, EventRole[]>> {
  const { data, error } = await supabase.rpc('my_event_relations');
  if (error) throw error;
  const out = new Map<string, EventRole[]>();
  for (const r of (data ?? []) as Array<{ event_id: string; role: EventRole }>) out.set(r.event_id, [...(out.get(r.event_id) ?? []), r.role]);
  return out;
}

export async function loadEventIndex(userId: string | undefined): Promise<EventIndex> {
  const [events, orgs, seasons, synthetic, relations] = await Promise.all([
    fetchEvents(), fetchOrgLites(), fetchSeasons(), loadSynthetic(), userId ? fetchMyEventRelations() : Promise.resolve(new Map<string, EventRole[]>())
  ]);
  return { events: indexEvents(events, synthetic, relations, orgs, seasons), orgs, signedIn: Boolean(userId) };
}

export function useEventIndex(userId: string | undefined): AsyncState<EventIndex> {
  return useAsync(() => loadEventIndex(userId), [userId]);
}

export type { IndexedEvent, LiveEvent };

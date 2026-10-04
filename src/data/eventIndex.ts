import { fetchEvents, type LiveEvent } from './api';
import { fetchOrgLites, fetchSeasons } from './careers';
import { fetchMyEvents } from './myEvents';
import { loadSynthetic } from './synthetic';
import { supabase } from '../lib/supabase';
import { indexEvents, type EventRole, type IndexedEvent } from '../lib/eventFilters';
import type { OrgLite } from '../lib/careerView';
import type { MyEvent } from '../lib/myEventsView';
import { useAsync, type AsyncState } from '../lib/useAsync';

/**
 * The one loader behind the Events list, the Calendar, My events and the platform list: every event the viewer may see (the database
 * decides: published for everyone, drafts for their staff), labelled with test-data flags, organizations and the viewer's own
 * relationships. Fetched once per page; the views only filter and sort.
 */
export interface EventIndex {
  events: IndexedEvent[]; orgs: OrgLite[]; signedIn: boolean;
  /** The viewer's own facts per event (registration, fee, check-in, staff roles, pending work), from my_events: the same rule as the roles. */
  mine: Map<string, MyEvent>;
}

/** The signed-in person's relationships to events, from the database (never from platform-wide powers). */
export async function fetchMyEventRelations(): Promise<Map<string, EventRole[]>> {
  const { data, error } = await supabase.rpc('my_event_relations');
  if (error) throw error;
  const out = new Map<string, EventRole[]>();
  for (const r of (data ?? []) as Array<{ event_id: string; role: EventRole }>) out.set(r.event_id, [...(out.get(r.event_id) ?? []), r.role]);
  return out;
}

/** An event the viewer can reach only through their own relationship (row level security hides it from the general read). */
const fromMyEvent = (m: MyEvent): LiveEvent => ({
  id: m.id, slug: m.slug, name: m.name, description: '', eventType: m.eventType, status: m.status, venue: m.venue, address: null, city: m.city, region: m.region, country: null,
  latitude: null, longitude: null, startsOn: m.startsOn, endsOn: m.endsOn, feeCents: 0, feeProvince: null, feeNote: null, registrationOpensAt: null, registrationClosesAt: null,
  leagues: [], registrationMode: m.registrationMode as LiveEvent['registrationMode'], externalUrl: null, timeNote: null, volunteerInfo: null, competitionCount: 0, organizationId: null, seasonId: null
});

export async function loadEventIndex(userId: string | undefined): Promise<EventIndex> {
  const [events, orgs, seasons, synthetic, relations, mine] = await Promise.all([
    fetchEvents(), fetchOrgLites(), fetchSeasons(), loadSynthetic(),
    userId ? fetchMyEventRelations() : Promise.resolve(new Map<string, EventRole[]>()),
    userId ? fetchMyEvents() : Promise.resolve([] as MyEvent[])
  ]);
  // my_events and my_event_relations come from one database rule; an event the viewer is part of but may not read directly (a registration
  // on an event taken back to draft) still belongs on My events and My calendar.
  const seen = new Set(events.map(e => e.id));
  const extra = mine.filter(m => !seen.has(m.id) && relations.has(m.id)).map(fromMyEvent);
  const indexed = indexEvents([...events, ...extra], synthetic, relations, orgs, seasons);
  const onlyMine = new Set(extra.map(e => e.id));
  for (const e of indexed) if (onlyMine.has(e.id)) e.onlyMine = true;
  return { events: indexed, orgs, signedIn: Boolean(userId), mine: new Map(mine.map(m => [m.id, m])) };
}

export function useEventIndex(userId: string | undefined): AsyncState<EventIndex> {
  return useAsync(() => loadEventIndex(userId), [userId]);
}

export type { IndexedEvent, LiveEvent };

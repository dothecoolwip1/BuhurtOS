import { supabase } from '../lib/supabase';
import { createCompetition, type CompetitionInput } from './competitions';
import { setEventOrganization, setEventSeason } from './organizations';
import { createEvent, updateEvent } from './setup';

/** Quick Setup (Pack 09D): one event, its fields and the competitions it offers, through the same database functions as the step-by-step screens. */

export interface QuickEventInput {
  slug: string; name: string; startsOn: string; endsOn: string;
  venue: string | null; address: string | null; city: string | null; region: string | null; country: string | null; latitude: number | null; longitude: number | null;
  fieldCount: number; organizationId: string | null; seasonId: string | null;
  competitions: CompetitionInput[];
}
export interface QuickEventResult { id: string; created: number; problems: string[] }

/**
 * Creates the event (create_event: approved organizers only), then the details that have their own path, then each competition (create_competition).
 * The event exists as soon as the first call succeeds; anything after that which fails is reported (never silently dropped) and can be finished in
 * the event's own screens. Linking an organization or season needs its administrator: when the organizer is not one, the event is simply not linked.
 */
export async function createQuickEvent(i: QuickEventInput): Promise<QuickEventResult> {
  const id = await createEvent({ slug: i.slug, name: i.name, startsOn: i.startsOn, endsOn: i.endsOn, venue: i.venue, address: i.address });
  const problems: string[] = [];
  try { await updateEvent(id, { city: i.city, region: i.region, country: i.country, latitude: i.latitude, longitude: i.longitude }); }
  catch { problems.push('The town, province and map position were not saved. Add them in Event settings.'); }
  try { await updateEvent(id, { field_count: i.fieldCount }); }
  catch { problems.push('The number of fields was not saved (the database update for it may not be applied yet).'); }
  if (i.seasonId) {
    try { await setEventSeason(id, i.seasonId); } catch { problems.push('The season was not linked: only an administrator of its organization can link it.'); }
  } else if (i.organizationId) {
    try { await setEventOrganization(id, i.organizationId); } catch { problems.push('The organization was not linked: only one of its administrators can link an event to it.'); }
  }
  let created = 0;
  for (const c of i.competitions) {
    try { await createCompetition(id, c); created += 1; }
    catch { problems.push(`${c.name} was not created. Add it in Advanced setup.`); }
  }
  return { id, created, problems };
}

export interface PastEvent { id: string; slug: string; name: string; startsOn: string; fieldCount: number }
/** Events this person organizes or organized, newest first, to copy a setup from ("Create event like…"). Only their configuration is ever copied. */
export async function fetchMyPastEvents(userId: string): Promise<PastEvent[]> {
  const { data, error } = await supabase.from('event_staff').select('events(id,slug,name,starts_on,field_count)').eq('user_id', userId).eq('role', 'organizer');
  if (error) {
    // 42703: field_count is not there yet; ask without it.
    if ((error as { code?: string }).code !== '42703') throw error;
    const older = await supabase.from('event_staff').select('events(id,slug,name,starts_on)').eq('user_id', userId).eq('role', 'organizer');
    if (older.error) throw older.error;
    return rows(older.data);
  }
  return rows(data);
}
type Row = { events: { id: string; slug: string; name: string; starts_on: string; field_count?: number } | { id: string; slug: string; name: string; starts_on: string; field_count?: number }[] | null };
function rows(data: unknown): PastEvent[] {
  const out = new Map<string, PastEvent>();
  for (const r of data as Row[]) {
    const e = Array.isArray(r.events) ? r.events[0] : r.events;
    if (e) out.set(e.id, { id: e.id, slug: e.slug, name: e.name, startsOn: e.starts_on, fieldCount: e.field_count ?? 1 });
  }
  return [...out.values()].sort((a, b) => b.startsOn.localeCompare(a.startsOn) || a.name.localeCompare(b.name));
}

import { supabase } from '../lib/supabase';
import { pickMine } from '../lib/draftView';

export type LeagueKey = 'buhurt' | 'duels' | 'outrance' | 'hacsa';
export interface LiveCompetition { id: string; name: string; category: string; league: LeagueKey; gender: 'open' | 'men' | 'women'; ruleset: string | null; status: string }
export interface LiveEvent {
  id: string; slug: string; name: string; description: string; eventType: string; status: 'draft' | 'published' | 'cancelled';
  venue: string | null; address: string | null; city: string | null; region: string | null;
  startsOn: string; endsOn: string; feeCents: number; feeProvince: string | null; feeNote: string | null;
  registrationOpensAt: string | null; registrationClosesAt: string | null; leagues: LeagueKey[];
  registrationMode: 'buhuros' | 'external' | 'none'; externalUrl: string | null; timeNote: string | null; volunteerInfo: string | null;
}
export interface MyEventContext {
  /** Roles on this event from event_staff, plus 'owner' for the platform owner. */
  roles: string[]; isOrganizer: boolean;
  registration: { id: string; status: string; feeDueCents: number; feePaid: boolean } | null;
  pendingRegistrations: number | null;
}

const EVENT_COLUMNS = 'id,slug,name,description,event_type,status,venue,address,city,region,starts_on,ends_on,fee_cents,fee_province,fee_note,registration_opens_at,registration_closes_at,registration_mode,external_url,time_note,volunteer_info';
type EventRow = {
  id: string; slug: string; name: string; description: string; event_type: string; status: LiveEvent['status'];
  venue: string | null; address: string | null; city: string | null; region: string | null; starts_on: string; ends_on: string;
  fee_cents: number; fee_province: string | null; fee_note: string | null; registration_opens_at: string | null; registration_closes_at: string | null;
  registration_mode: LiveEvent['registrationMode']; external_url: string | null; time_note: string | null; volunteer_info: string | null;
};
type Ref = { league: LeagueKey } | { league: LeagueKey }[] | null;
const leagueOf = (r: Ref): LeagueKey => (Array.isArray(r) ? r[0]?.league : r?.league) ?? 'duels';

const toEvent = (r: EventRow, leagues: LeagueKey[] = []): LiveEvent => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description, eventType: r.event_type, status: r.status,
  venue: r.venue, address: r.address, city: r.city, region: r.region, startsOn: r.starts_on, endsOn: r.ends_on,
  feeCents: r.fee_cents, feeProvince: r.fee_province, feeNote: r.fee_note,
  registrationOpensAt: r.registration_opens_at, registrationClosesAt: r.registration_closes_at, leagues,
  registrationMode: r.registration_mode ?? 'buhuros', externalUrl: r.external_url, timeNote: r.time_note, volunteerInfo: r.volunteer_info ?? null
});

/** Events the caller may see. The database decides: published events for everyone, drafts only for their organizers. */
export async function fetchEvents(): Promise<LiveEvent[]> {
  const { data, error } = await supabase.from('events').select(`${EVENT_COLUMNS},competitions(ref_categories(league))`).order('starts_on');
  if (error) throw error;
  type Row = EventRow & { competitions: { ref_categories: Ref }[] };
  return (data as unknown as Row[]).map(r => toEvent(r, [...new Set(r.competitions.map(c => leagueOf(c.ref_categories)))]));
}

export async function fetchEvent(slug: string): Promise<{ event: LiveEvent; competitions: LiveCompetition[] } | null> {
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as EventRow;
  const c = await supabase.from('competitions').select('id,name,category,gender,ruleset,status,sort,ref_categories(league)').eq('event_id', row.id).order('sort');
  if (c.error) throw c.error;
  type CRow = { id: string; name: string; category: string; gender: LiveCompetition['gender']; ruleset: string | null; status: string; ref_categories: Ref };
  const competitions = (c.data as unknown as CRow[]).map(k => ({ id: k.id, name: k.name, category: k.category, gender: k.gender, ruleset: k.ruleset, status: k.status, league: leagueOf(k.ref_categories) }));
  return { event: toEvent(row, [...new Set(competitions.map(k => k.league))]), competitions };
}

/** What the signed-in person is to this event. Each query is limited by the database to what they may see. */
export async function fetchMyEventContext(eventId: string, userId: string): Promise<MyEventContext> {
  const [staff, platform, reg] = await Promise.all([
    supabase.from('event_staff').select('role').eq('event_id', eventId).eq('user_id', userId),
    supabase.from('platform_roles').select('role').eq('user_id', userId),
    supabase.from('registrations').select('id,status,fee_due_cents,fee_paid').eq('event_id', eventId).eq('user_id', userId).maybeSingle()
  ]);
  if (staff.error) throw staff.error;
  if (platform.error) throw platform.error;
  if (reg.error) throw reg.error;
  const roles = [...(staff.data ?? []).map(r => r.role as string), ...(platform.data ?? []).filter(r => r.role === 'owner').map(() => 'owner')];
  const isOrganizer = roles.includes('organizer') || roles.includes('owner');
  let pending: number | null = null;
  if (isOrganizer) {
    const p = await supabase.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('status', 'pending');
    if (p.error) throw p.error;
    pending = p.count ?? 0;
  }
  const r = reg.data as { id: string; status: string; fee_due_cents: number; fee_paid: boolean } | null;
  return { roles, isOrganizer, registration: r ? { id: r.id, status: r.status, feeDueCents: r.fee_due_cents, feePaid: r.fee_paid } : null, pendingRegistrations: pending };
}

/** Events the signed-in person staffs (the platform owner: every event they can read), drafts included. Same query as the events list. */
export async function fetchMyEvents(userId: string): Promise<LiveEvent[]> {
  const [all, staff, platform] = await Promise.all([
    fetchEvents(),
    supabase.from('event_staff').select('event_id').eq('user_id', userId),
    supabase.from('platform_roles').select('role').eq('user_id', userId)
  ]);
  if (staff.error) throw staff.error;
  if (platform.error) throw platform.error;
  const ids = new Set((staff.data ?? []).map(r => r.event_id as string));
  return pickMine(all, ids, (platform.data ?? []).some(r => r.role === 'owner'));
}

/** The name the signed-in person goes by on BuhurtOS (organizers and captains see it on requests). Empty when never set. */
export async function fetchMyDisplayName(userId: string): Promise<string> {
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  if (error) throw error;
  return (data as { display_name: string } | null)?.display_name ?? '';
}
export async function saveMyDisplayName(userId: string, name: string): Promise<void> {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 80) throw new Error('Use 2 to 80 characters.');
  const { error } = await supabase.from('profiles').update({ display_name: clean }).eq('id', userId);
  if (error) throw error;
}

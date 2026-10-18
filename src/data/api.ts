import { supabase } from '../lib/supabase';
import { deviceRoles, isDeviceMode, storedWhoami } from '../lib/deviceSession';
import { isOperatorRole } from '../lib/deviceRoutes';

export type LeagueKey = 'buhurt' | 'duels' | 'outrance' | 'hacsa';
export interface LiveCompetition {
  id: string; name: string; category: string; league: LeagueKey; gender: 'open' | 'men' | 'women'; ruleset: string | null; status: string;
  /** Running order of the event's competitions (the Sort column). */ sort?: number;
  /** Pack 09C: when the placings became official; when an official result was last reopened (null: never / not applicable). */
  finalizedAt?: string | null; reopenedAt?: string | null;
  /** How the competition is fought: round robin, pools then a bracket, or a bracket (Pack 26: the progress rule needs it to know a bracket is still owed). */
  structure?: 'round_robin' | 'pools_elimination' | 'elimination' | null;
}
export interface LiveEvent {
  id: string; slug: string; name: string; description: string; eventType: string; status: 'draft' | 'published' | 'cancelled';
  venue: string | null; address: string | null; city: string | null; region: string | null; country: string | null;
  latitude: number | null; longitude: number | null;
  startsOn: string; endsOn: string; feeCents: number; feeProvince: string | null; feeNote: string | null;
  registrationOpensAt: string | null; registrationClosesAt: string | null; leagues: LeagueKey[];
  registrationMode: 'buhuros' | 'external' | 'none'; externalUrl: string | null; timeNote: string | null; volunteerInfo: string | null;
  /** Pack 26: the tournament's page on buhurtinternational.com, when the organizer set one. Absent in older fixtures. */
  biTournamentUrl?: string | null;
  /** The event's own time zone (IANA): the venue's clock decides which day it is (Pack 25). Absent in older fixtures: Mountain time is assumed. */
  timezone?: string;
  /** How many competitions the event has (0 for a tournament draft means "needs competition setup"). */
  competitionCount: number;
  organizationId: string | null; seasonId: string | null;
  /** Pack 09C: set once the organizer closed the event (every competition official); when it was last reopened. */
  closedAt?: string | null; reopenedAt?: string | null;
  /** Pack 09D lifecycle: archived (hidden from current browsing, still counts), excluded from official statistics (with the reason), number of fields. */
  archivedAt?: string | null; statsExcludedAt?: string | null; statsExcludedReason?: string | null; fieldCount?: number;
}
export interface MyEventContext {
  /** Roles on this event from event_staff, plus 'owner' for the platform owner. */
  roles: string[]; isOrganizer: boolean;
  registration: { id: string; status: string; feeDueCents: number; feePaid: boolean } | null;
  pendingRegistrations: number | null;
}

const EVENT_COLUMNS_09C = 'id,slug,name,description,event_type,status,venue,address,city,region,country,latitude,longitude,starts_on,ends_on,timezone,fee_cents,fee_province,fee_note,registration_opens_at,registration_closes_at,registration_mode,external_url,time_note,volunteer_info,organization_id,season_id,closed_at,reopened_at';
/** Pack 09D adds the lifecycle and the number of fields. A database without them (42703) is asked again with the older list. */
const EVENT_COLUMNS = `${EVENT_COLUMNS_09C},archived_at,stats_excluded_at,stats_excluded_reason,field_count,bi_tournament_url`;
const missingColumn = (e: unknown) => (e as { code?: string } | null)?.code === '42703';
type EventRow = {
  id: string; slug: string; name: string; description: string; event_type: string; status: LiveEvent['status'];
  venue: string | null; address: string | null; city: string | null; region: string | null; country: string | null; latitude: number | null; longitude: number | null; starts_on: string; ends_on: string; timezone?: string | null;
  organization_id: string | null; season_id: string | null;
  fee_cents: number; fee_province: string | null; fee_note: string | null; registration_opens_at: string | null; registration_closes_at: string | null;
  registration_mode: LiveEvent['registrationMode']; external_url: string | null; time_note: string | null; volunteer_info: string | null;
  closed_at?: string | null; reopened_at?: string | null;
  archived_at?: string | null; stats_excluded_at?: string | null; stats_excluded_reason?: string | null; field_count?: number | null;
  bi_tournament_url?: string | null;
};
type Ref = { league: LeagueKey } | { league: LeagueKey }[] | null;
const leagueOf = (r: Ref): LeagueKey => (Array.isArray(r) ? r[0]?.league : r?.league) ?? 'duels';

const toEvent = (r: EventRow, leagues: LeagueKey[] = [], competitionCount = 0): LiveEvent => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description, eventType: r.event_type, status: r.status,
  closedAt: r.closed_at ?? null, reopenedAt: r.reopened_at ?? null,
  archivedAt: r.archived_at ?? null, statsExcludedAt: r.stats_excluded_at ?? null, statsExcludedReason: r.stats_excluded_reason ?? null, fieldCount: r.field_count ?? 1,
  venue: r.venue, address: r.address, city: r.city, region: r.region, country: r.country ?? null, latitude: r.latitude ?? null, longitude: r.longitude ?? null, startsOn: r.starts_on, endsOn: r.ends_on, timezone: r.timezone ?? 'America/Edmonton',
  competitionCount, organizationId: r.organization_id ?? null, seasonId: r.season_id ?? null,
  feeCents: r.fee_cents, feeProvince: r.fee_province, feeNote: r.fee_note,
  registrationOpensAt: r.registration_opens_at, registrationClosesAt: r.registration_closes_at, leagues,
  registrationMode: r.registration_mode ?? 'buhuros', externalUrl: r.external_url, timeNote: r.time_note, volunteerInfo: r.volunteer_info ?? null,
  biTournamentUrl: r.bi_tournament_url ?? null
});

/** Events the caller may see. The database decides: published events for everyone, drafts only for their organizers. */
export async function fetchEvents(): Promise<LiveEvent[]> {
  let res: { data: unknown; error: unknown } = await supabase.from('events').select(`${EVENT_COLUMNS},competitions(ref_categories(league))`).order('starts_on');
  if (res.error && missingColumn(res.error)) res = await supabase.from('events').select(`${EVENT_COLUMNS_09C},competitions(ref_categories(league))`).order('starts_on');
  const { data, error } = res;
  if (error) throw error;
  type Row = EventRow & { competitions: { ref_categories: Ref }[] };
  return (data as unknown as Row[]).map(r => toEvent(r, [...new Set((r.competitions ?? []).map(c => leagueOf(c.ref_categories)))], (r.competitions ?? []).length));
}

export async function fetchEvent(slug: string): Promise<{ event: LiveEvent; competitions: LiveCompetition[] } | null> {
  let res: { data: unknown; error: unknown } = await supabase.from('events').select(EVENT_COLUMNS).eq('slug', slug).maybeSingle();
  if (res.error && missingColumn(res.error)) res = await supabase.from('events').select(EVENT_COLUMNS_09C).eq('slug', slug).maybeSingle();
  const { data, error } = res;
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as EventRow;
  const c = await supabase.from('competitions').select('id,name,category,gender,ruleset,status,sort,finalized_at,reopened_at,structure,ref_categories(league)').eq('event_id', row.id).order('sort');
  if (c.error) throw c.error;
  type CRow = { id: string; name: string; category: string; gender: LiveCompetition['gender']; ruleset: string | null; status: string; sort?: number; finalized_at?: string | null; reopened_at?: string | null; structure?: LiveCompetition['structure']; ref_categories: Ref };
  const competitions = (c.data as unknown as CRow[]).map(k => ({ id: k.id, name: k.name, category: k.category, gender: k.gender, ruleset: k.ruleset, status: k.status, sort: k.sort ?? 0, league: leagueOf(k.ref_categories), finalizedAt: k.finalized_at ?? null, reopenedAt: k.reopened_at ?? null, structure: k.structure ?? null }));
  return { event: toEvent(row, [...new Set(competitions.map(k => k.league))], competitions.length), competitions };
}

/** What the signed-in person is to this event. Each query is limited by the database to what they may see. */
export async function fetchMyEventContext(eventId: string, userId: string): Promise<MyEventContext> {
  // A temporary event device (Pack 18.1) has no staff rows, platform role or registration, and the database refuses those tables to it. What it is
  // comes from its own session: its roles on ITS event only (display; the database decides every action). A Temporary Organizer also counts as an
  // 'operator' (organizer powers on this event) but is never an organizer.
  if (isDeviceMode()) {
    const w = storedWhoami();
    const mine = w && w.event.id === eventId;
    const roles = mine ? [...deviceRoles(w), ...(isOperatorRole(w.role) ? ['operator'] : [])] : [];
    return { roles, isOrganizer: false, registration: null, pendingRegistrations: null };
  }
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

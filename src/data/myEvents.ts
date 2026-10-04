import { supabase } from '../lib/supabase';
import type { MyEvent } from '../lib/myEventsView';

type Row = {
  id: string; slug: string; name: string; status: MyEvent['status']; event_type: string; starts_on: string; ends_on: string; city: string | null; region: string | null; venue: string | null;
  registration_mode: string; synthetic: boolean; staff_roles: string[]; registration_id: string | null; registration_status: string | null; fee_due_cents: number | null; fee_paid: boolean | null;
  insurance: string | null; is_volunteer: boolean | null; checked_in: boolean; fighter_entry: boolean; captain_entry: boolean; pending_registrations: number | null;
};

/** Events the signed-in person has a direct relationship with (my_events: staff role, own registration, own fighter's entry, captained team's entry). */
export async function fetchMyEvents(): Promise<MyEvent[]> {
  const { data, error } = await supabase.rpc('my_events');
  if (error) throw error;
  return (data as Row[]).map(r => ({
    id: r.id, slug: r.slug, name: r.name, status: r.status, eventType: r.event_type, startsOn: r.starts_on, endsOn: r.ends_on, city: r.city, region: r.region, venue: r.venue,
    registrationMode: r.registration_mode, synthetic: r.synthetic, staffRoles: r.staff_roles ?? [],
    registration: r.registration_id ? { id: r.registration_id, status: r.registration_status ?? 'pending', feeDueCents: r.fee_due_cents ?? 0, feePaid: r.fee_paid ?? false, insurance: r.insurance ?? '', isVolunteer: r.is_volunteer ?? false, checkedIn: r.checked_in } : null,
    fighterEntry: r.fighter_entry, captainEntry: r.captain_entry, pendingRegistrations: r.pending_registrations
  }));
}

export interface MyRegistration {
  id: string; status: string; fullName: string; feeDueCents: number; feePaid: boolean; insurance: string; isVolunteer: boolean; attendDates: string[]; days: string[];
  categories: string[]; teamName: string | null; createdAt: string; waiverVersion: number | null;
}
/** The person's own registration for an event (RLS: only their own row is readable). Null when they never registered. */
export async function fetchMyRegistration(eventId: string, userId: string): Promise<MyRegistration | null> {
  const { data, error } = await supabase.from('registrations')
    .select('id,status,full_name,fee_due_cents,fee_paid,insurance,is_volunteer,attend_dates,days,team_name,created_at,teams(name),registration_competitions(competitions!registration_competitions_competition_id_fkey(name)),waiver_versions(version)')
    .eq('event_id', eventId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  type R = { id: string; status: string; full_name: string; fee_due_cents: number; fee_paid: boolean; insurance: string; is_volunteer: boolean; attend_dates: string[] | null; days: string[]; team_name: string | null; created_at: string;
    teams: { name: string } | { name: string }[] | null; registration_competitions: Array<{ competitions: { name: string } | { name: string }[] | null }> | null; waiver_versions: { version: number } | { version: number }[] | null };
  const r = data as unknown as R;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
  return {
    id: r.id, status: r.status, fullName: r.full_name, feeDueCents: r.fee_due_cents, feePaid: r.fee_paid, insurance: r.insurance, isVolunteer: r.is_volunteer,
    attendDates: r.attend_dates ?? [], days: r.days ?? [], teamName: one(r.teams)?.name ?? r.team_name, createdAt: r.created_at, waiverVersion: one(r.waiver_versions)?.version ?? null,
    categories: (r.registration_competitions ?? []).map(c => one(c.competitions)?.name).filter((x): x is string => Boolean(x))
  };
}

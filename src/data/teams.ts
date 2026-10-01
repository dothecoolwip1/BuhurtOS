import { supabase } from '../lib/supabase';
import type { ClearanceRow } from '../lib/teamClearance';

export interface TeamRow { id: string; slug: string; name: string; city: string | null; region: string | null; country: string | null; status: 'pending' | 'approved'; createdAt: string }

/** Row level security shows organizers every team, including ones still waiting for approval. */
export async function fetchAllTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase.from('teams').select('id,slug,name,city,region,country,status,created_at').order('created_at');
  if (error) throw error;
  return (data as { id: string; slug: string; name: string; city: string | null; region: string | null; country: string | null; status: 'pending' | 'approved'; created_at: string }[])
    .map(t => ({ id: t.id, slug: t.slug, name: t.name, city: t.city, region: t.region, country: t.country, status: t.status, createdAt: t.created_at }));
}

export async function approveTeam(teamId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_team', { p_team: teamId });
  if (error) throw error;
}

/** Moves everything from `remove` onto `keep` and deletes `remove`. The database refuses if both have entries in one competition. */
export async function mergeTeams(keepId: string, removeId: string): Promise<void> {
  const { error } = await supabase.rpc('merge_teams', { p_keep: keepId, p_remove: removeId });
  if (error) throw error;
}

export interface MyTeamRoster { teamId: string; teamName: string; rows: ClearanceRow[] }

type ClearanceDb = { registration_id: string; full_name: string; status: 'pending' | 'accepted'; is_volunteer: boolean; waiver_signed: boolean; insurance_ok: boolean; checked_in: boolean; kit_passed: boolean };

/**
 * The teams this person captains that are registered in the event, each with its roster and what is missing.
 * team_clearance is a database function that only answers for a captain of that team (or an organizer) and returns no health data.
 * A team counts as registered when it has a roster row or an entry in one of the event's competitions.
 */
export async function fetchMyTeamRosters(eventId: string): Promise<MyTeamRoster[]> {
  const roles = await supabase.from('team_roles').select('team_id,teams(name)').eq('role', 'captain');
  if (roles.error) throw roles.error;
  const mine = (roles.data as unknown as { team_id: string; teams: { name: string } | { name: string }[] | null }[])
    .map(r => ({ teamId: r.team_id, teamName: (Array.isArray(r.teams) ? r.teams[0] : r.teams)?.name ?? 'Your team' }));
  if (mine.length === 0) return [];
  const entries = await supabase.from('entries').select('team_id,competitions!inner(event_id)').eq('competitions.event_id', eventId).in('team_id', mine.map(m => m.teamId));
  if (entries.error) throw entries.error;
  const entered = new Set((entries.data as unknown as { team_id: string }[]).map(e => e.team_id));
  const out: MyTeamRoster[] = [];
  for (const m of mine) {
    const { data, error } = await supabase.rpc('team_clearance', { p_event: eventId, p_team: m.teamId });
    if (error) throw error;
    const rows = (data as ClearanceDb[]).map(r => ({
      registrationId: r.registration_id, fullName: r.full_name, status: r.status, isVolunteer: r.is_volunteer,
      waiverSigned: r.waiver_signed, insuranceOk: r.insurance_ok, checkedIn: r.checked_in, kitPassed: r.kit_passed
    }));
    if (rows.length > 0 || entered.has(m.teamId)) out.push({ teamId: m.teamId, teamName: m.teamName, rows });
  }
  return out;
}

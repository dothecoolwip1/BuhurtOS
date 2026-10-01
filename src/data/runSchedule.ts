import { supabase } from '../lib/supabase';
import type { RosterMember } from '../lib/runSchedule';

/** Data for the Run tab schedule and roster editor. Writes use the organizer-writable match columns and set_entry_roster. */

export const DEFAULT_TIME_ZONE = 'America/Edmonton';

export async function fetchEventTimeZone(eventId: string): Promise<string> {
  const { data, error } = await supabase.from('events').select('timezone').eq('id', eventId).maybeSingle();
  if (error) throw error;
  return (data as { timezone: string | null } | null)?.timezone || DEFAULT_TIME_ZONE;
}

/** Match length in minutes, by match id, for one competition. */
export async function fetchMatchDurations(competitionId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('matches').select('id,duration_minutes').eq('competition_id', competitionId);
  if (error) throw error;
  return new Map((data as { id: string; duration_minutes: number }[]).map(r => [r.id, Number(r.duration_minutes)]));
}

export interface ScheduleChange { scheduledAt: string | null; field: string | null; durationMinutes: number }
/** Sets time, field and length of one match. A null time or field clears it. Final matches are refused by the database triggers/policies as usual. */
export async function saveMatchSchedule(matchId: string, c: ScheduleChange): Promise<void> {
  const { error } = await supabase.from('matches').update({ scheduled_at: c.scheduledAt, field: c.field && c.field.trim() ? c.field.trim() : null, duration_minutes: c.durationMinutes }).eq('id', matchId);
  if (error) throw error;
}

/** Everyone on a team-entry roster in a competition. */
export async function fetchCompetitionRoster(competitionId: string): Promise<RosterMember[]> {
  const { data, error } = await supabase.from('entry_roster').select('entry_id,fighter_id,display_name').eq('competition_id', competitionId);
  if (error) throw error;
  return (data as { entry_id: string; fighter_id: string; display_name: string }[]).map(r => ({ entryId: r.entry_id, fighterId: r.fighter_id, displayName: r.display_name }));
}

export interface FighterOption { fighterId: string; displayName: string; homeTeamId: string | null; homeTeamName: string | null }
type FighterRow = { id: string; display_name: string; team_id: string | null; teams: { name: string } | { name: string }[] | null };
const toOption = (r: FighterRow): FighterOption => {
  const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
  return { fighterId: r.id, displayName: r.display_name, homeTeamId: r.team_id, homeTeamName: t?.name ?? null };
};

/** Fighters whose home team is this team. */
export async function fetchTeamFighters(teamId: string): Promise<FighterOption[]> {
  const { data, error } = await supabase.from('fighters').select('id,display_name,team_id,teams(name)').eq('team_id', teamId).order('display_name').limit(100);
  if (error) throw error;
  return (data as unknown as FighterRow[]).map(toOption);
}

/** Search every fighter by name (any team, or none). */
export async function searchFighters(query: string): Promise<FighterOption[]> {
  const q = query.trim().replace(/[%_,()\\]/g, ' ').trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.from('fighters').select('id,display_name,team_id,teams(name)').ilike('display_name', `%${q}%`).order('display_name').limit(15);
  if (error) throw error;
  return (data as unknown as FighterRow[]).map(toOption);
}

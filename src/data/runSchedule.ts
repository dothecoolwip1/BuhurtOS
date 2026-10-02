import { supabase } from '../lib/supabase';
import type { ResolveMatch } from '../lib/autoResolve';
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

// ---------------------------------------------------------------- whole-event schedule for the automatic fix

/** Every match of the event with who stands in it, ready for resolveSchedule(). Team sides count through their roster. */
export type EventResolveMatch = ResolveMatch & { competitionId: string };
export async function fetchEventResolveInput(eventId: string): Promise<EventResolveMatch[]> {
  const comps = await supabase.from('competitions').select('id,sort').eq('event_id', eventId);
  if (comps.error) throw comps.error;
  const compRows = comps.data as { id: string; sort: number | null }[];
  if (compRows.length === 0) return [];
  const ids = compRows.map(c => c.id);
  const sortOf = new Map(compRows.map(c => [c.id, c.sort ?? 0]));
  const [matches, entries, roster] = await Promise.all([
    supabase.from('matches').select('id,competition_id,position,scheduled_at,duration_minutes,field,queue_state,entry_a,entry_b,next_match_id').in('competition_id', ids),
    supabase.from('entries').select('id,fighter_id').in('competition_id', ids),
    supabase.from('entry_roster').select('entry_id,fighter_id').in('competition_id', ids)
  ]);
  if (matches.error) throw matches.error;
  if (entries.error) throw entries.error;
  if (roster.error) throw roster.error;
  const people = new Map<string, string[]>();
  for (const e of entries.data as { id: string; fighter_id: string | null }[]) if (e.fighter_id) people.set(e.id, [e.fighter_id]);
  for (const r of roster.data as { entry_id: string; fighter_id: string }[]) people.set(r.entry_id, [...(people.get(r.entry_id) ?? []), r.fighter_id]);
  type Row = { id: string; competition_id: string; position: number; scheduled_at: string | null; duration_minutes: number; field: string | null; queue_state: string; entry_a: string | null; entry_b: string | null; next_match_id: string | null };
  const rows = matches.data as Row[];
  const feeders = new Map<string, string[]>();
  for (const r of rows) if (r.next_match_id) feeders.set(r.next_match_id, [...(feeders.get(r.next_match_id) ?? []), r.id]);
  return rows.map(r => ({
    id: r.id, competitionId: r.competition_id, scheduledAt: r.scheduled_at, durationMinutes: Number(r.duration_minutes) || 15, field: r.field,
    fighters: [...new Set([...(r.entry_a ? people.get(r.entry_a) ?? [] : []), ...(r.entry_b ? people.get(r.entry_b) ?? [] : [])])],
    feeders: feeders.get(r.id) ?? [], locked: r.queue_state !== 'scheduled', order: (sortOf.get(r.competition_id) ?? 0) * 10000 + r.position
  }));
}

/** Moves one match to a new start time; field and length stay as they are. */
export async function moveMatchTime(matchId: string, scheduledAt: string): Promise<void> {
  const { error } = await supabase.from('matches').update({ scheduled_at: scheduledAt }).eq('id', matchId).eq('queue_state', 'scheduled');
  if (error) throw error;
}

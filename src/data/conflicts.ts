import { supabase } from '../lib/supabase';

/**
 * Scheduling conflicts: the same fighter booked in two matches of one event whose time windows overlap.
 * A match runs [scheduled_at, scheduled_at + duration_minutes). Final and unscheduled matches are ignored; a match that starts exactly when
 * another ends is not a conflict. Team entries count through their roster (set_entry_roster), duel entries through the fighter.
 * Event staff only (the database refuses anyone else).
 */
export interface ScheduleConflict {
  fighterId: string; displayName: string; matchA: string; matchB: string; competitionA: string; competitionB: string;
  scheduledA: string; scheduledB: string; overlapMinutes: number;
}
type ConflictDb = {
  fighter_id: string; display_name: string; match_a: string; match_b: string; competition_a: string; competition_b: string;
  scheduled_a: string; scheduled_b: string; overlap_minutes: number | string;
};
export const toScheduleConflict = (r: ConflictDb): ScheduleConflict => ({
  fighterId: r.fighter_id, displayName: r.display_name, matchA: r.match_a, matchB: r.match_b, competitionA: r.competition_a, competitionB: r.competition_b,
  scheduledA: r.scheduled_a, scheduledB: r.scheduled_b, overlapMinutes: Number(r.overlap_minutes)
});

export async function fetchScheduleConflicts(eventId: string): Promise<ScheduleConflict[]> {
  const { data, error } = await supabase.rpc('fighter_schedule_conflicts', { p_event: eventId });
  if (error) throw error;
  return (data as ConflictDb[]).map(toScheduleConflict);
}

/** Conflicts grouped per fighter, most conflicted first (ties by name). */
export function groupConflictsByFighter(rows: ScheduleConflict[]): Array<{ fighterId: string; displayName: string; conflicts: ScheduleConflict[] }> {
  const by = new Map<string, { fighterId: string; displayName: string; conflicts: ScheduleConflict[] }>();
  for (const c of rows) {
    const g = by.get(c.fighterId) ?? { fighterId: c.fighterId, displayName: c.displayName, conflicts: [] };
    g.conflicts.push(c);
    by.set(c.fighterId, g);
  }
  return [...by.values()].sort((a, b) => b.conflicts.length - a.conflicts.length || a.displayName.localeCompare(b.displayName));
}
/** The set of match ids that are part of any conflict, to mark them on a schedule board. */
export const conflictedMatchIds = (rows: ScheduleConflict[]): Set<string> => new Set(rows.flatMap(c => [c.matchA, c.matchB]));
/** One line for a warning banner. */
export const describeConflict = (c: ScheduleConflict): string => `${c.displayName} is booked in two matches that overlap by ${c.overlapMinutes} minute${c.overlapMinutes === 1 ? '' : 's'}.`;

export interface Booking { matchId: string; competitionId: string; competitionName: string; scheduledAt: string; durationMinutes: number; overlapMinutes: number }
type BookingDb = { match_id: string; competition_id: string; competition_name: string; scheduled_at: string; duration_minutes: number | string; overlap_minutes: number | string };
export const toBooking = (r: BookingDb): Booking => ({
  matchId: r.match_id, competitionId: r.competition_id, competitionName: r.competition_name, scheduledAt: r.scheduled_at,
  durationMinutes: Number(r.duration_minutes), overlapMinutes: Number(r.overlap_minutes)
});

export interface BookingQuery { eventId: string; fighterId: string; at: string; minutes?: number; excludeMatchId?: string | null }
const bookingArgs = (q: BookingQuery) => ({ p_event: q.eventId, p_fighter: q.fighterId, p_at: q.at, p_minutes: q.minutes ?? 15, p_exclude_match: q.excludeMatchId ?? null });
export const bookingArgsFor = bookingArgs;

/** Which matches would overlap if this fighter were put at `at` for `minutes` (default 15). Empty = free. Pass excludeMatchId to ignore the match being edited. */
export async function fetchFighterBookings(q: BookingQuery): Promise<Booking[]> {
  const { data, error } = await supabase.rpc('fighter_bookings', bookingArgs(q));
  if (error) throw error;
  return (data as BookingDb[]).map(toBooking);
}
export async function isFighterBooked(q: BookingQuery): Promise<boolean> {
  const { data, error } = await supabase.rpc('fighter_is_booked', bookingArgs(q));
  if (error) throw error;
  return data === true;
}

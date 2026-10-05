import { supabase } from '../lib/supabase';
import type { RegistrationFlag } from '../lib/eventDay';
import type { RosterMember } from '../lib/runSchedule';

/** Event day reads and queue commands. Every command is a database function that checks the caller again; the screen only decides what to show. */

export type QueueMove = 'first' | 'earlier' | 'later' | 'skip';
export interface AdvanceResult { promoted: Array<{ match: string; to: 'active' | 'on_deck' | 'in_the_hole' }>; demoted: string[] }

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

/**
 * "Start the next match" / "fill the queue" for one field. Anyone who can score the event may call it. The database fills the gaps from the top and never
 * promotes a match that cannot run; calling it again changes nothing. `start` false fills on deck and in the hole but starts nothing.
 */
export async function advanceFieldQueue(eventId: string, field: string | null, start = true): Promise<AdvanceResult> {
  const d = (await rpc('advance_field_queue', { p_event: eventId, p_field: field, p_start: start })) as Partial<AdvanceResult> | null;
  return { promoted: d?.promoted ?? [], demoted: d?.demoted ?? [] };
}

/** Run a waiting match sooner or later, make it next, or skip it for now. Organizers only. `changed` is false when it was already there. */
export async function moveMatchInQueue(matchId: string, action: QueueMove): Promise<{ changed: boolean }> {
  const d = (await rpc('move_match_in_queue', { p_match: matchId, p_action: action })) as { changed?: boolean } | null;
  return { changed: d?.changed === true };
}

/** Everyone on a team-entry roster, across the event's competitions, in one request. */
export async function fetchEventRoster(competitionIds: readonly string[]): Promise<RosterMember[]> {
  if (competitionIds.length === 0) return [];
  const { data, error } = await supabase.from('entry_roster').select('entry_id,fighter_id,display_name').in('competition_id', [...competitionIds]);
  if (error) throw error;
  return (data as { entry_id: string; fighter_id: string; display_name: string }[]).map(r => ({ entryId: r.entry_id, fighterId: r.fighter_id, displayName: r.display_name }));
}

/**
 * Who is checked in, for the people who have a registration on this event. Only the columns check-in needs: no contact, medical or emergency data.
 * Organizers only (row level security), so a scorekeeper simply gets nothing back.
 */
export async function fetchRegistrationFlags(eventId: string): Promise<RegistrationFlag[]> {
  const { data, error } = await supabase.from('registrations').select('id,fighter_id,full_name,status,is_volunteer,attend_dates,shares_equipment,registration_checks(check_name,passed)').eq('event_id', eventId).not('fighter_id', 'is', null);
  if (error) throw error;
  type Row = { id: string; fighter_id: string; full_name: string; status: RegistrationFlag['status']; is_volunteer: boolean; attend_dates: string[] | null; shares_equipment: boolean | null; registration_checks: { check_name: string; passed: boolean }[] };
  return (data as unknown as Row[]).map(r => ({
    id: r.id, fighterId: r.fighter_id, fullName: r.full_name, status: r.status, isVolunteer: r.is_volunteer,
    checkedIn: r.registration_checks.some(c => c.check_name === 'checked_in' && c.passed),
    attendDates: r.attend_dates ?? [], sharesEquipment: r.shares_equipment === true
  }));
}

/**
 * Save the planner's order of waiting fights (Pack 09D). Organizers only; the database touches only waiting fights of this event, never a called one,
 * and saving the same plan twice changes nothing. `hold` = fights someone in them cannot attend today: the queue will not call them by itself.
 */
export async function saveQueuePlan(eventId: string, order: readonly string[], hold: readonly string[]): Promise<{ changed: number }> {
  const d = (await rpc('save_queue_plan', { p_event: eventId, p_order: [...order], p_hold: [...hold] })) as { changed?: number } | null;
  return { changed: d?.changed ?? 0 };
}

/** "Let BuhurtOS plan this field again": forget the hand-made order of one field's waiting fights. Organizers only. */
export async function clearManualQueue(eventId: string, field: string): Promise<{ changed: number }> {
  const d = (await rpc('clear_manual_queue', { p_event: eventId, p_field: field })) as { changed?: number } | null;
  return { changed: d?.changed ?? 0 };
}

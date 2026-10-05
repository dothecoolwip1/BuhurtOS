import { supabase } from '../lib/supabase';

/**
 * Pack 09D lifecycle commands. Every one is a database function that checks the caller and writes the audit trail; the screens only decide what to show.
 * Archive = presentation (still counts). Exclude = statistics (results stay stored). Delete = disposable drafts only (the database refuses anything else).
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const archiveEvent = (eventId: string, note: string | null) => rpc<{ status: string }>('archive_event', { p_event: eventId, p_note: note });
export const unarchiveEvent = (eventId: string) => rpc<{ status: string }>('unarchive_event', { p_event: eventId });
export const excludeEventFromStats = (eventId: string, reason: string) => rpc<{ status: string; results?: number }>('exclude_event_from_stats', { p_event: eventId, p_reason: reason.trim() });
export const restoreEventStats = (eventId: string, reason: string) => rpc<{ status: string; results?: number }>('restore_event_stats', { p_event: eventId, p_reason: reason.trim() });
export interface DeleteCheck { blockers: string[]; registrations: number; competitions: number }
export const eventDeleteCheck = (eventId: string) => rpc<DeleteCheck>('event_delete_check', { p_event: eventId });
export const deleteEvent = (eventId: string, confirm: string) => rpc<{ status: string }>('delete_event', { p_event: eventId, p_confirm: confirm.trim() });

/** What stops a delete, in plain words. */
export const DELETE_BLOCKER_TEXT: Record<string, string> = {
  published: 'it has been published (people may have seen or registered for it)',
  closed: 'it is closed (its results are history)',
  official_results: 'it has official results',
  result_history: 'it has a result history',
  fights_fought: 'fights have been fought',
  official_competition: 'a competition is official'
};

// ---------------------------------------------------------------- fighters
export interface FighterLifecycle { inactiveAt: string | null; inactiveReason: string | null }
/** Public: whether a fighter is currently competing. A database without the column (42703) reads as active. */
export async function fetchFighterLifecycle(fighterId: string): Promise<FighterLifecycle> {
  const { data, error } = await supabase.from('fighters').select('inactive_at,inactive_reason').eq('id', fighterId).maybeSingle();
  if (error && (error as { code?: string }).code === '42703') return { inactiveAt: null, inactiveReason: null };
  if (error) throw error;
  const r = data as { inactive_at: string | null; inactive_reason: string | null } | null;
  return { inactiveAt: r?.inactive_at ?? null, inactiveReason: r?.inactive_reason ?? null };
}
/** The fighter themself, a captain or administrator of their current team, or the platform owner. False for anyone else (and when signed out). */
export async function canManageFighter(fighterId: string): Promise<boolean> {
  try { return await rpc<boolean>('can_manage_fighter', { p_fighter: fighterId }); } catch { return false; }
}
export const setFighterActive = (fighterId: string, active: boolean, reason: string | null) =>
  rpc<{ status: string }>('set_fighter_active', { p_fighter: fighterId, p_active: active, p_reason: reason });

// ---------------------------------------------------------------- team roster visibility
export interface ManagedMember { fighterId: string; displayName: string; role: string; hidden: boolean; inactive: boolean; since: string | null }
export async function fetchManagedRoster(teamId: string): Promise<ManagedMember[]> {
  const rows = await rpc<Array<{ fighter_id: string; display_name: string; role: string; hidden: boolean; inactive: boolean; since: string | null }>>('team_roster_manage', { p_team: teamId });
  return rows.map(r => ({ fighterId: r.fighter_id, displayName: r.display_name, role: r.role, hidden: r.hidden, inactive: r.inactive, since: r.since }));
}
export const setRosterVisibility = (teamId: string, fighterId: string, visible: boolean) =>
  rpc<{ status: string }>('set_roster_visibility', { p_team: teamId, p_fighter: fighterId, p_visible: visible });

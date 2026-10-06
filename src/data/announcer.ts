/**
 * The Announcer's reads. READ-ONLY: nothing in this file writes anything. Everything is a public read or one narrow function that returns booleans:
 *  - announcer_readiness(p_event): per fight and side, ready true/false and nothing else (no reasons, no notes). Only this event's staff and
 *    announcer devices may call it; anyone else is refused, and the screen then simply shows no readiness.
 *  - the entry's id, and for a fighter/team the existing career functions (fighter_career / team_career): public totals.
 * It never selects an account, contact, health, weigh-in, inspection or note column.
 */
import { supabase } from '../lib/supabase';
import { fetchFighterCareer, fetchTeamCareer, type CareerLine } from './careerProfile';

export interface ReadinessRow { match_id: string; side: 'a' | 'b'; ready: boolean }

/** Ready / not yet ready per side for the fights in play and coming up; null when this viewer may not read it (the screen shows none). */
export async function fetchReadiness(eventId: string): Promise<ReadinessRow[] | null> {
  const { data, error } = await supabase.rpc('announcer_readiness', { p_event: eventId });
  if (error) return null;
  return ((data ?? []) as Array<{ match_id: string; side: string; ready: boolean }>)
    .filter(r => (r.side === 'a' || r.side === 'b') && typeof r.match_id === 'string')
    .map(r => ({ match_id: r.match_id, side: r.side as 'a' | 'b', ready: r.ready === true }));
}

/** The career lines of the fighter or team behind one entry (public totals). Empty when the entry has none or cannot be read. */
export async function fetchEntryCareer(entryId: string): Promise<CareerLine[]> {
  const { data, error } = await supabase.from('entries').select('id,team_id,fighter_id').eq('id', entryId).maybeSingle();
  if (error) throw error;
  const e = data as { team_id: string | null; fighter_id: string | null } | null;
  if (!e) return [];
  if (e.team_id) return fetchTeamCareer(e.team_id);
  if (e.fighter_id) return fetchFighterCareer(e.fighter_id);
  return [];
}

/** True when this event's recorded fights are synthetic (a test event), so the screen can label them "Test". Best effort: false when unknown. */
export async function fetchEventIsTest(eventId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('career_fights_all').select('synthetic').eq('event_id', eventId).eq('synthetic', true).limit(1);
    return !error && (data ?? []).length > 0;
  } catch { return false; }
}

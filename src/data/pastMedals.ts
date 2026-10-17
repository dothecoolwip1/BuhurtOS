import { supabase } from '../lib/supabase';
import type { DisciplineOption, PastMedalEvent, PastMedalRecord } from '../lib/pastMedals';

/** Published tournaments kept for their medals (events.medals_only), newest first. Public: the database shows published events to everyone. */
export async function fetchPastMedalEvents(): Promise<PastMedalEvent[]> {
  const { data, error } = await supabase.from('events').select('id,slug,name,starts_on,ends_on,city,region,time_note')
    .eq('medals_only', true).eq('status', 'published').order('ends_on', { ascending: false }).limit(500);
  if (error) throw error;
  type Row = { id: string; slug: string; name: string; starts_on: string; ends_on: string; city: string | null; region: string | null; time_note: string | null };
  return ((data ?? []) as Row[]).map(r => ({ id: r.id, slug: r.slug, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on, city: r.city, region: r.region, timeNote: r.time_note }));
}

export async function fetchDisciplines(): Promise<DisciplineOption[]> {
  const { data, error } = await supabase.from('ref_categories').select('code,name,league,sort').order('sort');
  if (error) throw error;
  return ((data ?? []) as DisciplineOption[]).map(d => ({ code: d.code, name: d.name, league: d.league, sort: d.sort }));
}

/** The reported placings of one fighter and whether each is verified. Follows the caller's own read permissions. */
export async function fetchPastMedalRecords(fighterId: string): Promise<PastMedalRecord[]> {
  const { data, error } = await supabase.from('past_medal_records').select('result_id,competition_id,event_id,final_place,status,note,reported_at').eq('fighter_id', fighterId).limit(1000);
  if (error) throw error;
  type Row = { result_id: string; competition_id: string; event_id: string; final_place: number; status: PastMedalRecord['status']; note: string | null; reported_at: string };
  return ((data ?? []) as Row[]).map(r => ({ resultId: r.result_id, competitionId: r.competition_id, eventId: r.event_id, finalPlace: r.final_place, status: r.status, note: r.note, reportedAt: r.reported_at }));
}

export interface AddPastMedalOutcome { status: 'recorded' | 'already_recorded'; competitionId: string; entryId: string; resultId: string }

/**
 * Adds a medal to the signed-in fighter's own profile at a medals-only tournament (add_past_medal). The database creates the discipline's competition
 * the first time, writes the entry and the result through the audited path and tags the result "reported, unverified". A platform organizer may pass
 * another fighter's id to enter that fighter's report.
 */
export async function addPastMedal(input: { eventId: string; category: string; place: number; note?: string; fighterId?: string | null }): Promise<AddPastMedalOutcome> {
  const { data, error } = await supabase.rpc('add_past_medal', {
    p_event: input.eventId, p_category: input.category, p_place: input.place, p_note: input.note?.trim() || null, p_fighter: input.fighterId ?? null
  });
  if (error) throw error;
  const d = data as { status: AddPastMedalOutcome['status']; competition_id: string; entry_id: string; result_id: string };
  return { status: d.status, competitionId: d.competition_id, entryId: d.entry_id, resultId: d.result_id };
}

/** Takes back one's own unverified report (withdraw_past_medal): logged as voided, never silently removed. */
export async function withdrawPastMedal(resultId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_past_medal', { p_result: resultId, p_reason: reason?.trim() || null });
  if (error) throw error;
}

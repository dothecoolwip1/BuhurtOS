import { supabase } from '../lib/supabase';

/**
 * Competitions inside an event. Row level security lets only the event's organizers write; a competition that already has entrants,
 * matches, results or registrations can never be deleted (database trigger). Errors are thrown as-is for friendlyError.
 */

export type CompetitionGender = 'open' | 'men' | 'women';
export type CompetitionStructure = 'round_robin' | 'pools_elimination' | 'elimination';
export interface CompetitionInput { name: string; category: string; gender: CompetitionGender; tier: string | null; ruleset: string | null; structure: CompetitionStructure; roundsToWin: number | null; sort: number }
export interface EventCompetition extends CompetitionInput { id: string; status: string; league: string; entries: number }

export const STRUCTURES: ReadonlyArray<readonly [CompetitionStructure, string]> = [
  ['round_robin', 'Round robin (everyone fights everyone)'], ['pools_elimination', 'Pools, then a bracket'], ['elimination', 'Single elimination bracket']
];
export const GENDERS: ReadonlyArray<readonly [CompetitionGender, string]> = [['men', 'Men'], ['women', 'Women'], ['open', 'Open']];

export interface CategoryRef { code: string; name: string; league: string }
export async function fetchCategoryRefs(): Promise<CategoryRef[]> {
  const { data, error } = await supabase.from('ref_categories').select('code,name,league').order('sort');
  if (error) throw error;
  return data as CategoryRef[];
}
export async function fetchTierNames(): Promise<string[]> {
  const { data, error } = await supabase.from('ref_tiers').select('name').order('sort');
  if (error) throw error;
  return (data as { name: string }[]).map(t => t.name);
}

type Row = { id: string; name: string; category: string; gender: CompetitionGender; tier: string | null; ruleset: string | null; structure: CompetitionStructure; rounds_to_win: number | null; sort: number; status: string; ref_categories: { league: string } | { league: string }[] | null; entries: { count: number }[] | null };
export async function fetchEventCompetitions(eventId: string): Promise<EventCompetition[]> {
  const { data, error } = await supabase.from('competitions').select('id,name,category,gender,tier,ruleset,structure,rounds_to_win,sort,status,ref_categories(league),entries(count)').eq('event_id', eventId).order('sort').order('name');
  if (error) throw error;
  return (data as unknown as Row[]).map(r => ({
    id: r.id, name: r.name, category: r.category, gender: r.gender, tier: r.tier, ruleset: r.ruleset, structure: r.structure, roundsToWin: r.rounds_to_win, sort: r.sort, status: r.status,
    league: (Array.isArray(r.ref_categories) ? r.ref_categories[0]?.league : r.ref_categories?.league) ?? 'duels', entries: r.entries?.[0]?.count ?? 0
  }));
}

/** Plain messages per field, mirroring the database checks. */
export function validateCompetition(c: CompetitionInput): Record<string, string> {
  const e: Record<string, string> = {};
  const n = c.name.trim();
  if (n.length < 2 || n.length > 80) e.name = 'Give the competition a name of 2 to 80 characters.';
  if (!c.category) e.category = 'Choose a category.';
  if (c.ruleset && c.ruleset.trim().length > 120) e.ruleset = 'Keep the ruleset name under 120 characters.';
  if (c.roundsToWin !== null && (!Number.isInteger(c.roundsToWin) || c.roundsToWin < 1 || c.roundsToWin > 5)) e.roundsToWin = 'Rounds to win is 1 to 5.';
  return e;
}

/** "Longsword (men)" from a category name and a division, the way the seeded competitions are named. */
export const suggestCompetitionName = (categoryName: string, gender: CompetitionGender): string => (categoryName ? `${categoryName} (${gender})` : '');

const toRow = (c: CompetitionInput) => ({
  name: c.name.trim(), category: c.category, gender: c.gender, tier: c.tier || null, ruleset: c.ruleset?.trim() || null, structure: c.structure, rounds_to_win: c.roundsToWin, sort: c.sort
});
export async function createCompetition(eventId: string, c: CompetitionInput): Promise<string> {
  const { data, error } = await supabase.from('competitions').insert({ event_id: eventId, ...toRow(c) }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function updateCompetition(id: string, c: CompetitionInput): Promise<void> {
  const { data, error } = await supabase.from('competitions').update(toRow(c)).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error('not permitted'), { code: '42501' });
}
/** Refused by the database once anything hangs off the competition. */
export async function deleteCompetition(id: string): Promise<void> {
  const { data, error } = await supabase.from('competitions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error('not permitted'), { code: '42501' });
}

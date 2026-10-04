import { supabase } from '../lib/supabase';
import type { LeagueKey } from './api';

/** A category from the reference table (what competitions are made of): its league decides the scoring board and the entry kind. */
export interface RefCategory { code: string; league: LeagueKey; name: string; sort: number }
export async function fetchRefCategories(): Promise<RefCategory[]> {
  const { data, error } = await supabase.from('ref_categories').select('code,league,name,sort').order('sort');
  if (error) throw error;
  return data as RefCategory[];
}

export type Division = 'open' | 'men' | 'women';
export type Structure = 'round_robin' | 'pools_elimination' | 'elimination';
export const DIVISIONS: ReadonlyArray<readonly [Division, string]> = [['open', 'Open'], ['men', 'Men'], ['women', 'Women']];
export const STRUCTURES: ReadonlyArray<readonly [Structure, string, string]> = [
  ['round_robin', 'Round robin', 'Everyone meets everyone once. Best for up to about 6 entrants.'],
  ['pools_elimination', 'Pools, then a bracket', 'Pool play first; the top of each pool goes into a knockout bracket. Best for 7 or more.'],
  ['elimination', 'Single elimination', 'Straight knockout bracket. Lose once and you are out.']
];
export const LEAGUE_LABEL: Record<LeagueKey, string> = { buhurt: 'Group fights', duels: 'Duels', outrance: 'Profight', hacsa: 'HACSA formats' };

export interface SetupCompetition {
  id: string; name: string; category: string; league: LeagueKey; gender: Division; ruleset: string | null; structure: Structure; roundsToWin: number | null;
  status: string; sort: number;
  /** Dependent rows: once any exist the competition can no longer be removed, and with matches its category and division are fixed. */
  entries: number; matches: number; registrations: number;
}
export interface CompetitionInput { name: string; category: string; gender: Division; ruleset: string; structure: Structure; roundsToWin: number | null }

/** Everything the Competitions tab shows, in three requests: the competitions, then counts of what depends on each. */
export async function fetchSetupCompetitions(eventId: string): Promise<SetupCompetition[]> {
  const { data, error } = await supabase.from('competitions').select('id,name,category,gender,ruleset,structure,rounds_to_win,status,sort,ref_categories(league)').eq('event_id', eventId).order('sort');
  if (error) throw error;
  type Row = { id: string; name: string; category: string; gender: Division; ruleset: string | null; structure: Structure; rounds_to_win: number | null; status: string; sort: number; ref_categories: { league: LeagueKey } | { league: LeagueKey }[] | null };
  const rows = data as unknown as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const [ents, mats, regs] = await Promise.all([
    supabase.from('entries').select('competition_id').in('competition_id', ids),
    supabase.from('matches').select('competition_id').in('competition_id', ids),
    supabase.from('registration_competitions').select('competition_id').in('competition_id', ids)
  ]);
  if (ents.error) throw ents.error;
  if (mats.error) throw mats.error;
  if (regs.error) throw regs.error;
  const count = (list: Array<{ competition_id: string }> | null, id: string) => (list ?? []).filter(x => x.competition_id === id).length;
  return rows.map(r => ({
    id: r.id, name: r.name, category: r.category, gender: r.gender, ruleset: r.ruleset, structure: r.structure, roundsToWin: r.rounds_to_win, status: r.status, sort: r.sort,
    league: (Array.isArray(r.ref_categories) ? r.ref_categories[0]?.league : r.ref_categories?.league) ?? 'duels',
    entries: count(ents.data as Array<{ competition_id: string }>, r.id), matches: count(mats.data as Array<{ competition_id: string }>, r.id), registrations: count(regs.data as Array<{ competition_id: string }>, r.id)
  }));
}

/** The database checks the organizer role, the fields and the audit trail (create_competition). */
export async function createCompetition(eventId: string, i: CompetitionInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_competition', { p_event: eventId, p_name: i.name.trim(), p_category: i.category, p_gender: i.gender, p_ruleset: i.ruleset.trim() || null, p_structure: i.structure, p_rounds_to_win: i.roundsToWin });
  if (error) throw error;
  return data as string;
}
export async function updateCompetition(id: string, i: CompetitionInput): Promise<void> {
  const { error } = await supabase.rpc('update_competition', { p_comp: id, p_name: i.name.trim(), p_category: i.category, p_gender: i.gender, p_ruleset: i.ruleset.trim() || null, p_structure: i.structure, p_rounds_to_win: i.roundsToWin });
  if (error) throw error;
}
/** Refused by the database once anything depends on the competition (registrations, entries, matches, results). */
export async function deleteCompetition(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_competition', { p_comp: id });
  if (error) throw error;
}

/** Plain-language checks before the database sees the form. */
export function validateCompetition(i: CompetitionInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (i.name.trim().length < 2) e.name = 'Give the competition a name of at least 2 letters.';
  if (i.name.trim().length > 80) e.name = 'Keep the name under 80 characters.';
  if (!i.category) e.category = 'Choose a category.';
  if (i.ruleset.trim().length > 120) e.ruleset = 'Keep the ruleset name under 120 characters.';
  if (i.roundsToWin !== null && (!Number.isInteger(i.roundsToWin) || i.roundsToWin < 1 || i.roundsToWin > 5)) e.roundsToWin = 'Rounds to win is a whole number from 1 to 5, or empty.';
  return e;
}

/** "Men 5v5", "Longsword (open)": the name suggested when the organizer picks a category and division. */
export function suggestName(category: RefCategory | undefined, gender: Division): string {
  if (!category) return '';
  const g = gender === 'men' ? 'Men ' : gender === 'women' ? 'Women ' : '';
  return `${g}${category.name}`.trim() + (gender === 'open' ? ' (open)' : '');
}

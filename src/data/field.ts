import { supabase } from '../lib/supabase';
import type { LeagueKey } from '../lib/fieldScoring';
import { fetchMatchesForCompetitions, type CompetitionMatch } from './matches';

export interface FieldCompetition { id: string; name: string; category: string; league: LeagueKey; roundsToWin: number | null }

/** The event's competitions with what the scoring boards need: league (which board), category (fighters per side), rounds to win. */
export async function fetchFieldCompetitions(eventId: string): Promise<FieldCompetition[]> {
  const { data, error } = await supabase.from('competitions').select('id,name,category,rounds_to_win,sort,ref_categories(league)').eq('event_id', eventId).order('sort');
  if (error) throw error;
  type Row = { id: string; name: string; category: string; rounds_to_win: number | null; ref_categories: { league: LeagueKey } | { league: LeagueKey }[] | null };
  return (data as unknown as Row[]).map(r => ({
    id: r.id, name: r.name, category: r.category, roundsToWin: r.rounds_to_win,
    league: (Array.isArray(r.ref_categories) ? r.ref_categories[0]?.league : r.ref_categories?.league) ?? 'duels'
  }));
}

/** Every match of the given competitions, in ONE request. The field filter and queue order are applied by fieldQueue. */
export async function fetchEventMatches(competitions: readonly { id: string }[]): Promise<CompetitionMatch[]> {
  if (competitions.length === 0) return [];
  return fetchMatchesForCompetitions(competitions.map(c => c.id));
}

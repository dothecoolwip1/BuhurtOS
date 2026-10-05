import { supabase } from '../lib/supabase';
import type { Division, Outcome } from '../lib/careerView';

/**
 * Pack 10: the reads behind the fighter and team career profiles. Every number comes from the database (migration 20261005000200): the
 * views career_fights(_all), team_fights(_all), career_results(_all) and the functions fighter_career, team_career, fighter_head_to_head,
 * team_head_to_head, team_fighters_represented. Row level security decides what the viewer sees; nothing here decides a sporting rule.
 * Public data only. Errors are thrown as-is so friendlyError can show the message.
 */
const num = (v: number | string | null | undefined): number => Number(v ?? 0);
const numOrNull = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** 'official': real, counted results. 'test': rows of a fictional (test) event, shown only on a fictional fighter's or team's page. */
export type CareerContext = 'official' | 'test';
export type CareerScope = 'career' | 'season' | 'organization';
export type EntryKind = 'individual' | 'team';

/** One row of fighter_career / team_career: a total (kind / category null) or a per-discipline line, for one filter (scope + id). */
export interface CareerLine {
  context: CareerContext; scope: CareerScope; seasonId: string | null; organizationId: string | null;
  /** Fighter lines: 'individual' (duel categories) or 'team' (group fights the fighter was on the roster for). Team lines: always 'team'. Null on totals. */
  kind: EntryKind | null; category: string | null; categoryName: string | null; gender: Division | null;
  events: number; competitions: number; matches: number; wins: number; losses: number; draws: number; winPct: number | null;
  golds: number; silvers: number; bronzes: number; podiums: number; points: number; bestPlace: number | null; firstOn: string | null; lastOn: string | null;
}
type LineDb = {
  context: CareerContext; scope: CareerScope; season_id: string | null; organization_id: string | null; kind?: EntryKind | null; category: string | null; category_name: string | null; gender: Division | null;
  events: number | string; competitions: number | string; matches: number | string; wins: number | string; losses: number | string; draws: number | string; win_pct: number | string | null;
  golds: number | string; silvers: number | string; bronzes: number | string; podiums: number | string; points: number | string; best_place: number | null; first_on: string | null; last_on: string | null;
};
const toLine = (r: LineDb, kind: EntryKind | null): CareerLine => ({
  context: r.context, scope: r.scope, seasonId: r.season_id, organizationId: r.organization_id, kind: r.category === null ? null : kind, category: r.category, categoryName: r.category_name, gender: r.gender,
  events: num(r.events), competitions: num(r.competitions), matches: num(r.matches), wins: num(r.wins), losses: num(r.losses), draws: num(r.draws), winPct: numOrNull(r.win_pct),
  golds: num(r.golds), silvers: num(r.silvers), bronzes: num(r.bronzes), podiums: num(r.podiums), points: num(r.points), bestPlace: r.best_place, firstOn: r.first_on, lastOn: r.last_on
});
export async function fetchFighterCareer(fighterId: string): Promise<CareerLine[]> {
  const { data, error } = await supabase.rpc('fighter_career', { p_fighter: fighterId });
  if (error) throw error;
  return ((data ?? []) as LineDb[]).map(r => toLine(r, r.kind ?? null));
}
export async function fetchTeamCareer(teamId: string): Promise<CareerLine[]> {
  const { data, error } = await supabase.rpc('team_career', { p_team: teamId });
  if (error) throw error;
  return ((data ?? []) as LineDb[]).map(r => toLine(r, 'team'));
}

/** One final fight of a fighter (career_fights_all): who they fought, for which team, the result, and whether it counts. */
export interface Fight {
  matchId: string; competitionId: string; competitionName: string; category: string; categoryName: string; gender: Division; stage: string; roundLabel: string | null;
  eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null;
  entryId: string; kind: EntryKind; rosterRole: string | null; teamId: string | null; teamName: string | null; teamSlug: string | null;
  opponentEntryId: string; opponentFighterId: string | null; opponentTeamId: string | null; opponentName: string | null; opponentTeamSlug: string | null;
  outcome: Outcome; scoreFor: number | null; scoreAgainst: number | null; walkover: boolean; finalizedAt: string | null;
  synthetic: boolean; statsExcluded: boolean;
}
type FightDb = {
  match_id: string; competition_id: string; competition_name: string; category: string; category_name: string; gender: Division; stage: string; round_label: string | null;
  event_id: string; event_slug: string; event_name: string; starts_on: string; event_ends_on: string; season_id: string | null; organization_id: string | null;
  entry_id: string; kind: EntryKind; roster_role: string | null; team_id: string | null; team_name: string | null; team_slug: string | null;
  opponent_entry_id: string; opponent_fighter_id: string | null; opponent_team_id: string | null; opponent_name: string | null; opponent_team_slug: string | null;
  outcome: Outcome; score_for: number | null; score_against: number | null; walkover: boolean; finalized_at: string | null; synthetic: boolean; stats_excluded: boolean;
};
const FIGHT_COLUMNS = 'match_id,competition_id,competition_name,category,category_name,gender,stage,round_label,event_id,event_slug,event_name,starts_on,event_ends_on,season_id,organization_id,entry_id,kind,roster_role,team_id,team_name,team_slug,opponent_entry_id,opponent_fighter_id,opponent_team_id,opponent_name,opponent_team_slug,outcome,score_for,score_against,walkover,finalized_at,synthetic,stats_excluded';
const toFight = (r: FightDb): Fight => ({
  matchId: r.match_id, competitionId: r.competition_id, competitionName: r.competition_name, category: r.category, categoryName: r.category_name, gender: r.gender, stage: r.stage, roundLabel: r.round_label,
  eventId: r.event_id, eventSlug: r.event_slug, eventName: r.event_name, startsOn: r.starts_on, endsOn: r.event_ends_on, seasonId: r.season_id, organizationId: r.organization_id,
  entryId: r.entry_id, kind: r.kind, rosterRole: r.roster_role, teamId: r.team_id, teamName: r.team_name, teamSlug: r.team_slug,
  opponentEntryId: r.opponent_entry_id, opponentFighterId: r.opponent_fighter_id, opponentTeamId: r.opponent_team_id, opponentName: r.opponent_name, opponentTeamSlug: r.opponent_team_slug,
  outcome: r.outcome, scoreFor: numOrNull(r.score_for), scoreAgainst: numOrNull(r.score_against), walkover: r.walkover === true, finalizedAt: r.finalized_at,
  synthetic: r.synthetic === true, statsExcluded: r.stats_excluded === true
});
/** Every final fight of the fighter, newest first, fictional and excluded ones flagged (the history shows them marked; no total counts them). */
export async function fetchFighterFights(fighterId: string, limit = 2000): Promise<Fight[]> {
  const { data, error } = await supabase.from('career_fights_all').select(FIGHT_COLUMNS).eq('fighter_id', fighterId)
    .order('event_ends_on', { ascending: false }).order('finalized_at', { ascending: false, nullsFirst: false }).order('match_id', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as unknown as FightDb[]).map(toFight);
}

/** One placing of a fighter (career_results_all), with the team it was earned for. */
export interface CareerResult {
  competitionId: string; competitionName: string; category: string; categoryName: string; gender: Division; tier: string | null; entryId: string; kind: EntryKind; entryStatus: string;
  teamId: string | null; teamName: string | null; teamSlug: string | null; finalPlace: number; points: number;
  eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null; synthetic: boolean; statsExcluded: boolean;
}
type ResultDb = {
  competition_id: string; competition_name: string; category: string; category_name: string; gender: Division; tier: string | null; entry_id: string; kind: EntryKind; entry_status: string;
  team_id: string | null; team_name: string | null; team_slug: string | null; final_place: number; points: number | string;
  event_id: string; event_slug: string; event_name: string; starts_on: string; event_ends_on: string; season_id: string | null; organization_id: string | null; synthetic: boolean; stats_excluded: boolean;
  fighter_id?: string;
};
const RESULT_COLUMNS = 'fighter_id,competition_id,competition_name,category,category_name,gender,tier,entry_id,kind,entry_status,team_id,team_name,team_slug,final_place,points,event_id,event_slug,event_name,starts_on,event_ends_on,season_id,organization_id,synthetic,stats_excluded';
const toResult = (r: ResultDb): CareerResult => ({
  competitionId: r.competition_id, competitionName: r.competition_name, category: r.category, categoryName: r.category_name, gender: r.gender, tier: r.tier, entryId: r.entry_id, kind: r.kind, entryStatus: r.entry_status,
  teamId: r.team_id, teamName: r.team_name, teamSlug: r.team_slug, finalPlace: r.final_place, points: num(r.points),
  eventId: r.event_id, eventSlug: r.event_slug, eventName: r.event_name, startsOn: r.starts_on, endsOn: r.event_ends_on, seasonId: r.season_id, organizationId: r.organization_id,
  synthetic: r.synthetic === true, statsExcluded: r.stats_excluded === true
});
export async function fetchFighterResults(fighterId: string): Promise<CareerResult[]> {
  const { data, error } = await supabase.from('career_results_all').select(RESULT_COLUMNS).eq('fighter_id', fighterId).order('event_ends_on', { ascending: false }).limit(2000);
  if (error) throw error;
  return (data as unknown as ResultDb[]).map(toResult);
}
/** Individual placings earned while representing the team (never the team's own group-fight placings), with the fighter. */
export async function fetchTeamRepresentedResults(teamId: string): Promise<Array<CareerResult & { fighterId: string }>> {
  const { data, error } = await supabase.from('career_results_all').select(RESULT_COLUMNS).eq('team_id', teamId).eq('kind', 'individual').order('event_ends_on', { ascending: false }).limit(5000);
  if (error) throw error;
  return (data as unknown as ResultDb[]).map(r => ({ ...toResult(r), fighterId: r.fighter_id as string }));
}

/** One line of a head-to-head: all categories (category null) or one category. */
export interface HeadToHeadLine {
  context: CareerContext; opponentId: string; opponentName: string; opponentSlug: string | null; category: string | null; categoryName: string | null; gender: Division | null;
  meetings: number; wins: number; losses: number; draws: number; lastOn: string | null;
}
type H2HDb = { context: CareerContext; opponent_fighter_id?: string; opponent_team_id?: string; opponent_name: string; opponent_team_slug?: string | null; category: string | null; category_name: string | null; gender: Division | null; meetings: number | string; wins: number | string; losses: number | string; draws: number | string; last_on: string | null };
const toH2H = (r: H2HDb): HeadToHeadLine => ({
  context: r.context, opponentId: (r.opponent_fighter_id ?? r.opponent_team_id) as string, opponentName: r.opponent_name, opponentSlug: r.opponent_team_slug ?? null, category: r.category, categoryName: r.category_name, gender: r.gender,
  meetings: num(r.meetings), wins: num(r.wins), losses: num(r.losses), draws: num(r.draws), lastOn: r.last_on
});
export async function fetchFighterHeadToHead(fighterId: string): Promise<HeadToHeadLine[]> {
  const { data, error } = await supabase.rpc('fighter_head_to_head', { p_fighter: fighterId });
  if (error) throw error;
  return ((data ?? []) as H2HDb[]).map(toH2H);
}
export async function fetchTeamHeadToHead(teamId: string): Promise<HeadToHeadLine[]> {
  const { data, error } = await supabase.rpc('team_head_to_head', { p_team: teamId });
  if (error) throw error;
  return ((data ?? []) as H2HDb[]).map(toH2H);
}

/** One team fight (team_fights_all): the team's own group fight with the opponent team, the score, the placing and the entry (for its roster). */
export interface TeamFight {
  matchId: string; competitionId: string; competitionName: string; category: string; categoryName: string; gender: Division; stage: string; roundLabel: string | null;
  eventId: string; eventSlug: string; eventName: string; startsOn: string; endsOn: string; seasonId: string | null; organizationId: string | null;
  entryId: string; teamNameAtEvent: string | null; opponentEntryId: string; opponentTeamId: string | null; opponentName: string | null; opponentTeamSlug: string | null;
  outcome: Outcome; scoreFor: number | null; scoreAgainst: number | null; walkover: boolean; finalizedAt: string | null; finalPlace: number | null; points: number;
  synthetic: boolean; statsExcluded: boolean;
}
type TeamFightDb = {
  match_id: string; competition_id: string; competition_name: string; category: string; category_name: string; gender: Division; stage: string; round_label: string | null;
  event_id: string; event_slug: string; event_name: string; starts_on: string; event_ends_on: string; season_id: string | null; organization_id: string | null;
  entry_id: string; team_name_at_event: string | null; opponent_entry_id: string; opponent_team_id: string | null; opponent_name: string | null; opponent_team_slug: string | null;
  outcome: Outcome; score_for: number | null; score_against: number | null; walkover: boolean; finalized_at: string | null; final_place: number | null; points: number | string; synthetic: boolean; stats_excluded: boolean;
};
export async function fetchTeamFights(teamId: string, limit = 2000): Promise<TeamFight[]> {
  const { data, error } = await supabase.from('team_fights_all')
    .select('match_id,competition_id,competition_name,category,category_name,gender,stage,round_label,event_id,event_slug,event_name,starts_on,event_ends_on,season_id,organization_id,entry_id,team_name_at_event,opponent_entry_id,opponent_team_id,opponent_name,opponent_team_slug,outcome,score_for,score_against,walkover,finalized_at,final_place,points,synthetic,stats_excluded')
    .eq('team_id', teamId).order('event_ends_on', { ascending: false }).order('finalized_at', { ascending: false, nullsFirst: false }).order('match_id', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as unknown as TeamFightDb[]).map(r => ({
    matchId: r.match_id, competitionId: r.competition_id, competitionName: r.competition_name, category: r.category, categoryName: r.category_name, gender: r.gender, stage: r.stage, roundLabel: r.round_label,
    eventId: r.event_id, eventSlug: r.event_slug, eventName: r.event_name, startsOn: r.starts_on, endsOn: r.event_ends_on, seasonId: r.season_id, organizationId: r.organization_id,
    entryId: r.entry_id, teamNameAtEvent: r.team_name_at_event, opponentEntryId: r.opponent_entry_id, opponentTeamId: r.opponent_team_id, opponentName: r.opponent_name, opponentTeamSlug: r.opponent_team_slug,
    outcome: r.outcome, scoreFor: numOrNull(r.score_for), scoreAgainst: numOrNull(r.score_against), walkover: r.walkover === true, finalizedAt: r.finalized_at, finalPlace: r.final_place, points: num(r.points),
    synthetic: r.synthetic === true, statsExcluded: r.stats_excluded === true
  }));
}

/** A fighter who earned a result or fought a team fight for the team, from the records (not a membership list). */
export interface RepresentedFighter { context: CareerContext; fighterId: string; displayName: string; active: boolean; individualResults: number; individualFights: number; teamFights: number; firstOn: string | null; lastOn: string | null }
export async function fetchTeamFightersRepresented(teamId: string): Promise<RepresentedFighter[]> {
  const { data, error } = await supabase.rpc('team_fighters_represented', { p_team: teamId });
  if (error) throw error;
  type R = { context: CareerContext; fighter_id: string; display_name: string; active: boolean; individual_results: number | string; individual_fights: number | string; team_fights: number | string; first_on: string | null; last_on: string | null };
  return ((data ?? []) as R[]).map(r => ({ context: r.context, fighterId: r.fighter_id, displayName: r.display_name, active: r.active !== false, individualResults: num(r.individual_results), individualFights: num(r.individual_fights), teamFights: num(r.team_fights), firstOn: r.first_on, lastOn: r.last_on }));
}

/** The team's rows of the existing discipline totals ranking (every scope), so the page can show its rank per discipline for the chosen filter. */
export interface TeamDisciplineRank { scope: 'season' | 'org_career' | 'career'; organizationId: string | null; seasonId: string | null; category: string; categoryName: string; gender: string | null; fighters: number; results: number; points: number; rank: number }
export async function fetchTeamDisciplineRanks(teamId: string): Promise<TeamDisciplineRank[]> {
  const { data, error } = await supabase.from('ranking_team_disciplines').select('scope,organization_id,season_id,category,category_name,gender,fighters,results,points,rank').eq('team_id', teamId).limit(2000);
  if (error) throw error;
  type R = { scope: TeamDisciplineRank['scope']; organization_id: string | null; season_id: string | null; category: string; category_name: string; gender: string | null; fighters: number | string; results: number | string; points: number | string; rank: number | string };
  return (data as unknown as R[]).map(r => ({ scope: r.scope, organizationId: r.organization_id, seasonId: r.season_id, category: r.category, categoryName: r.category_name, gender: r.gender, fighters: num(r.fighters), results: num(r.results), points: num(r.points), rank: num(r.rank) }));
}

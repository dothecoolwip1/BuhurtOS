import { supabase } from '../lib/supabase';
import { UNNAMED_ENTRY } from '../lib/entryLabel';
import type { PlannedMatch, PlannedStage } from '../lib/bracket';

export type QueueState = 'scheduled' | 'on_deck' | 'in_the_hole' | 'active' | 'final';
export type MatchResult = 'a' | 'b' | 'draw';

export interface CompetitionMatch {
  id: string; competitionId: string; stage: PlannedStage; roundLabel: string; position: number; pool: string | null; field: string | null;
  scheduledAt: string | null; queueState: QueueState; entryA: string | null; entryB: string | null; nameA: string | null; nameB: string | null;
  nextMatchId: string | null; nextSlot: 'a' | 'b' | null; result: MatchResult | null; winnerEntryId: string | null;
  scoreA: number | null; scoreB: number | null; detail: Record<string, unknown>; version: number; finalizedAt: string | null;
  /** The organizer's manual running order among a field's waiting matches (lower runs sooner); null or absent means schedule order. */
  queueOrder?: number | null;
  /** The planner's saved event-wide order of waiting fights (Pack 09D plan_order), after queueOrder; null or absent means none. */
  planOrder?: number | null;
  /** Held by the planner: someone in it is not here today, so the queue does not call it by itself (Pack 09D plan_hold). */
  planHold?: boolean;
}
export interface CompetitionEntry { id: string; competitionId: string; teamId: string | null; fighterId: string | null; name: string; pool: string | null; seed: number | null; status: string }
/** `rank` and `tied` come from the database ranking (pool_standings): spectators and organizers read the same order. */
export interface Standing { competitionId: string; entryId: string; wins: number; losses: number; draws: number; scoreFor: number; scoreAgainst: number; rank?: number; tied?: boolean }
export interface MatchRound { key: string; stage: PlannedStage; pool: string | null; label: string; matches: CompetitionMatch[] }

type Named = { teams: { name: string } | { name: string }[] | null; fighters: { display_name: string } | { display_name: string }[] | null };
type MatchRow = {
  id: string; competition_id: string; stage: PlannedStage; round_label: string; position: number; pool: string | null; field: string | null;
  scheduled_at: string | null; queue_state: QueueState; entry_a: string | null; entry_b: string | null; next_match_id: string | null; next_slot: 'a' | 'b' | null;
  result: MatchResult | null; winner_entry_id: string | null; score_a: number | null; score_b: number | null; detail: Record<string, unknown> | null;
  version: number; finalized_at: string | null; queue_order?: number | null; plan_order?: number | null; plan_hold?: boolean | null; a: Named | Named[] | null; b: Named | Named[] | null;
};
type EntryRow = { id: string; competition_id: string; team_id: string | null; fighter_id: string | null; pool: string | null; seed: number | null; status: string } & Named;
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const NAMED = 'teams(name),fighters(display_name)';
const nameOf = (n: Named | null): string | null => (n ? one(n.teams)?.name ?? one(n.fighters)?.display_name ?? null : null);

const MATCH_SELECT = 'id,competition_id,stage,round_label,position,pool,field,scheduled_at,queue_state,entry_a,entry_b,next_match_id,next_slot,result,winner_entry_id,score_a,score_b,detail,version,finalized_at,'
  + `a:entries!entry_a(${NAMED}),b:entries!entry_b(${NAMED})`;

export const toMatch = (r: MatchRow): CompetitionMatch => ({
  id: r.id, competitionId: r.competition_id, stage: r.stage, roundLabel: r.round_label, position: r.position, pool: r.pool, field: r.field?.trim() || 'Field 1',
  scheduledAt: r.scheduled_at, queueState: r.queue_state, entryA: r.entry_a, entryB: r.entry_b, nameA: nameOf(one(r.a)), nameB: nameOf(one(r.b)),
  nextMatchId: r.next_match_id, nextSlot: r.next_slot, result: r.result, winnerEntryId: r.winner_entry_id, scoreA: r.score_a, scoreB: r.score_b,
  detail: r.detail ?? {}, version: r.version, finalizedAt: r.finalized_at, queueOrder: r.queue_order ?? null,
  planOrder: r.plan_order ?? null, planHold: r.plan_hold === true
});

/**
 * Like fetchCompetitionMatches, plus the organizer's manual running order (matches.queue_order, added in Pack 09A). Only the Event day screen asks for it,
 * so every public page keeps working against a database that does not have the column yet.
 */
export async function fetchCompetitionMatchesOrdered(competitionId: string): Promise<CompetitionMatch[]> {
  const { data, error } = await supabase.from('matches').select(`${MATCH_SELECT},queue_order,plan_order,plan_hold`).eq('competition_id', competitionId).order('stage').order('position');
  // 42703 = a column does not exist yet (the database has not had the Pack 09D / 09A update): fall back one step at a time rather than show nothing.
  if (error && (error as { code?: string }).code === '42703') {
    const older = await supabase.from('matches').select(`${MATCH_SELECT},queue_order`).eq('competition_id', competitionId).order('stage').order('position');
    if (older.error && (older.error as { code?: string }).code === '42703') return fetchCompetitionMatches(competitionId);
    if (older.error) throw older.error;
    return (older.data as unknown as MatchRow[]).map(toMatch);
  }
  if (error) throw error;
  return (data as unknown as MatchRow[]).map(toMatch);
}

export async function fetchCompetitionMatches(competitionId: string): Promise<CompetitionMatch[]> {
  const { data, error } = await supabase.from('matches').select(MATCH_SELECT).eq('competition_id', competitionId).order('stage').order('position');
  if (error) throw error;
  return groupIntoRounds((data as unknown as MatchRow[]).map(toMatch)).flatMap(r => r.matches);
}

/** Matches of several competitions in one request (the field screen reads a whole event's queue this way). */
export async function fetchMatchesForCompetitions(competitionIds: readonly string[]): Promise<CompetitionMatch[]> {
  const { data, error } = await supabase.from('matches').select(MATCH_SELECT).in('competition_id', [...competitionIds]).order('stage').order('position');
  if (error) throw error;
  return (data as unknown as MatchRow[]).map(toMatch);
}

export async function fetchEntries(competitionId: string): Promise<CompetitionEntry[]> {
  const { data, error } = await supabase.from('entries').select(`id,competition_id,team_id,fighter_id,pool,seed,status,${NAMED}`).eq('competition_id', competitionId).order('created_at');
  if (error) throw error;
  return (data as unknown as EntryRow[]).map(r => ({
    id: r.id, competitionId: r.competition_id, teamId: r.team_id, fighterId: r.fighter_id, pool: r.pool, seed: r.seed, status: r.status, name: nameOf(r) ?? UNNAMED_ENTRY
  }));
}

/** How BuhurtOS knows which team an individual entrant represented (entries.represented_team_basis). */
export type RepresentedBasis = 'registration' | 'team_at_entry' | 'recorded' | 'correction';
/** An individual (fighter) entry and the team the fighter represented in this competition: what their points count toward in team discipline totals. */
export interface RepresentedTeamRow {
  entryId: string; fighterId: string; fighterName: string; status: string;
  teamId: string | null;
  /** The team's name when it was recorded (a later rename does not change it). */
  teamName: string | null;
  basis: RepresentedBasis | null;
}
type RepresentedDb = { id: string; fighter_id: string; status: string; represented_team_id: string | null; represented_team_name_at_event: string | null; represented_team_basis: RepresentedBasis | null; fighters: { display_name: string } | { display_name: string }[] | null };
export const toRepresentedTeamRow = (r: RepresentedDb): RepresentedTeamRow => ({
  entryId: r.id, fighterId: r.fighter_id, fighterName: one(r.fighters)?.display_name ?? UNNAMED_ENTRY, status: r.status,
  teamId: r.represented_team_id, teamName: r.represented_team_name_at_event, basis: r.represented_team_basis
});
/** The individual entries of one competition with their represented team, by fighter name. Team entries have no represented team. */
export async function fetchRepresentedTeams(competitionId: string): Promise<RepresentedTeamRow[]> {
  const { data, error } = await supabase.from('entries')
    .select('id,fighter_id,status,represented_team_id,represented_team_name_at_event,represented_team_basis,fighters(display_name)')
    .eq('competition_id', competitionId).not('fighter_id', 'is', null);
  if (error) throw error;
  return (data as unknown as RepresentedDb[]).map(toRepresentedTeamRow).sort((a, b) => a.fighterName.localeCompare(b.fighterName));
}
/**
 * Corrects the team a fighter represented in this one competition (null = no team). Only an organizer of the event or the platform owner;
 * the database records who, when, the old and new team and the reason. It never changes the fighter's current team.
 */
export async function setRepresentedTeam(entryId: string, teamId: string | null, reason: string): Promise<void> {
  const { error } = await supabase.rpc('set_represented_team', { p_entry: entryId, p_team: teamId, p_reason: reason.trim() });
  if (error) throw error;
}

export async function fetchStandings(competitionId: string): Promise<Standing[]> {
  const { data, error } = await supabase.from('competition_standings').select('competition_id,entry_id,wins,losses,draws,score_for,score_against').eq('competition_id', competitionId);
  if (error) throw error;
  type S = { competition_id: string; entry_id: string; wins: number; losses: number; draws: number; score_for: number; score_against: number };
  const base = (data as unknown as S[]).map(s => ({ competitionId: s.competition_id, entryId: s.entry_id, wins: Number(s.wins), losses: Number(s.losses), draws: Number(s.draws), scoreFor: Number(s.score_for), scoreAgainst: Number(s.score_against) }));
  const ranks = new Map((await fetchPoolStandings(competitionId).catch(() => [] as PoolStanding[])).map(r => [r.entryId, r]));
  return base.map(s => { const r = ranks.get(s.entryId); return r ? { ...s, rank: r.rank, tied: r.tied } : s; });
}

/** Which algorithm produced the plan the browser sends. Saved with the seed so a draw can be explained and reproduced. */
export const DRAW_ALGORITHM = 'ts-draw-v1';
export interface DrawRecord { format: 'single_elimination' | 'round_robin' | 'pools'; mode: 'random' | 'manual'; seed: number }
export type ScheduleMode = 'new' | 'replace' | 'append';

const toPlan = (planned: readonly PlannedMatch[]) => planned.map(p => ({
  key: p.key, stage: p.stage, round_label: p.roundLabel, position: p.position, pool: p.pool ?? null, a: p.a ?? null, b: p.b ?? null, next_key: p.nextKey ?? null, next_slot: p.nextSlot ?? null
}));

/**
 * Build a schedule in ONE database transaction (public.build_schedule). The browser plans the matches; the database validates them, takes a lock on
 * the competition and either saves the whole schedule or nothing. `new` refuses if matches exist, `replace` refuses if any are final, and `append`
 * builds the bracket after finished pools (the database checks the pool standings, refusing while a tie affects who advances).
 */
export async function buildSchedule(competitionId: string, planned: readonly PlannedMatch[], mode: ScheduleMode, opts: { draw?: DrawRecord; advance?: number } = {}): Promise<number> {
  const draw = opts.draw ? { format: opts.draw.format, mode: opts.draw.mode, seed: opts.draw.seed, algorithm: DRAW_ALGORITHM } : null;
  return (await rpc('build_schedule', { p_competition: competitionId, p_matches: toPlan(planned), p_mode: mode, p_draw: draw, p_advance: opts.advance ?? null })) as number;
}

/** All draws and Lyst assignments succeed together, or nothing is built. */
export async function buildTournamentPlan(eventId: string, fields: number, plans: readonly { id: string; matches: readonly PlannedMatch[]; field: string; draw: DrawRecord }[]): Promise<{ built: number; fights: number }> {
  return await rpc('build_tournament_plan', { p_event: eventId, p_fields: fields, p_plans: plans.map(p => ({
    competition: p.id, matches: toPlan(p.matches), field: p.field, draw: { ...p.draw, algorithm: DRAW_ALGORITHM }
  })) }) as { built: number; fights: number };
}

export interface PoolStanding { part: string; entryId: string; wins: number; losses: number; scoreFor: number; scoreAgainst: number; diff: number; headToHead: number; rank: number; tied: boolean; decided: boolean }
/** The one ranking of a round robin or of each pool. `part` is the pool name ('' for a round robin). */
export async function fetchPoolStandings(competitionId: string): Promise<PoolStanding[]> {
  const { data, error } = await supabase.rpc('pool_standings', { p_competition: competitionId });
  if (error) throw error;
  type R = { part: string; entry_id: string; wins: number; losses: number; score_for: number; score_against: number; diff: number; head_to_head: number; rank: number; tied: boolean; decided: boolean };
  return ((data ?? []) as R[]).map(r => ({ part: r.part, entryId: r.entry_id, wins: r.wins, losses: r.losses, scoreFor: r.score_for, scoreAgainst: r.score_against, diff: r.diff, headToHead: r.head_to_head, rank: r.rank, tied: r.tied, decided: r.decided }));
}
/** Record the order of entries that are level on everything, best first. Needs a note saying how it was decided. */
export const recordTieDecision = (competitionId: string, part: string, order: readonly string[], note: string): Promise<void> =>
  rpc('record_tie_decision', { p_competition: competitionId, p_part: part, p_order: [...order], p_note: note }).then(() => undefined);
/** Correct an official result. The previous value, the new value, who and why are kept in the revision log. */
export const correctResult = (competitionId: string, entryId: string, place: number, points: number, reason: string): Promise<void> =>
  rpc('correct_result', { p_competition: competitionId, p_entry: entryId, p_place: place, p_points: points, p_reason: reason }).then(() => undefined);
export const voidResult = (competitionId: string, entryId: string, reason: string): Promise<void> =>
  rpc('void_result', { p_competition: competitionId, p_entry: entryId, p_reason: reason }).then(() => undefined);

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}
/** What the database is told about the field: '' clears it, null leaves it as it is, any other text sets it. */
export const fieldArg = (field: string | null | undefined): string | null => (field === undefined || field === null ? null : field.trim());
/** `field`: omit or null to keep the current field, '' to clear it, text to set it. */
export const setQueue = (matchId: string, state: Exclude<QueueState, 'final'>, field?: string | null): Promise<void> =>
  rpc('set_match_queue', { p_match: matchId, p_state: state, p_field: fieldArg(field) }).then(() => undefined);

export interface FinalizeInput { matchId: string; result: MatchResult; scoreA: number; scoreB: number; detail?: Record<string, unknown>; expectedVersion: number }
/** Returns the new match version. */
export const finalizeMatch = async (i: FinalizeInput): Promise<number> =>
  (await rpc('finalize_match', { p_match: i.matchId, p_result: i.result, p_score_a: i.scoreA, p_score_b: i.scoreB, p_detail: i.detail ?? {}, p_expected_version: i.expectedVersion })) as number;
export const reopenMatch = (matchId: string, reason: string): Promise<void> => rpc('reopen_match', { p_match: matchId, p_reason: reason }).then(() => undefined);

const STAGE_ORDER: Record<PlannedStage, number> = { pool: 0, round_robin: 0, elimination: 1, third_place: 2, final: 3 };
/** Entrants in a round, from its label, so rounds sort earliest first ("Round of 16" before "Quarterfinal" before "Final"). */
function roundOrder(stage: PlannedStage, label: string): number {
  if (stage === 'pool' || stage === 'round_robin') return Number(/(\d+)/.exec(label)?.[1] ?? 0);
  const size = /^Round of (\d+)$/.exec(label)?.[1];
  if (size) return -Number(size);
  return label === 'Quarterfinal' ? -8 : label === 'Semifinal' ? -4 : 0;
}

/** Group matches into display rounds: pools (by pool, then round), then elimination rounds, third place and final. */
export function groupIntoRounds(matches: readonly CompetitionMatch[]): MatchRound[] {
  const groups = new Map<string, MatchRound>();
  for (const m of matches) {
    const key = `${m.stage}|${m.pool ?? ''}|${m.roundLabel}`;
    const g = groups.get(key) ?? { key, stage: m.stage, pool: m.pool, label: m.roundLabel, matches: [] };
    g.matches.push(m);
    groups.set(key, g);
  }
  const rounds = [...groups.values()];
  for (const r of rounds) r.matches.sort((x, y) => x.position - y.position);
  return rounds.sort((x, y) =>
    STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage]
    || (x.pool ?? '').localeCompare(y.pool ?? '')
    || roundOrder(x.stage, x.label) - roundOrder(y.stage, y.label)
    || x.label.localeCompare(y.label));
}

// ---------------------------------------------------------------- withdrawals (injury, or someone who no longer wants to fight)
/** Marks an entry withdrawn through the server-side sporting action. On event day it also settles every walkover that is already knowable; future bracket walkovers settle when their feeder result arrives. */
export async function withdrawEntry(entryId: string, reason = 'Withdrawn', walkovers = false): Promise<number> {
  const data = await rpc('withdraw_entry', { p_entry: entryId, p_reason: reason, p_walkovers: walkovers });
  return Number(data ?? 0);
}
/** Puts a withdrawn entry back. */
export async function reinstateEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from('entries').update({ status: 'registered' }).eq('id', entryId);
  if (error) throw error;
}

/** The unplayed matches a withdrawn entry was in, where the other side is known: these become walkovers for the opponent. */
export const walkoverTargets = (matches: readonly CompetitionMatch[], entryId: string): CompetitionMatch[] =>
  matches.filter(m => m.queueState !== 'final' && m.entryA && m.entryB && (m.entryA === entryId || m.entryB === entryId));

/** Records each target as a win for the opponent, 0 to 0, marked as a walkover with the reason. Returns how many were recorded. */
export async function recordWalkovers(matches: readonly CompetitionMatch[], entryId: string, reason: string): Promise<number> {
  let n = 0;
  for (const m of walkoverTargets(matches, entryId)) {
    await finalizeMatch({ matchId: m.id, result: m.entryA === entryId ? 'b' : 'a', scoreA: 0, scoreB: 0, detail: { walkover: true, reason }, expectedVersion: m.version });
    n++;
  }
  return n;
}

/* ---------------- finalization command, review and paper recovery (Pack 03) ---------------- */
/** Version of the finalization command the server understands (public.submit_match_result). */
export const FINALIZE_SCHEMA = 1;
export type SubmitStatus = 'accepted' | 'duplicate' | 'conflict' | 'stale';
export interface SubmitResult { status: SubmitStatus; version: number; repeat: boolean }
export interface SubmitInput { commandId: string; matchId: string; result: MatchResult; scoreA: number; scoreB: number; detail?: Record<string, unknown>; expectedVersion: number }

/**
 * Ask the server to make a result official. Needs signal (by owner decision). `commandId` is the idempotency key: sending the same command again
 * returns the original outcome and never makes a second result. The server answers `accepted` (official now), `duplicate` (another device already
 * saved the same result), `conflict` (a different official result exists: this one is kept for the head marshal, nothing is overwritten) or
 * `stale` (the match changed since it was opened). Network trouble throws; callers must then treat the result as still pending, not official.
 */
export async function submitMatchResult(i: SubmitInput): Promise<SubmitResult> {
  const d = (await rpc('submit_match_result', {
    p_command: i.commandId, p_match: i.matchId, p_result: i.result, p_score_a: i.scoreA, p_score_b: i.scoreB, p_detail: i.detail ?? {}, p_expected_version: i.expectedVersion, p_schema: FINALIZE_SCHEMA
  })) as { status: SubmitStatus; version: number; repeat?: boolean };
  return { status: d.status, version: d.version, repeat: d.repeat === true };
}

export interface ResultConflict {
  proposalId: string; matchId: string; competitionName: string; roundLabel: string; sideA: string; sideB: string;
  officialResult: MatchResult; officialScoreA: number; officialScoreB: number; proposedResult: MatchResult; proposedScoreA: number; proposedScoreB: number;
  proposedByName: string; createdAt: string;
}
/** Results two devices disagreed about, for the head marshal or an organizer ("Needs review"). */
export async function fetchResultConflicts(eventId: string): Promise<ResultConflict[]> {
  const { data, error } = await supabase.rpc('list_result_conflicts', { p_event: eventId });
  if (error) throw error;
  type R = { proposal_id: string; match_id: string; competition_name: string; round_label: string; side_a: string; side_b: string; official_result: MatchResult; official_score_a: number; official_score_b: number;
    proposed_result: MatchResult; proposed_score_a: number; proposed_score_b: number; proposed_by_name: string; created_at: string };
  return ((data ?? []) as R[]).map(r => ({
    proposalId: r.proposal_id, matchId: r.match_id, competitionName: r.competition_name, roundLabel: r.round_label, sideA: r.side_a, sideB: r.side_b,
    officialResult: r.official_result, officialScoreA: r.official_score_a, officialScoreB: r.official_score_b, proposedResult: r.proposed_result,
    proposedScoreA: r.proposed_score_a, proposedScoreB: r.proposed_score_b, proposedByName: r.proposed_by_name, createdAt: r.created_at
  }));
}
export const resolveResultConflict = (proposalId: string, decision: 'keep_official' | 'use_proposal', note: string): Promise<void> =>
  rpc('resolve_result_conflict', { p_proposal: proposalId, p_decision: decision, p_note: note }).then(() => undefined);

/** Paper recovery: transcribe or correct an official result from the score sheet. Same audited path; the note names the sheet. */
export async function enterOfficialResult(i: { matchId: string; result: MatchResult; scoreA: number; scoreB: number; note: string; detail?: Record<string, unknown> }): Promise<'entered' | 'corrected' | 'unchanged'> {
  const d = (await rpc('enter_official_result', { p_match: i.matchId, p_result: i.result, p_score_a: i.scoreA, p_score_b: i.scoreB, p_detail: i.detail ?? {}, p_note: i.note })) as { status: 'entered' | 'corrected' | 'unchanged' };
  return d.status;
}

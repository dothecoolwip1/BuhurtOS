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
  version: number; finalized_at: string | null; a: Named | Named[] | null; b: Named | Named[] | null;
};
type EntryRow = { id: string; competition_id: string; team_id: string | null; fighter_id: string | null; pool: string | null; seed: number | null; status: string } & Named;
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const NAMED = 'teams(name),fighters(display_name)';
const nameOf = (n: Named | null): string | null => (n ? one(n.teams)?.name ?? one(n.fighters)?.display_name ?? null : null);

const MATCH_SELECT = 'id,competition_id,stage,round_label,position,pool,field,scheduled_at,queue_state,entry_a,entry_b,next_match_id,next_slot,result,winner_entry_id,score_a,score_b,detail,version,finalized_at,'
  + `a:entries!entry_a(${NAMED}),b:entries!entry_b(${NAMED})`;

export const toMatch = (r: MatchRow): CompetitionMatch => ({
  id: r.id, competitionId: r.competition_id, stage: r.stage, roundLabel: r.round_label, position: r.position, pool: r.pool, field: r.field,
  scheduledAt: r.scheduled_at, queueState: r.queue_state, entryA: r.entry_a, entryB: r.entry_b, nameA: nameOf(one(r.a)), nameB: nameOf(one(r.b)),
  nextMatchId: r.next_match_id, nextSlot: r.next_slot, result: r.result, winnerEntryId: r.winner_entry_id, scoreA: r.score_a, scoreB: r.score_b,
  detail: r.detail ?? {}, version: r.version, finalizedAt: r.finalized_at
});

export async function fetchCompetitionMatches(competitionId: string): Promise<CompetitionMatch[]> {
  const { data, error } = await supabase.from('matches').select(MATCH_SELECT).eq('competition_id', competitionId).order('stage').order('position');
  if (error) throw error;
  return groupIntoRounds((data as unknown as MatchRow[]).map(toMatch)).flatMap(r => r.matches);
}

export async function fetchEntries(competitionId: string): Promise<CompetitionEntry[]> {
  const { data, error } = await supabase.from('entries').select(`id,competition_id,team_id,fighter_id,pool,seed,status,${NAMED}`).eq('competition_id', competitionId).order('created_at');
  if (error) throw error;
  return (data as unknown as EntryRow[]).map(r => ({
    id: r.id, competitionId: r.competition_id, teamId: r.team_id, fighterId: r.fighter_id, pool: r.pool, seed: r.seed, status: r.status, name: nameOf(r) ?? UNNAMED_ENTRY
  }));
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
/** Marks an entry withdrawn. Organizers of the event only (row level security). It then no longer counts for a new draw. */
export async function withdrawEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from('entries').update({ status: 'withdrawn' }).eq('id', entryId);
  if (error) throw error;
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

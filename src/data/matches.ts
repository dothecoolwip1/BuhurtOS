import { supabase } from '../lib/supabase';
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
export interface Standing { competitionId: string; entryId: string; wins: number; losses: number; draws: number; scoreFor: number; scoreAgainst: number }
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
    id: r.id, competitionId: r.competition_id, teamId: r.team_id, fighterId: r.fighter_id, pool: r.pool, seed: r.seed, status: r.status, name: nameOf(r) ?? 'Unnamed entry'
  }));
}

export async function fetchStandings(competitionId: string): Promise<Standing[]> {
  const { data, error } = await supabase.from('competition_standings').select('competition_id,entry_id,wins,losses,draws,score_for,score_against').eq('competition_id', competitionId);
  if (error) throw error;
  type S = { competition_id: string; entry_id: string; wins: number; losses: number; draws: number; score_for: number; score_against: number };
  return (data as unknown as S[]).map(s => ({ competitionId: s.competition_id, entryId: s.entry_id, wins: Number(s.wins), losses: Number(s.losses), draws: Number(s.draws), scoreFor: Number(s.score_for), scoreAgainst: Number(s.score_against) }));
}

/**
 * Insert planned matches. Two passes: all rows first (ids are generated here), then the next_match_id links, because the
 * database checks that a linked match already exists. Refuses if matches exist, unless `replace` deletes the unfinished ones
 * (finished matches are never deleted, so that still refuses when any are final).
 */
export async function generateMatches(competitionId: string, planned: readonly PlannedMatch[], opts: { replace?: boolean } = {}): Promise<number> {
  const { data: existing, error: e0 } = await supabase.from('matches').select('id,queue_state').eq('competition_id', competitionId);
  if (e0) throw e0;
  const rows = (existing ?? []) as { id: string; queue_state: QueueState }[];
  if (rows.length > 0) {
    if (!opts.replace) throw new Error('This competition already has matches. Replace them to start over.');
    if (rows.some(r => r.queue_state === 'final')) throw new Error('Some matches are already final. Reopen them before replacing the schedule.');
    const { error } = await supabase.from('matches').delete().eq('competition_id', competitionId).neq('queue_state', 'final');
    if (error) throw error;
  }
  if (planned.length === 0) return 0;
  const ids = new Map(planned.map(p => [p.key, crypto.randomUUID()]));
  const insert = planned.map(p => ({
    id: ids.get(p.key)!, competition_id: competitionId, stage: p.stage, round_label: p.roundLabel, position: p.position,
    pool: p.pool ?? null, entry_a: p.a ?? null, entry_b: p.b ?? null
  }));
  const { error: e1 } = await supabase.from('matches').insert(insert);
  if (e1) throw e1;
  const links = planned.filter(p => p.nextKey && p.nextSlot);
  try {
    for (const p of links) {
      const nextId = ids.get(p.nextKey!);
      if (!nextId) throw new Error(`planned match ${p.key} links to unknown match ${p.nextKey}`);
      const { error } = await supabase.from('matches').update({ next_match_id: nextId, next_slot: p.nextSlot }).eq('id', ids.get(p.key)!);
      if (error) throw error;
    }
  } catch (err) {
    await supabase.from('matches').delete().in('id', [...ids.values()]); // best effort: do not leave a half-linked bracket
    throw err;
  }
  return planned.length;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}
export const setQueue = (matchId: string, state: Exclude<QueueState, 'final'>, field?: string | null): Promise<void> =>
  rpc('set_match_queue', { p_match: matchId, p_state: state, p_field: field ?? null }).then(() => undefined);

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

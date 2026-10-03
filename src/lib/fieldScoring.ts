import type { CompetitionMatch, MatchResult, QueueState } from '../data/matches';
import { duelTotal, newDuel, newGroupFight, newPro, type DuelState, type GroupState, type ProState } from './scoring';
import { newMarathon, newSeries, seriesDetail, seriesOutcome, type SeriesKind, type SeriesState } from './marathon';
import { proRoundScore } from './tournament';

export type LeagueKey = 'buhurt' | 'duels' | 'outrance' | 'hacsa';
export type BoardMode = 'group' | 'duel' | 'pro' | 'marathon' | 'series';

/**
 * Which scoring board a competition uses. Marathon has its own (rules from the registration form). Triathlon, Sabre and
 * Greatsword get the generic series board because their HACSA rules are not loaded: the organizer sets rounds and points.
 * Any other HACSA category has no board yet.
 */
export const boardModeFor = (league: LeagueKey, category?: string): BoardMode | null =>
  category === 'marathon' ? 'marathon'
    : category === 'triathlon' || category === 'sabre' || category === 'greatsword' ? 'series'
      : league === 'buhurt' ? 'group' : league === 'duels' ? 'duel' : league === 'outrance' ? 'pro' : null;

export type BoardState =
  | { mode: 'group'; s: GroupState }
  | { mode: 'duel'; s: DuelState }
  | { mode: 'pro'; s: ProState }
  | { mode: 'marathon'; s: SeriesState }
  | { mode: 'series'; s: SeriesState };

/** Fighters per side from a category code such as "5v5" or "12v12". Falls back to 5. */
export function perSideFor(category: string): number {
  const n = Number(/^(\d+)v\d+$/.exec(category)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 5;
}

export function newBoard(mode: BoardMode, opts: { perSide?: number; roundsToWin?: number | null; seriesKind?: Exclude<SeriesKind, 'marathon'> } = {}): BoardState {
  if (mode === 'marathon') return { mode, s: newMarathon() };
  if (mode === 'series') return { mode, s: newSeries(opts.seriesKind ?? 'triathlon') };
  if (mode === 'group') return { mode, s: newGroupFight(opts.perSide ?? 5, opts.roundsToWin ?? 2) };
  if (mode === 'duel') return { mode, s: newDuel() };
  return { mode, s: newPro() };
}

/* ---------------- the queue ---------------- */
const QUEUE_ORDER: Partial<Record<QueueState, number>> = { active: 0, on_deck: 1, in_the_hole: 2 };
const sameField = (a: string | null, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/** The matches to run on one field: active first, then on deck, then in the hole; ties by start time, then position. */
export function fieldQueue(matches: readonly CompetitionMatch[], field: string): CompetitionMatch[] {
  return matches
    .filter(m => m.field !== null && sameField(m.field, field) && QUEUE_ORDER[m.queueState] !== undefined)
    .sort((x, y) =>
      QUEUE_ORDER[x.queueState]! - QUEUE_ORDER[y.queueState]!
      || (x.scheduledAt ?? '￿').localeCompare(y.scheduledAt ?? '￿')
      || x.position - y.position);
}

export const QUEUE_LABEL: Record<QueueState, string> = { scheduled: 'Scheduled', on_deck: 'On deck', in_the_hole: 'In the hole', active: 'Active', final: 'Final' };

/* ---------------- finishing a match ---------------- */
export interface FinalResult { result: MatchResult; scoreA: number; scoreB: number; detail: Record<string, unknown> }
export type ResultOutcome = { ok: true; value: FinalResult } | { ok: false; reason: string };

const winnerResult = (w: 'a' | 'b'): MatchResult => w;

/**
 * Turn what the board shows into the database's result, scores and detail.
 * Group: rounds won. Duel: match totals, with each round's points kept in the detail. Profight: the 10-point round
 * scores summed, so level totals are a draw (which the database refuses in elimination).
 */
export function resultFromBoard(board: BoardState, stage: CompetitionMatch['stage']): ResultOutcome {
  const noDraw = (r: MatchResult): ResultOutcome | null =>
    r === 'draw' && stage !== 'pool' && stage !== 'round_robin' ? { ok: false, reason: 'This is an elimination match, so it cannot end level. Score another round or ask the head marshal.' } : null;

  if (board.mode === 'group') {
    const s = board.s;
    if (!s.winner) return { ok: false, reason: 'No team has won the fight yet. Confirm the final round first.' };
    return { ok: true, value: { result: winnerResult(s.winner), scoreA: s.rounds.a, scoreB: s.rounds.b, detail: { kind: 'group', roundsToWin: s.roundsToWin, roundsWon: { a: s.rounds.a, b: s.rounds.b }, roundsPlayed: s.rounds.a + s.rounds.b } } };
  }
  if (board.mode === 'duel') {
    const s = board.s;
    if (!s.winner) return { ok: false, reason: 'The match is not decided yet. End the round to check the lead.' };
    const scoreA = duelTotal(s, 'a'), scoreB = duelTotal(s, 'b');
    if ((s.winner === 'a' && scoreA < scoreB) || (s.winner === 'b' && scoreB < scoreA)) return { ok: false, reason: 'The totals do not match the winner. Check the round points.' };
    return { ok: true, value: { result: winnerResult(s.winner), scoreA, scoreB, detail: { kind: 'duel', rounds: { a: [...s.a], b: [...s.b] }, totals: { a: scoreA, b: scoreB } } } };
  }
  if (board.mode === 'marathon' || board.mode === 'series') {
    const s = board.s;
    if (!s.configured) return { ok: false, reason: 'The organizer has not set the rounds and points for this competition yet.' };
    const o = seriesOutcome(s, stage);
    if (o.state === 'incomplete') return { ok: false, reason: `Round ${o.played + 1} of ${o.of} is still to score. Every round must be in before the result can be saved.` };
    if (o.state === 'needs_decider') return { ok: false, reason: o.message };
    const result: MatchResult = o.state === 'draw' ? 'draw' : o.winner;
    return { ok: true, value: { result, scoreA: o.a, scoreB: o.b, detail: { ...seriesDetail(s), kind: board.mode === 'marathon' ? 'marathon' : 'series', seriesKind: s.kind } } };
  }
  const s = board.s;
  const scored = s.rounds.map(r => ({ ...r, score: proRoundScore(r) }));
  const scoreA = scored.reduce((t, r) => t + r.score.a, 0), scoreB = scored.reduce((t, r) => t + r.score.b, 0);
  const result: MatchResult = scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : 'draw';
  const blocked = noDraw(result);
  if (blocked) return blocked;
  return {
    ok: true,
    value: {
      result, scoreA, scoreB,
      detail: { kind: 'pro', method: 'decision', rounds: scored.map((r, i) => ({ round: i + 1, strikesA: r.strikesA, strikesB: r.strikesB, deductionsA: r.deductionsA, deductionsB: r.deductionsB, otherCriteria: r.otherCriteria, a: r.score.a, b: r.score.b, label: r.score.label })), totals: { a: scoreA, b: scoreB } }
    }
  };
}

/** Can a result be offered for confirmation at all (so the Finish button can show)? */
export const canOfferFinish = (board: BoardState, stage: CompetitionMatch['stage']): boolean =>
  board.mode === 'pro' ? true : resultFromBoard(board, stage).ok;

/** The database's message when somebody else changed or finished the match after it was opened here. */
export const isStaleVersionError = (e: unknown): boolean => /changed since you opened it/i.test((e as { message?: string } | null)?.message ?? '');
/** True when a call failed because nothing reached the server (no signal), as opposed to the server answering with a refusal. */
export const isNoSignalError = (e: unknown): boolean => {
  const x = (e ?? {}) as { code?: string; message?: string; status?: number };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (typeof x.status === 'number' && x.status >= 500) return true;
  return !x.code && /failed to fetch|network|load failed|fetch/i.test(x.message ?? '');
};
export const isAlreadyFinalError = (e: unknown): boolean => /already final/i.test((e as { message?: string } | null)?.message ?? '');

export const resultSummary = (v: FinalResult, nameA: string, nameB: string): string =>
  v.result === 'draw' ? `Draw, ${v.scoreA}–${v.scoreB}` : `${v.result === 'a' ? nameA : nameB} win, ${Math.max(v.scoreA, v.scoreB)}–${Math.min(v.scoreA, v.scoreB)}`;

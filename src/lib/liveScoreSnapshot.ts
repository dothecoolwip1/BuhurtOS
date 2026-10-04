import type { LiveScoreDetail } from '../data/liveScores';
import type { BoardState } from './fieldScoring';
import { duelTotal, standing } from './scoring';
import { seriesOutcome, seriesTotals, roundPoints, currentRound } from './marathon';
import { proRoundScore } from './tournament';

/**
 * What a board shows, as two numbers and one line: the scorekeeper's screen and the venue display both read this, so they can never disagree.
 * It reports; it decides nothing (the boards and resultFromBoard own the rules).
 */
export interface ScoreSnapshot { scoreA: number; scoreB: number; phase: string; detail: LiveScoreDetail; /** the fight is decided on the board (not official until saved) */ decided: 'a' | 'b' | 'draw' | null }

export function snapshotOf(board: BoardState, stage: string): ScoreSnapshot {
  if (board.mode === 'group') {
    const s = board.s;
    const decided = s.winner ?? null;
    return {
      scoreA: s.rounds.a, scoreB: s.rounds.b, decided,
      phase: decided ? 'Fight decided' : `Round ${s.round} · first to ${s.roundsToWin}`,
      detail: { mode: 'group', standing: { a: standing(s, 'a'), b: standing(s, 'b') }, roundsToWin: s.roundsToWin, ...(decided ? { decided } : {}) }
    };
  }
  if (board.mode === 'duel') {
    const s = board.s;
    const r = s.a.length;
    const decided = s.winner ?? null;
    return {
      scoreA: duelTotal(s, 'a'), scoreB: duelTotal(s, 'b'), decided,
      phase: decided ? 'Fight decided' : r <= 2 ? `Round ${r} of 2` : 'Extra round',
      detail: { mode: 'duel', rounds: s.a.map((a, i) => ({ a, b: s.b[i] ?? 0 })), ...(decided ? { decided } : {}) }
    };
  }
  if (board.mode === 'marathon' || board.mode === 'series') {
    const s = board.s;
    const t = seriesTotals(s);
    const i = currentRound(s);
    const o = s.configured ? seriesOutcome(s, stage) : null;
    const decided = o?.state === 'decided' ? o.winner : o?.state === 'draw' ? 'draw' : null;
    const phase = !s.configured ? 'Setting up' : i >= s.results.length ? (decided ? 'Fight decided' : 'All rounds fought') : `Round ${i + 1} of ${s.results.length} · ${s.config.disciplines[i]}`;
    return {
      scoreA: t.a, scoreB: t.b, decided, phase,
      detail: { mode: board.mode, rounds: s.results.map((r, k) => ({ ...roundPoints(s, r), label: s.config.disciplines[k] })), ...(decided ? { decided } : {}) }
    };
  }
  const s = board.s;
  const scored = s.rounds.map(r => proRoundScore(r));
  const scoreA = scored.reduce((t, r) => t + r.a, 0), scoreB = scored.reduce((t, r) => t + r.b, 0);
  return { scoreA, scoreB, decided: null, phase: `Round ${s.current + 1} of ${s.rounds.length}`, detail: { mode: 'pro', rounds: scored.map(r => ({ a: r.a, b: r.b })) } };
}

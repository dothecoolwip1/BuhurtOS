import type { GroupState } from '../scoring';
import type { LystRound } from './rounds';

export function recordedGroupRounds(rounds: readonly LystRound[]) {
  const confirmed = rounds.filter(r => r.status === 'confirmed');
  let a = 0, b = 0, last = 0;
  for (const r of confirmed) {
    if (r.awarded_a === 1 && r.awarded_b === 0) a++;
    else if (r.awarded_a === 0 && r.awarded_b === 1) b++;
    else if (r.awarded_a !== 0 || r.awarded_b !== 0) throw new Error('Recorded team rounds need a marshal to review their awarded winners.');
    last = Math.max(last, r.round_no);
  }
  return { a, b, last };
}

/** Keep a locally pending round, but never let an older device erase confirmed rounds. */
export function recoverGroupBoard(board: GroupState, rounds: readonly LystRound[]): GroupState {
  const recorded = recordedGroupRounds(rounds);
  const total = recorded.a + recorded.b;
  if (total < board.rounds.a + board.rounds.b || (recorded.a === board.rounds.a && recorded.b === board.rounds.b && (recorded.last < board.round || !!board.winner))) return board;
  const winner = recorded.a >= board.roundsToWin ? 'a' : recorded.b >= board.roundsToWin ? 'b' : undefined;
  return { ...board, rounds: { a: recorded.a, b: recorded.b }, winner,
    round: winner ? recorded.last : recorded.last + 1,
    down: { a: board.down.a.map(() => false), b: board.down.b.map(() => false) } };
}

export function groupRoundsAligned(board: GroupState, rounds: readonly LystRound[]): boolean {
  if (rounds.length === 0) return true; // Manual scoring without a Lyst clock remains supported.
  const recorded = recordedGroupRounds(rounds);
  return rounds.every(r => r.status === 'confirmed') && recorded.a === board.rounds.a && recorded.b === board.rounds.b;
}

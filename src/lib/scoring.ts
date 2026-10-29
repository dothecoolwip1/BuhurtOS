import { BUCKLER_ROUND_POINTS, bucklerMatchFinished, leadMatchFinished, type DuelCategory, type ProRound, type Side } from './tournament';

/* ---------------- group fight ---------------- */
/**
 * Group fights (Buhurt Rules 26.4.1 §1.2, Buhurt Regulations 26.4 §4). A round ends when one team is fully grounded, or outnumbered 3 to 1
 * (recorded as e.g. "3-1", §4.1), or when its time runs out: the team with more fighters standing wins it; level, the round is fought again
 * (§4.2/§4.3.1). The fight is won on rounds (rounds to win is a competition setting; BI: 2). In the group stage a fight still level when its
 * match time runs out is a draw (§4.2); never in round robin or elimination (§4.3).
 */
export type GroupRoundEnd = 'wipe' | 'ratio' | 'time';
export interface GroupRoundRecord { round: number; standing: Record<Side, number>; endedBy: GroupRoundEnd; winner: Side | null }
export interface GroupState {
  down: Record<Side, boolean[]>;
  rounds: Record<Side, number>;
  round: number;
  roundsToWin: number;
  winner?: Side;
  /** The score sheet: each round's standing count and how it ended (Regulations §4.1, §5.7). */
  history?: GroupRoundRecord[];
  /** Group stage only: the match time ran out with the rounds level, so the fight is a draw (Regulations §4.2). */
  drawn?: boolean;
}

export const newGroupFight = (perSide = 5, roundsToWin = 2): GroupState => ({
  down: { a: Array(perSide).fill(false), b: Array(perSide).fill(false) },
  rounds: { a: 0, b: 0 }, round: 1, roundsToWin
});

export const standing = (s: GroupState, side: Side) => s.down[side].filter(d => !d).length;

/** How a round has ended on the field: a team fully grounded, or outnumbered 3 to 1 (Regulations §4.1). */
export function roundEnd(s: GroupState): { winner: Side; by: 'wipe' | 'ratio' } | undefined {
  const a = standing(s, 'a'), b = standing(s, 'b');
  if (a === 0 && b > 0) return { winner: 'b', by: 'wipe' };
  if (b === 0 && a > 0) return { winner: 'a', by: 'wipe' };
  if (b >= 1 && a >= 3 * b) return { winner: 'a', by: 'ratio' };
  if (a >= 1 && b >= 3 * a) return { winner: 'b', by: 'ratio' };
  return undefined;
}
/** The side that owns the round on the field (fully grounded or outnumbered 3 to 1 opponents). */
export function roundWinner(s: GroupState): Side | undefined {
  return roundEnd(s)?.winner;
}
/** Time is up (Regulations §4.2): more fighters standing wins the round; level, nobody (the round is fought again). */
export function timeWinner(s: GroupState): Side | null {
  const a = standing(s, 'a'), b = standing(s, 'b');
  return a > b ? 'a' : b > a ? 'b' : null;
}

export function toggleFighter(s: GroupState, side: Side, index: number): GroupState {
  if (s.winner || index < 0 || index >= s.down[side].length) return s;
  const down = { a: [...s.down.a], b: [...s.down.b] };
  down[side][index] = !down[side][index];
  return { ...s, down };
}

export function confirmRound(s: GroupState, byTime = false): GroupState {
  if (s.winner || s.drawn) return s;
  const end = roundEnd(s);
  const w = byTime ? timeWinner(s) : end?.winner ?? null;
  const record: GroupRoundRecord = { round: s.round, standing: { a: standing(s, 'a'), b: standing(s, 'b') }, endedBy: byTime ? 'time' : end?.by ?? 'wipe', winner: w };
  const history = [...(s.history ?? []), record];
  const fresh = { a: s.down.a.map(() => false), b: s.down.b.map(() => false) };
  // level at time: nobody wins the round, it is fought again (the same round on the Lyst)
  if (!w) return byTime ? { ...s, history, down: fresh } : s;
  const rounds = { ...s.rounds, [w]: s.rounds[w] + 1 };
  const fightWinner = rounds[w] >= s.roundsToWin ? w : undefined;
  return { ...s, rounds, history, winner: fightWinner, round: fightWinner ? s.round : s.round + 1, down: fightWinner ? s.down : fresh };
}
/** Group stage only (Regulations §4.2): the match time ran out with the rounds level: the fight is a draw. */
export function matchTimeUp(s: GroupState): GroupState {
  if (s.winner || s.drawn || s.rounds.a !== s.rounds.b) return s;
  return { ...s, drawn: true };
}

/* ---------------- duel ---------------- */
export interface DuelState { a: number[]; b: number[]; log: [Side, number][]; winner?: Side; /** the BI duel category: sword and buckler is won on rounds */ cat?: DuelCategory }
export const newDuel = (cat?: DuelCategory | null): DuelState => ({ a: [0], b: [0], log: [], ...(cat ? { cat } : {}) });
export const duelTotal = (s: DuelState, side: Side) => s[side].reduce((x, y) => x + y, 0);

export function duelScore(s: DuelState, side: Side, points: number): DuelState {
  if (s.winner) return s;
  const arr = [...s[side]];
  // sword and buckler: 5 points win the round (Duels Rules 2.2.1)
  if (s.cat === 'buckler' && arr[arr.length - 1] + points > BUCKLER_ROUND_POINTS) return s;
  arr[arr.length - 1] += points;
  return { ...s, [side]: arr, log: [...s.log, [side, points]] };
}
export function duelUndo(s: DuelState): DuelState {
  const last = s.log[s.log.length - 1];
  if (!last || s.winner) return s;
  const [side, pts] = last;
  const arr = [...s[side]];
  arr[arr.length - 1] -= pts;
  return { ...s, [side]: arr, log: s.log.slice(0, -1) };
}
/** Two main rounds, then extra rounds until one fighter leads by 2 (Duels rules V.26.4 §2.2.2). */
export function duelEndRound(s: DuelState): DuelState {
  if (s.winner) return s;
  const r = s.cat === 'buckler' ? bucklerMatchFinished(s.a, s.b) : leadMatchFinished(s.a, s.b);
  if (r.done) return { ...s, winner: r.winner, log: [] };
  return { ...s, a: [...s.a, 0], b: [...s.b, 0], log: [] };
}

/* ---------------- profight (one line marshal) ---------------- */
export interface ProState { rounds: ProRound[]; current: number }
export const blankProRound = (): ProRound => ({ strikesA: 0, strikesB: 0, deductionsA: 0, deductionsB: 0, otherCriteria: 'none' });
export const newPro = (): ProState => ({ rounds: [blankProRound()], current: 0 });
export function proPatch(s: ProState, patch: Partial<ProRound>): ProState {
  const rounds = s.rounds.map((r, i) => (i === s.current ? { ...r, ...patch } : r));
  return { ...s, rounds };
}
export function proAddRound(s: ProState, max = 3): ProState {
  if (s.rounds.length >= max) return s;
  return { rounds: [...s.rounds, blankProRound()], current: s.rounds.length };
}

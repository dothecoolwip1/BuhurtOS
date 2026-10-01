import { leadMatchFinished, type ProRound, type Side } from './tournament';

/* ---------------- group fight ---------------- */
/**
 * Group fights are won by grounding every opposing fighter (Buhurt Rules V.26.4.1 §1.2). How many rounds make a fight
 * is set by the tournament regulations (Buhurt Regulations §4, not available to read yet), so it is a setting here.
 */
export interface GroupState {
  down: Record<Side, boolean[]>;
  rounds: Record<Side, number>;
  round: number;
  roundsToWin: number;
  winner?: Side;
}

export const newGroupFight = (perSide = 5, roundsToWin = 2): GroupState => ({
  down: { a: Array(perSide).fill(false), b: Array(perSide).fill(false) },
  rounds: { a: 0, b: 0 }, round: 1, roundsToWin
});

export const standing = (s: GroupState, side: Side) => s.down[side].filter(d => !d).length;

/** The side that has every fighter grounded loses the round, so the other side owns it. */
export function roundWinner(s: GroupState): Side | undefined {
  if (standing(s, 'a') === 0 && standing(s, 'b') > 0) return 'b';
  if (standing(s, 'b') === 0 && standing(s, 'a') > 0) return 'a';
  return undefined;
}

export function toggleFighter(s: GroupState, side: Side, index: number): GroupState {
  if (s.winner || index < 0 || index >= s.down[side].length) return s;
  const down = { a: [...s.down.a], b: [...s.down.b] };
  down[side][index] = !down[side][index];
  return { ...s, down };
}

export function confirmRound(s: GroupState): GroupState {
  const w = roundWinner(s);
  if (!w || s.winner) return s;
  const rounds = { ...s.rounds, [w]: s.rounds[w] + 1 };
  const fightWinner = rounds[w] >= s.roundsToWin ? w : undefined;
  return {
    ...s, rounds, winner: fightWinner, round: fightWinner ? s.round : s.round + 1,
    down: fightWinner ? s.down : { a: s.down.a.map(() => false), b: s.down.b.map(() => false) }
  };
}

/* ---------------- duel ---------------- */
export interface DuelState { a: number[]; b: number[]; log: [Side, number][]; winner?: Side }
export const newDuel = (): DuelState => ({ a: [0], b: [0], log: [] });
export const duelTotal = (s: DuelState, side: Side) => s[side].reduce((x, y) => x + y, 0);

export function duelScore(s: DuelState, side: Side, points: number): DuelState {
  if (s.winner) return s;
  const arr = [...s[side]];
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
  const r = leadMatchFinished(s.a, s.b);
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

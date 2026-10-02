/**
 * Tournament maths taken from Buhurt International documents (League Structure V2026.1,
 * Tournament Structure and Formats Jan 2026, Outrance Rules V26.4, Duels rules V26.4).
 * Pure functions only: the UI renders what these return and never decides rules itself.
 */
export type TierName = 'Exhibition' | 'Source' | 'Classic' | 'Regional' | 'Conference';
export type MultiplierSource = 'tournamentStructure' | 'leagueStructure';

/** The two documents disagree for Regional and Conference. Both are kept, never merged. */
export const TIER_MULTIPLIER: Record<MultiplierSource, Record<TierName, number>> = {
  tournamentStructure: { Exhibition: 0, Source: 0.5, Classic: 1, Regional: 1.25, Conference: 1.5 },
  leagueStructure: { Exhibition: 0, Source: 0.5, Classic: 1, Regional: 1.5, Conference: 2 }
};

export type Placement = 'none' | 'third' | 'second' | 'first';
export const PLACEMENT_POINTS: Record<Placement, number> = { none: 0, third: 2, second: 4, first: 6 };

export interface PointsInput {
  poolWins: number;
  eliminationWins: number;
  placement: Placement;
  tier: TierName;
  source: MultiplierSource;
}

/** 1 point per pool/round-robin win, 2 per elimination win, 2/4/6 for 3rd/2nd/1st, times the tier multiplier. */
export function leaguePoints(i: PointsInput): { base: number; multiplier: number; total: number } {
  const base = i.poolWins + 2 * i.eliminationWins + PLACEMENT_POINTS[i.placement];
  const multiplier = TIER_MULTIPLIER[i.source][i.tier];
  return { base, multiplier, total: Math.round(base * multiplier * 100) / 100 };
}

/** Split n entrants into p pools as evenly as possible. */
export function splitPools(n: number, p: number): number[] {
  const out: number[] = [];
  let rest = n;
  for (let i = 0; i < p; i++) {
    const size = Math.ceil(rest / (p - i));
    out.push(size);
    rest -= size;
  }
  return out;
}

export interface StructureOption {
  title: string;
  detail: string;
  pools: number[];
  advancing: number;
  after: string;
}
export interface StructureAdvice {
  band: '4-6' | '6-12' | '12-16' | '16-20' | '20+' | 'under-4';
  options: StructureOption[];
  note?: string;
}

const FINAL_FOUR = 'Round robin, or bracket + 3rd place match';

/** Tournament Structure and Formats §1.3 to §1.7. */
export function structureAdvice(n: number): StructureAdvice {
  if (n < 4) {
    const options = n === 3
      ? [{ title: 'Round robin of three', detail: 'Each fighter meets the other two: 3 matches. Most wins takes first. If all three win once, use the tie rules (for example points scored) or one deciding match.', pools: [3], advancing: 0, after: 'Ranked by wins; tie rules apply' }]
      : n === 2
        ? [{ title: 'Head to head', detail: 'One match decides it. For a longer contest, run it as a round robin and play it more than once (best of three).', pools: [2], advancing: 0, after: 'Winner takes first' }]
        : [];
    return { band: 'under-4', options, note: 'The structure document starts at 4 entrants, so this is a suggestion; the organizer decides how to run small categories.' };
  }
  if (n <= 6) {
    return { band: '4-6', options: [{ title: 'Round robin', detail: 'Everyone fights everyone the same number of times. Ranked by matches won.', pools: [n], advancing: 0, after: 'Ranked by wins; tie rules apply' }] };
  }
  if (n <= 12) {
    return {
      band: '6-12',
      options: [
        { title: 'Option 1: round robin', detail: 'One group. Ranked by matches won.', pools: [n], advancing: 0, after: 'Ranked by wins; tie rules apply' },
        { title: 'Option 2: pools, then the final four', detail: 'Pools of 3 to 6. The top two from each pool reach the semifinals. Then a round robin of four, or a single-elimination bracket with a 3rd and 4th place match.', pools: splitPools(n, 2), advancing: 4, after: FINAL_FOUR }
      ]
    };
  }
  if (n <= 16) {
    return {
      band: '12-16',
      options: [
        { title: 'Option 1: two pools of 6 to 8', detail: 'Top two from each pool reach the semifinals, then a round robin of four or a bracket with a 3rd and 4th place match.', pools: splitPools(n, 2), advancing: 4, after: FINAL_FOUR },
        { title: 'Option 2: three pools of 4 to 6', detail: 'Top two from each pool, six in all. A round robin of six is recommended; a six-team bracket is not.', pools: splitPools(n, 3), advancing: 6, after: 'Round robin of six (bracket not recommended)' }
      ]
    };
  }
  if (n <= 20) {
    return {
      band: '16-20',
      options: [
        { title: 'Option 1: two pools of 8 to 10', detail: 'Top two from each pool reach the semifinals, then a round robin of four or a bracket.', pools: splitPools(n, 2), advancing: 4, after: FINAL_FOUR },
        { title: 'Option 2: four pools of 4 to 5', detail: 'Top two from each pool, eight in all. A bracket is the practical choice; a round robin of eight is not recommended for length.', pools: splitPools(n, 4), advancing: 8, after: 'Single-elimination bracket + 3rd place match' }
      ]
    };
  }
  const pools = Math.ceil(n / 5);
  return {
    band: '20+',
    options: [{ title: '20 or more entrants', detail: 'Follow the same pattern and continue it: more pools, top two from each into an elimination stage. The organizer may add a losers bracket, but those matches earn no league points.', pools: splitPools(n, pools), advancing: pools * 2, after: 'Elimination stage' }]
  };
}

/* ---------- Outrance (profight): 10-point must, one line marshal (Outrance Rules V26.4 §15.3) ---------- */
export type Side = 'a' | 'b';
export interface ProRound {
  strikesA: number;
  strikesB: number;
  deductionsA: number;
  deductionsB: number;
  /** Who the other criteria favour when the strike gap is 5 or less. */
  otherCriteria: Side | 'none';
}
export interface ProScore { a: number; b: number; label: 'Even' | 'Won on other criteria' | 'Slight' | 'Moderate' | 'Dominant' }

export function proRoundScore(r: ProRound): ProScore {
  const gap = Math.abs(r.strikesA - r.strikesB);
  const lead: Side | 'none' = r.strikesA > r.strikesB ? 'a' : r.strikesA < r.strikesB ? 'b' : 'none';
  let winner: Side | 'none' = 'none';
  let loserScore = 10;
  let label: ProScore['label'] = 'Even';
  if (gap <= 5) {
    if (r.otherCriteria !== 'none') { winner = r.otherCriteria; loserScore = 9; label = 'Won on other criteria'; }
  } else if (gap <= 10) { winner = lead; loserScore = 9; label = 'Slight'; }
  else if (gap <= 15) { winner = lead; loserScore = 8; label = 'Moderate'; }
  else { winner = lead; loserScore = 7; label = 'Dominant'; }
  const a = (winner === 'b' ? loserScore : 10) - r.deductionsA;
  const b = (winner === 'a' ? loserScore : 10) - r.deductionsB;
  return { a, b, label };
}

/* ---------- Duels: points per strike, match won by a lead of 2 (Duels rules V26.4 §2) ---------- */
export type DuelCategory = 'swordShield' | 'buckler' | 'longsword' | 'polearm';
export type Grip = 'two' | 'one';
export interface ZoneValues { head: number; torso: number; arms: number; hands: number; legs: number }

export function zoneValues(cat: DuelCategory, grip: Grip = 'two'): ZoneValues {
  switch (cat) {
    case 'swordShield': return { head: 2, torso: 2, arms: 1, hands: 1, legs: 1 };
    case 'buckler': return { head: 1, torso: 1, arms: 1, hands: 1, legs: 1 };
    case 'longsword': return grip === 'one' ? { head: 1, torso: 1, arms: 1, hands: 1, legs: 1 } : { head: 2, torso: 2, arms: 1, hands: 1, legs: 1 };
    case 'polearm': return { head: 1, torso: 1, arms: 1, hands: 0, legs: 1 };
  }
}

/** Sword & Shield, Longsword and Polearm: two 1-minute rounds, then 30 s rounds until one leads by 2 or more. */
export function leadMatchFinished(a: number[], b: number[]): { done: boolean; winner?: Side } {
  if (a.length < 2) return { done: false };
  const diff = a.reduce((x, y) => x + y, 0) - b.reduce((x, y) => x + y, 0);
  if (Math.abs(diff) >= 2) return { done: true, winner: diff > 0 ? 'a' : 'b' };
  return { done: false };
}

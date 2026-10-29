/**
 * Outrance (Profight) scoring, exactly as Outrance Rules and Regulations V.26.4 §15 and the example scoresheet (p.25) say. Pure: no network,
 * no clock. The database computes the same with the same vectors (supabase/tests/vectors/outrance.json), so the phone, the tablet and the
 * server can never disagree.
 *
 * Each line marshal keeps a sheet (§2.3, §15.1.1). Per round the sheet's result comes from the strike point difference (§15.3.1); a difference
 * of 5 or less goes through the other criteria in priority order (§15.2.2-15.2.5, p.25 "Win Criteria"). Deductions come off the sheet's round
 * (§15.3.2, p.25 "Point Deductions"). The Round Score is the secretary's average of the sheets (§15.3.1); the Total Fight Score, the sum of
 * the Round Scores, declares the winner (§15.4.1); the win type comes from each marshal's own fight result (§15.4.2).
 */
export type Side = 'a' | 'b';
export type Call = Side | 'even';
export interface Pair { a: number; b: number }

/** The other evaluation criteria, in their order of priority (§15.2; effective striking is the strike point difference itself). */
export const CRITERIA = ['grappling', 'list_control', 'aggression', 'defence'] as const;
export type Criterion = typeof CRITERIA[number];
export type CriteriaCalls = Partial<Record<Criterion, Call>>;
export const CRITERION_LABEL: Record<Criterion, string> = {
  grappling: 'Effective grappling', list_control: 'Effective list control', aggression: 'Effective aggression', defence: 'Effective defence'
};

/** §15.3.1: "Even" is a strike point difference of 5 or less. */
export const EVEN_MAX = 5;
export type Band = 'dominant' | 'moderate' | 'slight' | 'even' | 'stoppage';
export const BAND_LABEL: Record<Band, string> = { dominant: 'Dominant', moderate: 'Moderate', slight: 'Slight', even: 'Even', stoppage: 'KO / TKO' };

export interface SheetResult {
  a: number; b: number; band: Band;
  /** Who won the round on this sheet (null: a 10-10 drawn round). */
  winner: Side | null;
  /** For an Even round won on the criteria: the criterion that decided it. */
  decidedBy: Criterion | null;
}

/** Are the criteria needed on this sheet? Only when the strike point difference is 5 or less (§15.3.1). */
export const needsCriteria = (strikes: Pair): boolean => Math.abs(strikes.a - strikes.b) <= EVEN_MAX;

/** The first criterion, in priority order, that is not Even decides the round (p.25: "Follow Criteria by Priority until a Winner can be determined"). */
export function criteriaWinner(calls: CriteriaCalls): { winner: Side | null; decidedBy: Criterion | null } {
  for (const c of CRITERIA) {
    const v = calls[c];
    if (v === 'a' || v === 'b') return { winner: v, decidedBy: c };
  }
  return { winner: null, decidedBy: null };
}

/** The criteria a marshal still has to answer: in order, up to and including the first that is not Even. Empty once the round is decided or all four are Even. */
export function criteriaToAsk(calls: CriteriaCalls): Criterion[] {
  const out: Criterion[] = [];
  for (const c of CRITERIA) {
    const v = calls[c];
    if (v === undefined) { out.push(c); return out; }
    if (v !== 'even') return [];
  }
  return [];
}

/** One sheet's round result before deductions (§15.3.1). A KO or TKO in the round gives 10-7 to the other fighter. */
export function sheetResult(strikes: Pair, calls: CriteriaCalls = {}, stoppageLoser: Side | null = null): SheetResult {
  if (stoppageLoser) {
    const winner: Side = stoppageLoser === 'a' ? 'b' : 'a';
    return { a: winner === 'a' ? 10 : 7, b: winner === 'b' ? 10 : 7, band: 'stoppage', winner, decidedBy: null };
  }
  const gap = Math.abs(strikes.a - strikes.b);
  const lead: Side = strikes.a > strikes.b ? 'a' : 'b';
  const won = (w: Side, loser: number, band: Band, decidedBy: Criterion | null = null): SheetResult =>
    ({ a: w === 'a' ? 10 : loser, b: w === 'b' ? 10 : loser, band, winner: w, decidedBy });
  if (gap >= 16) return won(lead, 7, 'dominant');
  if (gap >= 11) return won(lead, 8, 'moderate');
  if (gap >= 6) return won(lead, 9, 'slight');
  const c = criteriaWinner(calls);
  if (c.winner) return won(c.winner, 9, 'even', c.decidedBy);
  return { a: 10, b: 10, band: 'even', winner: null, decidedBy: null };
}

/** §14.1 and p.25: losing the weapon 3 or more times in a single round is ONE point off that round. */
export const weaponLossDeduction = (losses: number): number => (losses >= 3 ? 1 : 0);

/** §15.3.2: a point for each yellow card, for each 90 seconds granted for an armour repair (§14.4), and for the weapon-loss penalty. */
export interface RoundPenalties { yellows: number; armourGrants: number; weaponLosses: number }
export const deduction = (p: RoundPenalties): number => p.yellows + p.armourGrants + weaponLossDeduction(p.weaponLosses);

/** One sheet's round score: the result minus that sheet's deductions for each side. */
export function sheetRoundScore(result: SheetResult, penalties: { a: RoundPenalties; b: RoundPenalties }): Pair {
  return { a: result.a - deduction(penalties.a), b: result.b - deduction(penalties.b) };
}

/**
 * Exact arithmetic. A Round Score is a sum of sheets divided by the number of marshals (§15.3.1); with 3 marshals that is in thirds, which a
 * decimal cannot hold exactly (three thirds would not add back to one). Every score is therefore held in SIXTIETHS: exact for 1 to 6 marshals.
 */
export const UNIT = 60;
export const toUnits = (n: number): number => Math.round(n * UNIT);
export const fromUnits = (u: number): number => u / UNIT;

/** The Round Score in sixtieths: the sum of the marshals' round scores divided by the number of marshals. */
export function roundScoreUnits(sheets: readonly Pair[]): Pair {
  if (sheets.length === 0) throw new Error('a Round Score needs at least one sheet');
  if (UNIT % sheets.length !== 0) throw new Error('a Round Score is averaged over 1 to 6 sheets');
  const k = UNIT / sheets.length;
  return { a: sheets.reduce((s, x) => s + x.a, 0) * k, b: sheets.reduce((s, x) => s + x.b, 0) * k };
}

/** The Total Fight Score in sixtieths: the sum of the Round Scores (§15.4.1). */
export const totalUnits = (rounds: readonly Pair[]): Pair => ({ a: rounds.reduce((s, r) => s + r.a, 0), b: rounds.reduce((s, r) => s + r.b, 0) });
export const leader = (t: Pair): Side | null => (t.a > t.b ? 'a' : t.b > t.a ? 'b' : null);

/** A score for people: whole numbers as they are, otherwise up to two decimals (29.67). */
export function showScore(units: number): string {
  const v = fromUnits(units);
  return Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toFixed(2).replace(/0$/, '');
}
/** The whole number kept in matches.score_a / score_b (display and sorting only; the exact score stays in the result detail). */
export const wholeScore = (units: number): number => Math.round(fromUnits(units));

export type WinType = 'unanimous_decision' | 'unanimous_draw' | 'majority_decision' | 'majority_draw' | 'split_decision' | 'split_draw';
export const WIN_TYPE_LABEL: Record<WinType | 'tko' | 'ko', string> = {
  unanimous_decision: 'Unanimous decision', unanimous_draw: 'Unanimous draw', majority_decision: 'Majority decision', majority_draw: 'Majority draw',
  split_decision: 'Split decision', split_draw: 'Split draw', tko: 'Technical knockout (TKO)', ko: 'Knockout (KO)'
};

/**
 * §15.4.2, from each line marshal's own fight result (their sheet's total; a draw when level):
 *  - all for the same competitor: unanimous decision; all draw: unanimous draw;
 *  - a majority for one competitor and the rest draw: majority decision;
 *  - a majority draw: majority draw;
 *  - a majority for one competitor and at least one for the other: split decision;
 *  - no majority at all (all different): split draw.
 */
export function winType(results: readonly (Side | 'draw')[]): { type: WinType; majority: Side | 'draw' | null } {
  const n = results.length;
  if (n === 0) throw new Error('no sheets');
  const count = (v: Side | 'draw') => results.filter(r => r === v).length;
  const a = count('a'), b = count('b'), d = count('draw');
  if (a === n) return { type: 'unanimous_decision', majority: 'a' };
  if (b === n) return { type: 'unanimous_decision', majority: 'b' };
  if (d === n) return { type: 'unanimous_draw', majority: 'draw' };
  const half = n / 2;
  for (const [side, mine, theirs] of [['a', a, b], ['b', b, a]] as const) {
    if (mine > half) return { type: theirs > 0 ? 'split_decision' : 'majority_decision', majority: side };
  }
  if (d > half) return { type: 'majority_draw', majority: 'draw' };
  return { type: 'split_draw', majority: null };
}

/** A marshal's own fight result: the sum of their sheet's round scores (p.25 "Fight Result"). */
export const sheetFightResult = (rounds: readonly Pair[]): Side | 'draw' => leader(totalUnits(rounds)) ?? 'draw';

/* ---------------- the fight (§4) ---------------- */
export type Division = '1' | '2';
export type FightFormat = 'tournament' | 'matched';
export interface Timing { rounds: number; roundSeconds: number; breakSeconds: number; tiebreak: boolean }
/** §4.1 matched fights: 3 rounds, 60 s breaks. §4.2 tournament fights: 2 rounds, a 45 s break, and a 3rd round of the same length if level. Division 1 rounds are 120 s, Division 2 rounds 90 s. */
export function timing(division: Division, format: FightFormat): Timing {
  const roundSeconds = division === '1' ? 120 : 90;
  return format === 'matched' ? { rounds: 3, roundSeconds, breakSeconds: 60, tiebreak: false } : { rounds: 2, roundSeconds, breakSeconds: 45, tiebreak: true };
}

/**
 * What comes after the rounds confirmed so far:
 *  - more regular rounds to fight;
 *  - a tournament fight level after its 2 rounds: the 3rd round (§4.2);
 *  - a tournament fight still level after the 3rd round: the rules give no further round, so the head marshal records the decision (§2.1);
 *  - otherwise the fight can be finished.
 */
export type Next = 'round' | 'tiebreak' | 'head_marshal' | 'finish';
export function nextAfter(t: Timing, confirmed: number, total: Pair): Next {
  if (confirmed < t.rounds) return 'round';
  const level = total.a === total.b;
  if (!level) return 'finish';
  if (!t.tiebreak) return 'finish';   // a matched fight may end as a draw (§15.4.2)
  return confirmed === t.rounds ? 'tiebreak' : 'head_marshal';
}

/** §14.8: a TKO for lack of defence loses the match in Division 1 and the round in Division 2. */
export const tkoLosesFight = (division: Division): boolean => division === '1';

/** §15.4.1: the expected Total Fight Score range for each format (a check shown to the secretary, never enforced: deductions can go below). */
export const expectedTotalRange = (format: FightFormat): [number, number] => (format === 'matched' ? [21, 30] : [14, 20]);

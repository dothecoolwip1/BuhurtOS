/**
 * Pure bracket and round-robin planning. Nothing here touches the database: it returns planned matches
 * that src/data/matches.ts can insert. Entries are referenced by id; `key` links planned matches to each other.
 */
import { drawPools, seededShuffle } from './draw';

export type PlannedStage = 'pool' | 'round_robin' | 'elimination' | 'third_place' | 'final';

export interface PlannedMatch {
  key: string;
  stage: PlannedStage;
  roundLabel: string;
  /** Zero-based position within its round. */
  position: number;
  pool?: string;
  a?: string;
  b?: string;
  nextKey?: string;
  nextSlot?: 'a' | 'b';
}

export interface SingleEliminationOptions {
  /** Shuffle the entries with this seed (reproducible draw). Without a seed the given order is used as the seeding. */
  seed?: number;
  /** Add a third-place match between the semifinal losers (needs 4 or more entries). */
  thirdPlace?: boolean;
  /** Use the given order as seeds 1..n, even if a seed is passed. */
  manualOrder?: boolean;
}

/** Name of a round by how many entrants are left in it. */
export function eliminationRoundLabel(entrantsInRound: number): string {
  if (entrantsInRound <= 2) return 'Final';
  if (entrantsInRound === 4) return 'Semifinal';
  if (entrantsInRound === 8) return 'Quarterfinal';
  return `Round of ${entrantsInRound}`;
}

/** Standard bracket order of seeds for a power-of-two size, e.g. 8 -> 1,8,4,5,2,7,3,6 (1 meets 2 only in the final). */
function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap(s => [s, next + 1 - s]);
  }
  return order;
}

export function buildSingleElimination(entryIds: readonly string[], opts: SingleEliminationOptions = {}): PlannedMatch[] {
  const n = entryIds.length;
  if (new Set(entryIds).size !== n) throw new Error('an entry cannot appear twice in a bracket');
  if (n < 2) return [];
  const seeded = opts.manualOrder || opts.seed === undefined ? [...entryIds] : seededShuffle(entryIds, opts.seed);
  let size = 2;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const entryAt = (slot: number): string | undefined => (order[slot] <= n ? seeded[order[slot] - 1] : undefined);
  const keyOf = (round: number, i: number) => `e${round}-${i}`;

  const planned: PlannedMatch[] = [];
  const byKey = new Map<string, PlannedMatch>();
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      if (r === 1) {
        const a = entryAt(2 * i), b = entryAt(2 * i + 1);
        if (!a || !b) continue; // a bye: no match, the entry is placed straight into the next round below
        const m: PlannedMatch = { key: keyOf(r, i), stage: rounds === 1 ? 'final' : 'elimination', roundLabel: eliminationRoundLabel(size), position: i, a, b };
        planned.push(m); byKey.set(m.key, m);
      } else {
        const m: PlannedMatch = { key: keyOf(r, i), stage: r === rounds ? 'final' : 'elimination', roundLabel: eliminationRoundLabel(size / 2 ** (r - 1)), position: i };
        planned.push(m); byKey.set(m.key, m);
      }
    }
  }
  // Link winners forward; bye winners go directly into the next match.
  for (let r = 1; r < rounds; r++) {
    for (let i = 0; i < size / 2 ** r; i++) {
      const next = byKey.get(keyOf(r + 1, i >> 1))!;
      const slot: 'a' | 'b' = i % 2 === 0 ? 'a' : 'b';
      const m = byKey.get(keyOf(r, i));
      if (m) { m.nextKey = next.key; m.nextSlot = slot; }
      else if (r === 1) next[slot] = entryAt(2 * i) ?? entryAt(2 * i + 1);
    }
  }
  if (opts.thirdPlace && n >= 4) planned.push({ key: 'third', stage: 'third_place', roundLabel: 'Third place', position: 0 });
  return planned;
}

/** Circle-method pairings. Odd counts give each entry one rest round (no match is created for it). */
export function buildRoundRobin(entryIds: readonly string[], opts: { pool?: string; stage?: 'pool' | 'round_robin' } = {}): PlannedMatch[] {
  if (new Set(entryIds).size !== entryIds.length) throw new Error('an entry cannot appear twice in a round robin');
  const slots: (string | null)[] = [...entryIds];
  if (slots.length < 2) return [];
  if (slots.length % 2 === 1) slots.push(null);
  const total = slots.length;
  const stage = opts.stage ?? (opts.pool !== undefined ? 'pool' : 'round_robin');
  const prefix = opts.pool !== undefined ? `p${opts.pool}-` : 'rr-';
  const planned: PlannedMatch[] = [];
  let ring = [...slots];
  for (let r = 0; r < total - 1; r++) {
    let position = 0;
    for (let i = 0; i < total / 2; i++) {
      let a = ring[i], b = ring[total - 1 - i];
      if (a === null || b === null) continue;
      if (i === 0 && r % 2 === 1) [a, b] = [b, a]; // alternate the fixed entry's side
      planned.push({ key: `${prefix}r${r + 1}-${position}`, stage, roundLabel: `Round ${r + 1}`, position: position++, ...(opts.pool !== undefined ? { pool: opts.pool } : {}), a, b });
    }
    ring = [ring[0], ring[total - 1], ...ring.slice(1, total - 1)];
  }
  return planned;
}

export interface PoolPlan { name: string; entries: string[]; matches: PlannedMatch[] }

const poolName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);

/** Draw entries into pools (reproducible by seed) and plan a round robin in each. The bracket is built after the pools finish. */
export function buildPoolsThenBracket(entryIds: readonly string[], opts: { poolSizes: readonly number[]; seed: number }): { pools: PoolPlan[]; matches: PlannedMatch[] } {
  const drawn = drawPools(entryIds, opts.poolSizes, opts.seed);
  const pools = drawn.map((entries, i) => ({ name: poolName(i), entries, matches: buildRoundRobin(entries, { pool: poolName(i), stage: 'pool' }) }));
  return { pools, matches: pools.flatMap(p => p.matches) };
}

/**
 * Order pool qualifiers for buildSingleElimination(..., {manualOrder: true}): all pool winners are the top seeds,
 * then the runners-up in reverse pool order (so a runner-up is less likely to meet their own pool winner early).
 * `ranked[i]` is pool i's entry ids best-first.
 */
export function seedPoolQualifiers(ranked: readonly (readonly string[])[], advancePerPool: number): string[] {
  const out: string[] = [];
  for (let rank = 0; rank < advancePerPool; rank++) {
    const row = ranked.map(p => p[rank]).filter((x): x is string => !!x);
    out.push(...(rank % 2 === 1 ? row.reverse() : row));
  }
  return out;
}

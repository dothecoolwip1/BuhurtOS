/** Pure helpers for the organizer Run tab: choosing a draw, describing it in plain language, and building a bracket from pool results. */
import { buildPoolsThenBracket, buildRoundRobin, buildSingleElimination, seedPoolQualifiers, type PlannedMatch } from './bracket';
import { seededShuffle } from './draw';
import { splitPools } from './tournament';

export type DrawFormat = 'single_elimination' | 'round_robin' | 'pools';
export const DRAW_FORMATS: readonly (readonly [DrawFormat, string])[] = [['single_elimination', 'Single elimination'], ['round_robin', 'Round robin'], ['pools', 'Pools']];

export interface DrawChoice {
  format: DrawFormat;
  /** Entry ids in the order the organizer sees them (this is the seeding for a manual draw). */
  entryIds: readonly string[];
  mode: 'random' | 'manual';
  seed: number;
  thirdPlace: boolean;
  poolCount: number;
}

const INACTIVE = new Set(['withdrawn', 'disqualified']);
/** Entries that still count toward a draw. */
export const activeEntries = <T extends { status: string }>(entries: readonly T[]): T[] => entries.filter(e => !INACTIVE.has(e.status));

/** A new whole-number seed, small enough to read out loud. */
export const randomSeed = (rand: () => number = Math.random): number => 1 + Math.floor(rand() * 999999);

export const maxPoolCount = (n: number): number => Math.max(1, Math.floor(n / 2));

/** Why this draw cannot be built yet, in plain words, or null when it is fine. */
export function drawProblem(c: DrawChoice): string | null {
  const n = c.entryIds.length;
  if (n < 2) return 'You need at least 2 entrants to build a draw.';
  if (c.format === 'pools') {
    if (n < 4) return 'Pools need at least 4 entrants. Use a round robin instead.';
    if (!Number.isInteger(c.poolCount) || c.poolCount < 2 || c.poolCount > maxPoolCount(n)) return `Choose between 2 and ${maxPoolCount(n)} pools, so every pool has at least 2 entrants.`;
  }
  return null;
}

export interface DrawPlan { matches: PlannedMatch[]; pools: { name: string; entries: string[] }[] }

/** The planned matches for a choice. Same choice (including seed) always gives the same plan. Call drawProblem first. */
export function planDraw(c: DrawChoice): DrawPlan {
  const problem = drawProblem(c);
  if (problem) throw new Error(problem);
  const manual = c.mode === 'manual';
  if (c.format === 'single_elimination') {
    return { pools: [], matches: buildSingleElimination(c.entryIds, { seed: c.seed, manualOrder: manual, thirdPlace: c.thirdPlace }) };
  }
  const order = manual ? [...c.entryIds] : seededShuffle(c.entryIds, c.seed);
  if (c.format === 'round_robin') return { pools: [], matches: buildRoundRobin(order, { stage: 'round_robin' }) };
  const sizes = splitPools(order.length, c.poolCount);
  if (!manual) {
    const r = buildPoolsThenBracket(c.entryIds, { poolSizes: sizes, seed: c.seed });
    return { pools: r.pools.map(p => ({ name: p.name, entries: p.entries })), matches: r.matches };
  }
  const pools: DrawPlan['pools'] = [];
  const matches: PlannedMatch[] = [];
  let at = 0;
  sizes.forEach((size, i) => {
    const name = String.fromCharCode(65 + i);
    const entries = order.slice(at, at + size);
    at += size;
    pools.push({ name, entries });
    matches.push(...buildRoundRobin(entries, { pool: name, stage: 'pool' }));
  });
  return { pools, matches };
}

export interface PlanGroup { heading: string; lines: string[] }

/** A plan in words: who fights whom, round by round, and who gets a bye. */
export function describePlan(planned: readonly PlannedMatch[], nameOf: (entryId: string) => string): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  const byes: string[] = [];
  for (const m of planned) {
    if ((m.stage === 'elimination' || m.stage === 'final') && !m.key.startsWith('e1-')) {
      if (m.a) byes.push(m.a);
      if (m.b) byes.push(m.b);
    }
    const heading = m.pool !== undefined ? `Pool ${m.pool}, ${m.roundLabel}` : m.roundLabel;
    const g = groups.get(heading) ?? { heading, lines: [] };
    const side = (id?: string) => (id ? nameOf(id) : 'winner of an earlier match');
    g.lines.push(m.stage === 'third_place' ? 'Losers of the two semifinals' : `${side(m.a)} vs ${side(m.b)}`);
    groups.set(heading, g);
  }
  const out = [...groups.values()];
  if (byes.length) out.unshift({ heading: 'Byes', lines: byes.map(id => `${nameOf(id)} moves straight to the next round`) });
  return out;
}

interface MatchLike { stage: string; pool: string | null; queueState: string; entryA: string | null; entryB: string | null }
/** One row of the database's pool standings (see fetchPoolStandings). */
export interface StandingRow { part: string; entryId: string; rank: number; tied: boolean }

/** True when there are pool matches, all are final, and no elimination stage exists yet. */
export function canBuildBracketFromPools(matches: readonly MatchLike[]): boolean {
  const pool = matches.filter(m => m.stage === 'pool');
  if (pool.length === 0) return false;
  if (matches.some(m => m.stage === 'elimination' || m.stage === 'final' || m.stage === 'third_place')) return false;
  return pool.every(m => m.queueState === 'final');
}

/**
 * Each pool's entry ids, best first, exactly as the database ranks them (wins, score difference, head-to-head, points scored, then an
 * organizer's recorded decision). The browser never ranks pools itself and never breaks a tie by id: entries that are still level keep
 * the same rank and show up in `tiesWithin`.
 */
export function rankedPools(rows: readonly StandingRow[]): string[][] {
  const byPart = new Map<string, StandingRow[]>();
  for (const r of rows) byPart.set(r.part, [...(byPart.get(r.part) ?? []), r]);
  return [...byPart.keys()].sort().map(k => byPart.get(k)!.slice().sort((x, y) => x.rank - y.rank).map(r => r.entryId));
}

export interface TieGroup { part: string; rank: number; entryIds: string[] }
/** Groups of entries that are level and finish within the top `top` places of their pool: an organizer must decide these before a bracket is built. */
export function tiesWithin(rows: readonly StandingRow[], top: number): TieGroup[] {
  const groups = new Map<string, TieGroup>();
  for (const r of rows) {
    if (!r.tied || r.rank > top) continue;
    const key = `${r.part}|${r.rank}`;
    const g = groups.get(key) ?? { part: r.part, rank: r.rank, entryIds: [] };
    g.entryIds.push(r.entryId);
    groups.set(key, g);
  }
  return [...groups.values()].sort((x, y) => x.part.localeCompare(y.part) || x.rank - y.rank);
}

/** The seeded qualifier list and the elimination bracket built from it. */
export function bracketFromPools(ranked: readonly (readonly string[])[], advancePerPool: number, thirdPlace: boolean): { qualifiers: string[]; matches: PlannedMatch[] } {
  const qualifiers = seedPoolQualifiers(ranked, advancePerPool);
  return { qualifiers, matches: buildSingleElimination(qualifiers, { manualOrder: true, thirdPlace }) };
}

/** Move one item up (-1) or down (+1) in a list; returns a new list. */
export function moveItem<T>(list: readonly T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

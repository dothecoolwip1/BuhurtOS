/**
 * Plans (with the product's own planner: src/lib/runDraw.ts, bracket.ts, draw.ts) and plays the competitions of one event.
 * Ratings come from rating.ts; the planner decides who meets whom, a seeded RNG decides how each match goes. The outcome of every
 * match is only a proposal here: the SQL loader sends each one through the real finalize_match RPC, and finish_competition then
 * computes places and points in the database. Nothing about placements or points is decided in this file.
 */
import { planDraw, bracketFromPools, rankPools, type DrawFormat } from '../../src/lib/runDraw';
import { structureAdvice } from '../../src/lib/tournament';
import type { PlannedMatch, PlannedStage } from '../../src/lib/bracket';
import type { FighterDef, TeamDef, Cat } from './roster';
import { isMelee } from './roster';
import type { CompPlan, EntryPlan } from './entries';
import type { EventDef } from './events';
import { divCode } from './events';
import { fighterRating, teamRating, winProb, volOf } from './rating';
import { hash32, poisson, rngFor, uid, clamp, type Rand } from './util';

export type Structure = 'round_robin' | 'elimination' | 'pools_elimination';
export interface Outcome { result: 'a' | 'b'; scoreA: number; scoreB: number; detail: Record<string, unknown> }
export interface PlayedMatch {
  id: string; key: string; stage: PlannedStage; roundLabel: string; position: number; pool: string | null;
  entryA: string | null; entryB: string | null; nextKey: string | null; nextSlot: 'a' | 'b' | null; nextId: string | null;
  field: string | null; startLocal: string | null; duration: number; outcome: Outcome | null;
}
export interface CompSim {
  comp: CompPlan; structure: Structure; roundsToWin: number | null; seed: number;
  /** Matches inserted in order; later phases (a bracket after pools) are inserted after the earlier ones were finalized. */
  phases: PlayedMatch[][];
  /** Entry ids in the order their matches were played, for the schedule and diagnostics. */
  ratings: Map<string, number>;
}

export function chooseFormat(n: number, team: boolean, key: string): { format: DrawFormat; poolCount: number; structure: Structure } {
  const h = hash32(`format|${key}`);
  if (n <= 6) return { format: 'round_robin', poolCount: 0, structure: 'round_robin' };
  if (n <= 9) return { format: 'single_elimination', poolCount: 0, structure: 'elimination' };
  if (n <= 16 && !team && h % 2 === 0) return { format: 'single_elimination', poolCount: 0, structure: 'elimination' };
  const adv = structureAdvice(n);
  const opt = n >= 13 && n <= 16 ? adv.options[0] : adv.options[Math.min(1, adv.options.length - 1)];
  return { format: 'pools', poolCount: opt.pools.length, structure: 'pools_elimination' };
}

const fieldFor = (i: number): string => `Ring ${i + 1}`;

export function entryRatings(comp: CompPlan, teams: readonly TeamDef[], fighters: readonly FighterDef[]): Map<string, { rating: number; vol: number }> {
  const out = new Map<string, { rating: number; vol: number }>();
  for (const e of comp.entries) {
    if (e.fighterIdx !== null) {
      const f = fighters[e.fighterIdx];
      out.set(e.id, { rating: fighterRating(f, teams[f.teamIdx], comp.div.cat, comp.event), vol: volOf(f) });
    } else {
      const rs = e.roster.map(s => fighterRating(fighters[s.fighterIdx], teams[fighters[s.fighterIdx].teamIdx], comp.div.cat, comp.event));
      out.set(e.id, { rating: teamRating(rs, teams[e.teamIdx!], e.roster.filter(s => s.role === 'mercenary').length), vol: 1 });
    }
  }
  return out;
}

function simDuel(pa: number, rand: Rand): Outcome {
  const share = clamp(0.5 + (pa - 0.5) * 1.35, 0.08, 0.92);
  const a: number[] = [], b: number[] = [];
  for (let r = 0; r < 8; r++) {
    a.push(poisson(rand, 2.6 * share)); b.push(poisson(rand, 2.6 * (1 - share)));
    const diff = a.reduce((x, y) => x + y, 0) - b.reduce((x, y) => x + y, 0);
    if (a.length >= 2 && Math.abs(diff) >= 2) break;
  }
  let diff = a.reduce((x, y) => x + y, 0) - b.reduce((x, y) => x + y, 0);
  if (Math.abs(diff) < 2) { // a long match is decided on the last exchange
    if (rand() < pa) a[a.length - 1] += 2 - diff; else b[b.length - 1] += 2 + diff;
    diff = a.reduce((x, y) => x + y, 0) - b.reduce((x, y) => x + y, 0);
  }
  const ta = a.reduce((x, y) => x + y, 0), tb = b.reduce((x, y) => x + y, 0);
  return { result: diff > 0 ? 'a' : 'b', scoreA: ta, scoreB: tb, detail: { kind: 'duel', rounds: { a, b }, totals: { a: ta, b: tb } } };
}

function simGroup(pa: number, roundsToWin: number, rand: Rand): Outcome {
  let wa = 0, wb = 0;
  while (wa < roundsToWin && wb < roundsToWin) { if (rand() < clamp(pa, 0.05, 0.95)) wa++; else wb++; }
  return { result: wa > wb ? 'a' : 'b', scoreA: wa, scoreB: wb, detail: { kind: 'group', roundsToWin, roundsWon: { a: wa, b: wb }, roundsPlayed: wa + wb } };
}

/** Play planned matches in order; winners (and semifinal losers for the third place match) move on exactly as finalize_match moves them. */
function playPlanned(planned: readonly PlannedMatch[], ids: Map<string, string>, strengths: Map<string, { rating: number; vol: number }>, team: boolean,
  roundsToWin: number, rand: Rand, play: boolean): PlayedMatch[] {
  const live = new Map(planned.map(p => [p.key, { ...p }]));
  const out: PlayedMatch[] = [];
  const finalFeeders = new Set<string>();
  for (const p of planned) if (p.stage === 'elimination' && p.nextKey && live.get(p.nextKey)?.stage === 'final') finalFeeders.add(p.key);
  const feeders = [...finalFeeders].map(k => live.get(k)!).sort((x, y) => x.position - y.position);
  const initial = new Map(planned.map(p => [p.key, { a: p.a ?? null, b: p.b ?? null }]));
  const results = new Map<string, Outcome>();
  if (play) {
    for (const p of planned) {
      const m = live.get(p.key)!;
      if (m.stage === 'third_place' && !m.a) { /* filled by semifinal losers below */ }
      if (!m.a || !m.b) throw new Error(`match ${p.key} has an empty side when it is its turn`);
      const sa = strengths.get(m.a)!, sb = strengths.get(m.b)!;
      const vol = (sa.vol + sb.vol) / 2;
      const pa = team ? winProb(sa.rating, sb.rating, 230 * vol) : winProb(sa.rating, sb.rating, 330 * vol);
      const o = team ? simGroup(pa, roundsToWin, rand) : simDuel(pa, rand);
      results.set(p.key, o);
      const w = o.result === 'a' ? m.a : m.b, l = o.result === 'a' ? m.b : m.a;
      if (m.nextKey) { const n = live.get(m.nextKey)!; if (m.nextSlot === 'a') n.a = w; else n.b = w; }
      if (feeders.includes(m)) {
        const third = [...live.values()].find(x => x.stage === 'third_place');
        if (third) { if (feeders.indexOf(m) === 0) third.a = l; else third.b = l; }
      }
    }
  }
  for (const p of planned) {
    out.push({
      id: ids.get(p.key)!, key: p.key, stage: p.stage, roundLabel: p.roundLabel, position: p.position, pool: p.pool ?? null,
      entryA: initial.get(p.key)!.a, entryB: initial.get(p.key)!.b, nextKey: p.nextKey ?? null, nextSlot: p.nextSlot ?? null,
      nextId: p.nextKey ? ids.get(p.nextKey)! : null, field: null, startLocal: null, duration: 0, outcome: results.get(p.key) ?? null
    });
  }
  // The resolved sides are what the finalize calls refer to; keep them on the match so the loader never has to guess.
  for (const m of out) { const l = live.get(m.key)!; (m as PlayedMatch & { resolvedA?: string; resolvedB?: string }).resolvedA = l.a; (m as PlayedMatch & { resolvedA?: string; resolvedB?: string }).resolvedB = l.b; }
  return out;
}

export interface PlayOptions { play: boolean }

export function simulateCompetition(comp: CompPlan, teams: readonly TeamDef[], fighters: readonly FighterDef[], opt: PlayOptions): CompSim {
  const isTeam = isMelee(comp.div.cat);
  const entryIds = comp.entries.map(e => e.id);
  const strengths = entryRatings(comp, teams, fighters);
  const seed = 1 + (hash32(`draw|${comp.key}`) % 999999);
  const fmt = chooseFormat(entryIds.length, isTeam, comp.key);
  const roundsToWin = isTeam ? 2 : 0;
  const rand = rngFor(`sim|${comp.key}`);
  const plan = planDraw({ format: fmt.format, entryIds, mode: 'random', seed, thirdPlace: true, poolCount: fmt.poolCount });
  const idOf = (k: string): string => uid(`match|${comp.key}|${k}`);
  const ids1 = new Map(plan.matches.map(m => [m.key, idOf(m.key)]));
  const phase1 = playPlanned(plan.matches, ids1, strengths, isTeam, roundsToWin, rand, opt.play && fmt.format !== 'pools' ? true : opt.play);
  const phases = [phase1];
  if (fmt.format === 'pools' && opt.play) {
    // Pools are final: rank them exactly like the Run tab does, then build the bracket from the qualifiers.
    const stat = new Map<string, { entryId: string; wins: number; losses: number; scoreFor: number; scoreAgainst: number }>();
    const s = (id: string) => stat.get(id) ?? stat.set(id, { entryId: id, wins: 0, losses: 0, scoreFor: 0, scoreAgainst: 0 }).get(id)!;
    for (const m of phase1) {
      const x = m as PlayedMatch & { resolvedA: string; resolvedB: string };
      const o = m.outcome!;
      s(x.resolvedA).scoreFor += o.scoreA; s(x.resolvedA).scoreAgainst += o.scoreB; s(x.resolvedB).scoreFor += o.scoreB; s(x.resolvedB).scoreAgainst += o.scoreA;
      if (o.result === 'a') { s(x.resolvedA).wins++; s(x.resolvedB).losses++; } else { s(x.resolvedB).wins++; s(x.resolvedA).losses++; }
    }
    const ranked = rankPools(phase1.map(m => ({ stage: m.stage, pool: m.pool, queueState: 'final', entryA: m.entryA, entryB: m.entryB })), [...stat.values()]);
    const bracket = bracketFromPools(ranked, 2, true);
    const ids2 = new Map(bracket.matches.map(m => [m.key, idOf(m.key)]));
    phases.push(playPlanned(bracket.matches, ids2, strengths, isTeam, roundsToWin, rand, true));
  }
  const ratings = new Map([...strengths].map(([k, v]) => [k, v.rating]));
  return { comp, structure: fmt.structure, roundsToWin: isTeam ? roundsToWin : null, seed, phases, ratings };
}

export const resolved = (m: PlayedMatch): { a: string | null; b: string | null } => {
  const x = m as PlayedMatch & { resolvedA?: string | null; resolvedB?: string | null };
  return { a: x.resolvedA ?? m.entryA, b: x.resolvedB ?? m.entryB };
};

/* ------------------------------------------------------------------ the schedule */
const pad = (n: number): string => String(n).padStart(2, '0');
const minutes = (m: number): string => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Gives every match a ring, a local start time and a length. Competitions run in parallel on rings, so the same person can be in two places. */
export function scheduleEvent(ev: EventDef, sims: CompSim[], rings: number): void {
  const cursor = Array.from({ length: rings }, () => 0); // minutes after 10:00 on day one, continuing into day two after 480
  const dayOf = (m: number): { day: number; at: number } => (m < 480 ? { day: 0, at: m } : { day: 1, at: m - 480 });
  sims.forEach((s, ci) => {
    const ring = ci % rings;
    const dur = isMelee(s.comp.div.cat) ? 15 : 8;
    for (const phase of s.phases) {
      for (const m of phase) {
        let c = cursor[ring];
        if (c < 480 && c + dur > 480) c = 480; // day one ends at 18:00
        const { day, at } = dayOf(c);
        const date = new Date(`${ev.start}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + day);
        m.field = fieldFor(ring);
        m.startLocal = `${date.toISOString().slice(0, 10)} ${minutes(10 * 60 + at)}`;
        m.duration = dur;
        cursor[ring] = c + dur + 2;
      }
    }
  });
}

export const catOfComp = (c: CompPlan): Cat => c.div.cat;
export const compCode = (c: CompPlan): string => divCode(c.div);
export type { EntryPlan };

import type { PlannedMatch } from './bracket';
import { planDraw, type DrawFormat } from './runDraw';
import { planFights, type Plan, type PlanMatch } from './planner';
import { structureAdvice } from './tournament';

/**
 * Build Tournament (Pack 09D): from the entrants already in each competition to a proposed tournament. Pure; tested in buildPlan.test.ts.
 *
 *   activation   a competition is built only with 2 or more entrants still in; with fewer it stays offered (never an empty bracket).
 *   format       the existing advice (Tournament Structure and Formats, src/lib/tournament.ts) and the Run tab's existing default:
 *                2 to 6 entrants = round robin; 7 or more = pools (the advised number of pools), the bracket built from the pool results.
 *                The organizer can choose round robin, pools or single elimination instead (with a third-place fight from 4 entrants).
 *   draw         the existing reproducible random draw (planDraw with a saved draw number).
 *   fields       whole competitions go to fields, biggest first onto the least-loaded field (so one person's competition stays on one field
 *                and every field has about the same number of fights). The organizer can move a competition to another field.
 *   order        the fight planner (src/lib/planner.ts) over every competition and field at once, so the preview's rest numbers are the real ones.
 */

export interface FormatChoice { format: DrawFormat; poolCount: number; thirdPlace: boolean }
export interface FormatAdvice extends FormatChoice { why: string }

export function suggestFormat(n: number): FormatAdvice {
  if (n < 2) return { format: 'round_robin', poolCount: 0, thirdPlace: false, why: 'Not enough entrants to run' };
  if (n <= 6) return { format: 'round_robin', poolCount: 0, thirdPlace: false, why: `${n} entrants: everyone fights everyone` };
  const advisedPools = structureAdvice(n).options.map(o => o.pools.length).find(p => p >= 2) ?? 2;
  const poolCount = Math.max(2, Math.min(advisedPools, Math.floor(n / 2)));
  return { format: 'pools', poolCount, thirdPlace: true, why: `${n} entrants: ${poolCount} pools, then a bracket for the top of each pool` };
}

export const FORMAT_WORD: Record<DrawFormat, string> = { round_robin: 'Round robin', pools: 'Pools, then a bracket', single_elimination: 'Single elimination' };

export interface BuildCompetition {
  id: string; name: string; sort: number;
  /** Entrants still in, in entry order. */
  entryIds: string[];
  /** Who stands in each entry: the fighter of a duel entry, the roster of a team entry. */
  people: ReadonlyMap<string, readonly string[]>;
  alreadyBuilt: boolean;
}

export type CompetitionPlanState = 'build' | 'built' | 'too_few';
export interface CompetitionProposal {
  id: string; name: string; state: CompetitionPlanState; entrants: number;
  choice: FormatChoice; why: string; field: string; seed: number;
  matches: PlannedMatch[];
}

/** One competition's planned matches for a choice (empty when it is not built). */
export function plannedMatches(c: BuildCompetition, choice: FormatChoice, seed: number): PlannedMatch[] {
  if (c.alreadyBuilt || c.entryIds.length < 2) return [];
  const format: DrawFormat = choice.format === 'pools' && c.entryIds.length < 4 ? 'round_robin' : choice.format;
  const poolCount = Math.max(2, Math.min(choice.poolCount || 2, Math.floor(c.entryIds.length / 2)));
  return planDraw({ format, entryIds: c.entryIds, mode: 'random', seed, thirdPlace: format === 'single_elimination' && choice.thirdPlace && c.entryIds.length >= 4, poolCount }).matches;
}

/** Biggest competition first onto the field with the fewest fights so far (ties: lower field number, then competition order). Deterministic. */
export function assignFields(items: ReadonlyArray<{ id: string; fights: number; sort: number }>, fieldCount: number): Map<string, string> {
  const n = Math.max(1, fieldCount);
  const load = Array.from({ length: n }, () => 0);
  const out = new Map<string, string>();
  for (const it of [...items].sort((a, b) => b.fights - a.fights || a.sort - b.sort || a.id.localeCompare(b.id))) {
    let best = 0;
    for (let i = 1; i < n; i++) if (load[i] < load[best]) best = i;
    load[best] += it.fights;
    out.set(it.id, `Field ${best + 1}`);
  }
  return out;
}

/** How much worse a plan is for rest: back-to-back weighs most, then 1, then 2 fights of rest. */
export const restPenalty = (p: Plan): number => p.fights.filter(f => !f.locked).reduce((s, f) => s + (f.minRest === null || !f.short ? 0 : f.minRest === 0 ? 100 : f.minRest === 1 ? 10 : 1), 0);

/**
 * Fields chosen with the planner itself: biggest competition first, each onto the field whose simulated fight order (everything placed so far plus it)
 * gives the least rest penalty, then the most even number of fights per field, then the lower field number. No field may carry more fights than the busiest
 * field of the plain balanced spread (an idle field is never "better rest"). It is compared with that balanced spread
 * at the end and keeps whichever is better, so it is never worse for rest. Deterministic.
 */
function assignFieldsByPlan(comps: readonly BuildCompetition[], items: ReadonlyArray<{ c: BuildCompetition; matches: PlannedMatch[]; seedOrder: number }>, fieldCount: number): Map<string, string> {
  const n = Math.max(1, fieldCount);
  const balanced = assignFields(items.map(x => ({ id: x.c.id, fights: x.matches.length, sort: x.c.sort })), n);
  if (n === 1 || items.length <= 1) return balanced;
  const proposalsFor = (fields: ReadonlyMap<string, string>): CompetitionProposal[] => items.filter(x => fields.has(x.c.id)).map(x => ({
    id: x.c.id, name: x.c.name, state: 'build', entrants: x.c.entryIds.length, choice: { format: 'round_robin', poolCount: 0, thirdPlace: false }, why: '', seed: 0, matches: x.matches, field: fields.get(x.c.id)!
  }));
  const score = (fields: ReadonlyMap<string, string>) => {
    const loads = Array.from({ length: n }, () => 0);
    for (const x of items) { const f = fields.get(x.c.id); if (f) loads[Number(f.replace(/\D/g, '')) - 1] += x.matches.length; }
    return { rest: restPenalty(previewPlan(comps, proposalsFor(fields), n, new Set())), spread: Math.max(...loads) - Math.min(...loads) };
  };
  // Keep the fields moving: no field may carry more fights than the busiest field of the plain balanced spread.
  const cap = Math.max(...Array.from({ length: n }, (_, i) => items.filter(x => balanced.get(x.c.id) === `Field ${i + 1}`).reduce((s, x) => s + x.matches.length, 0)));
  const out = new Map<string, string>();
  const loads = Array.from({ length: n }, () => 0);
  for (const x of [...items].sort((a, b) => b.matches.length - a.matches.length || a.c.sort - b.c.sort || a.c.id.localeCompare(b.c.id))) {
    let best = '', bestScore = { rest: Infinity, spread: Infinity };
    const open = Array.from({ length: n }, (_, i) => i).filter(i => loads[i] + x.matches.length <= cap);
    for (const i of open.length > 0 ? open : [loads.indexOf(Math.min(...loads))]) {
      const trial = new Map(out).set(x.c.id, `Field ${i + 1}`);
      const sc = score(trial);
      if (sc.rest < bestScore.rest || (sc.rest === bestScore.rest && sc.spread < bestScore.spread)) { best = `Field ${i + 1}`; bestScore = sc; }
    }
    out.set(x.c.id, best);
    loads[Number(best.replace(/\D/g, '')) - 1] += x.matches.length;
  }
  // keep the plain spread when it is at least as good
  const a = score(out), b = score(balanced);
  return b.rest < a.rest || (b.rest === a.rest && b.spread <= a.spread) ? balanced : out;
}

export function propose(comps: readonly BuildCompetition[], fieldCount: number, seeds: ReadonlyMap<string, number>, overrides: ReadonlyMap<string, Partial<FormatChoice> & { field?: string }> = new Map()): CompetitionProposal[] {
  const base = comps.map(c => {
    const advice = suggestFormat(c.entryIds.length);
    const o = overrides.get(c.id) ?? {};
    const choice: FormatChoice = { format: o.format ?? advice.format, poolCount: o.poolCount ?? advice.poolCount, thirdPlace: o.thirdPlace ?? (o.format === 'single_elimination' && c.entryIds.length >= 4) };
    const state: CompetitionPlanState = c.alreadyBuilt ? 'built' : c.entryIds.length < 2 ? 'too_few' : 'build';
    const seed = seeds.get(c.id) ?? 1;
    const matches = state === 'build' ? plannedMatches(c, choice, seed) : [];
    const why = state === 'built' ? 'Already built' : state === 'too_few' ? (c.entryIds.length === 0 ? 'Nobody entered: offered, not run' : 'Only 1 entrant: offered, not run') : (o.format ? `${FORMAT_WORD[choice.format]} (your choice)` : advice.why);
    return { c, choice, state, seed, matches, why };
  });
  const fields = assignFieldsByPlan(comps, base.filter(b => b.state === 'build').map((b, i) => ({ c: b.c, matches: b.matches, seedOrder: i })), fieldCount);
  return base.map(b => ({
    id: b.c.id, name: b.c.name, state: b.state, entrants: b.c.entryIds.length, choice: b.choice, why: b.why, seed: b.seed, matches: b.matches,
    field: overrides.get(b.c.id)?.field ?? fields.get(b.c.id) ?? 'Field 1'
  }));
}

/** The proposal as the planner sees it: every planned fight, with the people in it and whether both sides are known yet. */
export function previewPlan(comps: readonly BuildCompetition[], proposals: readonly CompetitionProposal[], fieldCount: number, unavailable: ReadonlySet<string>): Plan {
  const byId = new Map(comps.map(c => [c.id, c]));
  const stageRank = (s: string) => (s === 'pool' || s === 'round_robin' ? 0 : s === 'elimination' ? 1 : s === 'third_place' ? 2 : 3);
  const matches: PlanMatch[] = [];
  let order = 0;
  for (const p of [...proposals].filter(x => x.state === 'build').sort((a, b) => (byId.get(a.id)!.sort - byId.get(b.id)!.sort) || a.id.localeCompare(b.id))) {
    const c = byId.get(p.id)!;
    const sorted = [...p.matches].sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || (Number(/\d+/.exec(a.roundLabel)?.[0] ?? 0) - Number(/\d+/.exec(b.roundLabel)?.[0] ?? 0)) || (a.pool ?? '').localeCompare(b.pool ?? '') || a.position - b.position);
    for (const m of sorted) {
      const people = [...(m.a ? c.people.get(m.a) ?? [] : []), ...(m.b ? c.people.get(m.b) ?? [] : [])];
      matches.push({ id: `${p.id}:${m.key}`, field: p.field.toLowerCase(), state: 'scheduled', people: [...new Set(people)], ready: !!(m.a && m.b), baseOrder: order++ });
    }
  }
  return planFights({ matches, fields: Array.from({ length: Math.max(1, fieldCount) }, (_, i) => `field ${i + 1}`), unavailable });
}

export interface PlanTotals { people: number; competitions: number; fights: number; laterFights: number }
export function planTotals(comps: readonly BuildCompetition[], proposals: readonly CompetitionProposal[]): PlanTotals {
  const building = proposals.filter(p => p.state === 'build');
  const people = new Set<string>();
  for (const p of building) { const c = comps.find(x => x.id === p.id)!; for (const id of c.entryIds) for (const who of c.people.get(id) ?? []) people.add(who); }
  const fights = building.reduce((s, p) => s + p.matches.length, 0);
  const laterFights = building.reduce((s, p) => s + p.matches.filter(m => !(m.a && m.b)).length, 0);
  return { people: people.size, competitions: building.length, fights, laterFights };
}

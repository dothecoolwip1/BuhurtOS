/**
 * Smart fight planning (Pack 09D): which fight should run next, on every field, so that every fighter gets as much rest as the draw allows.
 *
 * Pure and deterministic: no database, no React, no clock. The same input always gives the same plan (every tie is broken by a fixed key), so two
 * organizer screens open at once compute and save the same order. docs/claude-packs/PACK_09D_SIMPLE_EVENT_AUTOMATION.md explains the rules in prose.
 *
 * The model
 *   * Every field is a lane. A lane runs its fights one after another; lanes run side by side at the same pace (we do not know how long a fight takes,
 *     so a "slot" is one fight's worth of time on every field). A fight's place in time is (slot, field order): `key = slot * fields + fieldIndex`.
 *   * Fights already called (NOW, ON DECK, IN THE HOLE) are LOCKED at the front of their lane in that order. The planner never moves them.
 *   * Finished fights are history, in the order they were finished; they sit before every lane (negative keys).
 *   * Rest is counted EVENT-WIDE: the number of fights (on any field, in any competition) that start strictly between two appearances of a fighter.
 *   * The planner fills the earliest open slot first (lowest key) with the best READY fight for that field, then the next slot, until every ready fight
 *     has a place.
 *
 * Hard rules (a fight that breaks one is never placed in that slot)
 *   1. Only READY fights are planned: both sides known and neither withdrawn. A bracket fight waiting for an earlier result is "waiting", not planned.
 *   2. Never double-book: a fighter is never placed in a slot where they already fight on another field.
 *   3. A fighter registered as not attending today makes their fight "waiting" (shown to the organizer) rather than planned.
 *   4. A fight runs on its own field (no field = Field 1).
 *
 * Preferences, in order (the first difference decides)
 *   a. The organizer's hand-made order on that field (Pack 09A "run sooner / later") comes first, in that order; then fights with a published time,
 *      in time order (an organizer who published times keeps them). Only fights with neither are ordered for rest.
 *   b. The most rest, counted up to the target (3 fights between appearances by default): 3+ beats 2 beats 1 beats back-to-back. Never-yet-fought counts
 *      as fully rested. Rest beyond the target is not "better": once everyone is rested, the next rules decide.
 *   c. Fighters with more fights still to come go first (spreads a round robin out instead of leaving one fighter's fights for the end).
 *   d. The normal running order (competition order, pool before bracket, earlier round first, position, id).
 *
 * A short rest is never hidden: each planned fight carries the rest of every fighter in it, and `short` is true when anyone is below the target. Because
 * the best available fight is always chosen, a short rest in the plan means no ready fight on that field could do better at that moment.
 */

export const REST_TARGET = 3;

export type PlanState = 'final' | 'active' | 'on_deck' | 'in_the_hole' | 'scheduled';
const LOCK_RANK: Record<string, number> = { active: 0, on_deck: 1, in_the_hole: 2 };

export interface PlanMatch {
  id: string;
  /** Field key (lower-case, trimmed; blank = "field 1"). */
  field: string;
  state: PlanState;
  /** Everyone fighting in this match (both sides; team rosters included). Empty sides are allowed for fights that are not ready. */
  people: readonly string[];
  /** Both sides known and neither side withdrawn. */
  ready: boolean;
  /** For finished fights: when they finished (ISO). Orders history. */
  finishedAt?: string | null;
  /** The organizer's hand-made order on its field (Pack 09A queue_order, or a published fight time); null = none. */
  manualOrder?: number | null;
  /** The hand-made order comes from a published fight time (said as such in the reasons). */
  scheduled?: boolean;
  /** The normal running order position (lower runs sooner); used only to break ties. */
  baseOrder: number;
}

export interface PlanInput {
  matches: readonly PlanMatch[];
  /** Field keys in display order. Fields that only appear on matches are added after these, alphabetically. */
  fields?: readonly string[];
  /** Fighters registered as not attending today. */
  unavailable?: ReadonlySet<string>;
  /** Fighters who said they share equipment with someone (the partner is not recorded): a warning only. */
  sharesEquipment?: ReadonlySet<string>;
  target?: number;
}

export type ReasonCode = 'called' | 'manual' | 'rested' | 'first' | 'short' | 'back_to_back' | 'only' | 'equipment';
export interface Reason { code: ReasonCode; text: string }

export interface FighterRest {
  fighterId: string;
  /** Fights between this fighter's previous appearance and this one; null = no earlier appearance today. */
  rest: number | null;
}

export interface PlannedFight {
  matchId: string;
  field: string;
  /** 0 = now fighting / the next to start on an empty field. */
  slot: number;
  /** Position in the event-wide order (0 = earliest). */
  order: number;
  locked: boolean;
  rests: FighterRest[];
  /** The smallest rest of anyone in the fight; null when nobody in it has fought yet. */
  minRest: number | null;
  /** Someone in it has less rest than the target. */
  short: boolean;
  reasons: Reason[];
}

export type WaitCode = 'unknown_side' | 'unavailable';
export interface WaitingFight { matchId: string; code: WaitCode; fighters: string[] }

export interface PlanSummary {
  planned: number;
  meetTarget: number;
  shortRest: number;
  backToBack: number;
  waiting: number;
  unavailable: number;
}

export interface Plan {
  target: number;
  fights: PlannedFight[];
  byMatch: Map<string, PlannedFight>;
  /** Each field's fights in order: locked first, then the plan. */
  lanes: Map<string, PlannedFight[]>;
  waiting: WaitingFight[];
  summary: PlanSummary;
  /** Upcoming (not locked) fights in event-wide order: what is saved as the plan order. */
  upcoming: string[];
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const timeOf = (iso: string | null | undefined): number => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? t : Infinity; };

/** Sorted insert into an ascending number array. */
function insertSorted(arr: number[], v: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  arr.splice(lo, 0, v);
}
/** How many values lie strictly between a and b (a < b). */
function countBetween(arr: readonly number[], a: number, b: number): number {
  const lower = (v: number) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= v) lo = mid + 1; else hi = mid; } return lo; };
  const upper = (v: number) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  return Math.max(0, upper(b) - lower(a));
}

export function planFights(input: PlanInput): Plan {
  const target = Math.max(1, input.target ?? REST_TARGET);
  const unavailable = input.unavailable ?? new Set<string>();
  const shares = input.sharesEquipment ?? new Set<string>();

  // ---- fields, in a fixed order
  const fields: string[] = [...(input.fields ?? [])];
  const extra = [...new Set(input.matches.filter(m => m.state !== 'final').map(m => m.field))].filter(f => !fields.includes(f)).sort(cmpStr);
  fields.push(...extra);
  const F = Math.max(1, fields.length);
  const fieldIndex = new Map(fields.map((f, i) => [f, i]));

  // ---- history: finished fights, oldest first, as negative keys
  const finished = input.matches.filter(m => m.state === 'final')
    .sort((a, b) => timeOf(a.finishedAt) - timeOf(b.finishedAt) || cmpStr(a.id, b.id));
  const keys: number[] = [];                       // every placed fight's key, ascending
  const last = new Map<string, number>();          // fighter -> key of their latest placed appearance
  const appear = (people: readonly string[], key: number) => { for (const p of people) { const k = last.get(p); if (k === undefined || k < key) last.set(p, key); } };
  finished.forEach((m, i) => { const key = i - finished.length; insertSorted(keys, key); appear(m.people, key); });

  // ---- remaining fights per fighter (for preference c): every non-final fight with known people
  const remaining = new Map<string, number>();
  for (const m of input.matches) if (m.state !== 'final') for (const p of m.people) remaining.set(p, (remaining.get(p) ?? 0) + 1);

  const restOf = (people: readonly string[], key: number): FighterRest[] =>
    people.map(p => { const k = last.get(p); return { fighterId: p, rest: k === undefined ? null : countBetween(keys, k, key) }; });
  const minOf = (rests: readonly FighterRest[]): number | null => rests.reduce<number | null>((acc, r) => (r.rest === null ? acc : acc === null ? r.rest : Math.min(acc, r.rest)), null);
  const keyAt = (field: string, slot: number) => slot * F + (fieldIndex.get(field) ?? 0);

  // who fights in which slot (for the double-booking rule)
  const bySlot = new Map<number, Set<string>>();
  const occupy = (slot: number, people: readonly string[]) => { let s = bySlot.get(slot); if (!s) bySlot.set(slot, (s = new Set())); people.forEach(p => s!.add(p)); };

  // A placement: which fight sits in which slot of which lane. Reasons and rests are worked out at the end, on the final arrangement.
  interface Placement { m: PlanMatch; field: string; slot: number; locked: boolean }
  const placements: Placement[] = [];
  const place = (m: PlanMatch, field: string, slot: number, locked: boolean) => {
    const key = keyAt(field, slot);
    insertSorted(keys, key); appear(m.people, key); occupy(slot, m.people);
    for (const p of m.people) remaining.set(p, Math.max(0, (remaining.get(p) ?? 1) - 1));
    placements.push({ m, field, slot, locked });
  };

  // ---- locked: called fights, at the front of their lanes
  for (const field of fields) {
    const called = input.matches.filter(m => m.field === field && m.state in LOCK_RANK)
      .sort((a, b) => LOCK_RANK[a.state] - LOCK_RANK[b.state] || a.baseOrder - b.baseOrder || cmpStr(a.id, b.id));
    called.forEach((m, slot) => place(m, field, slot, true));
  }

  // ---- what can be planned, and what waits
  const waiting: WaitingFight[] = [];
  const pool: PlanMatch[] = [];
  for (const m of input.matches) {
    if (m.state !== 'scheduled') continue;
    if (!m.ready) { waiting.push({ matchId: m.id, code: 'unknown_side', fighters: [] }); continue; }
    const away = m.people.filter(p => unavailable.has(p));
    if (away.length > 0) { waiting.push({ matchId: m.id, code: 'unavailable', fighters: away }); continue; }
    pool.push(m);
  }
  waiting.sort((a, b) => cmpStr(a.matchId, b.matchId));
  const perField = new Map<string, PlanMatch[]>(fields.map(f => [f, []]));
  for (const m of pool) perField.get(m.field)!.push(m);

  // ---- 1. fill greedily: always the earliest open slot (lowest key) of a lane that still has fights
  const laneLength = new Map(fields.map(f => [f, placements.filter(x => x.field === f).length]));
  const stalls = new Map(fields.map(f => [f, 0]));
  type Scored = { m: PlanMatch; bucket: number; manual: number; busy: number };
  const better = (a: Scored, b: Scored) =>
    (a.manual - b.manual) || (b.bucket - a.bucket) || (b.busy - a.busy) || (a.m.baseOrder - b.m.baseOrder) || cmpStr(a.m.id, b.m.id);
  let guard = pool.length * (F + 2) * 4 + 16;
  while (guard-- > 0) {
    const open = fields.filter(f => perField.get(f)!.length > 0);
    if (open.length === 0) break;
    const field = open.reduce((best, f) => (keyAt(f, laneLength.get(f)!) < keyAt(best, laneLength.get(best)!) ? f : best));
    const slot = laneLength.get(field)!;
    const key = keyAt(field, slot);
    const busy = bySlot.get(slot) ?? new Set<string>();
    const candidates = perField.get(field)!;
    const valid = candidates.filter(m => !m.people.some(p => busy.has(p)));
    // hand-made order on this field is followed exactly: the lowest manual one goes first if it can go at all
    const manualLeft = candidates.filter(m => m.manualOrder != null).sort((a, b) => a.manualOrder! - b.manualOrder! || cmpStr(a.id, b.id));
    if ((valid.length === 0 || (manualLeft.length > 0 && !valid.includes(manualLeft[0]))) && stalls.get(field)! < F) {
      // Every ready fight here would double-book someone fighting on another field at the same time (or the next hand-placed fight would):
      // leave this slot of that field empty and try the next one. Bounded: a lane never stalls more than once per field in a row.
      stalls.set(field, stalls.get(field)! + 1); laneLength.set(field, slot + 1); continue;
    }
    const pickFrom = valid.length > 0 ? valid : candidates;            // after F stalls nothing is gained by waiting (cannot happen with one field)
    let pick: PlanMatch;
    if (manualLeft.length > 0 && pickFrom.includes(manualLeft[0])) pick = manualLeft[0];
    else {
      const scored = pickFrom.map(m => {
        const mr = minOf(restOf(m.people, key));
        return { m, bucket: mr === null ? target : Math.min(mr, target), manual: m.manualOrder != null ? 0 : 1, busy: m.people.reduce((s, p) => s + (remaining.get(p) ?? 0), 0) };
      });
      scored.sort(better);
      pick = scored[0].m;
    }
    place(pick, field, slot, false);
    stalls.set(field, 0);
    laneLength.set(field, slot + 1);
    perField.set(field, candidates.filter(m => m !== pick));
  }

  // ---- 2. improve: swap nearby upcoming fights on the same field while that lowers the rest penalty (greedy alone can paint itself into a corner:
  //         Bob in two disciplines gets 2 then 0 where 1 and 1 was possible). Called and hand-placed fights never move. Deterministic: fixed scan order,
  //         a swap is kept only when the penalty strictly drops, and the number of passes is bounded.
  const allKeys = [...keys];                                          // the SET of occupied keys never changes when fights swap slots
  const historyAppearances = new Map<string, number[]>();
  finished.forEach((m, i) => { for (const p of m.people) { const a = historyAppearances.get(p) ?? []; a.push(i - finished.length); historyAppearances.set(p, a); } });
  const PENALTY = (rest: number | null) => (rest === null || rest >= target ? 0 : 10 ** (target - rest));
  const minRestAt = (people: readonly string[], key: number, byPerson: Map<string, number[]>): number | null => {
    let best: number | null = null;
    for (const p of people) {
      const ks = byPerson.get(p) ?? [];
      let prev: number | undefined;
      for (const k of ks) { if (k < key && (prev === undefined || k > prev)) prev = k; }
      if (prev === undefined) continue;
      const r = countBetween(allKeys, prev, key);
      best = best === null ? r : Math.min(best, r);
    }
    return best;
  };
  const appearances = () => {
    const by = new Map<string, number[]>();
    for (const [p, ks] of historyAppearances) by.set(p, [...ks]);
    for (const x of placements) for (const p of x.m.people) { const a = by.get(p) ?? []; a.push(keyAt(x.field, x.slot)); by.set(p, a); }
    return by;
  };
  const cost = () => {
    const by = appearances();
    let c = 0;
    for (const x of placements) if (!x.locked) c += PENALTY(minRestAt(x.m.people, keyAt(x.field, x.slot), by));
    return c;
  };
  const doubleBooked = (x: Placement) => placements.some(y => y !== x && y.slot === x.slot && y.field !== x.field && y.m.people.some(p => x.m.people.includes(p)));
  const movable = (x: Placement) => !x.locked && x.m.manualOrder == null;
  const WINDOW = 6;
  if (placements.some(x => !x.locked)) {
    let current = cost();
    for (let pass = 0; pass < 8 && current > 0; pass++) {
      let improved = false;
      for (const field of fields) {
        const lane = placements.filter(x => x.field === field && movable(x)).sort((a, b) => a.slot - b.slot);
        for (let i = 0; i < lane.length; i++) {
          for (let j = i + 1; j < Math.min(lane.length, i + 1 + WINDOW); j++) {
            const a = lane[i], b = lane[j];
            [a.m, b.m] = [b.m, a.m];
            if (!doubleBooked(a) && !doubleBooked(b)) {
              const c = cost();
              if (c < current) { current = c; improved = true; continue; }
            }
            [a.m, b.m] = [b.m, a.m];
          }
        }
      }
      if (!improved) break;
    }
  }

  // ---- 3. describe the final arrangement: rests, reasons, event-wide order
  const by = appearances();
  const laneUpcoming = new Map(fields.map(f => [f, placements.filter(x => x.field === f && !x.locked).length]));
  const fights: PlannedFight[] = placements.map(x => {
    const key = keyAt(x.field, x.slot);
    const rests: FighterRest[] = x.m.people.map(p => {
      const ks = by.get(p) ?? [];
      let prev: number | undefined;
      for (const k of ks) { if (k < key && (prev === undefined || k > prev)) prev = k; }
      return { fighterId: p, rest: prev === undefined ? null : countBetween(allKeys, prev, key) };
    });
    const minRest = minOf(rests);
    const short = minRest !== null && minRest < target;
    const reasons: Reason[] = [];
    if (x.locked) reasons.push({ code: 'called', text: x.m.state === 'active' ? 'Fighting now' : 'Already called' });
    else {
      if (x.m.manualOrder != null) reasons.push({ code: 'manual', text: x.m.scheduled ? 'Follows the published fight times' : 'Placed by hand' });
      if (laneUpcoming.get(x.field) === 1) reasons.push({ code: 'only', text: 'Only ready fight on this field' });
      if (minRest === null) reasons.push({ code: 'first', text: 'First fight today for everyone in it' });
      else if (minRest === 0) reasons.push({ code: 'back_to_back', text: 'Back-to-back: no other ready fight gives more rest' });
      else if (short) reasons.push({ code: 'short', text: `Short rest: ${minRest} fight${minRest === 1 ? '' : 's'} between appearances` });
      else reasons.push({ code: 'rested', text: `${target}+ fights of rest` });
      if (x.m.people.some(p => shares.has(p))) reasons.push({ code: 'equipment', text: 'Someone in this fight shares equipment: check the gear is free' });
    }
    return { matchId: x.m.id, field: x.field, slot: x.slot, order: -1, locked: x.locked, rests, minRest, short, reasons };
  });
  const keyOf = (f: PlannedFight) => keyAt(f.field, f.slot);
  fights.sort((a, b) => keyOf(a) - keyOf(b) || cmpStr(a.matchId, b.matchId));
  fights.forEach((f, i) => { f.order = i; });
  const lanes = new Map<string, PlannedFight[]>(fields.map(f => [f, fights.filter(x => x.field === f).sort((a, b) => a.slot - b.slot)]));

  const upcoming = fights.filter(f => !f.locked);
  const summary: PlanSummary = {
    planned: upcoming.length,
    meetTarget: upcoming.filter(f => !f.short).length,
    shortRest: upcoming.filter(f => f.short).length,
    backToBack: upcoming.filter(f => f.minRest === 0).length,
    waiting: waiting.length,
    unavailable: waiting.filter(w => w.code === 'unavailable').length
  };
  return { target, fights, byMatch: new Map(fights.map(f => [f.matchId, f])), lanes, waiting, summary, upcoming: upcoming.map(f => f.matchId) };
}

/** The fight each field should start next: the one fighting now, else the first called, else the first planned. */
export function nextOnField(plan: Plan, field: string): PlannedFight | null {
  return plan.lanes.get(field)?.[0] ?? null;
}

/** "4 fights since last appearance" / "First fight today". */
export function restWords(rest: number | null): string {
  if (rest === null) return 'First fight today';
  if (rest === 0) return 'Just fought (back-to-back)';
  return `${rest} fight${rest === 1 ? '' : 's'} since last appearance`;
}

/** One line for the organizer: why this fight. */
export function planHeadline(f: PlannedFight, target = REST_TARGET): string {
  if (f.minRest === null) return 'Fresh fighters: nobody in it has fought yet';
  if (!f.short) return `Everyone has had ${target}+ fights of rest`;
  if (f.minRest === 0) return 'Back-to-back: nothing better is ready';
  return `Short rest (${f.minRest} between appearances): nothing better is ready`;
}

/** Whether the saved order (the database's plan_order, numbered from 1) already matches the plan's upcoming order. */
export function planMatchesSaved(upcoming: readonly string[], saved: ReadonlyMap<string, number | null | undefined>): boolean {
  for (let i = 0; i < upcoming.length; i++) if (saved.get(upcoming[i]) !== i + 1) return false;   // the database numbers the plan from 1
  for (const [id, v] of saved) if (v != null && !upcoming.includes(id)) return false;
  return true;
}

import type { CompetitionEntry, CompetitionMatch } from '../data/matches';
import { compareRunOrder, fieldKey, isRunnable, type CompetitionSort, type RegistrationFlag } from './eventDay';
import { planFights, type Plan, type PlanMatch, type PlanState } from './planner';
import { sideFighters, type RosterMember } from './runSchedule';

/**
 * Event day data → the planner (src/lib/planner.ts). Pure: the caller passes "today" (the event's calendar day) so nothing here reads a clock.
 *
 *   people     a duel side is its fighter; a team side is its roster for this competition (entry_roster). Rest follows a PERSON across fields,
 *              competitions and disciplines.
 *   ready      both sides known and neither withdrawn (the Pack 09A rule, isRunnable).
 *   fields     "field 1".."field n" from the event's number of fields, then any other field a match names.
 *   unavailable  an ACCEPTED registration that lists the days it can attend, and today is not one of them.
 *   equipment  a registration that says it shares equipment (the partner is not recorded): a warning on the fight, never a rule.
 *   baseOrder  the normal running order without any manual or planned order (schedule, competition order, stage, round, pool, position, id).
 */
export interface PlanSource {
  matches: readonly CompetitionMatch[];
  entries: readonly CompetitionEntry[];
  roster: readonly RosterMember[];
  registrations: readonly RegistrationFlag[];
  sorts: CompetitionSort;
  withdrawn: ReadonlySet<string>;
  /** The event's calendar day today, yyyy-mm-dd (in the event's time zone). */
  today: string;
  fieldCount?: number;
  target?: number;
}

export function fieldKeysFor(count: number | undefined, matches: readonly Pick<CompetitionMatch, 'field'>[]): string[] {
  const keys = Array.from({ length: Math.max(1, count ?? 1) }, (_, i) => `field ${i + 1}`);
  for (const m of matches) { const k = fieldKey(m.field); if (!keys.includes(k)) keys.push(k); }
  return keys;
}

export function planInput(src: PlanSource): { matches: PlanMatch[]; fields: string[]; unavailable: Set<string>; sharesEquipment: Set<string>; target?: number } {
  const base = [...src.matches].sort((a, b) => compareRunOrder({ ...a, queueOrder: null, planOrder: null }, { ...b, queueOrder: null, planOrder: null }, src.sorts));
  const rank = new Map(base.map((m, i) => [m.id, i]));
  const sideEntries = src.entries.map(e => ({ id: e.id, fighterId: e.fighterId, teamId: e.teamId, name: e.name }));
  const matches: PlanMatch[] = src.matches.map(m => {
    const people = [...new Set([...sideFighters(m.entryA, sideEntries, src.roster), ...sideFighters(m.entryB, sideEntries, src.roster)].map(p => p.fighterId))];
    return {
      id: m.id, field: fieldKey(m.field), state: m.queueState as PlanState, people,
      ready: isRunnable(m, src.withdrawn), finishedAt: m.finalizedAt, manualOrder: m.queueOrder ?? null, baseOrder: rank.get(m.id) ?? 0
    };
  });
  const unavailable = new Set<string>();
  const sharesEquipment = new Set<string>();
  for (const r of src.registrations) {
    if (r.status !== 'accepted') continue;
    if (r.attendDates && r.attendDates.length > 0 && !r.attendDates.includes(src.today)) unavailable.add(r.fighterId);
    if (r.sharesEquipment) sharesEquipment.add(r.fighterId);
  }
  return { matches, fields: fieldKeysFor(src.fieldCount, src.matches), unavailable, sharesEquipment, target: src.target };
}

export function planEvent(src: PlanSource): Plan {
  return planFights(planInput(src));
}

/** The fights to hold back (someone in them is not here today): saved with the plan so the queue does not call them by itself. */
export const heldMatches = (plan: Plan): string[] => plan.waiting.filter(w => w.code === 'unavailable').map(w => w.matchId);

/** Whether what the database holds already matches this plan (order and holds), so nothing needs saving. */
export function planIsSaved(plan: Plan, matches: readonly CompetitionMatch[]): boolean {
  const held = new Set(heldMatches(plan));
  const position = new Map(plan.upcoming.map((id, i) => [id, i + 1]));
  for (const m of matches) {
    if (m.queueState !== 'scheduled') continue;
    if ((m.planOrder ?? null) !== (position.get(m.id) ?? null)) return false;
    if ((m.planHold === true) !== held.has(m.id)) return false;
  }
  return true;
}

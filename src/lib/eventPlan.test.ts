import { describe, expect, it } from 'vitest';
import type { CompetitionEntry, CompetitionMatch } from '../data/matches';
import { fieldKeysFor, heldMatches, planEvent, planInput, planIsSaved } from './eventPlan';

const m = (id: string, a: string | null, b: string | null, o: Partial<CompetitionMatch> = {}): CompetitionMatch => ({
  id, competitionId: o.competitionId ?? 'c1', stage: 'round_robin', roundLabel: 'Round 1', position: 1, pool: null, field: 'Field 1', scheduledAt: null, queueState: 'scheduled',
  entryA: a, entryB: b, nameA: a, nameB: b, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null, scoreA: null, scoreB: null, detail: {}, version: 1, finalizedAt: null, ...o
});
const duel = (id: string, fighter: string, comp = 'c1'): CompetitionEntry => ({ id, competitionId: comp, teamId: null, fighterId: fighter, name: fighter, pool: null, seed: null, status: 'registered' });
const team = (id: string, comp = 't1'): CompetitionEntry => ({ id, competitionId: comp, teamId: `team-${id}`, fighterId: null, name: id, pool: null, seed: null, status: 'registered' });
const base = { sorts: new Map([['c1', 1], ['c2', 2], ['t1', 3]]), withdrawn: new Set<string>(), today: '2026-11-14', registrations: [], roster: [] };

describe('event plan input', () => {
  it('a team side is its roster; rest follows the person from a duel into a team fight', () => {
    const entries = [duel('eBob', 'bob'), duel('eJoe', 'joe'), team('tA'), team('tB'), duel('eX', 'x', 'c2'), duel('eY', 'y', 'c2')];
    const roster = [{ entryId: 'tA', fighterId: 'bob', displayName: 'Bob' }, { entryId: 'tA', fighterId: 'ann', displayName: 'Ann' }, { entryId: 'tB', fighterId: 'cat', displayName: 'Cat' }];
    const matches = [m('duel', 'eBob', 'eJoe', { queueState: 'final', finalizedAt: '2026-11-14T10:00:00Z' }), m('melee', 'tA', 'tB', { competitionId: 't1' }), m('other', 'eX', 'eY', { competitionId: 'c2' })];
    const input = planInput({ ...base, matches, entries, roster });
    expect([...input.matches.find(x => x.id === 'melee')!.people].sort()).toEqual(['ann', 'bob', 'cat']);
    const plan = planEvent({ ...base, matches, entries, roster });
    expect(plan.upcoming[0]).toBe('other');                  // Bob just fought a duel: the 5v5 he is in waits one fight
  });

  it('a fighter registered for another day is held, and the hold is saved with the plan', () => {
    const entries = [duel('e1', 'sun'), duel('e2', 'b'), duel('e3', 'c'), duel('e4', 'd')];
    const regs = [{ id: 'r', fighterId: 'sun', fullName: 'Sunday Sam', status: 'accepted' as const, isVolunteer: false, checkedIn: true, attendDates: ['2026-11-15'] }];
    const plan = planEvent({ ...base, matches: [m('m1', 'e1', 'e2'), m('m2', 'e3', 'e4')], entries, registrations: regs });
    expect(plan.upcoming).toEqual(['m2']);
    expect(heldMatches(plan)).toEqual(['m1']);
  });

  it('no stated days, or a pending registration, never holds anyone', () => {
    const entries = [duel('e1', 'a'), duel('e2', 'b')];
    const regs = [{ id: 'r', fighterId: 'a', fullName: 'A', status: 'pending' as const, isVolunteer: false, checkedIn: false, attendDates: ['2026-11-15'] }];
    expect(planEvent({ ...base, matches: [m('m1', 'e1', 'e2')], entries, registrations: regs }).upcoming).toEqual(['m1']);
  });

  it('fields: the event count first, then any other field a match names', () => {
    expect(fieldKeysFor(2, [{ field: 'Field 1' }, { field: 'Ring B' }])).toEqual(['field 1', 'field 2', 'ring b']);
  });

  it('knows when the saved plan already matches', () => {
    const entries = [duel('e1', 'a'), duel('e2', 'b'), duel('e3', 'c'), duel('e4', 'd')];
    const ms = [m('m1', 'e1', 'e2'), m('m2', 'e3', 'e4')];
    const plan = planEvent({ ...base, matches: ms, entries });
    expect(planIsSaved(plan, ms)).toBe(false);
    const saved = ms.map(x => ({ ...x, planOrder: plan.upcoming.indexOf(x.id) + 1, planHold: false }));
    expect(planIsSaved(plan, saved)).toBe(true);
  });
});

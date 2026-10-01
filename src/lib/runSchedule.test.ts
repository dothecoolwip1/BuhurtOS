import { describe, expect, it } from 'vitest';
import {
  addMinutes, bookingLine, conflictsHeadline, conflictsStripLabel, distinctFighters, matchFighters, parseDuration, parseFields, planEnd, planSchedule, sideFighters, timeLabel
} from './runSchedule';

const m = (id: string, queueState = 'scheduled', scheduledAt: string | null = null) => ({ matchId: id, queueState, scheduledAt });

describe('time stepping', () => {
  it('adds minutes and rejects bad dates', () => {
    expect(addMinutes('2026-11-14T16:00:00.000Z', 15)).toBe('2026-11-14T16:15:00.000Z');
    expect(addMinutes('nope', 5)).toBeNull();
  });
  it('parses durations as whole minutes 1 to 720', () => {
    expect(parseDuration('15')).toBe(15);
    expect(parseDuration(' 720 ')).toBe(720);
    for (const bad of ['0', '721', '1.5', '', 'abc', '-3']) expect(parseDuration(bad)).toBeNull();
  });
  it('parses field lists', () => {
    expect(parseFields('Field 1, Field 2\nfield 1,  ,Ring')).toEqual(['Field 1', 'Field 2', 'Ring']);
    expect(parseFields('')).toEqual([]);
  });
});

describe('planSchedule', () => {
  const start = '2026-11-14T16:00:00.000Z';
  it('runs one match per slot on one field', () => {
    const p = planSchedule([m('a'), m('b'), m('c')], start, 20, ['Field 1']);
    expect(p.map(s => s.scheduledAt)).toEqual(['2026-11-14T16:00:00.000Z', '2026-11-14T16:20:00.000Z', '2026-11-14T16:40:00.000Z']);
    expect(p.every(s => s.field === 'Field 1')).toBe(true);
  });
  it('runs as many matches at once as there are fields', () => {
    const p = planSchedule([m('a'), m('b'), m('c'), m('d'), m('e')], start, 10, ['F1', 'F2']);
    expect(p.map(s => [s.field, s.scheduledAt.slice(11, 16)])).toEqual([['F1', '16:00'], ['F2', '16:00'], ['F1', '16:10'], ['F2', '16:10'], ['F1', '16:20']]);
  });
  it('leaves the field empty when none are given', () => {
    expect(planSchedule([m('a')], start, 10, [])[0].field).toBeNull();
  });
  it('skips final matches and, on request, matches that already have a time', () => {
    const list = [m('a', 'final'), m('b', 'scheduled', start), m('c')];
    expect(planSchedule(list, start, 10, ['F1']).map(s => s.matchId)).toEqual(['b', 'c']);
    expect(planSchedule(list, start, 10, ['F1'], true).map(s => s.matchId)).toEqual(['c']);
    expect(planSchedule(list, start, 10, ['F1'], true)[0].scheduledAt).toBe(start);
  });
  it('returns nothing for a bad start or interval', () => {
    expect(planSchedule([m('a')], 'x', 10, [])).toEqual([]);
    expect(planSchedule([m('a')], start, 0, [])).toEqual([]);
  });
  it('finds the end of the plan', () => {
    const p = planSchedule([m('a'), m('b')], start, 30, []);
    expect(planEnd(p, 15)).toBe('2026-11-14T16:45:00.000Z');
    expect(planEnd([], 15)).toBeNull();
  });
});

describe('who stands in a match', () => {
  const entries = [
    { id: 'e1', fighterId: 'f1', teamId: null, name: 'Aldric Stone-test' },
    { id: 'e2', fighterId: null, teamId: 't1', name: 'Team One' },
    { id: 'e3', fighterId: null, teamId: 't2', name: 'Team Two' }
  ];
  const roster = [
    { entryId: 'e2', fighterId: 'f2', displayName: 'Bea' }, { entryId: 'e2', fighterId: 'f3', displayName: 'Cal' },
    { entryId: 'e3', fighterId: 'f3', displayName: 'Cal' }, { entryId: 'e3', fighterId: 'f4', displayName: 'Dee' }
  ];
  it('uses the fighter for a duel and the roster for a team', () => {
    expect(sideFighters('e1', entries, roster)).toEqual([{ fighterId: 'f1', name: 'Aldric Stone-test' }]);
    expect(sideFighters('e2', entries, roster).map(p => p.fighterId)).toEqual(['f2', 'f3']);
    expect(sideFighters(null, entries, roster)).toEqual([]);
    expect(sideFighters('missing', entries, roster)).toEqual([]);
  });
  it('lists each person once across both sides', () => {
    expect(matchFighters('e2', 'e3', entries, roster).map(p => p.fighterId)).toEqual(['f2', 'f3', 'f4']);
  });
});

describe('wording', () => {
  it('formats a time in the event zone', () => {
    expect(timeLabel('2026-11-14T17:15:00.000Z', 'America/Edmonton')).toBe('Sat 10:15');
    expect(timeLabel('bad')).toBe('an unknown time');
  });
  it('names the booking in plain language', () => {
    expect(bookingLine('Aldric Stone-test', { competitionName: 'Male Longsword', scheduledAt: '2026-11-14T17:15:00.000Z', overlapMinutes: 5 }, 'America/Edmonton'))
      .toBe('Aldric Stone-test is already fighting Male Longsword at Sat 10:15 (overlaps by 5 minutes).');
    expect(bookingLine('A', { competitionName: 'X', scheduledAt: '2026-11-14T17:15:00.000Z', overlapMinutes: 1 }, 'America/Edmonton')).toContain('1 minute)');
  });
  it('words the headline and counts distinct fighters', () => {
    expect(conflictsHeadline(0)).toBeNull();
    expect(conflictsHeadline(1)).toBe('Needs attention: 1 fighter is double-booked');
    expect(conflictsHeadline(3)).toBe('Needs attention: 3 fighters are double-booked');
    expect(conflictsStripLabel(2)).toBe('2 fighters double-booked');
    expect(distinctFighters([{ fighterId: 'a' }, { fighterId: 'a' }, { fighterId: 'b' }])).toBe(2);
  });
});

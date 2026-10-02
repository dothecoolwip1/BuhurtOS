import { describe, expect, it } from 'vitest';
import { isEventDayOrLater, resolveSchedule, type ResolveMatch } from './autoResolve';

const at = (hhmm: string) => `2026-11-14T${hhmm}:00.000Z`;
const m = (id: string, hhmm: string | null, fighters: string[], extra: Partial<ResolveMatch> = {}): ResolveMatch =>
  ({ id, scheduledAt: hhmm ? at(hhmm) : null, durationMinutes: 15, field: null, fighters, feeders: [], locked: false, order: 0, ...extra });

describe('resolveSchedule', () => {
  it('leaves a clean schedule alone', () => {
    expect(resolveSchedule([m('a', '10:00', ['x']), m('b', '10:15', ['x'])]).moves).toEqual([]);
  });
  it('pushes the later of two overlapping matches to just after the first, and never earlier', () => {
    const r = resolveSchedule([m('a', '10:00', ['x']), m('b', '10:05', ['x', 'y'])]);
    expect(r.moves).toEqual([{ matchId: 'b', from: at('10:05'), to: at('10:15') }]);
    expect(r.endBefore).toBe(at('10:20'));
    expect(r.endAfter).toBe(at('10:30'));
  });
  it('cascades: moving one match can move the next one for another shared fighter', () => {
    const r = resolveSchedule([m('a', '10:00', ['x']), m('b', '10:00', ['x', 'y']), m('c', '10:15', ['y'])]);
    expect(r.moves.map(x => [x.matchId, x.to])).toEqual([['b', at('10:15')], ['c', at('10:30')]]);
  });
  it('keeps one match per field at a time', () => {
    const r = resolveSchedule([m('a', '10:00', ['x'], { field: 'Ring 1' }), m('b', '10:00', ['y'], { field: 'ring 1' }), m('c', '10:00', ['z'], { field: 'Ring 2' })]);
    expect(r.moves.map(x => x.matchId)).toEqual(['b']);
  });
  it('never moves a called or finished match; the other one moves around it', () => {
    const r = resolveSchedule([m('a', '10:05', ['x'], { locked: true }), m('b', '10:00', ['x'])]);
    expect(r.moves).toEqual([{ matchId: 'b', from: at('10:00'), to: at('10:20') }]);
  });
  it('reports two locked matches that clash, since it cannot fix them', () => {
    expect(resolveSchedule([m('a', '10:00', ['x'], { locked: true }), m('b', '10:05', ['x'], { locked: true })]).stillClashing).toEqual(['b']);
  });
  it('keeps a bracket match after the matches that feed it', () => {
    const r = resolveSchedule([m('semi', '10:00', ['x']), m('semi2', '10:00', ['x2']), m('final', '10:10', [], { feeders: ['semi', 'semi2'] })]);
    expect(r.moves).toEqual([{ matchId: 'final', from: at('10:10'), to: at('10:15') }]);
  });
  it('adds a rest break for fighters when asked, and snaps to the step', () => {
    const r = resolveSchedule([m('a', '10:00', ['x']), m('b', '10:15', ['x'])], { restMinutes: 7, stepMinutes: 5 });
    expect(r.moves).toEqual([{ matchId: 'b', from: at('10:15'), to: at('10:25') }]);
  });
  it('ignores unscheduled matches', () => {
    expect(resolveSchedule([m('a', null, ['x']), m('b', '10:00', ['x'])]).moves).toEqual([]);
  });
});

describe('isEventDayOrLater', () => {
  it('is false before the first day and true from it, in the event time zone', () => {
    // Saskatchewan has no daylight saving, so its offset (UTC-6) is the same in every tz database.
    expect(isEventDayOrLater('2026-11-14', 'America/Regina', new Date('2026-11-14T05:00:00Z'))).toBe(false); // still 13 Nov there
    expect(isEventDayOrLater('2026-11-14', 'America/Regina', new Date('2026-11-14T07:00:00Z'))).toBe(true);
  });
});

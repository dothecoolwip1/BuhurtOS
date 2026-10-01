import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { bookingArgsFor, conflictedMatchIds, describeConflict, groupConflictsByFighter, toBooking, toScheduleConflict, type ScheduleConflict } from './conflicts';

const row = (over: Partial<ScheduleConflict> = {}): ScheduleConflict => ({
  fighterId: 'f1', displayName: 'Alpha', matchA: 'm1', matchB: 'm2', competitionA: 'c1', competitionB: 'c2', scheduledA: 'a', scheduledB: 'b', overlapMinutes: 5, ...over
});

describe('conflicts', () => {
  it('maps a database row and turns the overlap into a number', () => {
    expect(toScheduleConflict({ fighter_id: 'f', display_name: 'Jo', match_a: 'a', match_b: 'b', competition_a: 'c', competition_b: 'd', scheduled_a: 's1', scheduled_b: 's2', overlap_minutes: '15' }))
      .toEqual({ fighterId: 'f', displayName: 'Jo', matchA: 'a', matchB: 'b', competitionA: 'c', competitionB: 'd', scheduledA: 's1', scheduledB: 's2', overlapMinutes: 15 });
  });
  it('groups by fighter, most conflicted first', () => {
    const g = groupConflictsByFighter([row({ fighterId: 'b', displayName: 'Bravo' }), row(), row({ matchB: 'm3' })]);
    expect(g.map(x => [x.displayName, x.conflicts.length])).toEqual([['Alpha', 2], ['Bravo', 1]]);
  });
  it('collects every match that is in a conflict', () => {
    expect([...conflictedMatchIds([row(), row({ matchA: 'm3', matchB: 'm1' })])].sort()).toEqual(['m1', 'm2', 'm3']);
  });
  it('writes one readable line', () => {
    expect(describeConflict(row())).toBe('Alpha is booked in two matches that overlap by 5 minutes.');
    expect(describeConflict(row({ overlapMinutes: 1 }))).toBe('Alpha is booked in two matches that overlap by 1 minute.');
  });
  it('maps a booking and names the database arguments', () => {
    expect(toBooking({ match_id: 'm', competition_id: 'c', competition_name: 'Longsword', scheduled_at: 's', duration_minutes: 15, overlap_minutes: '10' }))
      .toEqual({ matchId: 'm', competitionId: 'c', competitionName: 'Longsword', scheduledAt: 's', durationMinutes: 15, overlapMinutes: 10 });
    expect(bookingArgsFor({ eventId: 'e', fighterId: 'f', at: 't' })).toEqual({ p_event: 'e', p_fighter: 'f', p_at: 't', p_minutes: 15, p_exclude_match: null });
    expect(bookingArgsFor({ eventId: 'e', fighterId: 'f', at: 't', minutes: 30, excludeMatchId: 'm' }).p_exclude_match).toBe('m');
  });
});

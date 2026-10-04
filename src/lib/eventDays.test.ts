import { describe, expect, it } from 'vitest';
import { attendanceText, dayLabel, eventDays } from './eventDays';

describe('eventDays', () => {
  it('lists every day of a two-day event with weekday labels', () => {
    expect(eventDays('2026-12-05', '2026-12-06')).toEqual([
      { iso: '2026-12-05', label: 'Saturday, Dec 5' }, { iso: '2026-12-06', label: 'Sunday, Dec 6' }
    ]);
  });
  it('gives one day for a one-day event and nothing for junk', () => {
    expect(eventDays('2026-11-14', '2026-11-14')).toHaveLength(1);
    expect(eventDays('nope', '2026-11-14')).toEqual([]);
  });
  it('never produces more than two weeks of boxes', () => { expect(eventDays('2026-01-01', '2026-12-31')).toHaveLength(14); });
  it('does not shift across time zones', () => { expect(dayLabel('2026-11-15')).toBe('Sunday, Nov 15'); });
});

describe('attendanceText', () => {
  it('prefers event days, falls back to the legacy answer, then says so', () => {
    expect(attendanceText(['2026-12-05'], ['sat'])).toBe('Saturday, Dec 5');
    expect(attendanceText([], ['sat', 'sun'])).toBe('Saturday and Sunday');
    expect(attendanceText(null, [])).toBe('not given');
  });
});

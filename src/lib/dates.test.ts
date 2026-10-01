import { describe, expect, it } from 'vitest';
import { dateBox, dateRange, registrationWindow } from './dates';

describe('dates', () => {
  it('formats a two-day range in one month', () => expect(dateRange('2026-11-14', '2026-11-15')).toBe('Nov 14-15, 2026'));
  it('formats a range across months', () => expect(dateRange('2026-11-30', '2026-12-01')).toBe('Nov 30 - Dec 1, 2026'));
  it('formats a single day', () => expect(dateRange('2026-11-14', '2026-11-14')).toBe('Nov 14, 2026'));
  it('builds the date box without shifting a day', () => expect(dateBox('2026-11-01')).toEqual({ month: 'Nov', day: '01', year: '2026' }));
  it('knows when registration is open, not yet open and closed', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(registrationWindow(null, '2026-11-09T06:59:00Z', now)).toBe('open');
    expect(registrationWindow('2026-11-01T00:00:00Z', null, now)).toBe('not_open');
    expect(registrationWindow(null, '2026-10-01T00:00:00Z', now)).toBe('closed');
    expect(registrationWindow(null, null, now)).toBe('open');
  });
});

import { isoToLocal, localToIso } from './dates';
describe('Mountain time conversion', () => {
  // Explicit zone with long-stable rules: the default Edmonton zone depends on the runner's tz database for future dates.
  it('Nov 8 23:59 is 06:59 UTC the next day (standard time, UTC-7)', () => expect(localToIso('2026-11-08T23:59', 'America/Denver')).toBe('2026-11-09T06:59:00.000Z'));
  it('summer uses daylight time (UTC-6)', () => expect(localToIso('2026-07-01T12:00', 'America/Denver')).toBe('2026-07-01T18:00:00.000Z'));
  it('round-trips', () => expect(isoToLocal(localToIso('2026-11-08T23:59'))).toBe('2026-11-08T23:59'));
  it('empty and invalid input', () => { expect(isoToLocal(null)).toBe(''); expect(localToIso('nonsense')).toBeNull(); });
});

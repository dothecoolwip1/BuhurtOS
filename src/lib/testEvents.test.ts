import { describe, expect, it } from 'vitest';
import { testCleanupAt } from './testEvents';

describe('when a test event is deleted', () => {
  it('expiring after that day\'s clean-up: the next day at 10:23 UTC (the rehearsal fixture: Nov 8 20:16 → Nov 9)', () => {
    expect(testCleanupAt('2026-11-08T20:16:34Z').toISOString()).toBe('2026-11-09T10:23:00.000Z');
  });
  it('expiring before that day\'s clean-up: the same day', () => {
    expect(testCleanupAt('2026-11-08T03:00:00Z').toISOString()).toBe('2026-11-08T10:23:00.000Z');
  });
  it('expiring exactly at the clean-up: that run', () => {
    expect(testCleanupAt('2026-11-08T10:23:00Z').toISOString()).toBe('2026-11-08T10:23:00.000Z');
  });
  it('across a month end', () => {
    expect(testCleanupAt('2026-11-30T23:59:00Z').toISOString()).toBe('2026-12-01T10:23:00.000Z');
  });
});

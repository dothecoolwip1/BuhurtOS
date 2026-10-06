import { afterEach, describe, expect, it } from 'vitest';
import { dayOfUtc, endOfDayUtc, showDayUtc } from './suspensionDates';

// Node reads TZ again when it changes; the app's tsconfig has no Node types, so reach it through globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const tz = env.TZ;
afterEach(() => { env.TZ = tz; });

describe('suspension end dates (whole days in UTC, like the database)', () => {
  for (const zone of ['America/Edmonton', 'Pacific/Auckland', 'UTC']) {
    it(`"until 2026-10-12" stays the 12th in ${zone}, and editing it does not move it`, () => {
      env.TZ = zone;
      expect(new Date('2026-10-12T23:59:59Z').getTimezoneOffset()).toBe(zone === 'America/Edmonton' ? 360 : zone === 'Pacific/Auckland' ? -780 : 0);
      const saved = endOfDayUtc('2026-10-12');
      expect(saved).toBe('2026-10-12T23:59:59Z');
      expect(dayOfUtc(saved)).toBe('2026-10-12');
      expect(dayOfUtc(endOfDayUtc(dayOfUtc(saved)))).toBe('2026-10-12');
      // the database returns it with an offset
      expect(dayOfUtc('2026-10-12T23:59:59+00:00')).toBe('2026-10-12');
      expect(showDayUtc(saved)).toMatch(/12/);
    });
  }
  it('no end date shows nothing', () => { expect(showDayUtc(null)).toBeNull(); });
});

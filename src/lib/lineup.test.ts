import { describe, expect, it } from 'vitest';
import { moveLineup } from './lineup';
import { experienceLine } from './announcer/info';
describe('organizer line editing', () => {
  it('moves in either direction without losing or duplicating fights or mutating live data', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveLineup(rows, 'a', 'c').map(r => r.id)).toEqual(['b', 'c', 'a']);
    expect(moveLineup(rows, 'c', 'a').map(r => r.id)).toEqual(['c', 'a', 'b']);
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(moveLineup(rows, 'missing', 'a')).toEqual(rows);
  });
});
describe('announcer experience', () => {
  it('uses only a valid recorded start year and describes the estimate honestly', () => {
    expect(experienceLine(2020, 2026)).toBe('Fighting since 2020 · about 6 years');
    expect(experienceLine(2026, 2026)).toBe('Fighting since 2026');
    for (const year of [undefined, null, 1980, 2027, NaN, 2020.5]) expect(experienceLine(year, 2026)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { drawPools, seededShuffle } from './draw';

const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
describe('draw', () => {
  it('gives the same order for the same seed', () => {
    expect(seededShuffle(names, 4821)).toEqual(seededShuffle(names, 4821));
  });
  it('usually gives a different order for a different seed', () => {
    expect(seededShuffle(names, 1)).not.toEqual(seededShuffle(names, 2));
  });
  it('keeps every entrant exactly once and does not change the input', () => {
    const copy = [...names];
    const out = seededShuffle(names, 7);
    expect([...out].sort()).toEqual(copy);
    expect(names).toEqual(copy);
  });
  it('deals pools of the requested sizes', () => {
    const pools = drawPools(names, [5, 5], 99);
    expect(pools.map(p => p.length)).toEqual([5, 5]);
    expect(pools.flat().sort()).toEqual(names);
  });
  it('refuses sizes that do not match the entrants', () => {
    expect(() => drawPools(names, [4, 4], 1)).toThrow();
  });
});

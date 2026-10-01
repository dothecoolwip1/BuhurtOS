import { describe, expect, it } from 'vitest';
import { buildPoolsThenBracket, buildRoundRobin, buildSingleElimination, eliminationRoundLabel, seedPoolQualifiers } from './bracket';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);

describe('buildSingleElimination', () => {
  for (let n = 2; n <= 17; n++) {
    it(`n=${n}: ${n - 1} matches, valid links, byes, no entry twice in round 1`, () => {
      const m = buildSingleElimination(ids(n), { seed: 7 });
      expect(m).toHaveLength(n - 1);
      const keys = new Set(m.map(x => x.key));
      expect(keys.size).toBe(m.length);
      for (const x of m) if (x.nextKey) { expect(keys.has(x.nextKey)).toBe(true); expect(['a', 'b']).toContain(x.nextSlot); }
      expect(m.filter(x => !x.nextKey)).toHaveLength(1);
      expect(m.find(x => !x.nextKey)!.stage).toBe('final');
      // every entry is placed exactly once at the start
      const placed = m.flatMap(x => [x.a, x.b]).filter(Boolean) as string[];
      const inRound1 = new Set<string>();
      let size = 2; while (size < n) size *= 2;
      for (const x of m) if (x.roundLabel === eliminationRoundLabel(size)) { for (const e of [x.a, x.b]) if (e) { expect(inRound1.has(e)).toBe(false); inRound1.add(e); } }
      expect(new Set(placed).size).toBe(n);
      // no slot is filled twice (a bye winner plus an incoming link)
      const incoming = new Map<string, number>();
      for (const x of m) if (x.nextKey) { const k = `${x.nextKey}/${x.nextSlot}`; incoming.set(k, (incoming.get(k) ?? 0) + 1); }
      for (const x of m) for (const s of ['a', 'b'] as const) expect((incoming.get(`${x.key}/${s}`) ?? 0) + (x[s] && !inRound1.has(x[s]!) ? 1 : 0)).toBeLessThanOrEqual(1);
    });
  }

  it('gives byes to the top seeds and places bye winners in the next match', () => {
    const m = buildSingleElimination(ids(6), { manualOrder: true });
    expect(m).toHaveLength(5);
    const semis = m.filter(x => x.roundLabel === 'Semifinal');
    expect(semis).toHaveLength(2);
    expect(semis.map(s => s.a)).toEqual(['e1', 'e2']); // seeds 1 and 2 skipped round 1
    expect(m.filter(x => x.roundLabel === 'Quarterfinal')).toHaveLength(2); // only seeds 3-6 play round 1
  });

  it('labels rounds', () => {
    const m = buildSingleElimination(ids(16), { seed: 1 });
    const labels = [...new Set(m.map(x => x.roundLabel))];
    expect(labels).toEqual(['Round of 16', 'Quarterfinal', 'Semifinal', 'Final']);
    expect(m.filter(x => x.roundLabel === 'Round of 16')).toHaveLength(8);
    expect(buildSingleElimination(ids(2))[0]).toMatchObject({ stage: 'final', roundLabel: 'Final' });
  });

  it('adds third place only with 4+ entries', () => {
    expect(buildSingleElimination(ids(8), { thirdPlace: true }).filter(x => x.stage === 'third_place')).toHaveLength(1);
    expect(buildSingleElimination(ids(3), { thirdPlace: true }).filter(x => x.stage === 'third_place')).toHaveLength(0);
    expect(buildSingleElimination(ids(8), { thirdPlace: true })).toHaveLength(8);
  });

  it('is deterministic by seed, and manualOrder ignores the seed', () => {
    expect(buildSingleElimination(ids(11), { seed: 5 })).toEqual(buildSingleElimination(ids(11), { seed: 5 }));
    expect(buildSingleElimination(ids(11), { seed: 5 })).not.toEqual(buildSingleElimination(ids(11), { seed: 6 }));
    expect(buildSingleElimination(ids(11), { seed: 5, manualOrder: true })).toEqual(buildSingleElimination(ids(11), { manualOrder: true }));
  });

  it('handles tiny and duplicate input', () => {
    expect(buildSingleElimination([])).toEqual([]);
    expect(buildSingleElimination(['x'])).toEqual([]);
    expect(() => buildSingleElimination(['x', 'x'])).toThrow();
  });
});

describe('buildRoundRobin', () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    it(`n=${n}: every pair meets once and nobody plays twice in a round`, () => {
      const m = buildRoundRobin(ids(n));
      expect(m).toHaveLength((n * (n - 1)) / 2);
      const pairs = new Set(m.map(x => [x.a, x.b].sort().join('|')));
      expect(pairs.size).toBe(m.length);
      const byRound = new Map<string, string[]>();
      for (const x of m) byRound.set(x.roundLabel, [...(byRound.get(x.roundLabel) ?? []), x.a!, x.b!]);
      for (const list of byRound.values()) expect(new Set(list).size).toBe(list.length);
      expect(byRound.size).toBe(n % 2 ? n : n - 1);
    });
  }
  it('tags pool and stage', () => {
    const m = buildRoundRobin(ids(3), { pool: 'A' });
    expect(m.every(x => x.pool === 'A' && x.stage === 'pool')).toBe(true);
    expect(buildRoundRobin(ids(3)).every(x => x.stage === 'round_robin' && x.pool === undefined)).toBe(true);
    expect(new Set(m.map(x => x.key)).size).toBe(3);
  });
});

describe('buildPoolsThenBracket', () => {
  it('draws reproducible pools with a round robin each', () => {
    const r = buildPoolsThenBracket(ids(10), { poolSizes: [5, 5], seed: 3 });
    expect(r.pools.map(p => p.name)).toEqual(['A', 'B']);
    expect(r.matches).toHaveLength(20);
    expect(r.matches.every(x => x.stage === 'pool')).toBe(true);
    expect(new Set(r.matches.map(x => x.key)).size).toBe(20);
    expect(buildPoolsThenBracket(ids(10), { poolSizes: [5, 5], seed: 3 })).toEqual(r);
  });
  it('orders qualifiers winners first', () => {
    expect(seedPoolQualifiers([['a1', 'a2'], ['b1', 'b2']], 2)).toEqual(['a1', 'b1', 'b2', 'a2']);
  });
});

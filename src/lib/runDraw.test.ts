import { describe, expect, it } from 'vitest';
import { activeEntries, bracketFromPools, canBuildBracketFromPools, describePlan, drawProblem, moveItem, planDraw, rankedPools, randomSeed, tiesWithin, type DrawChoice } from './runDraw';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);
const base: DrawChoice = { format: 'single_elimination', entryIds: ids(6), mode: 'random', seed: 7, thirdPlace: false, poolCount: 2 };
const name = (id: string) => id.toUpperCase();

describe('runDraw', () => {
  it('drops withdrawn and disqualified entries', () => {
    expect(activeEntries([{ status: 'accepted' }, { status: 'withdrawn' }, { status: 'disqualified' }, { status: 'checked_in' }])).toHaveLength(2);
  });
  it('random draws are reproducible and change with the seed', () => {
    expect(planDraw(base)).toEqual(planDraw(base));
    expect(planDraw({ ...base, seed: 8 })).not.toEqual(planDraw(base));
  });
  it('manual order seeds in the given order regardless of seed', () => {
    const m = { ...base, mode: 'manual' as const };
    expect(planDraw(m)).toEqual(planDraw({ ...m, seed: 99 }));
  });
  it('reports problems in plain words', () => {
    expect(drawProblem({ ...base, entryIds: ids(1) })).toMatch(/at least 2/);
    expect(drawProblem({ ...base, format: 'pools', entryIds: ids(3) })).toMatch(/at least 4/);
    expect(drawProblem({ ...base, format: 'pools', entryIds: ids(6), poolCount: 4 })).toMatch(/between 2 and 3/);
    expect(drawProblem({ ...base, format: 'pools', poolCount: 2 })).toBeNull();
    expect(() => planDraw({ ...base, entryIds: [] })).toThrow();
  });
  it('plans pools in both modes with every entrant once', () => {
    for (const mode of ['random', 'manual'] as const) {
      const p = planDraw({ ...base, format: 'pools', entryIds: ids(7), mode, poolCount: 2 });
      expect(p.pools.map(x => x.entries.length)).toEqual([4, 3]);
      expect(p.pools.flatMap(x => x.entries).sort()).toEqual(ids(7));
      expect(p.matches).toHaveLength(6 + 3);
    }
  });
  it('plans a round robin', () => {
    expect(planDraw({ ...base, format: 'round_robin', entryIds: ids(4) }).matches).toHaveLength(6);
  });
  it('describes byes, rounds and third place', () => {
    const g = describePlan(planDraw({ ...base, mode: 'manual', thirdPlace: true }).matches, name);
    expect(g[0].heading).toBe('Byes');
    expect(g[0].lines).toEqual(['E1 moves straight to the next round', 'E2 moves straight to the next round']);
    expect(g.map(x => x.heading)).toEqual(['Byes', 'Quarterfinal', 'Semifinal', 'Final', 'Third place']);
    expect(g[1].lines).toContain('E3 vs E6');
    expect(g[2].lines[0]).toBe('E1 vs winner of an earlier match');
  });
  it('detects when a pool bracket can be built', () => {
    const p = (queueState: string) => ({ stage: 'pool', pool: 'A', queueState, entryA: 'x', entryB: 'y' });
    expect(canBuildBracketFromPools([p('final'), p('final')])).toBe(true);
    expect(canBuildBracketFromPools([p('final'), p('active')])).toBe(false);
    expect(canBuildBracketFromPools([])).toBe(false);
    expect(canBuildBracketFromPools([p('final'), { stage: 'elimination', pool: null, queueState: 'scheduled', entryA: null, entryB: null }])).toBe(false);
  });
  it('takes pool order from the database ranking, never from ids, and seeds qualifiers', () => {
    const row = (part: string, entryId: string, rank: number, tied = false) => ({ part, entryId, rank, tied });
    // the rows arrive in an arbitrary order; the ranking decides, and an id such as "a1" < "a2" never breaks a tie
    const rows = [row('B', 'b1', 2), row('A', 'a1', 2), row('A', 'a3', 3), row('A', 'a2', 1), row('B', 'b2', 1)];
    const ranked = rankedPools(rows);
    expect(ranked).toEqual([['a2', 'a1', 'a3'], ['b2', 'b1']]);
    const r = bracketFromPools(ranked, 2, false);
    expect(r.qualifiers).toEqual(['a2', 'b2', 'a1', 'b1']);
    expect(r.matches.length).toBe(3);
  });
  it('reports level entries inside the advancing places as ties for an organizer to decide', () => {
    const row = (part: string, entryId: string, rank: number, tied: boolean) => ({ part, entryId, rank, tied });
    const rows = [row('A', 'a1', 1, false), row('A', 'a2', 2, true), row('A', 'a3', 2, true), row('A', 'a4', 4, false), row('B', 'b1', 1, true), row('B', 'b2', 1, true), row('B', 'b3', 3, true), row('B', 'b4', 3, true)];
    expect(tiesWithin(rows, 2)).toEqual([{ part: 'A', rank: 2, entryIds: ['a2', 'a3'] }, { part: 'B', rank: 1, entryIds: ['b1', 'b2'] }]);
    expect(tiesWithin(rows, 1)).toEqual([{ part: 'B', rank: 1, entryIds: ['b1', 'b2'] }]);
    expect(tiesWithin([row('A', 'a1', 1, false)], 2)).toEqual([]);
  });
  it('moves items within bounds and makes seeds', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(randomSeed(() => 0)).toBe(1);
    expect(Number.isInteger(randomSeed())).toBe(true);
  });
});

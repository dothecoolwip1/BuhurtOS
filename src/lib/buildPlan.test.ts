import { describe, expect, it } from 'vitest';
import { assignFields, planTotals, previewPlan, propose, suggestFormat, type BuildCompetition } from './buildPlan';

const duels = (id: string, n: number, sort: number, prefix = id, built = false): BuildCompetition => {
  const ids = Array.from({ length: n }, (_, i) => `${id}-e${i}`);
  return { id, name: id, sort, entryIds: ids, people: new Map(ids.map((e, i) => [e, [`${prefix}${i}`]])), alreadyBuilt: built };
};

describe('format suggestion (existing advice)', () => {
  it('round robin up to 6, pools from 7', () => {
    expect(suggestFormat(3).format).toBe('round_robin');
    expect(suggestFormat(6).format).toBe('round_robin');
    const seven = suggestFormat(7);
    expect(seven.format).toBe('pools'); expect(seven.poolCount).toBe(2);
    expect(suggestFormat(14).poolCount).toBe(2);
    expect(suggestFormat(18).poolCount).toBe(2);
  });
});

describe('activation: empty divisions are not built', () => {
  it('0 or 1 entrants stays offered, built ones are left alone', () => {
    const p = propose([duels('a', 0, 1), duels('b', 1, 2), duels('c', 4, 3), duels('d', 5, 4, 'd', true)], 2, new Map());
    expect(p.map(x => `${x.id}:${x.state}:${x.matches.length}`)).toEqual(['a:too_few:0', 'b:too_few:0', 'c:build:6', 'd:built:0']);
    expect(p[0].why).toMatch(/Nobody entered/);
  });
});

describe('fields', () => {
  it('spreads competitions so every field has about the same number of fights', () => {
    const f = assignFields([{ id: 'big', fights: 21, sort: 1 }, { id: 'mid', fights: 10, sort: 2 }, { id: 'small', fights: 6, sort: 3 }, { id: 'tiny', fights: 3, sort: 4 }], 2);
    expect(f.get('big')).toBe('Field 1');
    expect(f.get('mid')).toBe('Field 2');
    expect(f.get('small')).toBe('Field 2');
    expect(f.get('tiny')).toBe('Field 2');
  });
  it('one field: everything on Field 1', () => {
    expect([...assignFields([{ id: 'a', fights: 3, sort: 1 }, { id: 'b', fights: 3, sort: 2 }], 1).values()]).toEqual(['Field 1', 'Field 1']);
  });
});

describe('preview', () => {
  it('counts fighters across competitions once and plans every ready fight', () => {
    // Longsword and Sword & Shield share fighters s0..s3
    const ls = duels('ls', 4, 1, 's'), ss = duels('ss', 4, 2, 's');
    const props = propose([ls, ss], 2, new Map([['ls', 7], ['ss', 9]]));
    const t = planTotals([ls, ss], props);
    expect(t).toMatchObject({ people: 4, competitions: 2, fights: 12, laterFights: 0 });
    const plan = previewPlan([ls, ss], props, 2, new Set());
    expect(plan.summary.planned).toBe(12);
    // never double-booked: nobody fights on both fields in the same slot
    for (const [, lane] of plan.lanes) for (const f of lane) {
      const other = [...plan.lanes.values()].flat().filter(x => x.slot === f.slot && x.field !== f.field);
      const mine = new Set(f.rests.map(r => r.fighterId));
      expect(other.some(o => o.rests.some(r => mine.has(r.fighterId)))).toBe(false);
    }
  });
  it('bracket fights after the first round are counted but not planned until their entrants are known', () => {
    const se = duels('se', 8, 1);
    const props = propose([se], 1, new Map([['se', 3]]), new Map([['se', { format: 'single_elimination', thirdPlace: true }]]));
    const t = planTotals([se], props);
    expect(t.fights).toBe(8);            // 4 quarterfinals, 2 semifinals, final, third place
    expect(t.laterFights).toBe(4);
    expect(previewPlan([se], props, 1, new Set()).summary.planned).toBe(4);
  });
  it('the same draw numbers give the same proposal', () => {
    const c = duels('x', 9, 1);
    const a = propose([c], 2, new Map([['x', 42]])), b = propose([c], 2, new Map([['x', 42]]));
    expect(a[0].matches).toEqual(b[0].matches);
  });
  it('a fighter only here another day is reported, not planned', () => {
    const c = duels('x', 3, 1);
    const plan = previewPlan([c], propose([c], 1, new Map()), 1, new Set(['x0']));
    expect(plan.summary.unavailable).toBe(2);
    expect(plan.summary.planned).toBe(1);
  });
});

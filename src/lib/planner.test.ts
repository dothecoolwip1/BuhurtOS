import { describe, expect, it } from 'vitest';
import { planFights, planHeadline, planMatchesSaved, restWords, type PlanMatch, type PlanState } from './planner';

let n = 0;
/** A fight between people on a field. Order of creation = base running order. */
function fight(people: string[], o: { field?: string; state?: PlanState; ready?: boolean; finishedAt?: string; manual?: number; id?: string } = {}): PlanMatch {
  n += 1;
  return {
    id: o.id ?? `m${String(n).padStart(3, '0')}`, field: o.field ?? 'field 1', state: o.state ?? 'scheduled', people, ready: o.ready ?? true,
    finishedAt: o.finishedAt ?? null, manualOrder: o.manual ?? null, baseOrder: n
  };
}
const done = (people: string[], minute: number, field = 'field 1') => fight(people, { state: 'final', finishedAt: `2026-11-14T10:${String(minute).padStart(2, '0')}:00Z`, field });
const order = (p: ReturnType<typeof planFights>) => p.upcoming;
const restOf = (p: ReturnType<typeof planFights>, id: string, who: string) => p.byMatch.get(id)!.rests.find(r => r.fighterId === who)!.rest;
/** The circle-method round robin pairings for a list of people. */
function roundRobin(people: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) out.push([people[i], people[j]]);
  return out;
}

describe('rest target', () => {
  it('prefers 3 fights between appearances when that is possible', () => {
    const history = [done(['A', 'Z'], 1)];
    const ab = fight(['A', 'B']);
    const others = [fight(['C', 'D']), fight(['E', 'F']), fight(['G', 'H']), fight(['I', 'J'])];
    const p = planFights({ matches: [...history, ab, ...others] });
    expect(order(p).indexOf(ab.id)).toBeGreaterThanOrEqual(3);
    expect(restOf(p, ab.id, 'A')).toBeGreaterThanOrEqual(3);
    expect(p.byMatch.get(ab.id)!.short).toBe(false);
  });

  it('chooses 2 when 3 is impossible', () => {
    const history = [done(['A', 'Z'], 1)];
    const ab = fight(['A', 'B']);
    const p = planFights({ matches: [...history, ab, fight(['C', 'D']), fight(['E', 'F'])] });
    expect(order(p)[2]).toBe(ab.id);
    expect(p.byMatch.get(ab.id)!.minRest).toBe(2);
    expect(p.byMatch.get(ab.id)!.short).toBe(true);
    expect(p.byMatch.get(ab.id)!.reasons.map(r => r.code)).toContain('short');
  });

  it('chooses 1 when 2 is impossible', () => {
    const ab = fight(['A', 'B']);
    const p = planFights({ matches: [done(['A', 'Z'], 1), ab, fight(['C', 'D'])] });
    expect(order(p)).toEqual([expect.not.stringMatching(ab.id), ab.id]);
    expect(p.byMatch.get(ab.id)!.minRest).toBe(1);
  });

  it('avoids back-to-back when another ready fight exists', () => {
    const ab = fight(['A', 'B']), cd = fight(['C', 'D']);
    const p = planFights({ matches: [done(['A', 'Z'], 1), ab, cd] });
    expect(order(p)[0]).toBe(cd.id);
    expect(p.summary.backToBack).toBe(0);
  });

  it('allows back-to-back only when it is unavoidable, and says so', () => {
    const ab = fight(['A', 'B']);
    const p = planFights({ matches: [done(['A', 'Z'], 1), ab] });
    expect(order(p)).toEqual([ab.id]);
    const f = p.byMatch.get(ab.id)!;
    expect(f.minRest).toBe(0);
    expect(f.short).toBe(true);
    expect(f.reasons.map(r => r.code)).toEqual(expect.arrayContaining(['back_to_back', 'only']));
    expect(p.summary.backToBack).toBe(1);
    expect(planHeadline(f)).toMatch(/Back-to-back/);
  });

  it('a fighter who has not fought yet counts as fully rested', () => {
    const p = planFights({ matches: [fight(['A', 'B'])] });
    expect(p.fights[0].minRest).toBeNull();
    expect(p.fights[0].short).toBe(false);
    expect(restWords(null)).toBe('First fight today');
  });

  it('never hides a short rest: the summary counts every fight under the target', () => {
    const p = planFights({ matches: [done(['A', 'Z'], 1), fight(['A', 'B']), fight(['C', 'D'])] });
    expect(p.summary.planned).toBe(2);
    expect(p.summary.shortRest + p.summary.meetTarget).toBe(2);
    expect(p.summary.shortRest).toBe(1);
  });
});

describe('event-wide rest', () => {
  it('counts rest across fields and never double-books', () => {
    // Bob is fighting NOW on Field 1. Field 2 has Bob vs Joe and Ann vs Cat ready.
    const now = fight(['Bob', 'Max'], { field: 'field 1', state: 'active' });
    const bobJoe = fight(['Bob', 'Joe'], { field: 'field 2' }), annCat = fight(['Ann', 'Cat'], { field: 'field 2' });
    const p = planFights({ matches: [now, bobJoe, annCat], fields: ['field 1', 'field 2'] });
    expect(p.lanes.get('field 2')![0].matchId).toBe(annCat.id);
    expect(p.byMatch.get(bobJoe.id)!.slot).toBeGreaterThan(0);
    // he is never in two fights in the same slot
    const slots = p.fights.filter(f => (f.matchId === now.id || f.matchId === bobJoe.id)).map(f => f.slot);
    expect(new Set(slots).size).toBe(2);
  });

  it('counts rest across disciplines (one fighter in three competitions)', () => {
    // Bob just finished Longsword. Next: Bob's Sword & Shield, Bob's Polearm, and two fights without Bob.
    const ss = fight(['Bob', 'S1']), pole = fight(['Bob', 'P1']), x = fight(['C', 'D']), y = fight(['E', 'F']);
    const p = planFights({ matches: [done(['Bob', 'L1'], 5), ss, pole, x, y] });
    const seq = order(p);
    // Bob's two fights are not next to each other and not first
    expect(seq[0]).not.toBe(ss.id); expect(seq[0]).not.toBe(pole.id);
    expect(Math.abs(seq.indexOf(ss.id) - seq.indexOf(pole.id))).toBeGreaterThan(1);
  });

  it('history order is the order fights finished, on any field', () => {
    const p = planFights({ matches: [done(['A', 'B'], 1, 'field 2'), done(['C', 'D'], 2), done(['E', 'F'], 3, 'field 2'), fight(['A', 'C'])] });
    expect(restOf(p, p.upcoming[0], 'A')).toBe(2);
    expect(restOf(p, p.upcoming[0], 'C')).toBe(1);
  });
});

describe('round robin ordering', () => {
  it('a 4-person round robin on one field: the two unavoidable back-to-backs, never three in a row', () => {
    // Consecutive fights must not share anyone; K4 has only three such pairs of fights, so two back-to-backs are mathematically forced.
    const ms = roundRobin(['Bob', 'John', 'Steve', 'Mike']).map(pair => fight(pair));
    const p = planFights({ matches: ms });
    expect(p.summary.planned).toBe(6);
    expect(p.summary.backToBack).toBe(2);
    const seq = order(p).map(id => ms.find(m => m.id === id)!.people);
    for (let i = 2; i < seq.length; i++) for (const who of seq[i]) expect(seq[i - 1].includes(who) && seq[i - 2].includes(who)).toBe(false);
  });

  it('does not run Bob vs John, Bob vs Steve, Bob vs Mike in a row', () => {
    const ms = roundRobin(['Bob', 'John', 'Steve', 'Mike', 'Ann', 'Cat']).map(pair => fight(pair));
    const p = planFights({ matches: ms });
    const seq = order(p).map(id => ms.find(m => m.id === id)!.people);
    for (let i = 1; i < seq.length; i++) expect(seq[i].some(x => seq[i - 1].includes(x))).toBe(false);
    expect(p.summary.planned).toBe(15);           // every pairing exactly once
    expect(new Set(order(p)).size).toBe(15);
  });

  it('reaches the 3-fight target in a larger division', () => {
    // 10 fighters on one field: 4 consecutive fights can involve 8 different people, so the target is reachable almost everywhere.
    const ms = roundRobin(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']).map(pair => fight(pair));
    const p = planFights({ matches: ms });
    expect(p.summary.planned).toBe(45);
    expect(p.summary.meetTarget).toBeGreaterThanOrEqual(40);
    expect(p.summary.backToBack).toBe(0);
  });

  it('degrades to 2 (never back-to-back) where 3 is impossible: 8 fighters on one field', () => {
    const ms = roundRobin(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']).map(pair => fight(pair));
    const p = planFights({ matches: ms });
    expect(p.summary.backToBack).toBe(0);
    expect(p.fights.every(f => f.minRest === null || f.minRest >= 1)).toBe(true);
  });

  it('a 3-person round robin cannot avoid short rest, and the plan says so', () => {
    const ms = roundRobin(['A', 'B', 'C']).map(pair => fight(pair));
    const p = planFights({ matches: ms });
    expect(p.summary.planned).toBe(3);
    expect(p.summary.shortRest).toBeGreaterThan(0);
  });
});

describe('bracket readiness', () => {
  it('does not schedule a fight whose entrants are not known yet', () => {
    const semi = fight([], { ready: false });
    const p = planFights({ matches: [fight(['A', 'B']), semi] });
    expect(order(p)).not.toContain(semi.id);
    expect(p.waiting).toEqual([{ matchId: semi.id, code: 'unknown_side', fighters: [] }]);
  });

  it('a newly known bracket fight becomes a candidate', () => {
    const semi = fight(['A', 'C'], { id: 'semi' });
    const p = planFights({ matches: [done(['A', 'B'], 1), done(['C', 'D'], 2), semi, fight(['E', 'F'])] });
    expect(order(p)).toContain('semi');
    expect(order(p)[0]).not.toBe('semi');   // C just fought: the other ready fight goes first
  });
});

describe('stability of called fights', () => {
  it('NOW never moves, even when it is a back-to-back', () => {
    const now = fight(['A', 'B'], { state: 'active' });
    const p = planFights({ matches: [done(['A', 'Z'], 1), now, fight(['C', 'D'])] });
    expect(p.lanes.get('field 1')![0].matchId).toBe(now.id);
    expect(p.byMatch.get(now.id)!.locked).toBe(true);
    expect(p.upcoming).not.toContain(now.id);
  });

  it('ON DECK and IN THE HOLE stay where they are when a better fight appears', () => {
    const onDeck = fight(['A', 'B'], { state: 'on_deck' }), hole = fight(['C', 'D'], { state: 'in_the_hole' });
    const fresh = fight(['E', 'F']);
    const p = planFights({ matches: [done(['A', 'Z'], 1), onDeck, hole, fresh] });
    expect(p.lanes.get('field 1')!.map(f => f.matchId)).toEqual([onDeck.id, hole.id, fresh.id]);
    expect(p.upcoming).toEqual([fresh.id]);
  });

  it('a manual move (skip / run sooner) changes the recommendation', () => {
    const a = fight(['A', 'B']), b = fight(['C', 'D']), c = fight(['E', 'F']);
    const before = planFights({ matches: [a, b, c] });
    expect(order(before)[0]).toBe(a.id);
    // "Run sooner" on c: Pack 09A numbers the field's whole line by hand (c 1, a 2, b 3)
    const after = planFights({ matches: [{ ...a, manualOrder: 2 }, { ...b, manualOrder: 3 }, { ...c, manualOrder: 1 }] });
    expect(order(after)[0]).toBe(c.id);
    expect(after.byMatch.get(c.id)!.reasons.map(r => r.code)).toContain('manual');
  });
});

describe('availability and equipment', () => {
  it('a fighter not here today is not planned; the fight waits and is reported', () => {
    const sat = fight(['Sunday Sam', 'B']), ok = fight(['C', 'D']);
    const p = planFights({ matches: [sat, ok], unavailable: new Set(['Sunday Sam']) });
    expect(order(p)).toEqual([ok.id]);
    expect(p.waiting).toEqual([{ matchId: sat.id, code: 'unavailable', fighters: ['Sunday Sam'] }]);
    expect(p.summary.unavailable).toBe(1);
  });

  it('shared equipment is flagged on the fight (the partner is not recorded, so it is a warning)', () => {
    const m = fight(['Gear Gus', 'B']);
    const p = planFights({ matches: [m], sharesEquipment: new Set(['Gear Gus']) });
    expect(p.byMatch.get(m.id)!.reasons.map(r => r.code)).toContain('equipment');
  });
});

describe('determinism', () => {
  it('the same fights in any input order give the same plan', () => {
    const ms = [...roundRobin(['A', 'B', 'C', 'D', 'E']).map(pair => fight(pair, { field: 'field 1' })), ...roundRobin(['A', 'F', 'G', 'H']).map(pair => fight(pair, { field: 'field 2' }))];
    const a = planFights({ matches: ms, fields: ['field 1', 'field 2'] });
    const shuffled = [...ms].reverse();
    const b = planFights({ matches: shuffled, fields: ['field 1', 'field 2'] });
    expect(b.upcoming).toEqual(a.upcoming);
    expect(b.fights.map(f => [f.matchId, f.slot, f.field])).toEqual(a.fights.map(f => [f.matchId, f.slot, f.field]));
  });

  it('stays fast for a Rumble-sized day (300 fights, 4 fields)', () => {
    const people = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const ms: PlanMatch[] = [];
    for (let g = 0; g < 4; g++) for (const pair of roundRobin(people.slice(g * 10, g * 10 + 10))) ms.push(fight(pair, { field: `field ${g + 1}` }));
    const t0 = performance.now();
    const p = planFights({ matches: ms });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(p.summary.planned).toBe(ms.length);
    expect(p.summary.backToBack).toBe(0);
  });
});

describe('worst case speed', () => {
  it('stays fast when short rests are unavoidable (8 pools of 5 on 2 fields, 80 fights, people in two pools)', () => {
    const ms: PlanMatch[] = [];
    for (let g = 0; g < 8; g++) for (const pair of roundRobin([`q${g}a`, `q${g}b`, `q${g}c`, `q${(g + 1) % 8}d`, `q${g}e`])) ms.push(fight(pair, { field: `field ${(g % 2) + 1}` }));
    const t0 = performance.now();
    const p = planFights({ matches: ms });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(p.summary.planned).toBe(80);
  });
});

describe('saved plan comparison', () => {
  it('knows when the saved order already matches', () => {
    expect(planMatchesSaved(['a', 'b'], new Map([['a', 1], ['b', 2]]))).toBe(true);
    expect(planMatchesSaved(['b', 'a'], new Map([['a', 1], ['b', 2]]))).toBe(false);
    expect(planMatchesSaved(['a'], new Map([['a', 1], ['b', 2]]))).toBe(false);
  });
});

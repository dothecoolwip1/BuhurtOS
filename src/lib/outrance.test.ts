import { describe, expect, it } from 'vitest';
import vectors from '../../supabase/tests/vectors/outrance.json';
import {
  criteriaToAsk, deduction, expectedTotalRange, needsCriteria, nextAfter, roundScoreUnits, sheetFightResult, sheetResult, sheetRoundScore, showScore,
  timing, tkoLosesFight, totalUnits, wholeScore, winType, type CriteriaCalls, type Side
} from './outrance';

describe('Outrance V.26.4: the shared vectors (the database checks the same file)', () => {
  it.each(vectors.sheets)('sheet: $note', v => {
    const r = sheetResult({ a: v.strikes[0], b: v.strikes[1] }, v.calls as CriteriaCalls, v.stoppage as Side | null);
    expect({ a: r.a, b: r.b, band: r.band, decidedBy: r.decidedBy }).toEqual({ a: v.a, b: v.b, band: v.band, decidedBy: v.decidedBy });
  });
  it.each(vectors.deductions)('deduction: $note', v => {
    expect(deduction({ yellows: v.yellows, armourGrants: v.armourGrants, weaponLosses: v.weaponLosses })).toBe(v.points);
  });
  it.each(vectors.rounds)('round score: $note', v => {
    expect(roundScoreUnits(v.sheets.map(([a, b]) => ({ a, b })))).toEqual({ a: v.units[0], b: v.units[1] });
  });
  it.each(vectors.winTypes)('win type of $results', v => {
    expect(winType(v.results as (Side | 'draw')[], ((v as { winner?: Side }).winner) ?? null).type).toBe(v.type);
  });
});

describe('the sheet', () => {
  it('asks the criteria only when the strike point difference is 5 or less (§15.3.1)', () => {
    expect(needsCriteria({ a: 10, b: 5 })).toBe(true);
    expect(needsCriteria({ a: 11, b: 5 })).toBe(false);
  });
  it('asks the criteria one at a time, in priority order, and stops at the first that is not Even', () => {
    expect(criteriaToAsk({})).toEqual(['grappling']);
    expect(criteriaToAsk({ grappling: 'even' })).toEqual(['list_control']);
    expect(criteriaToAsk({ grappling: 'even', list_control: 'b' })).toEqual([]);
    expect(criteriaToAsk({ grappling: 'even', list_control: 'even', aggression: 'even', defence: 'even' })).toEqual([]);
  });
  it('§15.3.3: an evenly fought round with one armour failure fixed in time is 10-9', () => {
    const r = sheetResult({ a: 8, b: 8 }, { grappling: 'even', list_control: 'even', aggression: 'even', defence: 'even' });
    expect(sheetRoundScore(r, { a: { yellows: 0, armourGrants: 0, weaponLosses: 0 }, b: { yellows: 0, armourGrants: 1, weaponLosses: 0 } })).toEqual({ a: 10, b: 9 });
  });
});

describe('the fight', () => {
  it('a marshal\'s fight result is the sum of their rounds', () => {
    expect(sheetFightResult([{ a: 10, b: 9 }, { a: 9, b: 10 }])).toBe('draw');
    expect(sheetFightResult([{ a: 10, b: 9 }, { a: 10, b: 10 }])).toBe('a');
  });
  it('the Total Fight Score adds the Round Scores exactly (three thirds make a whole)', () => {
    const third = roundScoreUnits([{ a: 10, b: 10 }, { a: 10, b: 10 }, { a: 9, b: 10 }]);   // a = 29/3
    const t = totalUnits([third, third, third]);
    expect(t.a).toBe(29 * 60);
    expect(showScore(third.a)).toBe('9.67');
    expect(showScore(t.a)).toBe('29');
    expect(wholeScore(third.a)).toBe(10);
  });
  it('§4: Division and format set the rounds, their length and the break', () => {
    expect(timing('1', 'tournament')).toEqual({ rounds: 2, roundSeconds: 120, breakSeconds: 45, tiebreak: true });
    expect(timing('2', 'tournament')).toEqual({ rounds: 2, roundSeconds: 90, breakSeconds: 45, tiebreak: true });
    expect(timing('1', 'matched')).toEqual({ rounds: 3, roundSeconds: 120, breakSeconds: 60, tiebreak: false });
    expect(timing('2', 'matched')).toEqual({ rounds: 3, roundSeconds: 90, breakSeconds: 60, tiebreak: false });
  });
  it('§4.2: a tournament fight level after 2 rounds fights a 3rd; still level, the head marshal decides', () => {
    const t = timing('2', 'tournament');
    expect(nextAfter(t, 1, { a: 600, b: 540 })).toBe('round');
    expect(nextAfter(t, 2, { a: 1200, b: 1140 })).toBe('finish');
    expect(nextAfter(t, 2, { a: 1140, b: 1140 })).toBe('tiebreak');
    expect(nextAfter(t, 3, { a: 1740, b: 1740 })).toBe('head_marshal');
    expect(nextAfter(t, 3, { a: 1740, b: 1700 })).toBe('finish');
  });
  it('a matched fight can end level (a draw is a §15.4.2 outcome)', () => {
    expect(nextAfter(timing('1', 'matched'), 3, { a: 1740, b: 1740 })).toBe('finish');
  });
  it('§14.8: a TKO loses the match in Division 1, the round in Division 2', () => {
    expect(tkoLosesFight('1')).toBe(true);
    expect(tkoLosesFight('2')).toBe(false);
  });
  it('§15.4.1: the expected Total Fight Score ranges', () => {
    expect(expectedTotalRange('tournament')).toEqual([14, 20]);
    expect(expectedTotalRange('matched')).toEqual([21, 30]);
  });
  it('a round needs at least one sheet and at most six', () => {
    expect(() => roundScoreUnits([])).toThrow();
    expect(() => roundScoreUnits(Array(7).fill({ a: 10, b: 10 }))).toThrow();
  });
});

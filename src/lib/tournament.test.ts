import { describe, expect, it } from 'vitest';
import { leadMatchFinished, leaguePoints, proRoundScore, splitPools, structureAdvice, zoneValues, type MultiplierSource, type Placement, type TierName } from './tournament';

describe('leaguePoints', () => {
  it('adds pool, elimination and placement points, then the tier multiplier', () => {
    const r = leaguePoints({ poolWins: 3, eliminationWins: 2, placement: 'second', tier: 'Regional', source: 'leagueStructure' });
    expect(r.base).toBe(11);
    expect(r.total).toBe(16.5);
  });
  it('keeps both multiplier sources: they disagree for Regional', () => {
    const a = leaguePoints({ poolWins: 4, eliminationWins: 0, placement: 'none', tier: 'Regional', source: 'tournamentStructure' });
    const b = leaguePoints({ poolWins: 4, eliminationWins: 0, placement: 'none', tier: 'Regional', source: 'leagueStructure' });
    expect(a.total).toBe(5);
    expect(b.total).toBe(6);
  });
  it('awards nothing at an exhibition', () => {
    expect(leaguePoints({ poolWins: 5, eliminationWins: 3, placement: 'first', tier: 'Exhibition', source: 'tournamentStructure' }).total).toBe(0);
  });
});

describe('structureAdvice', () => {
  it('runs a round robin for 4 to 6', () => {
    expect(structureAdvice(5).options).toHaveLength(1);
    expect(structureAdvice(5).band).toBe('4-6');
  });
  it('offers two options for 6 to 12 with the final four advancing', () => {
    const a = structureAdvice(10);
    expect(a.band).toBe('6-12');
    expect(a.options[1].pools).toEqual([5, 5]);
    expect(a.options[1].advancing).toBe(4);
  });
  it('splits 14 entrants two ways or three ways', () => {
    const a = structureAdvice(14);
    expect(a.options[0].pools).toEqual([7, 7]);
    expect(a.options[1].pools).toEqual([5, 5, 4]);
  });
  it('says so below the 4-entrant minimum', () => {
    expect(structureAdvice(3).band).toBe('under-4');
  });
  it('splits pools evenly', () => {
    expect(splitPools(9, 2)).toEqual([5, 4]);
  });
});

describe('proRoundScore (10-point must)', () => {
  const base = { strikesA: 0, strikesB: 0, deductionsA: 0, deductionsB: 0, otherCriteria: 'none' as const };
  it('scores an even round 10-10', () => expect(proRoundScore(base)).toMatchObject({ a: 10, b: 10, label: 'Even' }));
  it('scores a 6-point gap as 10-9', () => expect(proRoundScore({ ...base, strikesA: 6 })).toMatchObject({ a: 10, b: 9, label: 'Slight' }));
  it('scores 11 to 15 as 10-8 and 16+ as 10-7', () => {
    expect(proRoundScore({ ...base, strikesB: 12 })).toMatchObject({ a: 8, b: 10 });
    expect(proRoundScore({ ...base, strikesA: 16 })).toMatchObject({ a: 10, b: 7, label: 'Dominant' });
  });
  it('uses other criteria when the gap is 5 or less', () => {
    expect(proRoundScore({ ...base, strikesA: 3, strikesB: 2, otherCriteria: 'b' })).toMatchObject({ a: 9, b: 10 });
  });
  it('takes a point off for each deduction', () => {
    expect(proRoundScore({ ...base, deductionsB: 1 })).toMatchObject({ a: 10, b: 9 });
  });
});

describe('duels', () => {
  it('scores longsword by grip', () => {
    expect(zoneValues('longsword', 'two').head).toBe(2);
    expect(zoneValues('longsword', 'one').head).toBe(1);
  });
  it('scores polearm hands as zero', () => expect(zoneValues('polearm').hands).toBe(0));
  it('needs two rounds and a 2-point lead', () => {
    expect(leadMatchFinished([5], [0]).done).toBe(false);
    expect(leadMatchFinished([2, 1], [1, 1])).toEqual({ done: false });
    expect(leadMatchFinished([2, 2], [1, 1])).toEqual({ done: true, winner: 'a' });
  });
});

describe('small categories', () => {
  it('suggests a round robin of three, and a head-to-head for two', () => {
    expect(structureAdvice(3).options[0].title).toBe('Round robin of three');
    expect(structureAdvice(2).options[0].title).toBe('Head to head');
    expect(structureAdvice(1).options).toEqual([]);
  });
});

import vectors from '../../supabase/tests/vectors/league_points.json';
describe('league points shared vectors (the same file is checked against SQL by supabase/tests/vectors_gate.sql)', () => {
  it.each(vectors.cases)('$poolWins pool wins, $eliminationWins elimination wins, $placement, $tier, $source = $total', c => {
    expect(leaguePoints({ poolWins: c.poolWins, eliminationWins: c.eliminationWins, placement: c.placement as Placement, tier: c.tier as TierName, source: c.source as MultiplierSource }).total).toBe(c.total);
  });
});

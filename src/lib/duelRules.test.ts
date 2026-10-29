import { describe, expect, it } from 'vitest';
import { bucklerMatchFinished, duelCategoryOf, leadMatchFinished } from './tournament';
import { duelEndRound, duelScore, newDuel } from './scoring';
import { resultFromBoard } from './fieldScoring';
import { bucklerRule, disciplineCounts, type LystDiscipline, type LystRound } from './lyst/rounds';

const round = (n: number, a: number, b: number): LystRound => ({ round_no: n, status: 'confirmed', rev: 1, awarded_a: a, awarded_b: b, deduct_a: 0, deduct_b: 0, official_a: a, official_b: b } as LystRound);

describe('BI duels (Duels Rules 26.4)', () => {
  it('knows the BI duel categories', () => {
    expect(duelCategoryOf('buckler')).toBe('buckler');
    expect(duelCategoryOf('sword_shield')).toBe('swordShield');
    expect(duelCategoryOf('sabre')).toBeNull();
  });
  it('2.2.1 sword and buckler: 2 round victories, not the points', () => {
    expect(bucklerMatchFinished([5, 4], [0, 5]).done).toBe(false);
    expect(bucklerMatchFinished([5, 4, 3], [0, 5, 5])).toEqual({ done: true, winner: 'b', rounds: { a: 1, b: 2 } });
    expect(bucklerMatchFinished([5, 5], [0, 4])).toMatchObject({ done: true, winner: 'a' });
    expect(bucklerMatchFinished([3, 5], [3, 2]).done).toBe(false);   // a level round is won by nobody
  });
  it('2.2.1 the classic board stops a buckler round at 5 points and decides on rounds', () => {
    let s = newDuel('buckler');
    for (let i = 0; i < 7; i++) s = duelScore(s, 'a', 1);
    expect(s.a[0]).toBe(5);
    s = duelEndRound(s);
    for (let i = 0; i < 4; i++) s = duelScore(s, 'a', 1);
    for (let i = 0; i < 5; i++) s = duelScore(s, 'b', 1);
    s = duelEndRound(s);
    expect(s.winner).toBeUndefined();          // 9-5 in points is 1-1 in rounds
    for (let i = 0; i < 3; i++) s = duelScore(s, 'a', 1);
    for (let i = 0; i < 5; i++) s = duelScore(s, 'b', 1);
    s = duelEndRound(s);
    expect(s.winner).toBe('b');
    const r = resultFromBoard({ mode: 'duel', s }, 'round_robin');
    expect(r.ok && r.value).toMatchObject({ result: 'b', scoreA: 1, scoreB: 2, detail: { totals: { a: 12, b: 10 }, score_is: 'round_wins' } });
  });
  it('2.2.2 the other duels: the lead of 2 after the regular rounds', () => {
    expect(leadMatchFinished([5], [3]).done).toBe(false);
    expect(leadMatchFinished([5, 3], [4, 3]).done).toBe(false);
    expect(leadMatchFinished([5, 3, 2], [4, 3, 0])).toEqual({ done: true, winner: 'a' });
  });
  it('the Lyst buckler suggestion follows the round victories', () => {
    expect(bucklerRule([round(1, 5, 0), round(2, 4, 5)])).toMatchObject({ decided: false, extraRound: true, won: { a: 1, b: 1 } });
    expect(bucklerRule([round(1, 5, 0), round(2, 4, 5), round(3, 3, 5)])).toMatchObject({ decided: true, winner: 'b' });
  });
  it('Regulations 4.2: a reprimand is counted apart from the cards (also an older "Reprimand" card)', () => {
    const d = (kind: LystDiscipline['kind'], label: string | null = null): LystDiscipline => ({ id: kind + (label ?? ''), round_no: 1, side: 'a', kind, label, amount: kind === 'reprimand' ? 3 : 0, voided_at: null });
    expect(disciplineCounts([d('reprimand'), d('card', 'Reprimand'), d('card', 'Yellow')], 'a')).toMatchObject({ reprimands: 2, cards: 1 });
  });
});

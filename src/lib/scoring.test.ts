import { describe, expect, it } from 'vitest';
import { confirmRound, duelEndRound, duelScore, duelTotal, duelUndo, newDuel, newGroupFight, newPro, proAddRound, proPatch, roundWinner, standing, toggleFighter } from './scoring';

describe('group fight', () => {
  const groundAll = (s: ReturnType<typeof newGroupFight>, side: 'a' | 'b') => [0, 1, 2, 3, 4].reduce((acc, i) => toggleFighter(acc, side, i), s);
  it('counts fighters still standing', () => {
    const s = toggleFighter(newGroupFight(), 'a', 0);
    expect(standing(s, 'a')).toBe(4);
    expect(standing(s, 'b')).toBe(5);
  });
  it('can take a mistaken call back by tapping again', () => {
    const s = toggleFighter(toggleFighter(newGroupFight(), 'a', 2), 'a', 2);
    expect(standing(s, 'a')).toBe(5);
  });
  it('gives the round to the side that still has fighters standing', () => {
    const s = groundAll(newGroupFight(), 'a');
    expect(roundWinner(s)).toBe('b');
  });
  it('does not give a round while both sides have fighters standing', () => {
    expect(confirmRound(toggleFighter(newGroupFight(), 'a', 0)).rounds).toEqual({ a: 0, b: 0 });
  });
  it('starts the next round fresh and ends the fight at the rounds to win', () => {
    let s = confirmRound(groundAll(newGroupFight(), 'a'));
    expect(s.rounds).toEqual({ a: 0, b: 1 });
    expect(s.round).toBe(2);
    expect(standing(s, 'a')).toBe(5);
    s = confirmRound(groundAll(s, 'a'));
    expect(s.winner).toBe('b');
    expect(toggleFighter(s, 'a', 0)).toBe(s);
  });
});

describe('duel', () => {
  it('adds points to the current round and can undo', () => {
    let s = duelScore(newDuel(), 'a', 2);
    s = duelScore(s, 'b', 1);
    expect(duelTotal(s, 'a')).toBe(2);
    s = duelUndo(s);
    expect(duelTotal(s, 'b')).toBe(0);
  });
  it('plays an extra round when the lead is under 2, then finishes', () => {
    let s = duelEndRound(duelScore(duelScore(newDuel(), 'a', 1), 'b', 1)); // round 1 level
    s = duelEndRound(duelScore(s, 'a', 1)); // total 2-1, round 2 ends, lead 1
    expect(s.winner).toBeUndefined();
    expect(s.a).toHaveLength(3);
    s = duelEndRound(duelScore(s, 'a', 2));
    expect(s.winner).toBe('a');
  });
  it('freezes the score once there is a winner', () => {
    let s = duelEndRound(duelScore(newDuel(), 'a', 5));
    s = duelEndRound(duelScore(s, 'a', 0));
    expect(s.winner).toBe('a');
    expect(duelScore(s, 'b', 2)).toBe(s);
  });
});

describe('profight', () => {
  it('edits only the current round and adds up to three rounds', () => {
    let s = proPatch(newPro(), { strikesA: 7 });
    s = proAddRound(s);
    s = proPatch(s, { strikesB: 3 });
    expect(s.rounds[0].strikesA).toBe(7);
    expect(s.rounds[1].strikesB).toBe(3);
    s = proAddRound(proAddRound(s));
    expect(s.rounds).toHaveLength(3);
  });
});

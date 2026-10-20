import { describe, expect, it } from 'vitest';
import { newGroupFight, toggleFighter } from '../scoring';
import type { LystRound } from './rounds';
import { groupRoundsAligned, recoverGroupBoard } from './groupRecovery';
const round = (n: number, a: number, b: number) => ({ round_no: n, status: 'confirmed', awarded_a: a, awarded_b: b } as LystRound);
describe('team device recovery', () => {
  it('restores recorded wins and the next round on a fresh device', () => {
    const b = recoverGroupBoard(newGroupFight(), [round(1, 1, 0)]);
    expect(b.rounds).toEqual({ a: 1, b: 0 }); expect(b.round).toBe(2); expect(b.winner).toBeUndefined();
  });
  it('restores the winner without inventing an extra round', () => {
    const b = recoverGroupBoard(newGroupFight(), [round(1, 1, 0), round(2, 0, 1), round(3, 1, 0)]);
    expect(b.rounds).toEqual({ a: 2, b: 1 }); expect(b.winner).toBe('a'); expect(b.round).toBe(3);
    expect(recoverGroupBoard(b, [round(1, 1, 0), round(2, 0, 1), round(3, 1, 0)])).toBe(b);
  });
  it('preserves a pending local win and partial current-round standing', () => {
    const pending = { ...newGroupFight(), rounds: { a: 1, b: 0 }, round: 2 };
    expect(recoverGroupBoard(pending, [])).toBe(pending);
    const partial = toggleFighter(pending, 'a', 0);
    expect(recoverGroupBoard(partial, [round(1, 1, 0)])).toBe(partial);
  });
  it('uses the server winner when two devices disagree about the same round', () => {
    const local = { ...newGroupFight(), rounds: { a: 0, b: 1 }, round: 2 };
    expect(recoverGroupBoard(local, [round(1, 1, 0)]).rounds).toEqual({ a: 1, b: 0 });
    expect(groupRoundsAligned(local, [round(1, 1, 0)])).toBe(false);
  });
  it('blocks finishing until a clock-backed pending round is confirmed', () => {
    const pending = { ...newGroupFight(), rounds: { a: 2, b: 0 }, winner: 'a' as const };
    expect(groupRoundsAligned(pending, [round(1, 1, 0)])).toBe(false);
    expect(groupRoundsAligned(pending, [round(1, 1, 0), round(2, 1, 0), { ...round(3, 0, 0), status: 'running' }])).toBe(false);
    expect(groupRoundsAligned(pending, [])).toBe(true);
  });
  it('refuses ambiguous team awards instead of guessing a result', () => {
    expect(() => recoverGroupBoard(newGroupFight(), [round(1, 5, 3)])).toThrow('marshal');
  });
  it('keeps an interrupted 0-0 round without inventing a winner or restarting it', () => {
    const b = recoverGroupBoard(newGroupFight(), [round(1, 0, 0)]);
    expect(b.rounds).toEqual({ a: 0, b: 0 }); expect(b.round).toBe(2); expect(b.winner).toBeUndefined();
  });
});

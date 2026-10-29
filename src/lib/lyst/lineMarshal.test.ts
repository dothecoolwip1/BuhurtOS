import { describe, expect, it } from 'vitest';
import type { CountAction } from './counters';
import { emptyTally, readTally, shownTally, strikeGap, undoTarget } from './lineMarshal';

const tap = (id: string, mark: CountAction['mark'], markSide: 'a' | 'b', round = 1, runId = 'r1'): CountAction => ({ id, kind: 'tap', weight: 1, round, runId, mark, markSide });
const undo = (id: string, mark: CountAction['mark'], markSide: 'a' | 'b', round = 1, runId = 'r1'): CountAction => ({ id, kind: 'undo', round, runId, mark, markSide });

describe('the line marshal\'s phone', () => {
  it('reads the server\'s tally defensively', () => {
    expect(readTally(null)).toEqual(emptyTally());
    expect(readTally({ strike: { a: 3, b: -1 }, takedown: { a: 'x' } }).strike).toEqual({ a: 3, b: 0 });
  });
  it('shows the server\'s tally plus the taps still waiting, in order', () => {
    const base = readTally({ strike: { a: 4, b: 2 } });
    const t = shownTally(base, [tap('1', 'strike', 'a'), tap('2', 'weapon_loss', 'b'), undo('3', 'strike', 'a'), tap('4', 'strike', 'b')], 1, 'r1');
    expect(t.strike).toEqual({ a: 4, b: 3 });
    expect(t.weapon_loss).toEqual({ a: 0, b: 1 });
  });
  it('ignores other rounds and runs and a side counter\'s unmarked taps', () => {
    const t = shownTally(emptyTally(), [tap('1', 'strike', 'a', 2), tap('2', 'strike', 'a', 1, 'old'), { id: '3', kind: 'tap', weight: 1, round: 1, runId: 'r1' }], 1, 'r1');
    expect(t.strike).toEqual({ a: 0, b: 0 });
  });
  it('an undo never goes below zero', () => {
    expect(shownTally(emptyTally(), [undo('1', 'takedown', 'a')], 1).takedown.a).toBe(0);
  });
  it('UNDO takes back this phone\'s last tap, or the server\'s last after a reload, never an empty cell', () => {
    const shown = readTally({ strike: { a: 1, b: 0 }, takedown: { a: 0, b: 1 } });
    expect(undoTarget([{ mark: 'strike', side: 'a' }, { mark: 'takedown', side: 'b' }], null, shown)).toEqual({ mark: 'takedown', side: 'b' });
    expect(undoTarget([], { mark: 'strike', side: 'a' }, shown)).toEqual({ mark: 'strike', side: 'a' });
    expect(undoTarget([], { mark: 'strike', side: 'b' }, shown)).toBeNull();
    expect(undoTarget([], null, shown)).toBeNull();
  });
  it('the strike point difference', () => {
    expect(strikeGap(readTally({ strike: { a: 3, b: 9 } }))).toBe(6);
  });
});

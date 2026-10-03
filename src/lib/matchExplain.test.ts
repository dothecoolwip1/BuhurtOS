import { describe, expect, it } from 'vitest';
import { explainResult } from './matchExplain';

const base = { queueState: 'final' as const, nameA: 'Iron Wolves', nameB: 'Ash Guard', stage: 'elimination' as const };
describe('explainResult', () => {
  it('states a group fight from the recorded rounds and rounds-to-win', () => {
    expect(explainResult({ ...base, result: 'a', scoreA: 2, scoreB: 1, detail: { kind: 'group', roundsToWin: 2 } })).toBe('Iron Wolves won 2 rounds to 1 (first to 2).');
    expect(explainResult({ ...base, result: 'b', scoreA: 0, scoreB: 1, detail: { kind: 'group' } })).toBe('Ash Guard won 1 round to 0.');
  });
  it('states a duel from the points and the number of rounds recorded', () => {
    expect(explainResult({ ...base, result: 'a', scoreA: 4, scoreB: 2, detail: { kind: 'duel', rounds: { a: [2, 2], b: [1, 1] } } })).toBe('Iron Wolves won on points, 4–2 over 2 rounds.');
  });
  it('states a profight and a plain result without inventing a reason', () => {
    expect(explainResult({ ...base, result: 'b', scoreA: 18, scoreB: 20, detail: { kind: 'pro' } })).toBe("Ash Guard won on the judges' round scores, 20–18.");
    expect(explainResult({ ...base, result: 'a', scoreA: 5, scoreB: 3, detail: {} })).toBe('Iron Wolves won 5–3.');
  });
  it('explains a pool draw using the standings rule', () => {
    expect(explainResult({ ...base, stage: 'pool', result: 'draw', scoreA: 3, scoreB: 3, detail: {} })).toMatch(/^Level at 3–3: a draw, which counts as neither/);
  });
  it('says nothing for an unfinished or incomplete match', () => {
    expect(explainResult({ ...base, queueState: 'active', result: null, scoreA: null, scoreB: null, detail: {} })).toBeNull();
    expect(explainResult({ ...base, result: 'a', scoreA: null, scoreB: null, detail: {} })).toBeNull();
  });
  it('is deterministic: the same input always gives the same sentence', () => {
    const m = { ...base, result: 'a' as const, scoreA: 2, scoreB: 0, detail: { kind: 'group', roundsToWin: 2 } };
    expect(explainResult(m)).toBe(explainResult({ ...m }));
  });
});

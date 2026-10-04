import { describe, expect, it } from 'vitest';
import { newBoard } from './fieldScoring';
import { snapshotOf } from './liveScoreSnapshot';
import { confirmRound, duelEndRound, duelScore, proPatch, toggleFighter, type DuelState, type GroupState } from './scoring';
import { setSeriesRound } from './marathon';
import { resultFromBoard } from './fieldScoring';

describe('the running score a board reports (what the scorer screen and the venue display both show)', () => {
  it('group fight: rounds won are the score, fighters standing and the round are the detail', () => {
    let g = newBoard('group', { perSide: 5, roundsToWin: 2 });
    expect(snapshotOf(g, 'pool')).toMatchObject({ scoreA: 0, scoreB: 0, phase: 'Round 1 · first to 2', decided: null, detail: { mode: 'group', standing: { a: 5, b: 5 }, roundsToWin: 2 } });
    let s = g.s as GroupState;
    for (let i = 0; i < 5; i++) s = toggleFighter(s, 'b', i);
    s = confirmRound(s);
    g = { mode: 'group', s };
    expect(snapshotOf(g, 'pool')).toMatchObject({ scoreA: 1, scoreB: 0, phase: 'Round 2 · first to 2', detail: { standing: { a: 5, b: 5 } } });
    for (let i = 0; i < 5; i++) s = toggleFighter(s, 'b', i);
    s = confirmRound(s);
    const snap = snapshotOf({ mode: 'group', s }, 'pool');
    expect(snap).toMatchObject({ scoreA: 2, scoreB: 0, phase: 'Fight decided', decided: 'a' });
    expect(snap.detail.decided).toBe('a');
  });
  it('duel: point totals are the score, each round is in the detail, the round number is the phase', () => {
    let d = newBoard('duel').s as DuelState;
    d = duelScore(d, 'a', 2); d = duelScore(d, 'b', 1);
    expect(snapshotOf({ mode: 'duel', s: d }, 'pool')).toMatchObject({ scoreA: 2, scoreB: 1, phase: 'Round 1 of 2', decided: null, detail: { mode: 'duel', rounds: [{ a: 2, b: 1 }] } });
    d = duelEndRound(d);
    expect(snapshotOf({ mode: 'duel', s: d }, 'pool').phase).toBe('Round 2 of 2');
    d = duelScore(d, 'b', 1); d = duelEndRound(d);   // 2–2 after two rounds: extra round
    expect(snapshotOf({ mode: 'duel', s: d }, 'pool').phase).toBe('Extra round');
    d = duelScore(d, 'a', 2); d = duelEndRound(d);
    expect(snapshotOf({ mode: 'duel', s: d }, 'pool')).toMatchObject({ scoreA: 4, scoreB: 2, decided: 'a', phase: 'Fight decided' });
  });
  it('series / marathon: points per round, the discipline in the phase', () => {
    const m = newBoard('marathon');
    expect(snapshotOf(m, 'pool').phase).toBe('Round 1 of 6 · Longsword');
    let s = m.s as Parameters<typeof setSeriesRound>[0];
    s = setSeriesRound(s, 'a', 0); s = setSeriesRound(s, 'tie', 0);
    const snap = snapshotOf({ mode: 'marathon', s }, 'pool');
    expect(snap).toMatchObject({ scoreA: 3, scoreB: 1, phase: 'Round 3 of 6 · Sabre' });
    expect(snap.detail.rounds?.slice(0, 2)).toEqual([{ a: 2, b: 0, label: 'Longsword' }, { a: 1, b: 1, label: 'Sword and Shield' }]);
    expect(snap.detail.rounds).toHaveLength(6);
    expect(snapshotOf(newBoard('series', { seriesKind: 'sabre' }), 'pool').phase).toBe('Setting up');
  });
  it('profight: the 10-point round scores summed, never decided on the board', () => {
    const p = newBoard('pro');
    const s = proPatch(p.s as Parameters<typeof proPatch>[0], { strikesA: 12, strikesB: 4 });
    const snap = snapshotOf({ mode: 'pro', s }, 'elimination');
    expect(snap.phase).toBe('Round 1 of 1');
    expect(snap.decided).toBeNull();
    expect(snap.scoreA).toBeGreaterThan(snap.scoreB);
  });
  it('agrees with the official result the board would produce', () => {
    let d = newBoard('duel').s as DuelState;
    d = duelScore(d, 'a', 2); d = duelEndRound(d); d = duelScore(d, 'a', 2); d = duelEndRound(d);
    const board = { mode: 'duel' as const, s: d };
    const snap = snapshotOf(board, 'pool'), official = resultFromBoard(board, 'pool');
    expect(official.ok && [official.value.scoreA, official.value.scoreB, official.value.result]).toEqual([snap.scoreA, snap.scoreB, snap.decided]);
  });
});

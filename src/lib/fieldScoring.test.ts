import { describe, expect, it } from 'vitest';
import type { CompetitionMatch } from '../data/matches';
import { boardModeFor, canOfferFinish, fieldQueue, isStaleVersionError, newBoard, perSideFor, resultFromBoard, resultSummary, type BoardState } from './fieldScoring';
import { configureSeries, newMarathon, newSeries, setSeriesRound, type SeriesState } from './marathon';
import { confirmRound, duelEndRound, duelScore, newDuel, newGroupFight, newPro, toggleFighter, type ProState } from './scoring';

const m = (over: Partial<CompetitionMatch>): CompetitionMatch => ({
  id: 'm', competitionId: 'c', stage: 'pool', roundLabel: 'Round 1', position: 0, pool: null, field: 'Field 1', scheduledAt: null, queueState: 'on_deck',
  entryA: 'a', entryB: 'b', nameA: 'A', nameB: 'B', nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null, scoreA: null, scoreB: null,
  detail: {}, version: 0, finalizedAt: null, ...over
});

describe('boardModeFor / perSideFor', () => {
  it('maps leagues to boards', () => {
    expect(boardModeFor('buhurt')).toBe('group');
    expect(boardModeFor('duels')).toBe('duel');
    expect(boardModeFor('outrance')).toBe('pro');
    expect(boardModeFor('hacsa')).toBeNull();
    expect(boardModeFor('hacsa', 'marathon')).toBe('marathon');
    expect(boardModeFor('hacsa', 'triathlon')).toBe('series');
    expect(boardModeFor('hacsa', 'sabre')).toBe('series');
    expect(boardModeFor('hacsa', 'greatsword')).toBe('series');
    expect(boardModeFor('duels', 'longsword')).toBe('duel');
  });
  it('reads fighters per side from the category', () => {
    expect(perSideFor('5v5')).toBe(5);
    expect(perSideFor('12v12')).toBe(12);
    expect(perSideFor('longsword')).toBe(5);
  });
});

describe('fieldQueue', () => {
  it('keeps one field, drops scheduled and final, orders active, on deck, in the hole', () => {
    const q = fieldQueue([
      m({ id: 'hole', queueState: 'in_the_hole' }), m({ id: 'deck2', queueState: 'on_deck', position: 2 }), m({ id: 'deck1', queueState: 'on_deck', position: 1 }),
      m({ id: 'act', queueState: 'active', position: 9 }), m({ id: 'other', field: 'Field 2' }), m({ id: 'sched', queueState: 'scheduled' }), m({ id: 'done', queueState: 'final' }), m({ id: 'nofield', field: null })
    ], ' field 1 ');
    expect(q.map(x => x.id)).toEqual(['act', 'deck1', 'deck2', 'hole']);
  });
  it('breaks ties by scheduled time before position', () => {
    const q = fieldQueue([m({ id: 'late', scheduledAt: '2026-10-01T12:00:00Z', position: 1 }), m({ id: 'early', scheduledAt: '2026-10-01T09:00:00Z', position: 5 })], 'Field 1');
    expect(q.map(x => x.id)).toEqual(['early', 'late']);
  });
});

describe('resultFromBoard: group', () => {
  it('needs a decided fight', () => {
    expect(resultFromBoard(newBoard('group'), 'pool').ok).toBe(false);
  });
  it('maps rounds won to score and detail', () => {
    let s = newGroupFight(2, 2);
    for (let r = 0; r < 2; r++) { s = toggleFighter(toggleFighter(s, 'b', 0), 'b', 1); s = confirmRound(s); }
    const out = resultFromBoard({ mode: 'group', s }, 'elimination');
    expect(out).toMatchObject({ ok: true, value: { result: 'a', scoreA: 2, scoreB: 0, detail: { kind: 'group', roundsWon: { a: 2, b: 0 }, roundsPlayed: 2 } } });
  });
});

describe('resultFromBoard: duel', () => {
  it('maps totals and keeps every round', () => {
    let s = newDuel();
    s = duelEndRound(duelScore(duelScore(s, 'a', 2), 'a', 2)); // round 1: a 4, b 0
    s = duelEndRound(duelScore(s, 'b', 1)); // round 2: a 0, b 1 -> 4 v 1, lead 3
    expect(s.winner).toBe('a');
    expect(resultFromBoard({ mode: 'duel', s }, 'pool')).toMatchObject({ ok: true, value: { result: 'a', scoreA: 4, scoreB: 1, detail: { kind: 'duel', rounds: { a: [4, 0], b: [0, 1] } } } });
  });
  it('is not finishable until decided', () => {
    expect(resultFromBoard({ mode: 'duel', s: newDuel() }, 'pool').ok).toBe(false);
  });
});

describe('resultFromBoard: profight', () => {
  const board = (rounds: Partial<ProState['rounds'][number]>[]): BoardState => {
    const base = newPro().rounds[0];
    return { mode: 'pro', s: { rounds: rounds.map(p => ({ ...base, ...p })), current: 0 } };
  };
  it('sums the 10-point round scores', () => {
    const out = resultFromBoard(board([{ strikesA: 12, strikesB: 0 }, { strikesA: 7, strikesB: 0 }]), 'elimination');
    // round 1: gap 12 -> 10-8, round 2: gap 7 -> 10-9
    expect(out).toMatchObject({ ok: true, value: { result: 'a', scoreA: 20, scoreB: 17, detail: { kind: 'pro', totals: { a: 20, b: 17 } } } });
  });
  it('applies deductions', () => {
    const out = resultFromBoard(board([{ strikesA: 0, strikesB: 0, deductionsA: 1 }]), 'pool');
    expect(out).toMatchObject({ ok: true, value: { result: 'b', scoreA: 9, scoreB: 10 } });
  });
  it('level totals are a draw in a pool but refused in elimination', () => {
    expect(resultFromBoard(board([{}]), 'round_robin')).toMatchObject({ ok: true, value: { result: 'draw', scoreA: 10, scoreB: 10 } });
    expect(resultFromBoard(board([{}]), 'final')).toMatchObject({ ok: false });
  });
});

describe('summaries and errors', () => {
  it('words the result', () => {
    expect(resultSummary({ result: 'b', scoreA: 1, scoreB: 2, detail: {} }, 'Iron', 'North')).toBe('North win, 2–1');
    expect(resultSummary({ result: 'draw', scoreA: 10, scoreB: 10, detail: {} }, 'Iron', 'North')).toBe('Draw, 10–10');
  });
  it('spots the stale-version error from the database', () => {
    expect(isStaleVersionError({ message: 'this match changed since you opened it, reload and check it' })).toBe(true);
    expect(isStaleVersionError(new Error('nope'))).toBe(false);
    expect(isStaleVersionError(null)).toBe(false);
  });
});

describe('resultFromBoard: marathon and series', () => {
  const full = (s: SeriesState, rs: ('a' | 'b' | 'tie')[]) => rs.reduce((acc, r) => setSeriesRound(acc, r, 0), s);
  it('is not finishable until all six rounds are in', () => {
    const b: BoardState = { mode: 'marathon', s: full(newMarathon(), ['a']) };
    expect(resultFromBoard(b, 'pool').ok).toBe(false);
    expect(canOfferFinish(b, 'pool')).toBe(false);
    expect(newBoard('marathon')).toMatchObject({ mode: 'marathon' });
  });
  it('maps total points to score and per-round results to detail', () => {
    const b: BoardState = { mode: 'marathon', s: full(newMarathon(), ['a', 'a', 'tie', 'b', 'a', 'a']) };
    const out = resultFromBoard(b, 'elimination');
    expect(out).toMatchObject({ ok: true, value: { result: 'a', scoreA: 9, scoreB: 3, detail: { kind: 'marathon', totals: { a: 9, b: 3 } } } });
    if (out.ok) expect((out.value.detail as { rounds: unknown[] }).rounds).toHaveLength(6);
  });
  it('level is a draw in a pool and needs a decider in elimination', () => {
    const b: BoardState = { mode: 'marathon', s: full(newMarathon(), ['a', 'a', 'a', 'b', 'b', 'b']) };
    expect(resultFromBoard(b, 'pool')).toMatchObject({ ok: true, value: { result: 'draw', scoreA: 6, scoreB: 6 } });
    const out = resultFromBoard(b, 'final');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/decider/i);
  });
  it('series with rules not loaded needs organizer setup first', () => {
    const fresh: BoardState = newBoard('series', { seriesKind: 'sabre' });
    expect(fresh).toMatchObject({ mode: 'series', s: { kind: 'sabre', configured: false } });
    const out = resultFromBoard(fresh, 'pool');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/organizer/i);
    const s = full(configureSeries(newSeries('sabre'), { disciplines: ['Bout 1', 'Bout 2'], winPoints: 3, tiePoints: 1 }), ['a', 'tie']);
    expect(resultFromBoard({ mode: 'series', s }, 'pool')).toMatchObject({ ok: true, value: { result: 'a', scoreA: 4, scoreB: 1, detail: { kind: 'series', rulesLoaded: false } } });
  });
});

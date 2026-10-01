import { describe, expect, it } from 'vitest';
import { BREAK_SECONDS, MARATHON_ROUNDS, breakRemaining, configureSeries, currentRound, newMarathon, newSeries, seriesDetail, seriesOutcome, seriesTotals, seriesUndo, setSeriesRound, type SeriesResult } from './marathon';

const play = (s: ReturnType<typeof newMarathon>, rs: SeriesResult[], now = 1000) => rs.reduce((acc, r) => setSeriesRound(acc, r, now), s);

describe('marathon', () => {
  it('has the six categories in the registration-form order', () => {
    expect(MARATHON_ROUNDS.map(r => r.label)).toEqual(['Longsword', 'Sword and Shield', 'Sabre', 'Polearm', 'Sword and Buckler', 'Short Axe']);
    expect(newMarathon().config.disciplines).toHaveLength(6);
  });
  it('can swap the last round to Greatsword', () => {
    expect(newMarathon('greatsword').config.disciplines[5]).toBe('Greatsword');
  });
  it('scores 2 per win, 1 per tie, 0 per loss and keeps running totals', () => {
    let s = newMarathon();
    s = setSeriesRound(s, 'a', 0);
    expect(seriesTotals(s)).toEqual({ a: 2, b: 0 });
    s = setSeriesRound(s, 'tie', 0);
    expect(seriesTotals(s)).toEqual({ a: 3, b: 1 });
    s = setSeriesRound(s, 'b', 0);
    expect(seriesTotals(s)).toEqual({ a: 3, b: 3 });
    expect(currentRound(s)).toBe(3);
  });
  it('undo takes the last round back and clears the break', () => {
    const s = seriesUndo(play(newMarathon(), ['a', 'b']));
    expect(s.results).toEqual(['a', null, null, null, null, null]);
    expect(s.breakAt).toBeNull();
    expect(seriesUndo(newMarathon()).results.every(r => r === null)).toBe(true);
  });
  it('starts a 10 s break after a round, but not after the last', () => {
    let s = setSeriesRound(newMarathon(), 'a', 5000);
    expect(s.breakAt).toBe(5000);
    expect(breakRemaining(s.breakAt, 5000)).toBe(BREAK_SECONDS);
    expect(breakRemaining(s.breakAt, 8200)).toBe(7);
    expect(breakRemaining(s.breakAt, 15000)).toBe(0);
    expect(breakRemaining(null, 5000)).toBe(0);
    s = play(newMarathon(), ['a', 'a', 'a', 'a', 'a', 'a']);
    expect(s.breakAt).toBeNull();
  });
  it('ignores a tap once all six rounds are in', () => {
    const s = play(newMarathon(), ['a', 'a', 'a', 'a', 'a', 'a']);
    expect(setSeriesRound(s, 'b', 0)).toBe(s);
  });
  it('is incomplete until every round is in', () => {
    expect(seriesOutcome(play(newMarathon(), ['a', 'a']), 'pool')).toEqual({ state: 'incomplete', played: 2, of: 6 });
  });
  it('most points wins', () => {
    expect(seriesOutcome(play(newMarathon(), ['a', 'a', 'a', 'b', 'tie', 'b']), 'elimination')).toEqual({ state: 'decided', winner: 'a', a: 7, b: 5 });
  });
  it('a level total is a draw in pool and round robin', () => {
    const s = play(newMarathon(), ['a', 'a', 'a', 'b', 'b', 'b']);
    expect(seriesOutcome(s, 'pool')).toMatchObject({ state: 'draw', a: 6, b: 6 });
    expect(seriesOutcome(s, 'round_robin')).toMatchObject({ state: 'draw' });
  });
  it('a level total in elimination needs a decider, with no tiebreak invented', () => {
    const o = seriesOutcome(play(newMarathon(), ['a', 'a', 'a', 'b', 'b', 'b']), 'elimination');
    expect(o.state).toBe('needs_decider');
    expect((o as { message: string }).message).toMatch(/decider/i);
    expect(seriesOutcome(play(newMarathon(), ['tie', 'tie', 'tie', 'tie', 'tie', 'tie']), 'third_place').state).toBe('needs_decider');
  });
  it('detail lists each round winner and points', () => {
    const d = seriesDetail(play(newMarathon(), ['a', 'tie', 'b', 'a', 'a', 'b']));
    expect(d.rounds[1]).toEqual({ round: 2, label: 'Sword and Shield', winner: 'tie', a: 1, b: 1 });
    expect(d.totals).toEqual({ a: 7, b: 5 });
    expect(d.pointsPerWin).toBe(2);
    expect(d.rulesLoaded).toBe(true);
  });
  it('records solo as a label and does not change scoring', () => {
    const s = { ...newMarathon(), solo: { a: true, b: false } };
    expect(seriesTotals(setSeriesRound(s, 'a', 0))).toEqual({ a: 2, b: 0 });
    expect(seriesDetail(s).solo).toEqual({ a: true, b: false });
  });
  it('cannot be reconfigured', () => {
    const s = newMarathon();
    expect(configureSeries(s, { disciplines: ['x'], winPoints: 1, tiePoints: 0 })).toBe(s);
  });
});

describe('generic series (rules not loaded)', () => {
  it('starts unconfigured and empty, labelled as organizer-set', () => {
    const s = newSeries('triathlon');
    expect(s.configured).toBe(false);
    expect(s.config.disciplines).toEqual([]);
    expect(s.config.rulesLoaded).toBe(false);
    expect(seriesOutcome(s, 'pool').state).toBe('incomplete');
  });
  it('does not accept rounds until the organizer has set it up', () => {
    const s = newSeries('triathlon');
    expect(setSeriesRound(s, 'a', 0)).toBe(s);
  });
  it('rejects an empty or invalid setup', () => {
    const s = newSeries('sabre');
    expect(configureSeries(s, { disciplines: ['  '], winPoints: 1, tiePoints: 0 })).toBe(s);
    expect(configureSeries(s, { disciplines: ['x'], winPoints: -1, tiePoints: 0 })).toBe(s);
  });
  it('scores by the organizer points and keeps the label', () => {
    let s = configureSeries(newSeries('triathlon'), { disciplines: ['One', ' Two ', 'Three'], winPoints: 3, tiePoints: 1 });
    expect(s.config.disciplines).toEqual(['One', 'Two', 'Three']);
    s = setSeriesRound(setSeriesRound(setSeriesRound(s, 'a', 0), 'tie', 0), 'b', 0);
    expect(seriesTotals(s)).toEqual({ a: 4, b: 4 });
    expect(seriesDetail(s).rulesLoaded).toBe(false);
    expect(seriesDetail(s).pointsPerWin).toBe(3);
  });
});

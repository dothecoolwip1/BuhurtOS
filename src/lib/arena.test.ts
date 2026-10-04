import { describe, expect, it } from 'vitest';
import type { CompetitionMatch } from '../data/matches';
import type { LiveScore } from '../data/liveScores';
import { RESULT_HOLD_MS, arenaFields, buildArena, nextArenaTick, pickField } from './arena';

const NOW = Date.parse('2026-10-04T16:00:00Z');
const m = (n: number, over: Partial<CompetitionMatch> = {}): CompetitionMatch => ({
  id: `m${n}`, competitionId: 'ls', stage: 'round_robin', roundLabel: 'Round 1', position: n, pool: null, field: null, scheduledAt: null, queueState: 'scheduled',
  entryA: `e${n}a`, entryB: `e${n}b`, nameA: `Fighter ${n}A`, nameB: `Fighter ${n}B`, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
  scoreA: null, scoreB: null, detail: {}, version: 0, finalizedAt: null, queueOrder: null, ...over
});
const COMPS = [{ id: 'ls', name: 'Longsword (men)', sort: 1 }, { id: 'ss', name: 'Sword and shield', sort: 2 }];
const score = (matchId: string, a: number, b: number, phase = 'Round 1 of 2'): LiveScore => ({ matchId, competitionId: 'ls', scoreA: a, scoreB: b, phase, detail: { mode: 'duel' }, updatedAt: '' });
const arena = (matches: CompetitionMatch[], scores: LiveScore[] = [], field = 'Field 1', now = NOW) => buildArena({ matches, scores, competitions: COMPS, field, now });

describe('fields', () => {
  it('a blank field is Field 1, explicit names are kept, Field 1 first', () => {
    expect(arenaFields([m(1, { field: 'List 2' }), m(2), m(3, { field: 'Arena A' })])).toEqual(['Field 1', 'Arena A', 'List 2']);
  });
  it('picks the wanted field case-insensitively, else the first, else Field 1', () => {
    expect(pickField(['Field 1', 'Arena A'], 'arena a')).toBe('Arena A');
    expect(pickField(['Field 1', 'Arena A'], undefined)).toBe('Field 1');
    expect(pickField([], null)).toBe('Field 1');
    expect(pickField(['Field 1'], 'Field 2')).toBe('Field 2');   // a field with no matches yet still shows, honestly empty
  });
});

describe('what the display shows', () => {
  it('nothing posted yet', () => {
    expect(arena([]).state).toEqual({ kind: 'no_matches' });
    expect(arena([m(1, { field: 'Field 2' })], [], 'Field 1').state).toEqual({ kind: 'no_matches' });
  });
  it('a fight is on: NOW with the running score when one was reported, on deck and in the hole behind it', () => {
    const v = arena([m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3, { queueState: 'in_the_hole' }), m(4), m(5, { competitionId: 'ss' })], [score('m1', 3, 1)]);
    expect(v.state.kind).toBe('fighting');
    if (v.state.kind !== 'fighting') return;
    expect(v.state.now).toMatchObject({ competition: 'Longsword (men)', stage: 'Round 1', live: true, phase: 'Round 1 of 2', a: { name: 'Fighter 1A', score: 3 }, b: { name: 'Fighter 1B', score: 1 } });
    expect(v.onDeck?.a.name).toBe('Fighter 2A');
    expect(v.inTheHole?.a.name).toBe('Fighter 3A');
    expect(v.upNext.map(f => f.a.name)).toEqual(['Fighter 4A', 'Fighter 5A']);
    expect(v.done).toBe(0); expect(v.total).toBe(5);
  });
  it('a fight is on but nothing has been reported: no score is invented', () => {
    const v = arena([m(1, { queueState: 'active' })]);
    expect(v.state.kind === 'fighting' && v.state.now).toMatchObject({ live: false, phase: null, a: { score: null }, b: { score: null } });
  });
  it('a result shows for a short while after it became official, then the field waits for the next', () => {
    const justNow = new Date(NOW - 5_000).toISOString();
    const list = [m(1, { queueState: 'final', result: 'a', winnerEntryId: 'e1a', scoreA: 5, scoreB: 3, finalizedAt: justNow }), m(2, { queueState: 'on_deck' })];
    const v = arena(list);
    expect(v.state).toMatchObject({ kind: 'result', winnerName: 'Fighter 1A', drawn: false, result: { a: { score: 5, winner: true }, b: { score: 3, winner: false } } });
    const later = arena(list, [], 'Field 1', NOW + RESULT_HOLD_MS + 1);
    expect(later.state).toMatchObject({ kind: 'waiting', next: { a: { name: 'Fighter 2A' } } });
    expect(nextArenaTick(list, 'Field 1', NOW)).toBe(Date.parse(justNow) + RESULT_HOLD_MS);
    expect(nextArenaTick(list, 'Field 1', NOW + RESULT_HOLD_MS + 1)).toBeNull();
  });
  it('a fresh result holds the screen while the next fight is only called; a reported score for that fight takes it; a drawn result says so', () => {
    const justNow = new Date(NOW - 5_000).toISOString();
    const held = arena([m(1, { queueState: 'final', result: 'a', winnerEntryId: 'e1a', scoreA: 5, scoreB: 3, finalizedAt: justNow }), m(2, { queueState: 'active' }), m(3, { queueState: 'on_deck' })]);
    expect(held.state).toMatchObject({ kind: 'result', winnerName: 'Fighter 1A', next: { a: { name: 'Fighter 2A' } } });
    expect(held.onDeck?.a.name).toBe('Fighter 3A');
    const taken = arena([m(1, { queueState: 'final', result: 'a', winnerEntryId: 'e1a', scoreA: 5, scoreB: 3, finalizedAt: justNow }), m(2, { queueState: 'active' })], [{ matchId: 'm2', competitionId: 'ls', scoreA: 0, scoreB: 0, phase: 'Round 1 of 2', detail: {}, updatedAt: justNow }]);
    expect(taken.state.kind).toBe('fighting');
    const over = arena([m(1, { queueState: 'final', result: 'a', winnerEntryId: 'e1a', scoreA: 5, scoreB: 3, finalizedAt: new Date(NOW - 26_000).toISOString() }), m(2, { queueState: 'active' })]);
    expect(over.state.kind).toBe('fighting');
  });
  it('a live fight beats a stale result; a drawn result says so', () => {
    const justNow = new Date(NOW - 5_000).toISOString();
    const v = arena([m(1, { queueState: 'final', result: 'draw', scoreA: 2, scoreB: 2, finalizedAt: new Date(NOW - 30_000).toISOString() }), m(2, { queueState: 'active' })]);
    expect(v.state.kind).toBe('fighting');
    const d = arena([m(1, { queueState: 'final', result: 'draw', scoreA: 2, scoreB: 2, finalizedAt: justNow })]);
    expect(d.state).toMatchObject({ kind: 'result', drawn: true, winnerName: null });
  });
  it('every fight on the field is done', () => {
    const old = new Date(NOW - 3_600_000).toISOString();
    expect(arena([m(1, { queueState: 'final', finalizedAt: old }), m(2, { queueState: 'final', finalizedAt: old })]).state).toEqual({ kind: 'finished' });
  });
  it('waiting: the next fight is on deck, else in the hole, else the first ready one; a fight waiting for a side is not offered', () => {
    expect(arena([m(1, { queueState: 'in_the_hole' }), m(2)]).state).toMatchObject({ kind: 'waiting', next: { a: { name: 'Fighter 1A' } } });
    expect(arena([m(2), m(1, { entryB: null, nameB: null })]).state).toMatchObject({ kind: 'waiting', next: { a: { name: 'Fighter 2A' } } });
    expect(arena([m(1, { entryB: null, nameB: null })]).state).toMatchObject({ kind: 'waiting', next: null });
  });
  it('Field 2 shows only Field 2; live scores of another field are ignored', () => {
    const list = [m(1, { queueState: 'active' }), m(11, { field: 'Field 2', queueState: 'active' }), m(12, { field: 'Field 2', queueState: 'on_deck' })];
    const v = arena(list, [score('m1', 9, 9), score('m11', 1, 0)], 'Field 2');
    expect(v.state.kind === 'fighting' && v.state.now.a).toMatchObject({ name: 'Fighter 11A', score: 1 });
    expect(v.onDeck?.a.name).toBe('Fighter 12A');
    expect(v.total).toBe(2);
    expect(arena(list, [], 'field 2').field).toBe('Field 2');
  });
  it('a side that is not decided yet reads "To be decided"', () => {
    const v = arena([m(1, { queueState: 'active', entryB: null, nameB: null })]);
    expect(v.state.kind === 'fighting' && v.state.now.b.name).toBe('To be decided');
  });
});

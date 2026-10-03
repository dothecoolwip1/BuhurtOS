import { describe, expect, it } from 'vitest';
import type { CompetitionEntry, CompetitionMatch, Standing } from '../data/matches';
import { buildBracketColumns, buildNowAndNext, buildPoolTables, championOf, sortStandings, TBD } from './liveView';

const m = (o: Partial<CompetitionMatch> & { id: string }): CompetitionMatch => ({
  competitionId: 'c1', stage: 'elimination', roundLabel: 'Semifinal', position: 0, pool: null, field: null, scheduledAt: null, queueState: 'scheduled',
  entryA: null, entryB: null, nameA: null, nameB: null, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null, scoreA: null, scoreB: null,
  detail: {}, version: 1, finalizedAt: null, ...o
});
const entry = (id: string, name: string, pool: string | null = null): CompetitionEntry => ({ id, competitionId: 'c1', teamId: null, fighterId: null, name, pool, seed: null, status: 'accepted' });
const st = (entryId: string, wins: number, scoreFor: number, scoreAgainst: number): Standing => ({ competitionId: 'c1', entryId, wins, losses: 0, draws: 0, scoreFor, scoreAgainst });

describe('sortStandings', () => {
  const entries = [entry('a', 'Alpha'), entry('b', 'Bravo'), entry('c', 'Charlie')];
  it('sorts by wins, then score difference', () => {
    const rows = sortStandings([st('a', 1, 5, 5), st('b', 2, 4, 6), st('c', 2, 9, 3)], entries);
    expect(rows.map(r => r.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(rows[0].diff).toBe(6);
    expect(rows.every(r => !r.tied)).toBe(true);
  });
  it('flags rows level on wins and difference instead of inventing a tie-break', () => {
    const rows = sortStandings([st('a', 2, 5, 3), st('b', 2, 7, 5), st('c', 0, 0, 4)], entries);
    expect(rows.map(r => r.tied)).toEqual([true, true, false]);
  });
  it('does not mutate its input', () => {
    const input = [st('a', 0, 0, 0), st('b', 3, 3, 0)];
    sortStandings(input, entries);
    expect(input[0].entryId).toBe('a');
  });
});

describe('buildPoolTables', () => {
  const entries = [entry('a', 'Alpha', 'A'), entry('b', 'Bravo', 'A'), entry('c', 'Charlie', 'B'), entry('d', 'Delta', 'B')];
  const matches = [m({ id: '1', stage: 'pool', pool: 'A', entryA: 'a', entryB: 'b' }), m({ id: '2', stage: 'pool', pool: 'B', entryA: 'c', entryB: 'd' })];
  it('makes one table per pool', () => {
    const t = buildPoolTables([st('a', 0, 0, 0), st('b', 1, 3, 1), st('c', 1, 2, 0), st('d', 0, 0, 2)], entries, matches);
    expect(t.map(x => x.label)).toEqual(['Pool A', 'Pool B']);
    expect(t[0].rows.map(r => r.name)).toEqual(['Bravo', 'Alpha']);
  });
  it('is empty without pool or round-robin matches', () => {
    expect(buildPoolTables([st('a', 0, 0, 0)], entries, [m({ id: '3', entryA: 'a', entryB: 'b' })])).toEqual([]);
  });
  it('uses a single table for a round robin without pools', () => {
    const t = buildPoolTables([st('a', 1, 1, 0), st('b', 0, 0, 1)], [entry('a', 'Alpha'), entry('b', 'Bravo')], [m({ id: '4', stage: 'round_robin', entryA: 'a', entryB: 'b' })]);
    expect(t).toHaveLength(1);
    expect(t[0].label).toBe('Standings');
  });
});

describe('buildBracketColumns', () => {
  const matches = [
    m({ id: 'f', stage: 'final', roundLabel: 'Final', entryA: 'a', nameA: 'Alpha', queueState: 'scheduled' }),
    m({ id: 't', stage: 'third_place', roundLabel: 'Third place' }),
    m({ id: 's2', position: 1, entryA: 'c', entryB: 'd', nameA: 'Charlie', nameB: 'Delta' }),
    m({ id: 's1', position: 0, entryA: 'a', entryB: 'b', nameA: 'Alpha', nameB: 'Bravo', queueState: 'final', result: 'a', winnerEntryId: 'a', scoreA: 3, scoreB: 1 }),
    m({ id: 'p', stage: 'pool', pool: 'A', roundLabel: 'Round 1', entryA: 'a', entryB: 'b' })
  ];
  const cols = buildBracketColumns(matches);
  it('orders rounds as columns and leaves pool matches out', () => {
    expect(cols.map(c => c.title)).toEqual(['Semifinal', 'Final', 'Third place']);
    expect(cols[0].matches.map(x => x.id)).toEqual(['s1', 's2']);
  });
  it('marks the winner and loser of a finished match', () => {
    const [a, b] = cols[0].matches[0].slots;
    expect(a).toMatchObject({ winner: true, loser: false, score: 3 });
    expect(b).toMatchObject({ winner: false, loser: true, score: 1 });
  });
  it('shows To be decided for empty slots and hides scores of unfinished matches', () => {
    const final = cols[1].matches[0];
    expect(final.slots[0].name).toBe('Alpha');
    expect(final.slots[1]).toMatchObject({ name: TBD, tbd: true, winner: false, loser: false, score: null });
  });
  it('is empty with no bracket matches', () => {
    expect(buildBracketColumns([])).toEqual([]);
  });
});

describe('championOf', () => {
  it('returns the final winner only once the final is done', () => {
    const base = { stage: 'final' as const, entryA: 'a', entryB: 'b', nameA: 'Alpha', nameB: 'Bravo' };
    expect(championOf([m({ id: 'f', ...base })])).toBeNull();
    expect(championOf([m({ id: 'f', ...base, queueState: 'final', result: 'b', winnerEntryId: 'b' })])).toBe('Bravo');
    expect(championOf([m({ id: 'f', ...base, queueState: 'final', result: 'draw' })])).toBeNull();
  });
});

describe('buildNowAndNext', () => {
  const names = new Map([['c1', 'Longsword']]);
  it('groups running and queued matches by field, active first', () => {
    const list = [
      m({ id: '1', field: 'Field 2', queueState: 'on_deck', nameA: 'A', nameB: 'B', entryA: 'a', entryB: 'b' }),
      m({ id: '2', field: 'Field 1', queueState: 'in_the_hole' }),
      m({ id: '3', field: 'Field 1', queueState: 'active', nameA: 'X', nameB: 'Y' }),
      m({ id: '4', field: 'Field 1', queueState: 'scheduled' }),
      m({ id: '5', field: 'Field 1', queueState: 'final' })
    ];
    const out = buildNowAndNext(list, names);
    expect(out.map(f => f.field)).toEqual(['Field 1', 'Field 2']);
    expect(out[0].items.map(i => i.id)).toEqual(['3', '2']);
    expect(out[0].items[1].nameA).toBe(TBD);
    expect(out[0].items[0].competition).toBe('Longsword');
  });
  it('is empty when nothing is running', () => {
    expect(buildNowAndNext([m({ id: '1' })], names)).toEqual([]);
  });
  it('puts matches without a field in their own group', () => {
    expect(buildNowAndNext([m({ id: '1', queueState: 'active' })], names)[0].field).toBe('Field not set');
  });
});

describe('sortStandings with the database ranking', () => {
  it('follows the database rank and tie flags instead of ordering by name', () => {
    const entries = [{ id: 'a', name: 'Alpha', pool: 'A' }, { id: 'b', name: 'Bravo', pool: 'A' }, { id: 'c', name: 'Charlie', pool: 'A' }] as unknown as Parameters<typeof sortStandings>[1];
    const st = (entryId: string, rank: number, tied: boolean) => ({ competitionId: 'k', entryId, wins: 1, losses: 1, draws: 0, scoreFor: 10, scoreAgainst: 10, rank, tied });
    // a three-way cycle that an organizer decided as Charlie, Alpha, Bravo
    const rows = sortStandings([st('a', 2, false), st('b', 3, false), st('c', 1, false)], entries);
    expect(rows.map(r => r.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    expect(rows.some(r => r.tied)).toBe(false);
    const undecided = sortStandings([st('a', 1, true), st('b', 1, true), st('c', 1, true)], entries);
    expect(undecided.every(r => r.tied)).toBe(true);
  });
});

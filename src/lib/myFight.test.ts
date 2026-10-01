import { describe, expect, it } from 'vitest';
import type { CompetitionMatch } from '../data/matches';
import { aheadText, nextForEntries, recordText, statusLabel } from './myFight';

const m = (over: Partial<CompetitionMatch>): CompetitionMatch => ({
  id: Math.random().toString(), competitionId: 'c', stage: 'pool', roundLabel: 'Round 1', position: 0, pool: null, field: null, scheduledAt: null,
  queueState: 'scheduled', entryA: null, entryB: null, nameA: null, nameB: null, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
  scoreA: null, scoreB: null, detail: {}, version: 0, finalizedAt: null, ...over
});

describe('nextForEntries', () => {
  it('returns nothing when the viewer has no matches', () => {
    const s = nextForEntries([m({ entryA: 'x', entryB: 'y' })], ['me']);
    expect(s.next).toBeNull();
    expect(s.total).toBe(0);
  });

  it('prefers the most urgent unfinished match and names the opponent', () => {
    const matches = [
      m({ id: 'later', entryA: 'me', entryB: 'o1', nameB: 'Wolves', queueState: 'scheduled', position: 5 }),
      m({ id: 'soon', entryA: 'o2', entryB: 'me', nameA: 'Ravens', queueState: 'on_deck', field: 'Field 1' }),
    ];
    const s = nextForEntries(matches, ['me']);
    expect(s.next?.match.id).toBe('soon');
    expect(s.next?.opponent).toBe('Ravens');
    expect(s.next?.myEntry).toBe('me');
  });

  it('counts matches ahead from the field queue, case-insensitively', () => {
    const matches = [
      m({ id: 'a1', entryA: 'p', entryB: 'q', queueState: 'active', field: 'field 1' }),
      m({ id: 'a2', entryA: 'r', entryB: 's', queueState: 'on_deck', field: 'Field 1' }),
      m({ id: 'mine', entryA: 'me', entryB: 'o', nameB: 'Foe', queueState: 'in_the_hole', field: 'Field 1' }),
      m({ id: 'other', entryA: 'u', entryB: 'v', queueState: 'active', field: 'Field 2' }),
    ];
    expect(nextForEntries(matches, ['me']).next?.ahead).toBe(2);
  });

  it('gives no position when the match is not queued or has no field', () => {
    expect(nextForEntries([m({ entryA: 'me', entryB: 'o', queueState: 'scheduled', field: 'Field 1' })], ['me']).next?.ahead).toBeNull();
    expect(nextForEntries([m({ entryA: 'me', entryB: 'o', queueState: 'on_deck', field: null })], ['me']).next?.ahead).toBeNull();
  });

  it('says the opponent is undecided when that side is empty, and flags an unnamed approved-later team', () => {
    expect(nextForEntries([m({ entryA: 'me', entryB: null })], ['me']).next?.opponent).toBe('Opponent to be decided');
    expect(nextForEntries([m({ entryA: 'me', entryB: 'hidden', nameB: null })], ['me']).next?.opponent).toMatch(/Unnamed entry/);
  });

  it('covers every entry of a person (several competitions)', () => {
    const matches = [
      m({ id: 'duel', competitionId: 'c1', entryA: 'e1', entryB: 'z', queueState: 'scheduled' }),
      m({ id: 'team', competitionId: 'c2', entryA: 'z', entryB: 'e2', queueState: 'in_the_hole', field: 'F' }),
    ];
    expect(nextForEntries(matches, ['e1', 'e2']).next?.match.id).toBe('team');
    expect(nextForEntries(matches, ['e1', 'e2']).total).toBe(2);
  });

  it('builds the result so far from either side', () => {
    const matches = [
      m({ id: '1', entryA: 'me', entryB: 'o', nameB: 'Ravens', queueState: 'final', result: 'a', scoreA: 5, scoreB: 3, finalizedAt: '2026-10-01T10:00:00Z' }),
      m({ id: '2', entryA: 'o', entryB: 'me', nameA: 'Wolves', queueState: 'final', result: 'a', scoreA: 4, scoreB: 2, finalizedAt: '2026-10-01T11:00:00Z' }),
      m({ id: '3', entryA: 'me', entryB: 'o', nameB: 'Bears', queueState: 'final', result: 'draw', scoreA: 1, scoreB: 1, finalizedAt: '2026-10-01T12:00:00Z' }),
    ];
    const s = nextForEntries(matches, ['me']);
    expect(s.next).toBeNull();
    expect(s.results.map(r => [r.opponent, r.outcome, r.mine, r.theirs])).toEqual([['Ravens', 'won', 5, 3], ['Wolves', 'lost', 2, 4], ['Bears', 'drawn', 1, 1]]);
    expect([s.wins, s.losses, s.draws]).toEqual([1, 1, 1]);
    expect(recordText(s)).toBe('1 won, 1 lost, 1 drawn');
  });
});

describe('statusLabel', () => {
  it('tells an on-deck fighter to go to the bullpen', () => {
    const s = statusLabel('on_deck', 0, 'Field 2');
    expect(s.label).toBe('You are on deck. Go to the bullpen');
    expect(s.tone).toBe('go');
    expect(s.detail).toContain('Field 2');
  });
  it('says fighting now for an active match', () => {
    expect(statusLabel('active', 0, 'Field 1').label).toBe('You are fighting now on Field 1');
    expect(statusLabel('active', 0, null).detail).toBe('Go to your field.');
  });
  it('shows matches ahead for the hole, and is honest when the position is unknown', () => {
    expect(statusLabel('in_the_hole', 3, 'Field 1').detail).toContain('3 matches ahead of you');
    expect(statusLabel('in_the_hole', null, null).detail).not.toMatch(/\d matches/);
  });
  it('does not invent a queue position for a scheduled match', () => {
    const s = statusLabel('scheduled', null, null);
    expect(s.tone).toBe('wait');
    expect(s.detail).toMatch(/not in the queue yet/);
  });
  it('words the ahead count', () => {
    expect([aheadText(0), aheadText(1), aheadText(4)]).toEqual(['You are up next', '1 match ahead of you', '4 matches ahead of you']);
  });
});

import { describe, expect, it } from 'vitest';
import type { EntrantCandidate } from '../data/entrants';
import { addedMessage, candidateContext, defaultEntryTeam, isLookAlikeRefusal, newEntrantProblem, sameNameCandidates } from './entrants';

const cand = (o: Partial<EntrantCandidate> = {}): EntrantCandidate => ({ fighterId: 'f1', name: 'Alex Existing', team: null, city: null, region: null, gender: null, claimed: false, inCompetition: false, inEvent: false, ...o });

describe('candidateContext', () => {
  it('joins team and place', () => expect(candidateContext(cand({ team: 'Team One', city: 'Calgary', region: 'AB' }))).toBe('Team One · Calgary, AB'));
  it('says so when nothing is known', () => expect(candidateContext(cand())).toBe('No team or location on record'));
  it('works with only a region', () => expect(candidateContext(cand({ region: 'ON' }))).toBe('ON'));
});

describe('sameNameCandidates', () => {
  const list = [cand({ fighterId: 'a', name: 'Alex Existing' }), cand({ fighterId: 'b', name: 'alex  existing' }), cand({ fighterId: 'c', name: 'Alex Other' })];
  it('matches regardless of case and spacing, never by partial name', () => expect(sameNameCandidates(list, ' ALEX existing ').map(c => c.fighterId)).toEqual(['a', 'b']));
  it('ignores a one-letter name', () => expect(sameNameCandidates(list, 'a')).toEqual([]));
});

describe('newEntrantProblem', () => {
  it('needs a name', () => expect(newEntrantProblem(' ')).toMatch(/name/));
  it('accepts a normal name', () => expect(newEntrantProblem('Zed Newcomer')).toBeNull());
  it('caps the length', () => expect(newEntrantProblem('x'.repeat(81))).toMatch(/80/));
});

describe('isLookAlikeRefusal', () => {
  it('recognises the database message', () => expect(isLookAlikeRefusal({ message: '2 fighter(s) named Zed already exist; pick one' })).toBe(true));
  it('ignores other errors', () => { expect(isLookAlikeRefusal({ message: 'permission denied' })).toBe(false); expect(isLookAlikeRefusal(null)).toBe(false); });
});

describe('defaultEntryTeam', () => {
  const entered = [{ id: 't2', name: 'Team Two' }];
  const all = [{ id: 't1', name: 'Team One' }, { id: 't2', name: 'Team Two' }];
  it('prefers the fighter\'s own team among entered teams', () => expect(defaultEntryTeam('team two', entered, all)).toBe('t2'));
  it('falls back to the fighter\'s team in the full list', () => expect(defaultEntryTeam('Team One', entered, all)).toBe('t1'));
  it('never guesses a different team', () => { expect(defaultEntryTeam(null, entered, all)).toBe(''); expect(defaultEntryTeam('Unknown FC', entered, all)).toBe(''); });
});

describe('addedMessage', () => {
  it('confirms an add', () => expect(addedMessage('Zed', false, false)).toBe('Zed is in.'));
  it('reminds about a draw that already exists', () => expect(addedMessage('Zed', false, true)).toMatch(/build a new draw/));
  it('says when nothing changed', () => expect(addedMessage('Zed', true, true)).toBe('Zed is already in this competition.'));
});

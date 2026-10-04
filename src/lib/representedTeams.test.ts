import { describe, expect, it } from 'vitest';
import { toRepresentedTeamRow } from '../data/matches';
import { basisLabel, correctionProblem, savedText } from './representedTeams';

describe('represented team wording', () => {
  it('says how the team is known', () => {
    expect(basisLabel('registration', true)).toBe('From their registration for this event');
    expect(basisLabel('team_at_entry', true)).toBe('Their team when they were entered');
    expect(basisLabel('recorded', true)).toBe('Recorded with the results');
    expect(basisLabel('correction', true)).toBe('Corrected by an organizer');
  });
  it('never presents a missing team as known', () => {
    expect(basisLabel(null, false)).toBe('No team recorded');
    expect(basisLabel('correction', false)).toBe('Set to no team by an organizer');
  });
  it('confirms that only this competition changed', () => {
    expect(savedText('Bob', 'Ankle Biters', 'Longsword men')).toBe("Saved. Bob's points in Longsword men now count for Ankle Biters. Their current team is unchanged.");
    expect(savedText('Bob', null, 'Longsword men')).toContain('now count for no team');
  });
});

describe('a correction needs a different team and a reason', () => {
  it('refuses the same team (including "no team" twice)', () => {
    expect(correctionProblem('ab', 'ab', 'a good reason')).toBe('Choose a different team.');
    expect(correctionProblem(null, '', 'a good reason')).toBe('Choose a different team.');
  });
  it('requires a reason of at least three characters', () => {
    expect(correctionProblem('ab', 'rdr', '  ')).toBe('Say why you are changing it.');
    expect(correctionProblem('ab', 'rdr', 'ok')).toBe('Say why you are changing it.');
  });
  it('allows a different team, or no team, with a reason', () => {
    expect(correctionProblem('ab', 'rdr', 'Checked the entry list')).toBeNull();
    expect(correctionProblem('ab', '', 'Fought independently')).toBeNull();
    expect(correctionProblem(null, 'ab', 'Confirmed by the captain')).toBeNull();
  });
});

describe('reading represented teams', () => {
  it('maps a row with the name the team had at the event', () => {
    expect(toRepresentedTeamRow({ id: 'e1', fighter_id: 'f1', status: 'checked_in', represented_team_id: 'ab', represented_team_name_at_event: 'Ankle Biters',
      represented_team_basis: 'registration', fighters: [{ display_name: 'Bob' }] }))
      .toEqual({ entryId: 'e1', fighterId: 'f1', fighterName: 'Bob', status: 'checked_in', teamId: 'ab', teamName: 'Ankle Biters', basis: 'registration' });
  });
  it('keeps "no team" as null rather than inventing one', () => {
    expect(toRepresentedTeamRow({ id: 'e2', fighter_id: 'f2', status: 'registered', represented_team_id: null, represented_team_name_at_event: null,
      represented_team_basis: null, fighters: { display_name: 'Mike' } })).toMatchObject({ teamId: null, teamName: null, basis: null });
  });
});

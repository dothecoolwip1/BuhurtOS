import { describe, expect, it } from 'vitest';
import { likelyDuplicates, mergeProblem, normalizeTeamName } from './teamMerge';

describe('normalizeTeamName', () => {
  it('ignores case, punctuation, spacing, accents and a leading "the"', () => {
    expect(normalizeTeamName('The Red-Deer Reavers')).toBe('reddeerreavers');
    expect(normalizeTeamName('red deer  reavers!')).toBe('reddeerreavers');
    expect(normalizeTeamName('Éire Wolves')).toBe('eirewolves');
  });
  it('gives an empty string for a name with no letters or digits', () => expect(normalizeTeamName('---')).toBe(''));
});

describe('likelyDuplicates', () => {
  it('groups teams whose names match once normalized', () => {
    const teams = [{ id: '1', name: 'Red Deer Reavers' }, { id: '2', name: 'red deer reavers ' }, { id: '3', name: 'Lone Wolves' }, { id: '4', name: 'The Lone Wolves' }, { id: '5', name: 'Solo' }];
    expect(likelyDuplicates(teams).map(g => g.map(t => t.id))).toEqual([['1', '2'], ['3', '4']]);
  });
  it('returns nothing when all names differ', () => expect(likelyDuplicates([{ id: '1', name: 'A1' }, { id: '2', name: 'B2' }])).toEqual([]));
});

describe('mergeProblem', () => {
  const ok = { id: 'a', status: 'approved' };
  it('needs both teams and two different ones', () => {
    expect(mergeProblem(undefined, ok)).toMatch(/Choose/);
    expect(mergeProblem(ok, ok)).toBe('Choose two different teams.');
  });
  it('will not keep a pending team over an approved one', () => {
    expect(mergeProblem({ id: 'p', status: 'pending' }, ok)).toMatch(/approved/);
    expect(mergeProblem(ok, { id: 'p', status: 'pending' })).toBeNull();
  });
});

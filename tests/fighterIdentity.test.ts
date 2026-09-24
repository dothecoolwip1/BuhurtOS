import { describe, expect, it } from 'vitest';
import { normalizeIdentityName, validateFighterPublicProfile } from '../src/lib/fighterIdentity';

describe('fighter identity helpers', () => {
  it('normalizes common fighter-name differences for duplicate review', () => {
    expect(normalizeIdentityName('  Björn  O’Neil ')).toBe('bjorn o neil');
    expect(normalizeIdentityName('BJORN---O NEIL')).toBe('bjorn o neil');
  });

  it('accepts a normal public fighter profile', () => {
    expect(validateFighterPublicProfile({
      displayName: 'Bob Mercer',
      nickname: 'Bob',
      bio: 'Armored combat fighter.',
      publicRegion: 'Central Alberta'
    })).toEqual([]);
  });

  it('rejects invalid public profile lengths before sending a mutation', () => {
    const errors = validateFighterPublicProfile({
      displayName: 'A',
      nickname: 'x'.repeat(121),
      bio: 'x'.repeat(2001),
      publicRegion: 'x'.repeat(161)
    });
    expect(errors).toHaveLength(4);
    expect(errors.join(' ')).toMatch(/Display name/);
  });
});

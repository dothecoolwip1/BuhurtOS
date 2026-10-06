import { describe, expect, it } from 'vitest';
import { savedCopyFits } from './useRules';
import type { RulesData } from '../../data/rules';

const copy = (viewer: string | null | undefined): RulesData => ({ documents: [], versions: [], provisions: [], loadedAt: '2026-10-06T00:00:00Z', ...(viewer === undefined ? {} : { viewer }) });

describe('the rules library saved in this browser', () => {
  it('is shown only to the account it was read for (the owner also reads versions in review; a visitor must never see them)', () => {
    expect(savedCopyFits(copy('owner-id'), 'owner-id')).toBe(true);
    expect(savedCopyFits(copy(null), null)).toBe(true);
    expect(savedCopyFits(copy('owner-id'), null)).toBe(false);          // the owner signed out on a shared tablet
    expect(savedCopyFits(copy(null), 'owner-id')).toBe(false);          // signed in: read again, with what this account may see
    expect(savedCopyFits(copy('someone-else'), 'owner-id')).toBe(false);
  });
  it('a copy saved before copies were stamped with their account is never trusted', () => {
    expect(savedCopyFits(copy(undefined), null)).toBe(false);
    expect(savedCopyFits(null, null)).toBe(false);
  });
});

import { expect, test } from 'vitest';
import {
  activeAffiliationsAt,
  findDuplicateFighterCandidates,
  normalizeFighterName,
  validateAffiliationWindow
} from '../src/lib/identityAdmin';
import type { FighterAffiliation, FoundationFighter } from '../src/types';

test('fighter identity normalization is stable', () => {
  expect(normalizeFighterName('  Sir Björn!!!  ')).toBe('sir bjorn');
  expect(normalizeFighterName('SIR   BJORN')).toBe('sir bjorn');
});

test('affiliation windows reject impossible history', () => {
  expect(validateAffiliationWindow('2026-03-01', '2026-02-28')).toContain('cannot be before');
  expect(validateAffiliationWindow('2026-03-01', '2026-03-01')).toBeNull();
  expect(validateAffiliationWindow('2026-03-01')).toBeNull();
});

test('current affiliation resolution preserves history', () => {
  const rows: FighterAffiliation[] = [
    { id: 'old', identityId: 'fighter', organizationId: 'org', affiliationType: 'member', startsOn: '2025-01-01', endsOn: '2025-12-31', isPrimary: true },
    { id: 'current', identityId: 'fighter', organizationId: 'org', affiliationType: 'mercenary', startsOn: '2026-01-01', isPrimary: true }
  ];
  expect(activeAffiliationsAt(rows, '2025-06-01').map(row => row.id)).toEqual(['old']);
  expect(activeAffiliationsAt(rows, '2026-06-01').map(row => row.id)).toEqual(['current']);
});

test('duplicate detection is organization scoped and ignores merged records', () => {
  const fighters: FoundationFighter[] = [
    { id: 'a', identityId: 'ia', organizationId: 'org', name: 'Björn Steel', preferredWeapons: [] },
    { id: 'b', identityId: 'ib', organizationId: 'org', name: 'Bjorn  Steel', preferredWeapons: [] },
    { id: 'c', identityId: 'ic', organizationId: 'other', name: 'Bjorn Steel', preferredWeapons: [] },
    { id: 'd', identityId: 'id', organizationId: 'org', name: 'Bjorn Steel', preferredWeapons: [], mergedIntoFighterId: 'a', deletedAt: '2026-01-01T00:00:00Z' }
  ];
  expect(findDuplicateFighterCandidates(fighters).map(pair => pair.map(row => row.id))).toEqual([['a', 'b']]);
});

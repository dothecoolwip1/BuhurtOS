import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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

test('Supabase migrations use CLI-compatible timestamp names and include foundation security', () => {
  const files = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql'));
  expect(files.length).toBeGreaterThanOrEqual(12);
  expect(files.every(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))).toBe(true);
  expect(files.some(name => /^00\d_/.test(name))).toBe(false);

  const migration = readFileSync('supabase/migrations/20260923223000_identity_foundation.sql', 'utf8');
  expect(migration).toContain('create table public.fighter_identities');
  expect(migration).toContain('create table public.fighter_affiliations');
  expect(migration).toContain('create table public.competition_divisions');
  expect(migration).toContain('create table public.event_divisions');
  expect(migration).toContain('alter table public.fighter_identities enable row level security');
  expect(migration).toContain('revoke all on function public.claim_temporary_fighter');
  expect(migration).toContain('revoke all on function public.merge_fighters');
  expect(migration).toContain('merged_into_fighter_id');
  expect(migration).toContain('deleted_at');
});

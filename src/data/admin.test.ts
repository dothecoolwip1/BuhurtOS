import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { adminMergeFighters, clampLimit, slugify, teamEditDiff, teamEditPayload, toAdminFighterRow, toAdminTeamRow, toTeamEditForm, validateFighterAdminPatch, validateTeamEdit } from './admin';

const teamDb = { id: 't', slug: 'iron-wolves', name: 'Iron Wolves', status: 'approved' as const, city: 'Red Deer', region: 'AB', country: 'CA', description: null, website: 'https://example.org',
  social_links: { instagram: 'https://instagram.com/w', bogus: 'x', x: 5 }, colors: ['#112233', '#FFFFFF'], crest_division: 'bend', initial: 'IW', founded_year: 2015, claimed_organizations: ['Fed'] };

describe('admin lists', () => {
  it('maps a team row including a disabled organization and the total', () => {
    const r = toAdminTeamRow({ team_id: 't', slug: 's', name: 'N', status: 'pending', city: null, region: null, country: null, logo_path: null, created_at: 'x', organization_id: 'o', organization_slug: 'org',
      organization_name: 'Org', organization_enabled: false, roster_count: '3', captain_count: 1, total_count: '12' });
    expect(r).toMatchObject({ status: 'pending', organization: { enabled: false }, rosterCount: 3, captainCount: 1, total: 12 });
    expect(toAdminTeamRow({ ...{ team_id: 't', slug: 's', name: 'N', status: 'approved' as const, city: null, region: null, country: null, logo_path: null, created_at: 'x' }, organization_id: null, organization_slug: null,
      organization_name: null, organization_enabled: null, roster_count: 0, captain_count: 0, total_count: 1 }).organization).toBeNull();
  });
  it('maps a fighter row (unclaimed flag, no account id)', () => {
    const r = toAdminFighterRow({ fighter_id: 'f', display_name: 'A', team_id: null, team_name: null, team_slug: null, claimed: false, city: null, region: null, country: null, photo_path: null,
      profile_public: true, created_at: 'x', total_count: 7 });
    expect(r).toMatchObject({ claimed: false, total: 7, teamId: null });
    expect(Object.keys(r).some(k => /user|account|email/i.test(k))).toBe(false);
  });
  it('clamps the page size', () => {
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(1000)).toBe(200);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(25.9)).toBe(25);
  });
});

describe('team edit', () => {
  it('round trips a team through the form (unknown social networks dropped)', () => {
    const f = toTeamEditForm(teamDb);
    expect(f.socialLinks).toEqual({ instagram: 'https://instagram.com/w' });
    expect(validateTeamEdit(f)).toEqual({});
    expect(teamEditPayload(f)).toMatchObject({ name: 'Iron Wolves', slug: 'iron-wolves', colors: ['#112233', '#FFFFFF'], founded_year: 2015, description: null, status: 'approved', claimed_organizations: ['Fed'] });
  });
  it('validates like the database', () => {
    const f = toTeamEditForm(teamDb);
    const bad = { ...f, name: 'x', slug: 'Bad Slug', website: 'http://x.org', colors: ['red', '#112233'] as [string, string], crestDivision: 'star', initial: 'ABC', foundedYear: '1850',
      claimedOrganizations: ['a'], socialLinks: { x: 'http://x' }, description: 'd'.repeat(501), city: 'c'.repeat(81) };
    expect(Object.keys(validateTeamEdit(bad, new Date('2026-06-01'))).sort()).toEqual(['city', 'claimedOrganizations', 'colors', 'crestDivision', 'description', 'foundedYear', 'initial', 'name', 'slug', 'socialLinks', 'website']);
  });
  it('diffs only the changed fields', () => {
    const a = toTeamEditForm(teamDb);
    expect(teamEditDiff(a, a)).toEqual({});
    expect(teamEditDiff(a, { ...a, city: 'Calgary', status: 'pending' })).toEqual({ city: 'Calgary', status: 'pending' });
  });
  it('slugifies', () => { expect(slugify('Iron Wolves of Red Deer!')).toBe('iron-wolves-of-red-deer'); });
});

describe('fighter edit', () => {
  it('validates the admin keys', () => {
    expect(validateFighterAdminPatch({ display_name: 'Alice', team_id: null })).toEqual({});
    expect(validateFighterAdminPatch({ display_name: 'A', team_id: 'nope' })).toEqual({ display_name: '2 to 80 characters.', team_id: 'Pick a team.' });
    expect(validateFighterAdminPatch({ city: 'x' })).toEqual({});
  });
  it('refuses to merge a fighter into itself before calling the database', async () => {
    await expect(adminMergeFighters('a', 'a')).rejects.toThrow(/different/);
  });
});

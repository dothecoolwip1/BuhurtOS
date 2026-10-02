import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import type { DirectoryEntry } from './teamDirectory';
import { teamEditPayload, teamToForm, validateTeamEdit } from './teamEdit';

const team = {
  id: 't', slug: 's', name: 'Reavers', city: 'Red Deer', region: 'AB', country: 'CA', status: 'approved', colors: ['#2C4A8C', '#E9ECEF'], crestDivision: 'pale', initial: 'R', emblemPath: null,
  description: null, website: null, socialLinks: {}, foundedYear: null, claimedOrganizations: [], affiliations: [], sources: []
} as DirectoryEntry;

describe('team edit form', () => {
  it('starts from the team as it is and is valid', () => { expect(validateTeamEdit(teamToForm(team), false)).toEqual({}); });
  it('sends empty optional fields as null so they are cleared, and the name only for those who may rename', () => {
    const f = { ...teamToForm(team), region: '', website: ' ', foundedYear: '' };
    const p = teamEditPayload(f, false);
    expect(p).toMatchObject({ region: null, website: null, description: null, founded_year: null, city: 'Red Deer' });
    expect('name' in p).toBe(false);
    expect(teamEditPayload(f, true).name).toBe('Reavers');
  });
  it('flags a short description, a non-https website and a bad year', () => {
    const e = validateTeamEdit({ ...teamToForm(team), description: 'short', website: 'http://x.com', foundedYear: '1850' }, false, new Date('2026-10-02'));
    expect(Object.keys(e).sort()).toEqual(['description', 'foundedYear', 'website']);
  });
  it('requires city and country, and a name only when it can be changed', () => {
    const f = { ...teamToForm(team), name: '', city: '', country: '' };
    expect(Object.keys(validateTeamEdit(f, false)).sort()).toEqual(['city', 'country']);
    expect(Object.keys(validateTeamEdit(f, true)).sort()).toEqual(['city', 'country', 'name']);
  });
});

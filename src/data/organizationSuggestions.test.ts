import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { approveFormFrom, approvePayload, emptySuggestion, orgSlug, SLUG_RE, statusText, suggestionPayload, toAdminSuggestion, validateSuggestion } from './organizationSuggestions';
import { notificationText } from './teamManager';
import { notificationLink } from '../lib/notificationView';

describe('suggest an organization: the form', () => {
  it('needs a name and nothing else', () => {
    expect(validateSuggestion(emptySuggestion()).name).toBeTruthy();
    expect(validateSuggestion({ ...emptySuggestion(), name: 'Prairie Buhurt League' })).toEqual({});
  });
  it('checks the same limits as the database', () => {
    const e = validateSuggestion({ ...emptySuggestion(), name: 'x'.repeat(121), shortName: 'P', website: 'not a site', description: 'd'.repeat(1001) });
    expect(Object.keys(e).sort()).toEqual(['description', 'name', 'shortName', 'website']);
  });
  it('accepts a website typed without https://', () => {
    expect(validateSuggestion({ ...emptySuggestion(), name: 'PBL', website: 'prairiebuhurt.ca' }).website).toBeUndefined();
    expect(validateSuggestion({ ...emptySuggestion(), name: 'PBL', website: 'https://instagram.com/pbl' }).website).toBeUndefined();
  });
  it('sends trimmed fields and leaves blanks out', () => {
    expect(suggestionPayload({ ...emptySuggestion(), name: '  Prairie Buhurt League ', country: ' Canada', note: '   ' }))
      .toEqual({ name: 'Prairie Buhurt League', country: 'Canada', kind: 'club', involvement: 'none' });
  });
  it('plain status words', () => {
    expect([statusText('pending'), statusText('approved'), statusText('declined')]).toEqual(['Waiting for review', 'Added', 'Not added']);
  });
});

describe('suggest an organization: the owner review', () => {
  const row = toAdminSuggestion({ id: 's1', created_at: 'c', person_name: 'Ana', email: 'ana@example.test', name: 'Prairie Buhurt League', short_name: 'PBL', kind: 'regional',
    country: 'Canada', region: null, website: null, description: null, involvement: 'admin', note: null, status: 'pending', decided_at: null, decision_note: null, organization_slug: null });
  it('starts from the suggestion, with the web address from the short name and admin ticked when they run it', () => {
    expect(approveFormFrom(row)).toMatchObject({ name: 'Prairie Buhurt League', slug: 'pbl', kind: 'regional', country: 'Canada', region: '', makeAdmin: true });
    expect(approveFormFrom({ ...row, shortName: null, involvement: 'member' })).toMatchObject({ slug: 'prairie-buhurt-league', makeAdmin: false });
  });
  it('makes web addresses the database accepts', () => {
    for (const n of ['Société d’Armes de Québec', '  --Steel & Iron--  ', 'A'.repeat(80)]) expect(orgSlug(n)).toMatch(SLUG_RE);
    expect(orgSlug('Société d’Armes de Québec')).toBe('societe-d-armes-de-quebec');
  });
  it('sends every field so the owner can clear one', () => {
    expect(approvePayload({ ...approveFormFrom(row), shortName: '  ' })).toMatchObject({ short_name: '', region: '', slug: 'pbl' });
  });
});

describe('suggest an organization: notifications', () => {
  it('the owner hears about a new suggestion and lands on the review list', () => {
    const n = { kind: 'organization_suggested' as const, payload: { organization_name: 'Prairie Buhurt League' } };
    expect(notificationText(n)).toBe('New organization suggested: Prairie Buhurt League.');
    expect(notificationLink(n)).toBe('/platform/organizations');
  });
  it('the person who suggested it hears the outcome', () => {
    const yes = { kind: 'organization_suggestion_decided' as const, payload: { decision: 'approved', organization_name: 'PBL', organization_slug: 'pbl', admin: true } };
    expect(notificationText(yes)).toBe('PBL is now listed on BuhurtOS, and you are one of its admins.');
    expect(notificationLink(yes)).toBe('/organizations/pbl');
    const no = { kind: 'organization_suggestion_decided' as const, payload: { decision: 'declined', organization_name: 'Lone Club' } };
    expect(notificationText(no)).toBe('Lone Club was not added.');
    expect(notificationLink(no)).toBe('/organizations');
  });
});

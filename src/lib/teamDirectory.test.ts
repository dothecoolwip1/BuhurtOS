import { describe, expect, it } from 'vitest';
import { adoptionLabel, affiliationOptions, filterTeams, listedFromLabel, locationText, matchesQuery, ordinal, safeHttpsUrl, sinceLabel, summarizeResults, type DirectoryTeam } from './teamDirectory';

const hacsa = { organizationSlug: 'hacsa', organizationName: 'HACSA' };
const teams: DirectoryTeam[] = [
  { name: 'Red Deer Reavers', city: 'Red Deer', region: 'AB', country: 'CA', affiliations: [hacsa] },
  { name: 'Vanguard', city: 'Vancouver', region: 'BC', country: 'CA', affiliations: [hacsa] },
  { name: 'Montréal Wolves', city: 'Montréal', region: null, country: 'CA', affiliations: [] }
];

describe('search and filter', () => {
  it('empty query matches all', () => expect(filterTeams(teams, '', '')).toHaveLength(3));
  it('matches name, city and region, ignoring case and accents', () => {
    expect(filterTeams(teams, 'reavers', '').map(t => t.name)).toEqual(['Red Deer Reavers']);
    expect(filterTeams(teams, 'vancouver', '').map(t => t.name)).toEqual(['Vanguard']);
    expect(filterTeams(teams, 'bc', '').map(t => t.name)).toEqual(['Vanguard']);
    expect(filterTeams(teams, 'MONTREAL', '').map(t => t.name)).toEqual(['Montréal Wolves']);
  });
  it('every word must match', () => {
    expect(matchesQuery(teams[0], 'red ab')).toBe(true);
    expect(matchesQuery(teams[0], 'red bc')).toBe(false);
  });
  it('filters by recorded affiliation only', () => {
    expect(filterTeams(teams, '', 'hacsa')).toHaveLength(2);
    expect(filterTeams(teams, '', 'imcf')).toHaveLength(0);
  });
  it('lists each organization once', () => expect(affiliationOptions(teams)).toEqual([hacsa]));
});

describe('labels', () => {
  it('joins location parts and skips empty ones', () => {
    expect(locationText(teams[0])).toBe('Red Deer, AB, CA');
    expect(locationText(teams[2])).toBe('Montréal, CA');
    expect(locationText({ city: null, region: null, country: ' ' })).toBe('');
  });
  it('names the source and its status', () => {
    expect(listedFromLabel({ title: 'HACSA website: Teams list', status: 'imported' })).toBe('Listed from HACSA website: Teams list (imported)');
  });
  it('shows nothing about adoption when it is unknown', () => {
    expect(adoptionLabel(null)).toBeNull();
    expect(adoptionLabel(true)).toBe('On BuhurtOS');
    expect(adoptionLabel(false)).toBe('Team has not joined BuhurtOS');
  });
  it('since label', () => {
    expect(sinceLabel('2024-03-09')).toBe('Since Mar 2024');
    expect(sinceLabel(null)).toBeNull();
    expect(sinceLabel('nonsense')).toBeNull();
  });
  it('ordinals', () => expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']));
  it('only https links', () => {
    expect(safeHttpsUrl('https://a.example')).toBe('https://a.example');
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });
});

describe('summarizeResults', () => {
  const row = (over = {}) => ({ eventName: 'E', eventSlug: 'e', startsOn: '2026-01-01', competitionName: 'C', finalPlace: 1 as number | null, points: null, ...over });
  it('is null with no results, never invented', () => {
    expect(summarizeResults([])).toBeNull();
    expect(summarizeResults([row({ finalPlace: null })])).toBeNull();
  });
  it('counts only placed rows', () => {
    expect(summarizeResults([row(), row({ eventSlug: 'f', finalPlace: 5 }), row({ finalPlace: null })])).toEqual({ competitions: 2, events: 2, podiums: 1, bestPlace: 1 });
  });
});

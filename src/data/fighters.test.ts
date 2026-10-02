import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import {
  ageFromBirthYear, applyRankingFilter, emptyProfileForm, fitWithin, parseRecentForm, placeLabel, profilePayload, profileToForm, rosterPayload, toEntryRosterRow, toFighterCareerStats,
  toFighterMatchStats, toFighterProfile, toFighterRanking, toResultRow, toTeamRanking, toTeamStats, validateProfile
} from './fighters';

const profileDb = {
  fighter_id: 'f', display_name: 'Alpha', gender: 'male' as const, birth_year: 1990, age: 36, city: 'Edmonton', region: 'AB', country: 'CA', joined_year: 2019,
  disciplines: ['longsword'], fighting_style: 'x', bio: 'b', highlights: ['h'], team_id: 't', team_name: 'T', team_slug: 't-s',
  team_organization_id: 'o', team_organization_slug: 'nacl-test', team_organization_name: 'NACL-test', team_organization_enabled: false
};

describe('profile', () => {
  it('maps the public profile with team and organization (and the inactive flag)', () => {
    const p = toFighterProfile(profileDb);
    expect(p).toMatchObject({ fighterId: 'f', age: 36, disciplines: ['longsword'], team: { slug: 't-s' }, organization: { slug: 'nacl-test', enabled: false } });
  });
  it('handles a fighter without team, organization, lists or birth year', () => {
    const p = toFighterProfile({ ...profileDb, birth_year: null, age: null, disciplines: null, highlights: null, team_id: null, team_name: null, team_slug: null,
      team_organization_id: null, team_organization_slug: null, team_organization_name: null, team_organization_enabled: null });
    expect(p).toMatchObject({ birthYear: null, age: null, disciplines: [], highlights: [], team: null, organization: null });
  });
  it('computes an age only when a birth year exists', () => {
    expect(ageFromBirthYear(null)).toBeNull();
    expect(ageFromBirthYear(1990, new Date('2026-06-01'))).toBe(36);
  });
  it('round trips a profile through the form and the payload (empty fields clear)', () => {
    const f = profileToForm(toFighterProfile(profileDb));
    expect(profilePayload(f)).toMatchObject({ gender: 'male', birth_year: 1990, city: 'Edmonton', joined_year: 2019, disciplines: ['longsword'], highlights: ['h'] });
    expect(profilePayload(emptyProfileForm())).toEqual({ gender: null, birth_year: null, city: null, region: null, country: null, joined_year: null, disciplines: [], fighting_style: null, bio: null, highlights: [] });
  });
  it('validates with the database limits', () => {
    const now = new Date('2026-06-01');
    expect(validateProfile(emptyProfileForm(), now)).toEqual({});
    const bad = { ...emptyProfileForm(), birthYear: '1850', joinedYear: '20x9', bio: 'b'.repeat(1501), city: 'c'.repeat(81), highlights: Array.from({ length: 11 }, (_, i) => `h${i}`), disciplines: ['longsword', 'longsword'] };
    expect(Object.keys(validateProfile(bad, now)).sort()).toEqual(['bio', 'birthYear', 'city', 'disciplines', 'highlights', 'joinedYear']);
    expect(validateProfile({ ...emptyProfileForm(), birthYear: '2999' }, now).birthYear).toBeDefined();
    expect(validateProfile({ ...emptyProfileForm(), bio: 'b'.repeat(1500) }, now)).toEqual({});
  });
});

describe('statistics mappers', () => {
  it('turns bigint and numeric strings into numbers and keeps a null win rate', () => {
    const c = toFighterCareerStats({ fighter_id: 'f', display_name: 'A', events_attended: '2', matches: '11', wins: '9', losses: '2', draws: '0', win_pct: '81.8', golds: '3', silvers: '1', bronzes: '0', podiums: '4', tournament_victories: '3', points: '35.00' });
    expect(c).toMatchObject({ eventsAttended: 2, matches: 11, winPct: 81.8, podiums: 4, points: 35 });
    expect(toFighterCareerStats({ fighter_id: 'f', display_name: 'A', events_attended: 0, matches: 0, wins: 0, losses: 0, draws: 0, win_pct: null, golds: 0, silvers: 0, bronzes: 0, podiums: 0, tournament_victories: 0, points: 0 }).winPct).toBeNull();
  });
  it('maps match stats', () => {
    expect(toFighterMatchStats({ fighter_id: 'f', display_name: 'A', organization_id: null, season_id: 's', category: 'longsword', gender: 'open', matches: '2', wins: '2', losses: '0', draws: '0', rounds_won: '10', rounds_lost: '5', points_for: '10', points_against: '5' }))
      .toMatchObject({ seasonId: 's', roundsWon: 10, roundsLost: 5, pointsFor: 10 });
  });
  it('maps team stats and the recent form string (most recent first)', () => {
    expect(parseRecentForm('WWLDW')).toEqual(['W', 'W', 'L', 'D', 'W']);
    expect(parseRecentForm(null)).toEqual([]);
    expect(parseRecentForm('WxL')).toEqual(['W', 'L']);
    const t = toTeamStats({ team_id: 't', team_name: 'T', team_slug: 's', events: '1', matches: '1', matches_5v5: '1', matches_3v3: '0', matches_other: '0', wins: '1', losses: '0', draws: '0', win_pct: '100.0',
      golds: '1', silvers: '0', bronzes: '0', podiums: '1', tournament_wins: '1', points: '7.00', recent_form: 'W' });
    expect(t).toMatchObject({ matches5v5: 1, winPct: 100, tournamentWins: 1, points: 7, recentForm: ['W'] });
  });
  it('maps result history rows', () => {
    const r = toResultRow({ competition_id: 'c', competition_name: 'Longsword', category: 'longsword', gender: 'open', tier: null, event_id: 'e', event_slug: 'nt-past', event_name: 'Past', event_type: 'tournament',
      starts_on: '2026-01-01', event_ends_on: '2026-01-02', season_id: null, organization_id: 'o', final_place: 1, points: '7.50' });
    expect(r).toMatchObject({ tier: null, endsOn: '2026-01-02', finalPlace: 1, points: 7.5 });
    expect([1, 2, 3, 5].map(placeLabel)).toEqual(['Gold', 'Silver', 'Bronze', '5th']);
  });
});

describe('rankings', () => {
  const base = { scope: 'org_all' as const, organization_id: 'o', season_id: null, category: null, gender: null, competitions: '3', golds: '1', silvers: '0', bronzes: '1', points: '13.00', rank: '1' };
  it('maps fighter and team rows', () => {
    expect(toFighterRanking({ ...base, fighter_id: 'f', display_name: 'A' })).toMatchObject({ subjectId: 'f', name: 'A', slug: null, points: 13, rank: 1, competitions: 3 });
    expect(toTeamRanking({ ...base, team_id: 't', team_name: 'T', team_slug: 's' })).toMatchObject({ subjectId: 't', slug: 's' });
  });
  it('filters by scope and matches unset dimensions as NULL', () => {
    const calls: string[] = [];
    const q = { eq(c: string, v: unknown) { calls.push(`eq ${c}=${String(v)}`); return q; }, is(c: string) { calls.push(`is ${c} null`); return q; } };
    applyRankingFilter(q, { scope: 'season', organizationId: 'o', seasonId: 's', category: 'longsword', gender: 'open' });
    applyRankingFilter(q, { scope: 'career' });
    expect(calls).toEqual(['eq scope=season', 'eq organization_id=o', 'eq season_id=s', 'eq category=longsword', 'eq gender=open',
      'eq scope=career', 'is organization_id null', 'is season_id null', 'is category null', 'is gender null']);
  });
});

describe('rosters', () => {
  it('maps a roster row with the permanent team of a mercenary', () => {
    expect(toEntryRosterRow({ entry_id: 'e', fighter_id: 'f', display_name: 'C', role: 'mercenary', permanent_team_id: 't', permanent_team_name: 'NT Two', permanent_team_slug: 'nt-two' }))
      .toMatchObject({ role: 'mercenary', permanentTeamName: 'NT Two' });
  });
  it('sends the role only when one was chosen', () => {
    expect(rosterPayload([{ fighterId: 'a' }, { fighterId: 'b', role: 'guest' }])).toEqual([{ fighter_id: 'a' }, { fighter_id: 'b', role: 'guest' }]);
  });
});

describe('fitWithin', () => {
  it('scales the longer side down to the limit and keeps the shape', () => {
    expect(fitWithin(4000, 3000, 512)).toEqual({ width: 512, height: 384 });
    expect(fitWithin(3000, 4000, 512)).toEqual({ width: 384, height: 512 });
  });
  it('never scales a small picture up', () => { expect(fitWithin(200, 100, 512)).toEqual({ width: 200, height: 100 }); });
});

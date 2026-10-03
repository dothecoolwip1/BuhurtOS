import { describe, expect, it } from 'vitest';
import type { FighterMatchStats, FighterSeasonStats, ResultRow } from '../data/fighters';
import {
  attendanceTotals, buildRankingFilter, categoryLabel, categoryLines, categoryRecords, currentSeasonStats, defaultOrganization, entriesByTeam, escapeLike, eventPhase, formString,
  formatRecord, guestLabel, medalOf, medalTable, membershipSpan, notPast, pageInfo, parsePage, pastEvents, rosterGroups, scopeUses, seasonsOf, sortFights, sortFighterRankings,
  sumMatchStats, todayIso, tournamentHistory, winPctText, type EventLike, type SeasonInfo
} from './careerView';

const res = (o: Partial<ResultRow>): ResultRow => ({ competitionId: 'c', competitionName: 'Open 5v5', category: '5v5', gender: 'men', tier: null, eventId: 'e1', eventSlug: 'e-1', eventName: 'E1',
  eventType: 'tournament', startsOn: '2026-05-01', endsOn: '2026-05-02', seasonId: null, organizationId: null, finalPlace: 1, points: 10, ...o });
const ms = (o: Partial<FighterMatchStats>): FighterMatchStats => ({ fighterId: 'f', displayName: 'F', organizationId: null, seasonId: null, category: '5v5', gender: 'men', matches: 4, wins: 3, losses: 1, draws: 0,
  roundsWon: 9, roundsLost: 4, pointsFor: 9, pointsAgainst: 4, ...o });

describe('labels and formatting', () => {
  it('names categories, falling back to a readable code', () => {
    expect(categoryLabel('sword_shield')).toBe('Sword and shield');
    expect(categoryLabel('new_thing')).toBe('new thing');
    expect(categoryLabel(null)).toBe('All categories');
  });
  it('shows medals only for places 1 to 3', () => { expect(medalOf(1)).toBe('gold'); expect(medalOf(3)).toBe('bronze'); expect(medalOf(4)).toBeNull(); });
  it('formats records and win rate without inventing a rate', () => {
    expect(formatRecord(5, 2, 0)).toBe('5-2'); expect(formatRecord(5, 2, 1)).toBe('5-2-1');
    expect(winPctText(null)).toBe('No matches yet'); expect(winPctText(75)).toBe('75%'); expect(winPctText(66.7)).toBe('66.7%');
  });
  it('labels a guest appearance', () => { expect(guestLabel('Iron Wolves')).toBe('Guest for Iron Wolves'); });
});

describe('paging and search', () => {
  it('clamps pages and counts ranges', () => {
    expect(pageInfo(0, 1)).toMatchObject({ pages: 1, from: 0, to: 0 });
    expect(pageInfo(50, 2, 24)).toMatchObject({ page: 2, pages: 3, from: 25, to: 48 });
    expect(pageInfo(50, 99, 24).page).toBe(3);
    expect(parsePage('0')).toBe(1); expect(parsePage('x')).toBe(1); expect(parsePage('4')).toBe(4); expect(parsePage(null)).toBe(1);
  });
  it('escapes LIKE wildcards', () => { expect(escapeLike(' 50%_a\\ ')).toBe('50\\%\\_a\\\\'); });
});

describe('dates', () => {
  it('classifies events', () => {
    expect(eventPhase('2026-05-01', '2026-05-02', '2026-10-01')).toBe('past');
    expect(eventPhase('2026-10-01', '2026-10-02', '2026-10-01')).toBe('current');
    expect(eventPhase('2026-11-01', '2026-11-02', '2026-10-01')).toBe('upcoming');
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('fighter stats', () => {
  it('sums match stats across organizations and seasons', () => {
    expect(sumMatchStats([ms({}), ms({ category: 'longsword', matches: 2, wins: 0, losses: 2, roundsWon: 1, roundsLost: 4, pointsFor: 5, pointsAgainst: 9 })]))
      .toMatchObject({ matches: 6, wins: 3, losses: 3, roundsWon: 10, roundsLost: 8, pointsFor: 14, pointsAgainst: 13 });
    expect(sumMatchStats([]).matches).toBe(0);
  });
  it('builds one line per category and division from results and matches', () => {
    const lines = categoryLines([res({}), res({ eventId: 'e2', finalPlace: 3 }), res({ category: 'longsword', gender: 'open', finalPlace: 2 })], [ms({}), ms({ seasonId: 's', matches: 1, wins: 1, losses: 0 })]);
    expect(lines.find(l => l.key === '5v5:men')).toMatchObject({ competitions: 2, golds: 1, bronzes: 1, bestPlace: 1, matches: 5, wins: 4, losses: 1 });
    expect(lines.find(l => l.key === 'longsword:open')).toMatchObject({ silvers: 1, matches: 0 });
    expect(categoryLines([], [])).toEqual([]);
  });
  it('groups tournaments by event, newest first, best placing first', () => {
    const t = tournamentHistory([res({ eventId: 'a', endsOn: '2026-03-02', finalPlace: 4, competitionName: 'B' }), res({ eventId: 'b', endsOn: '2026-06-02', finalPlace: 2 }), res({ eventId: 'b', endsOn: '2026-06-02', finalPlace: 1, competitionName: 'A' })]);
    expect(t).toHaveLength(2);
    expect(t[0].endsOn).toBe('2026-06-02');
    expect(t[0].placements.map(p => p.place)).toEqual([1, 2]);
    expect(t[0].placements[0].medal).toBe('gold');
    expect(t[1].placements[0].medal).toBeNull();
  });
  it('orders fights newest first and makes a form strip', () => {
    const rows = sortFights([
      { matchId: 'a', endsOn: '2026-01-01', finalizedAt: null, outcome: 'loss' as const }, { matchId: 'b', endsOn: '2026-05-01', finalizedAt: '2026-05-01T10:00', outcome: 'win' as const },
      { matchId: 'c', endsOn: '2026-05-01', finalizedAt: '2026-05-01T12:00', outcome: 'draw' as const }
    ]);
    expect(rows.map(r => r.matchId)).toEqual(['c', 'b', 'a']);
    expect(formString(rows, 2)).toEqual(['D', 'W']);
  });
});

describe('current season', () => {
  const seasons: SeasonInfo[] = [
    { id: 's1', name: '2025', slug: '2025', organizationId: 'o', startsOn: '2025-01-01', endsOn: '2025-12-31' },
    { id: 's2', name: '2026', slug: '2026', organizationId: 'o', startsOn: '2026-01-01', endsOn: '2026-12-31' }
  ];
  const st = (seasonId: string): FighterSeasonStats => ({ fighterId: 'f', displayName: 'F', seasonId, organizationId: 'o', eventsAttended: 1, matches: 1, wins: 1, losses: 0, draws: 0, golds: 0, silvers: 0, bronzes: 0, podiums: 0, points: 0 });
  it('prefers a running season', () => {
    const r = currentSeasonStats([st('s1'), st('s2')], seasons, '2026-10-01');
    expect(r.current).toBe(true); expect(r.rows.map(x => x.season.id)).toEqual(['s2']);
  });
  it('falls back to the latest season that has stats, and says so', () => {
    const r = currentSeasonStats([st('s1')], seasons, '2026-10-01');
    expect(r.current).toBe(false); expect(r.rows.map(x => x.season.id)).toEqual(['s1']);
    expect(currentSeasonStats([], seasons, '2026-10-01').rows).toEqual([]);
  });
  it('lists an organization seasons newest first', () => { expect(seasonsOf(seasons, 'o').map(s => s.id)).toEqual(['s2', 's1']); expect(seasonsOf(seasons, 'x')).toEqual([]); });
});

describe('rankings', () => {
  const base = { scope: 'season' as const, organizationId: 'o', seasonId: 's', category: '5v5', gender: 'men' as const };
  it('builds each scope filter and says what is missing', () => {
    expect(buildRankingFilter(base).filter).toEqual({ scope: 'season', organizationId: 'o', seasonId: 's', category: '5v5', gender: 'men' });
    expect(buildRankingFilter({ ...base, scope: 'org_career' }).filter).toEqual({ scope: 'org_career', organizationId: 'o', category: '5v5', gender: 'men' });
    expect(buildRankingFilter({ ...base, scope: 'org_all' }).filter).toEqual({ scope: 'org_all', organizationId: 'o' });
    expect(buildRankingFilter({ ...base, scope: 'career', organizationId: '' }).filter).toEqual({ scope: 'career' });
    expect(buildRankingFilter({ ...base, organizationId: '' }).missing).toMatch(/organization/);
    expect(buildRankingFilter({ ...base, seasonId: '' }).missing).toMatch(/season/);
    expect(buildRankingFilter({ ...base, category: '' }).missing).toMatch(/category/);
    expect(buildRankingFilter({ ...base, gender: '' }).missing).toMatch(/division/);
  });
  it('knows which boxes a scope uses', () => {
    expect(scopeUses('season')).toEqual({ organization: true, season: true, category: true, division: true });
    expect(scopeUses('org_all')).toEqual({ organization: true, season: false, category: false, division: false });
    expect(scopeUses('career').organization).toBe(false);
  });
  it('defaults to the first active organization', () => {
    const o = (id: string, enabled: boolean) => ({ id, slug: id, name: id, shortName: null, enabled });
    expect(defaultOrganization([o('a', false), o('b', true)])?.id).toBe('b');
    expect(defaultOrganization([o('a', false)])?.id).toBe('a');
    expect(defaultOrganization([])).toBeUndefined();
  });
  it('sorts a fighter rankings: season first, then best rank', () => {
    const r = (scope: 'season' | 'org_all' | 'career', rank: number, category: string | null = null) => ({ scope, organizationId: 'o', seasonId: null, category, gender: null, subjectId: 'f', name: 'F', slug: null, competitions: 1, golds: 0, silvers: 0, bronzes: 0, points: 0, rank });
    expect(sortFighterRankings([r('career', 1), r('season', 3, '5v5'), r('season', 1, '3v3'), r('org_all', 2)]).map(x => `${x.scope}${x.rank}`)).toEqual(['season1', 'season3', 'org_all2', 'career1']);
  });
});

describe('teams and events', () => {
  it('groups a roster by gender and keeps people with no gender apart', () => {
    const g = rosterGroups([{ fighterId: '1', displayName: 'Zed', gender: 'male' }, { fighterId: '2', displayName: 'Amy', gender: 'female' }, { fighterId: '3', displayName: 'Bo', gender: 'male' }, { fighterId: '4', displayName: 'Cy', gender: null }]);
    expect(g.male.map(p => p.displayName)).toEqual(['Bo', 'Zed']); expect(g.female).toHaveLength(1); expect(g.unspecified).toHaveLength(1); expect(g.other).toHaveLength(0);
  });
  it('builds a medal table by team, ignoring places beyond third', () => {
    const row = (entryId: string, teamId: string | null, finalPlace: number) => ({ competitionId: 'c', competitionName: 'C', category: '5v5', gender: 'men' as const, entryId, finalPlace, points: 0, teamId, fighterId: null });
    const t = medalTable([row('1', 'a', 1), row('2', 'b', 2), row('3', 'b', 3), row('4', 'c', 4), row('5', 'a', 3)], r => (r.teamId ?? '?').toUpperCase());
    expect(t.map(x => [x.name, x.golds, x.silvers, x.bronzes, x.total])).toEqual([['A', 1, 0, 1, 2], ['B', 0, 1, 1, 2]]);
  });
  it('counts attendance once per fighter and drops withdrawn entries', () => {
    const e = (entryId: string, teamId: string | null, status = 'registered') => ({ entryId, competitionId: 'c', teamId, fighterId: null, status });
    const entries = [e('1', 't1'), e('2', 't1'), e('3', 't2', 'withdrawn'), e('4', null)];
    const parts = [{ fighterId: 'x', entryId: '1' }, { fighterId: 'x', entryId: '2' }, { fighterId: 'y', entryId: '3' }, { fighterId: 'z', entryId: '4' }];
    expect(attendanceTotals(entries, parts)).toEqual({ entries: 3, teams: 1, fighters: 2 });
    expect(entriesByTeam(entries, new Map([['t1', 'Wolves']]))).toEqual([{ teamId: 't1', name: 'Wolves', entries: 2 }]);
    expect(attendanceTotals([], [])).toEqual({ entries: 0, teams: 0, fighters: 0 });
  });
  it('lists past published events by season, organization and province', () => {
    const ev = (o: Partial<EventLike>): EventLike => ({ id: 'i', slug: 's', name: 'N', startsOn: '2026-05-01', endsOn: '2026-05-02', status: 'published', region: 'AB', organizationId: 'o', seasonId: 'x', ...o });
    const all = [ev({ id: '1', endsOn: '2026-04-01' }), ev({ id: '2', endsOn: '2026-06-01', region: 'BC' }), ev({ id: '3', status: 'draft' }), ev({ id: '4', status: 'cancelled' }), ev({ id: '5', endsOn: '2026-12-01' }), ev({ id: '6', organizationId: 'p', endsOn: '2026-02-01' })];
    const none = { seasonId: '', organizationId: '', region: '' };
    expect(pastEvents(all, '2026-10-01', none).map(e => e.id)).toEqual(['2', '1', '6']);
    expect(pastEvents(all, '2026-10-01', { ...none, region: 'BC' }).map(e => e.id)).toEqual(['2']);
    expect(pastEvents(all, '2026-10-01', { ...none, organizationId: 'p' }).map(e => e.id)).toEqual(['6']);
    expect(pastEvents(all, '2026-10-01', { ...none, seasonId: 'nope' })).toEqual([]);
    expect(notPast(all, '2026-10-01').map(e => e.id)).toEqual(['3', '4', '5']);
  });
  it('summarizes membership spans by year', () => {
    expect(membershipSpan({ fromDate: '2022-03-01', toDate: '2024-01-01' })).toBe('2022 to 2024');
    expect(membershipSpan({ fromDate: '2022-03-01', toDate: null })).toBe('Since 2022');
    expect(membershipSpan({ fromDate: null, toDate: null })).toBe('');
  });
  it('makes W-L-D per category', () => {
    expect(categoryRecords([{ category: '5v5', outcome: 'win' }, { category: '5v5', outcome: 'loss' }, { category: '3v3', outcome: 'draw' }, { category: '5v5', outcome: 'win' }]))
      .toEqual([{ category: '5v5', matches: 3, wins: 2, losses: 1, draws: 0 }, { category: '3v3', matches: 1, wins: 0, losses: 0, draws: 1 }]);
  });
});

import { playedAsName } from './careerView';
describe('team history keeps the identity used at the event', () => {
  it('shows the old name only when it differs from the current one', () => {
    expect(playedAsName({ teamNameAtEvent: 'Old Name', teamCurrentName: 'Successor' })).toBe('Old Name');
    expect(playedAsName({ teamNameAtEvent: 'Successor', teamCurrentName: 'successor' })).toBeNull();
    expect(playedAsName({ teamNameAtEvent: null, teamCurrentName: 'Successor' })).toBeNull();
  });
  it('carries the fictional flag and the event-time name onto the event line', () => {
    const r = { competitionId: 'c', competitionName: 'Fiction 5v5', category: '5v5', gender: 'men' as const, tier: null, eventId: 'e', eventSlug: 'fiction-cup', eventName: 'Fiction Cup', eventType: 'tournament',
      startsOn: '2026-01-01', endsOn: '2026-01-02', seasonId: null, organizationId: null, finalPlace: 1, points: 6, synthetic: true, teamNameAtEvent: 'Old Name', teamCurrentName: 'Successor' };
    const [line] = tournamentHistory([r]);
    expect(line).toMatchObject({ synthetic: true, playedAs: 'Old Name', eventSlug: 'fiction-cup' });
  });
});

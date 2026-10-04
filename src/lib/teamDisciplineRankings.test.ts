import { describe, expect, it } from 'vitest';
import { applyDisciplineFilter, toTeamDisciplineRow, type DisciplineContribution, type TeamDisciplineRow } from '../data/fighters';
import {
  ALL_DIVISIONS, boardTitle, contributionLines, contributionTotal, disciplineBoard, disciplineOverview, disciplineParams, disciplineScope, divisionOptions, divisionSplit,
  formatPoints, genderOf, pointsText, resolveDiscipline, resolveDivision, splitText
} from './teamDisciplineRankings';
import { overviewScope, teamOverview } from './teamRankings';

// Rows as ranking_team_disciplines returns them. The SUMS are the database's job (proved by supabase/tests/team_discipline_rankings_gate.sql,
// including the Bob 3 + John 3 + Joe 3 = 9 scenario); these tests cover what the page does with the rows.
const row = (o: Partial<TeamDisciplineRow> & Pick<TeamDisciplineRow, 'teamId' | 'teamName' | 'category' | 'points' | 'rank'>): TeamDisciplineRow => ({
  scope: 'season', organizationId: 'org', seasonId: 'sea', categoryName: o.category, gender: null, teamSlug: o.teamId, fighters: 3, results: 3, ...o
});
const AB = { teamId: 'ab', teamName: 'Ankle Biters' };
const RDR = { teamId: 'rdr', teamName: 'Red Deer Reavers' };
const NR = { teamId: 'nr', teamName: 'Northern Ravens' };

// One season: longsword with two divisions (and the all-divisions total), sword and shield in one division, and a tie in sabre.
const BOARD_LONGSWORD: TeamDisciplineRow[] = [
  row({ ...AB, category: 'longsword', categoryName: 'Longsword', gender: null, points: 38, rank: 1 }),
  row({ ...RDR, category: 'longsword', categoryName: 'Longsword', gender: null, points: 37, rank: 2 }),
  row({ ...AB, category: 'longsword', categoryName: 'Longsword', gender: 'men', points: 23, rank: 2 }),
  row({ ...RDR, category: 'longsword', categoryName: 'Longsword', gender: 'men', points: 30, rank: 1 }),
  row({ ...AB, category: 'longsword', categoryName: 'Longsword', gender: 'women', points: 15, rank: 1 }),
  row({ ...RDR, category: 'longsword', categoryName: 'Longsword', gender: 'women', points: 7, rank: 2 })
];
const LEADERS: TeamDisciplineRow[] = [
  ...BOARD_LONGSWORD.filter(r => r.rank === 1),
  row({ ...RDR, category: 'sword_shield', categoryName: 'Sword & Shield', gender: null, points: 37, rank: 1 }),
  row({ ...RDR, category: 'sword_shield', categoryName: 'Sword & Shield', gender: 'men', points: 37, rank: 1 }),
  row({ ...NR, category: 'sabre', categoryName: 'Sabre', gender: null, points: 29, rank: 1 }),
  row({ ...AB, category: 'sabre', categoryName: 'Sabre', gender: null, points: 29, rank: 1 }),
  row({ ...AB, category: 'sabre', categoryName: 'Sabre', gender: 'open', points: 29, rank: 1 }),
  row({ ...NR, category: 'sabre', categoryName: 'Sabre', gender: 'open', points: 29, rank: 1 })
];

describe('the overview: one card per discipline with data', () => {
  const cards = disciplineOverview(LEADERS);
  it('shows the leader of every discipline, named by the data, in name order', () => {
    expect(cards.map(c => [c.label, c.leaders.map(l => l.teamName).join('+'), c.points])).toEqual([
      ['Longsword', 'Ankle Biters', 38], ['Sabre', 'Ankle Biters+Northern Ravens', 29], ['Sword & Shield', 'Red Deer Reavers', 37]
    ]);
  });
  it('leads with the all-divisions total, not one division (Red Deer Reavers lead men, Ankle Biters lead overall)', () => {
    expect(cards[0].leaders.map(l => l.teamName)).toEqual(['Ankle Biters']);
  });
  it('shows a genuine tie instead of picking one', () => {
    expect(cards.find(c => c.category === 'sabre')!.leaders).toHaveLength(2);
  });
  it('knows which divisions each discipline really has', () => {
    expect(Object.fromEntries(cards.map(c => [c.category, c.divisions]))).toEqual({ longsword: ['men', 'women'], sabre: ['open'], sword_shield: ['men'] });
  });
  it('a discipline no code has heard of appears from the data alone', () => {
    const more = disciplineOverview([...LEADERS, row({ ...NR, category: 'dagger_x', categoryName: 'Dagger', points: 4, rank: 1 })]);
    expect(more.map(c => c.label)).toContain('Dagger');
    expect(more.find(c => c.category === 'dagger_x')!.leaders[0].teamName).toBe('Northern Ravens');
  });
  it('shows nothing when there is no data, and ignores rows that are not rank 1', () => {
    expect(disciplineOverview([])).toEqual([]);
    expect(disciplineOverview([row({ ...AB, category: 'polearm', points: 3, rank: 2 })])).toEqual([]);
  });
});

describe('the full team table', () => {
  it('ranks teams by their combined points, with every division and all divisions available', () => {
    expect(disciplineBoard(BOARD_LONGSWORD, ALL_DIVISIONS).map(r => `${r.rank}. ${r.teamName} ${r.points}`)).toEqual(['1. Ankle Biters 38', '2. Red Deer Reavers 37']);
    expect(disciplineBoard(BOARD_LONGSWORD, 'men').map(r => `${r.rank}. ${r.teamName} ${r.points}`)).toEqual(['1. Red Deer Reavers 30', '2. Ankle Biters 23']);
    expect(disciplineBoard(BOARD_LONGSWORD, 'women').map(r => r.teamName)).toEqual(['Ankle Biters', 'Red Deer Reavers']);
  });
  it('lists teams sharing a rank by name', () => {
    const tied = [row({ ...RDR, category: 'x', points: 4, rank: 1 }), row({ ...AB, category: 'x', points: 4, rank: 1 })];
    expect(disciplineBoard(tied, ALL_DIVISIONS).map(r => r.teamName)).toEqual(['Ankle Biters', 'Red Deer Reavers']);
  });
  it('explains a total by division (Ankle Biters: 38 = men 23 + women 15)', () => {
    const split = divisionSplit(BOARD_LONGSWORD, 'ab');
    expect(split).toEqual([{ gender: 'men', points: 23 }, { gender: 'women', points: 15 }]);
    expect(split.reduce((s, p) => s + p.points, 0)).toBe(38);
    expect(splitText(split)).toBe('Men 23 · Women 15');
  });
  it('shows no split when the discipline has one division', () => {
    expect(divisionSplit([row({ ...AB, category: 's', gender: null, points: 5, rank: 1 }), row({ ...AB, category: 's', gender: 'open', points: 5, rank: 1 })], 'ab')).toEqual([]);
  });
});

describe('divisions and selection', () => {
  const cards = disciplineOverview(LEADERS);
  const longsword = cards.find(c => c.category === 'longsword')!;
  it('offers "All divisions" plus the divisions that exist, and no choice for a single division', () => {
    expect(divisionOptions(longsword)).toEqual([['all', 'All divisions'], ['men', 'Men'], ['women', 'Women']]);
    expect(divisionOptions(cards.find(c => c.category === 'sabre')!)).toEqual([]);
  });
  it('falls back to all divisions for a division the discipline does not have', () => {
    expect(resolveDivision(longsword, 'women')).toBe('women');
    expect(resolveDivision(longsword, 'open')).toBe('all');
    expect(resolveDivision(longsword, null)).toBe('all');
    expect(resolveDivision(cards.find(c => c.category === 'sabre')!, 'open')).toBe('all');
    expect(genderOf('all')).toBeNull();
    expect(genderOf('men')).toBe('men');
  });
  it('opens the asked discipline, or the first one', () => {
    expect(resolveDiscipline(cards, 'sabre')!.category).toBe('sabre');
    expect(resolveDiscipline(cards, 'gone')!.category).toBe('longsword');
    expect(resolveDiscipline([], 'sabre')).toBeNull();
  });
  it('titles the table', () => {
    expect(boardTitle(longsword, 'all')).toBe('Longsword');
    expect(boardTitle(longsword, 'women')).toBe('Longsword · Women');
  });
  it('tapping a discipline keeps organization, season and scope and resets the division', () => {
    const p = disciplineParams('sabre', new URLSearchParams('who=teams&scope=season&org=o1&season=s1&division=men&discipline=longsword'));
    expect(Object.fromEntries(p)).toEqual({ who: 'teams', scope: 'season', org: 'o1', season: 's1', discipline: 'sabre', table: 'disciplines' });
  });
});

describe('scopes', () => {
  it('maps every page scope to a discipline scope; whole organization uses the organization history', () => {
    expect(disciplineScope('season')).toBe('season');
    expect(disciplineScope('org_career')).toBe('org_career');
    expect(disciplineScope('org_all')).toBe('org_career');
    expect(disciplineScope('career')).toBe('career');
  });
  it('asks the database for the exact scope, organization, season, discipline, division and team (null matched as NULL)', () => {
    const calls: string[] = [];
    const q = { eq(c: string, v: unknown) { calls.push(`eq ${c}=${String(v)}`); return q; }, is(c: string) { calls.push(`is ${c} null`); return q; } };
    applyDisciplineFilter(q, { scope: 'season', organizationId: 'o', seasonId: 's' }, [['category', 'longsword'], ['gender', null], ['team_id', 'ab']]);
    applyDisciplineFilter(q, { scope: 'career' }, [['team_id', null]]);
    expect(calls).toEqual(['eq scope=season', 'eq organization_id=o', 'eq season_id=s', 'eq category=longsword', 'is gender null', 'eq team_id=ab',
      'eq scope=career', 'is organization_id null', 'is season_id null', 'is team_id null']);
  });
});

describe('the fighters behind a total', () => {
  const lines: DisciplineContribution[] = [
    { fighterId: 'mike', displayName: 'Mike', teamId: 'ab', results: 1, points: 4 }, { fighterId: 'bob', displayName: 'Bob', teamId: 'ab', results: 2, points: 12 },
    { fighterId: 'joe', displayName: 'Joe', teamId: 'ab', results: 1, points: 6 }, { fighterId: 'john', displayName: 'John', teamId: 'ab', results: 1, points: 8 }
  ];
  it('lists most points first and adds up to the team total (12 + 8 + 6 + 4 = 30)', () => {
    expect(contributionLines(lines).map(l => `${l.displayName} ${l.points}`)).toEqual(['Bob 12', 'John 8', 'Joe 6', 'Mike 4']);
    expect(contributionTotal(lines)).toBe(30);
  });
  it('formats league points (multipliers can make decimals)', () => {
    expect(formatPoints(9)).toBe('9');
    expect(formatPoints(12.5)).toBe('12.5');
    expect(formatPoints(7.25)).toBe('7.25');
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(9)).toBe('9 points');
    expect(contributionTotal([{ ...lines[0], points: 0.1 }, { ...lines[1], points: 0.2 }])).toBe(0.3);
  });
  it('maps database rows', () => {
    expect(toTeamDisciplineRow({ scope: 'career', organization_id: null, season_id: null, category: 'longsword', category_name: 'Longsword', gender: null, team_id: 'ab',
      team_name: 'Ankle Biters', team_slug: 'ankle-biters', fighters: '3', results: '3', points: '9.00', rank: '1' }))
      .toMatchObject({ teamName: 'Ankle Biters', points: 9, fighters: 3, rank: 1, gender: null, categoryName: 'Longsword' });
  });
});

describe('kept apart from team fights', () => {
  it('the team fights overview still reads its own rows and is unaffected', () => {
    expect(overviewScope('career')).toBeNull();
    expect(teamOverview([])).toEqual([]);
  });
});

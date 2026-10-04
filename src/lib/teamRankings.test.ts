import { describe, expect, it } from 'vitest';
import type { RankingRow } from '../data/fighters';
import { buildRankingFilter, RANKING_CATEGORIES } from './careerView';
import { cardTitle, fighterCategoryOptions, leaderboardParams, overviewScope, resolveTeamSelection, teamCategoryOptions, teamOverview } from './teamRankings';

const row = (o: Partial<RankingRow> & { subjectId: string; name: string }): RankingRow => ({
  scope: 'season', organizationId: 'org', seasonId: 'sea', category: '5v5', gender: 'men', slug: o.subjectId, competitions: 3, golds: 1, silvers: 0, bronzes: 0, points: 10, rank: 1, ...o
});
// What the ranking view returns for rank 1 of a season: two buhurt categories, one with two divisions, and a runner-up row that must be ignored.
const LEADERS: RankingRow[] = [
  row({ subjectId: 't1', name: 'Red Deer Reavers', category: '5v5', gender: 'men', points: 1240 }),
  row({ subjectId: 't2', name: 'Calgary Wolves', category: '5v5', gender: 'women', points: 640 }),
  row({ subjectId: 't3', name: 'Edmonton Hawks', category: '3v3', gender: 'open', points: 980 }),
  row({ subjectId: 't4', name: 'Second Place', category: '3v3', gender: 'open', points: 500, rank: 2 }),
  row({ subjectId: 't5', name: 'Big Melee', category: '12v12', gender: 'open', points: 760 }),
  row({ subjectId: 't6', name: 'Thirty Strong', category: '30v30', gender: 'open', points: 120 })
];

describe('fighters keep their own categories', () => {
  it('leads with the five categories, including the duel ones', () => {
    const codes = fighterCategoryOptions('5v5').map(([k]) => k);
    expect(codes).toEqual(RANKING_CATEGORIES.map(([k]) => k));
    expect(codes).toEqual(expect.arrayContaining(['longsword', 'sword_shield', 'polearm']));
  });
  it('adds a chosen category that is not in the leading five', () => {
    const o = fighterCategoryOptions('sabre');
    expect(o[o.length - 1]).toEqual(['sabre', 'Sabre']);
    expect(o).toHaveLength(RANKING_CATEGORIES.length + 1);
  });
});

describe('team categories come from the ranking data', () => {
  const cards = teamOverview(LEADERS);
  const options = teamCategoryOptions(cards);
  it('offers only categories teams really rank in, in natural order', () => {
    expect(options.map(o => o.code)).toEqual(['3v3', '5v5', '12v12', '30v30']);
  });
  it('never offers a duel category when no team ranks in it', () => {
    const codes = options.map(o => o.code);
    for (const duel of ['sword_shield', 'longsword', 'sabre', 'polearm', 'buckler', 'profight']) expect(codes).not.toContain(duel);
  });
  it('offers nothing when no team has a ranking row (no empty category is presented as a choice)', () => {
    expect(teamCategoryOptions(teamOverview([]))).toEqual([]);
    expect(resolveTeamSelection([], '5v5', 'men')).toBeNull();
    expect(teamOverview([row({ subjectId: 'x', name: 'Only second', rank: 2 })])).toEqual([]);
  });
  it('ignores rows with no category or division (the whole-organization and all-time tables)', () => {
    expect(teamOverview([row({ subjectId: 'x', name: 'Overall', category: null, gender: null })])).toEqual([]);
  });
});

describe('the overview', () => {
  const cards = teamOverview(LEADERS);
  const leaderOf = (category: string, gender: string) => cards.find(c => c.category === category && c.gender === gender);
  it('returns the number one team of each category and division', () => {
    expect(leaderOf('5v5', 'men')?.leaders.map(l => l.name)).toEqual(['Red Deer Reavers']);
    expect(leaderOf('5v5', 'women')?.leaders.map(l => l.name)).toEqual(['Calgary Wolves']);
    expect(leaderOf('3v3', 'open')?.leaders.map(l => l.name)).toEqual(['Edmonton Hawks']);
    expect(leaderOf('12v12', 'open')?.points).toBe(760);
    expect(cards).toHaveLength(5);
  });
  it('lists every team that shares rank 1', () => {
    const tied = teamOverview([row({ subjectId: 'b', name: 'Beta', points: 50 }), row({ subjectId: 'a', name: 'Alpha', points: 50 })]);
    expect(tied).toHaveLength(1);
    expect(tied[0].leaders.map(l => l.name)).toEqual(['Alpha', 'Beta']);
  });
  it('orders cards by category, then men, women, open', () => {
    expect(cards.map(c => `${c.category}/${c.gender}`)).toEqual(['3v3/open', '5v5/men', '5v5/women', '12v12/open', '30v30/open']);
  });
  it('shows a division only where the category really has more than one', () => {
    expect(leaderOf('5v5', 'men')?.showDivision).toBe(true);
    expect(cardTitle(leaderOf('5v5', 'men')!)).toBe('5v5 · Men');
    expect(leaderOf('3v3', 'open')?.showDivision).toBe(false);
    expect(cardTitle(leaderOf('3v3', 'open')!)).toBe('3v3');
  });
  it('knows where the overview comes from for each scope', () => {
    expect(overviewScope('season')).toBe('season');
    expect(overviewScope('org_career')).toBe('org_career');
    expect(overviewScope('org_all')).toBe('org_career');   // the organization's results split by category
    expect(overviewScope('career')).toBeNull();            // one all-time table: no per-category split exists
  });
});

describe('choosing a category and division', () => {
  const options = teamCategoryOptions(teamOverview(LEADERS));
  it('keeps a valid choice', () => {
    expect(resolveTeamSelection(options, '5v5', 'women')).toEqual({ category: '5v5', gender: 'women' });
  });
  it('falls back to the first team category when the page still holds a duel category from Fighters', () => {
    expect(resolveTeamSelection(options, 'sword_shield', 'men')).toEqual({ category: '3v3', gender: 'open' });
  });
  it('falls back to a division that exists in the category', () => {
    expect(resolveTeamSelection(options, '3v3', 'men')).toEqual({ category: '3v3', gender: 'open' });
    expect(options.find(o => o.code === '3v3')?.divisions).toEqual(['open']);   // so no Men / Women / Open choice is forced on it
    expect(options.find(o => o.code === '5v5')?.divisions).toEqual(['men', 'women']);
  });
  it('tapping a leader opens exactly that category and division in the same scope', () => {
    const card = teamOverview(LEADERS).find(c => c.category === '5v5' && c.gender === 'women')!;
    const next = leaderboardParams(card, 'season', new URLSearchParams('who=teams&scope=season&org=org&season=sea&category=3v3&division=open'));
    expect(Object.fromEntries(next)).toEqual({ who: 'teams', scope: 'season', org: 'org', season: 'sea', category: '5v5', division: 'women' });
    expect(buildRankingFilter({ scope: next.get('scope') as 'season', organizationId: 'org', seasonId: 'sea', category: next.get('category')!, gender: next.get('division') as 'women' }).filter)
      .toEqual({ scope: 'season', organizationId: 'org', seasonId: 'sea', category: '5v5', gender: 'women' });
  });
  it('from "Whole organization" a leader opens the organization-career table for that category', () => {
    const card = teamOverview(LEADERS).find(c => c.category === '3v3')!;
    const next = leaderboardParams(card, 'org_all', new URLSearchParams('who=teams&scope=org_all&org=org'));
    expect(next.get('scope')).toBe('org_career');
    expect(buildRankingFilter({ scope: 'org_career', organizationId: 'org', seasonId: '', category: next.get('category')!, gender: next.get('division') as 'open' }).filter)
      .toEqual({ scope: 'org_career', organizationId: 'org', category: '3v3', gender: 'open' });
  });
});

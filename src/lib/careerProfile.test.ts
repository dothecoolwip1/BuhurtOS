import { describe, expect, it } from 'vitest';
import type { CareerLine, CareerResult, Fight, HeadToHeadLine, RepresentedFighter, TeamDisciplineRank, TeamFight } from '../data/careerProfile';
import type { RankingRow } from '../data/fighters';
import {
  CAREER_FILTER, careerFilters, careerHighlights, careerLines, careerTotal, contextFor, contributionScope, currentWinStreak, disciplineTotals, eventHistory, fightLine,
  fightsIn, formLetters, headToHeadLine, medalsText, newestFirst, official, opponents, placeWord, pointsText, rankingHighlights, recordText, representedList, representedText,
  teamEventHistory, teamsRepresented, yearSpan
} from './careerProfile';

const line = (o: Partial<CareerLine>): CareerLine => ({
  context: 'official', scope: 'career', seasonId: null, organizationId: null, kind: null, category: null, categoryName: null, gender: null,
  events: 0, competitions: 0, matches: 0, wins: 0, losses: 0, draws: 0, winPct: null, golds: 0, silvers: 0, bronzes: 0, podiums: 0, points: 0, bestPlace: null, firstOn: null, lastOn: null, ...o
});
let n = 0;
const fight = (o: Partial<Fight>): Fight => {
  n += 1;
  return {
    matchId: `m${n}`, competitionId: 'c1', competitionName: 'Men Longsword', category: 'longsword', categoryName: 'Longsword', gender: 'men', stage: 'round_robin', roundLabel: 'Round 1',
    eventId: 'e1', eventSlug: 'ev-1', eventName: 'Event 1', startsOn: '2026-07-18', endsOn: '2026-07-19', seasonId: 's26', organizationId: 'org',
    entryId: 'x', kind: 'individual', rosterRole: null, teamId: 't1', teamName: 'Kestrel Guard', teamSlug: 'kestrel-guard',
    opponentEntryId: 'y', opponentFighterId: 'f2', opponentTeamId: null, opponentName: 'John Quill', opponentTeamSlug: null,
    outcome: 'win', scoreFor: 5, scoreAgainst: 2, walkover: false, finalizedAt: `2026-07-19T10:${String(n).padStart(2, '0')}:00Z`, synthetic: false, statsExcluded: false, ...o
  };
};
const result = (o: Partial<CareerResult>): CareerResult => ({
  competitionId: 'c1', competitionName: 'Men Longsword', category: 'longsword', categoryName: 'Longsword', gender: 'men', tier: 'Classic', entryId: 'x', kind: 'individual', entryStatus: 'checked_in',
  teamId: 't1', teamName: 'Kestrel Guard', teamSlug: 'kestrel-guard', finalPlace: 1, points: 9,
  eventId: 'e1', eventSlug: 'ev-1', eventName: 'Event 1', startsOn: '2026-07-18', endsOn: '2026-07-19', seasonId: 's26', organizationId: 'org', synthetic: false, statsExcluded: false, ...o
});
const seasons = [
  { id: 's25', name: 'Parkland 2025', slug: 'p25', organizationId: 'org', startsOn: '2025-01-01', endsOn: '2025-12-31' },
  { id: 's26', name: 'Parkland 2026', slug: 'p26', organizationId: 'org', startsOn: '2026-01-01', endsOn: '2026-12-31' }
];
const orgs = [{ id: 'org', name: 'Parkland League', shortName: null, enabled: true, slug: 'parkland' }, { id: 'org2', name: 'Other League', shortName: 'OL', enabled: true, slug: 'other' }];

describe('filters', () => {
  const lines = [
    line({ matches: 18, wins: 15, losses: 2, draws: 1 }),
    line({ scope: 'season', seasonId: 's25', matches: 8 }), line({ scope: 'season', seasonId: 's26', matches: 10 }),
    line({ scope: 'organization', organizationId: 'org', matches: 18 }),
    line({ kind: 'individual', category: 'longsword', categoryName: 'Longsword', gender: 'men', matches: 5, competitions: 2 }),
    line({ kind: 'individual', category: 'polearm', categoryName: 'Polearm', gender: 'men', matches: 6, competitions: 2 }),
    line({ kind: 'team', category: '5v5', categoryName: '5v5', gender: 'men', matches: 4 }),
    line({ scope: 'season', seasonId: 's26', kind: 'individual', category: 'longsword', categoryName: 'Longsword', gender: 'men', matches: 2 }),
    line({ context: 'test', matches: 1 })
  ];
  it('offers the career and every season with a record, newest first; one organization is not a filter', () => {
    expect(careerFilters(lines, seasons, orgs, 'official').map(f => f.label)).toEqual(['Career', 'Parkland 2026', 'Parkland 2025']);
  });
  it('offers organizations only when there are several', () => {
    const more = [...lines, line({ scope: 'organization', organizationId: 'org2', matches: 1 })];
    expect(careerFilters(more, seasons, orgs, 'official').map(f => f.label)).toEqual(['Career', 'Parkland 2026', 'Parkland 2025', 'Parkland League', 'OL']);
  });
  it('picks the total and the lines of a filter and a context', () => {
    expect(careerTotal(lines, CAREER_FILTER, 'official')?.matches).toBe(18);
    expect(careerTotal(lines, { kind: 'season', id: 's25', label: '' }, 'official')?.matches).toBe(8);
    expect(careerTotal(lines, CAREER_FILTER, 'test')?.matches).toBe(1);
    expect(careerLines(lines, CAREER_FILTER, 'official', 'individual').map(l => l.category)).toEqual(['polearm', 'longsword']);
    expect(careerLines(lines, CAREER_FILTER, 'official', 'team').map(l => l.category)).toEqual(['5v5']);
    expect(careerLines(lines, { kind: 'season', id: 's26', label: '' }, 'official').map(l => l.matches)).toEqual([2]);
    expect(careerTotal(lines, { kind: 'season', id: 'none', label: '' }, 'official')).toBeUndefined();
  });
  it('narrows fight and result lists to the filter', () => {
    const rows = [fight({ seasonId: 's25' }), fight({ seasonId: 's26' })];
    expect(fightsIn(rows, { kind: 'season', id: 's26', label: '' })).toHaveLength(1);
    expect(fightsIn(rows, { kind: 'organization', id: 'org', label: '' })).toHaveLength(2);
    expect(fightsIn(rows, CAREER_FILTER)).toHaveLength(2);
  });
  it('official rows leave fictional and excluded ones out; a fictional page keeps its own fictional rows', () => {
    const rows = [fight({}), fight({ synthetic: true }), fight({ statsExcluded: true })];
    expect(official(rows, 'official')).toHaveLength(1);
    expect(official(rows, 'test')).toHaveLength(1);
    expect(contextFor(true)).toBe('test');
  });
});

describe('wording', () => {
  it('records, medals, points, fights and places', () => {
    expect(recordText({ wins: 15, losses: 2, draws: 1 })).toBe('15 W · 2 L · 1 D');
    expect(recordText({ wins: 3, losses: 0, draws: 0 })).toBe('3 W · 0 L');
    expect(medalsText({ golds: 2, silvers: 0, bronzes: 1 })).toBe('2 gold · 1 bronze');
    expect(pointsText(8)).toBe('8 points'); expect(pointsText(1)).toBe('1 point'); expect(pointsText(7.5)).toBe('7.5 points'); expect(pointsText(11.25)).toBe('11.25 points');
    expect(fightLine({ outcome: 'win', scoreFor: 5, scoreAgainst: 2, walkover: false })).toBe('Won 5 to 2');
    expect(fightLine({ outcome: 'loss', scoreFor: 0, scoreAgainst: 0, walkover: true })).toBe('Lost by walkover');
    expect(fightLine({ outcome: 'draw', scoreFor: 3, scoreAgainst: 3, walkover: false })).toBe('Drew 3 to 3');
    expect(fightLine({ outcome: 'win', scoreFor: null, scoreAgainst: null, walkover: false })).toBe('Won');
    expect([1, 2, 3, 4, 11, 22].map(placeWord)).toEqual(['Gold', 'Silver', 'Bronze', '4th place', '11th place', '22nd place']);
    expect(yearSpan('2025-09-14', '2025-11-01')).toBe('2025'); expect(yearSpan('2025-09-14', '2026-07-19')).toBe('2025 to 2026');
  });
});

describe('chronology and streaks', () => {
  it('orders newest first by event, then time, then id', () => {
    const a = fight({ endsOn: '2026-01-01', finalizedAt: '2026-01-01T10:00:00Z' }), b = fight({ endsOn: '2026-02-01', finalizedAt: null }), c = fight({ endsOn: '2026-02-01', finalizedAt: '2026-02-01T09:00:00Z' });
    expect(newestFirst([a, b, c]).map(f => f.matchId)).toEqual([c.matchId, b.matchId, a.matchId]);
    expect(formLetters(newestFirst([a, fight({ outcome: 'loss', endsOn: '2026-03-01' }), fight({ outcome: 'draw', endsOn: '2026-04-01' })]))).toEqual(['D', 'L', 'W']);
  });
  it('counts the current run of wins and stops at a loss or a draw', () => {
    const rows = [fight({ outcome: 'loss', endsOn: '2026-01-01', eventId: 'e0' }), fight({ endsOn: '2026-02-01', eventId: 'e2' }), fight({ endsOn: '2026-03-01', eventId: 'e3' }), fight({ endsOn: '2026-04-01', eventId: 'e4' })];
    expect(currentWinStreak(rows)).toEqual({ length: 3, reliable: true });
    expect(currentWinStreak([...rows, fight({ outcome: 'draw', endsOn: '2026-05-01', eventId: 'e5' })])).toEqual({ length: 0, reliable: true });
    expect(currentWinStreak([])).toEqual({ length: 0, reliable: true });
  });
  it('does not claim a streak across same-day fights whose order is unknown', () => {
    const rows = [fight({ endsOn: '2026-04-01', eventId: 'e4', finalizedAt: null }), fight({ endsOn: '2026-04-01', eventId: 'e4', finalizedAt: null }), fight({ endsOn: '2026-03-01', eventId: 'e3' })];
    expect(currentWinStreak(rows)).toEqual({ length: 1, reliable: false });
    const timed = [fight({ endsOn: '2026-04-01', eventId: 'e4', finalizedAt: '2026-04-01T10:00:00Z' }), fight({ endsOn: '2026-04-01', eventId: 'e4', finalizedAt: '2026-04-01T11:00:00Z' }), fight({ endsOn: '2026-03-01', eventId: 'e3' })];
    expect(currentWinStreak(timed)).toEqual({ length: 3, reliable: true });
  });
});

describe('ranking highlights', () => {
  const r = (o: Partial<RankingRow>): RankingRow => ({ scope: 'career', organizationId: null, seasonId: null, category: null, gender: null, subjectId: 'f1', name: 'Bob', slug: null, competitions: 1, golds: 0, silvers: 0, bronzes: 0, points: 10, rank: 1, ...o });
  it('best rank first, a running season before careers, old seasons left out, at most three', () => {
    const rows = [
      r({ scope: 'season', seasonId: 's25', organizationId: 'org', category: 'longsword', gender: 'men', rank: 1 }),
      r({ scope: 'season', seasonId: 's26', organizationId: 'org', category: 'longsword', gender: 'men', rank: 2 }),
      r({ scope: 'org_career', organizationId: 'org', category: 'longsword', gender: 'men', rank: 2, points: 20 }),
      r({ scope: 'org_career', organizationId: 'org', category: 'polearm', gender: 'men', rank: 5 }),
      r({ scope: 'career', rank: 8 }), r({ scope: 'org_all', organizationId: 'org', rank: 3 })
    ];
    expect(rankingHighlights(rows, seasons, '2026-10-05').map(x => `${x.scope}:${x.category ?? '-'}:${x.rank}`)).toEqual(['season:longsword:2', 'org_career:longsword:2', 'org_all:-:3']);
  });
});

describe('event history and teams represented', () => {
  const results = [
    result({ eventId: 'e1', eventSlug: 'autumn', eventName: 'Autumn Clash 2025', endsOn: '2025-09-14', startsOn: '2025-09-13', seasonId: 's25', teamId: 't2', teamName: 'Iron Ferns', teamSlug: 'iron-ferns', finalPlace: 1 }),
    result({ eventId: 'e1', eventSlug: 'autumn', eventName: 'Autumn Clash 2025', endsOn: '2025-09-14', startsOn: '2025-09-13', seasonId: 's25', competitionId: 'c2', competitionName: 'Men Polearm', category: 'polearm', categoryName: 'Polearm', teamId: 't2', teamName: 'Iron Ferns', teamSlug: 'iron-ferns', finalPlace: 2 }),
    result({ eventId: 'e4', eventSlug: 'summer', eventName: 'Summer Duels 2026', endsOn: '2026-07-19', finalPlace: 2, points: 7.5 }),
    result({ eventId: 'e3', eventSlug: 'spring', eventName: 'Spring Open 2026', endsOn: '2026-05-10', finalPlace: 1, statsExcluded: true })
  ];
  const fights = [
    fight({ eventId: 'e1', eventSlug: 'autumn', eventName: 'Autumn Clash 2025', endsOn: '2025-09-14', startsOn: '2025-09-13', seasonId: 's25', teamId: 't2', teamName: 'Iron Ferns', teamSlug: 'iron-ferns' }),
    fight({ eventId: 'e1', eventSlug: 'autumn', eventName: 'Autumn Clash 2025', endsOn: '2025-09-14', startsOn: '2025-09-13', seasonId: 's25', teamId: 't2', teamName: 'Iron Ferns', teamSlug: 'iron-ferns', outcome: 'loss' }),
    fight({ eventId: 'e4', eventSlug: 'summer', eventName: 'Summer Duels 2026', endsOn: '2026-07-19', outcome: 'loss' }),
    fight({ eventId: 'e4', eventSlug: 'summer', eventName: 'Summer Duels 2026', endsOn: '2026-07-19', kind: 'team', category: '5v5', categoryName: '5v5', opponentFighterId: null, opponentTeamId: 't3', opponentName: 'Mire Wolves' })
  ];
  it('groups by event, newest first, with placings, the fight record and the team represented there', () => {
    const h = eventHistory(results, fights);
    expect(h.map(e => e.eventName)).toEqual(['Summer Duels 2026', 'Spring Open 2026', 'Autumn Clash 2025']);
    expect(h[2].placings.map(p => `${p.competitionName}:${p.place}:${p.medal}`)).toEqual(['Men Longsword:1:gold', 'Men Polearm:2:silver']);
    expect(h[2].teams.map(t => t.name)).toEqual(['Iron Ferns']);
    expect([h[2].fights, h[2].wins, h[2].losses]).toEqual([2, 1, 1]);
    expect(h[0].teams.map(t => t.name)).toEqual(['Kestrel Guard']);
    expect(h[1].statsExcluded).toBe(true);
    expect(h[1].fights).toBe(0);
  });
  it('lists the teams represented with the events that prove it, no dates invented', () => {
    const t = teamsRepresented(eventHistory(results, fights));
    expect(t.map(x => `${x.name}:${x.events.length}:${yearSpan(x.firstOn, x.lastOn)}`)).toEqual(['Kestrel Guard:2:2026', 'Iron Ferns:1:2025']);
  });
  it('highlights are deterministic: latest gold, best ranking, most fought discipline, streak only when certain, latest event', () => {
    const events = eventHistory(results.filter(r => !r.statsExcluded), fights);
    const lines = [line({ kind: 'individual', category: 'longsword', categoryName: 'Longsword', matches: 7 }), line({ kind: 'individual', category: 'polearm', categoryName: 'Polearm', matches: 9 }), line({ kind: 'team', category: '5v5', categoryName: '5v5', matches: 12 })];
    const rankings: RankingRow[] = [{ scope: 'org_career', organizationId: 'org', seasonId: null, category: 'longsword', gender: 'men', subjectId: 'f1', name: 'Bob', slug: null, competitions: 2, golds: 1, silvers: 1, bronzes: 0, points: 16.5, rank: 2 }];
    const h = careerHighlights({ total: lines[0], lines, events, rankings, fights, rankingLabel: r => `${r.category} (${r.organizationId})` });
    expect(h.map(x => `${x.label}: ${x.value}`)).toEqual([
      'Most recent gold: Men Longsword · Autumn Clash 2025', 'Best current ranking: #2 longsword (org)', 'Most fought discipline: Polearm · 9 fights', 'Most recent event: Summer Duels 2026'
    ]);
    expect(careerHighlights({ total: undefined, lines: [], events: [], rankings: [], fights: [], rankingLabel: () => '' })).toEqual([]);
  });
});

describe('head to head', () => {
  const l = (o: Partial<HeadToHeadLine>): HeadToHeadLine => ({ context: 'official', opponentId: 'f2', opponentName: 'John Quill', opponentSlug: null, category: null, categoryName: null, gender: null, meetings: 3, wins: 1, losses: 1, draws: 1, lastOn: '2026-07-19', ...o });
  it('opponents most met first with their category split; the other context is left out', () => {
    const rows = [l({}), l({ category: 'longsword', categoryName: 'Longsword', gender: 'men', meetings: 2, wins: 1, losses: 1, draws: 0 }), l({ category: 'sword_shield', categoryName: 'Sword & Shield', gender: 'men', meetings: 1, wins: 0, losses: 0, draws: 1 }),
      l({ opponentId: 'f7', opponentName: 'Steve Wold', meetings: 3, wins: 3, losses: 0, draws: 0 }), l({ opponentId: 'f8', opponentName: 'Pete', context: 'test' })];
    const o = opponents(rows, 'official');
    expect(o.map(x => `${x.name}:${x.meetings}`)).toEqual(['John Quill:3', 'Steve Wold:3']);
    expect(o[0].byCategory.map(c => `${c.categoryName}:${c.wins}-${c.losses}-${c.draws}`)).toEqual(['Longsword:1-1-0', 'Sword & Shield:0-0-1']);
    expect(headToHeadLine('Bob', o[0])).toBe('Bob 1 · John Quill 1 · Draws 1');
    expect(headToHeadLine('Bob', o[1])).toBe('Bob 3 · Steve Wold 0');
  });
});

describe('teams', () => {
  const tf = (o: Partial<TeamFight>): TeamFight => ({
    matchId: `t${n += 1}`, competitionId: 'k1', competitionName: 'Men 5v5', category: '5v5', categoryName: '5v5', gender: 'men', stage: 'round_robin', roundLabel: null,
    eventId: 'e1', eventSlug: 'autumn', eventName: 'Autumn Clash 2025', startsOn: '2025-09-13', endsOn: '2025-09-14', seasonId: 's25', organizationId: 'org',
    entryId: 'x', teamNameAtEvent: 'Kestrel Guard', opponentEntryId: 'y', opponentTeamId: 't2', opponentName: 'Iron Ferns', opponentTeamSlug: 'iron-ferns',
    outcome: 'win', scoreFor: 3, scoreAgainst: 1, walkover: false, finalizedAt: null, finalPlace: 2, points: 6, synthetic: false, statsExcluded: false, ...o
  });
  it('keeps what the team fought apart from what duelists fought for it', () => {
    const h = teamEventHistory([tf({ outcome: 'loss' }), tf({}), tf({ eventId: 'e2', eventSlug: 'winter', eventName: 'Winter Melee 2026', endsOn: '2026-02-21', competitionId: 'k2', competitionName: 'Men 3v3', categoryName: '3v3', finalPlace: 1 })],
      [{ ...result({ eventId: 'e4', eventSlug: 'summer', eventName: 'Summer Duels 2026', endsOn: '2026-07-19', finalPlace: 2 }), fighterId: 'f1' }, { ...result({ eventId: 'e4', eventSlug: 'summer', eventName: 'Summer Duels 2026', endsOn: '2026-07-19', competitionId: 'c9', finalPlace: 1 }), fighterId: 'f1' }, { ...result({ eventId: 'e4', eventSlug: 'summer', eventName: 'Summer Duels 2026', endsOn: '2026-07-19', competitionId: 'c8', finalPlace: 1 }), fighterId: 'f2' }],
      id => ({ f1: 'Bob Brand', f2: 'John Quill' })[id]);
    expect(h.map(e => e.eventName)).toEqual(['Summer Duels 2026', 'Winter Melee 2026', 'Autumn Clash 2025']);
    expect(h[0].direct).toEqual([]);
    expect(h[0].represented).toEqual({ fighters: 2, results: 3, golds: 2, silvers: 1, bronzes: 0, names: ['Bob Brand', 'John Quill'] });
    expect(h[2].direct.map(d => `${d.competitionName}:${d.wins}-${d.losses}:${d.medal}`)).toEqual(['Men 5v5:1-1:silver']);
    expect(h[2].represented.fighters).toBe(0);
  });
  it('discipline totals follow the filter and the contributor scope matches the rankings page', () => {
    const r = (o: Partial<TeamDisciplineRank>): TeamDisciplineRank => ({ scope: 'career', organizationId: null, seasonId: null, category: 'longsword', categoryName: 'Longsword', gender: null, fighters: 3, results: 4, points: 30, rank: 1, ...o });
    const rows = [r({}), r({ gender: 'men' }), r({ category: 'polearm', categoryName: 'Polearm', rank: 2, points: 20 }), r({ scope: 'season', seasonId: 's26', organizationId: 'org', rank: 3 }), r({ scope: 'org_career', organizationId: 'org', rank: 4 })];
    expect(disciplineTotals(rows, CAREER_FILTER, 'org').map(x => `${x.categoryName}:${x.rank}`)).toEqual(['Longsword:1', 'Polearm:2']);
    expect(disciplineTotals(rows, { kind: 'season', id: 's26', label: '' }, 'org').map(x => x.rank)).toEqual([3]);
    expect(disciplineTotals(rows, { kind: 'organization', id: 'org', label: '' }, null).map(x => x.rank)).toEqual([4]);
    expect(contributionScope(CAREER_FILTER, 'org')).toEqual({ scope: 'career', organizationId: null, seasonId: null });
    expect(contributionScope({ kind: 'season', id: 's26', label: '' }, 'org')).toEqual({ scope: 'season', organizationId: 'org', seasonId: 's26' });
  });
  it('represented fighters: most recent first, marked current when on the public roster, with a plain line', () => {
    const f = (o: Partial<RepresentedFighter>): RepresentedFighter => ({ context: 'official', fighterId: 'f1', displayName: 'Bob Brand', active: true, individualResults: 3, individualFights: 7, teamFights: 3, firstOn: '2026-02-21', lastOn: '2026-07-19', ...o });
    const rows = [f({}), f({ fighterId: 'f3', displayName: 'Mike Thorn', active: false, individualResults: 1, individualFights: 3, teamFights: 0, lastOn: '2025-09-14' }), f({ fighterId: 'f4', displayName: 'Hal Holt', individualResults: 0, individualFights: 0, teamFights: 2, lastOn: '2025-09-14' }), f({ fighterId: 'f8', context: 'test' })];
    const list = representedList(rows, 'official', new Set(['f1']));
    expect(list.map(x => `${x.displayName}:${x.current}:${x.active}`)).toEqual(['Bob Brand:true:true', 'Hal Holt:false:true', 'Mike Thorn:false:false']);
    expect(representedText(rows[0])).toBe('3 individual results · 3 team fights');
    expect(representedText(rows[2])).toBe('2 team fights');
    expect(representedText(f({ individualResults: 0, individualFights: 2, teamFights: 0 }))).toBe('2 fights');
  });
});

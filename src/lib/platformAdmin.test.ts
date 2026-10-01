import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
import type { AdminFighterRow, AdminTeamRow } from '../data/admin';
import { emptyProfileForm, emptySportsForm } from '../data/fighters';
import {
  auditLine, collectPages, fighterBadges, fighterEditDiff, filterFighters, filterTeams, ORG_ALL, ORG_NONE, orgOptions, overviewCounts, parseList, teamBadges, visibleCount
} from './platformAdmin';

const team = (o: Partial<AdminTeamRow> = {}): AdminTeamRow => ({ teamId: 't', slug: 's', name: 'N', status: 'approved', city: null, region: null, country: null, logoPath: null, createdAt: 'x', organization: null, rosterCount: 0, captainCount: 0, total: 1, ...o });
const fighter = (o: Partial<AdminFighterRow> = {}): AdminFighterRow => ({ fighterId: 'f', displayName: 'F', teamId: null, teamName: null, teamSlug: null, claimed: true, city: null, region: null, country: null, photoPath: null, profilePublic: true, createdAt: 'x', total: 1, ...o });
const org = (id: string, enabled = true) => ({ id, slug: id, name: `Org ${id}`, enabled });

describe('team filters and labels', () => {
  const rows = [team({ teamId: 'a', status: 'pending' }), team({ teamId: 'b', organization: org('o1') }), team({ teamId: 'c', status: 'pending', organization: org('o2', false) })];
  it('filters by status and organization', () => {
    expect(filterTeams(rows, { status: 'all', org: ORG_ALL })).toHaveLength(3);
    expect(filterTeams(rows, { status: 'pending', org: ORG_ALL }).map(r => r.teamId)).toEqual(['a', 'c']);
    expect(filterTeams(rows, { status: 'all', org: ORG_NONE }).map(r => r.teamId)).toEqual(['a']);
    expect(filterTeams(rows, { status: 'pending', org: 'o2' }).map(r => r.teamId)).toEqual(['c']);
  });
  it('lists organizations with counts, sorted by name', () => {
    expect(orgOptions([...rows, team({ organization: org('o1') })])).toEqual([{ id: 'o1', name: 'Org o1', enabled: true, count: 2 }, { id: 'o2', name: 'Org o2', enabled: false, count: 1 }]);
  });
  it('labels pending teams and disabled organizations clearly', () => {
    expect(teamBadges(rows[0]).map(b => b.label)).toEqual(['Pending approval']);
    expect(teamBadges(rows[2]).map(b => b.label)).toEqual(['Pending approval', 'Organization disabled']);
    expect(teamBadges(rows[1]).map(b => b.label)).toEqual(['Approved']);
  });
});

describe('fighter filters and labels', () => {
  it('keeps only unclaimed fighters when asked', () => {
    const rows = [fighter({ fighterId: 'a' }), fighter({ fighterId: 'b', claimed: false })];
    expect(filterFighters(rows, { unclaimedOnly: true }).map(r => r.fighterId)).toEqual(['b']);
    expect(filterFighters(rows, { unclaimedOnly: false })).toHaveLength(2);
  });
  it('labels unclaimed and private records', () => {
    expect(fighterBadges(fighter({ claimed: false, profilePublic: false })).map(b => b.label)).toEqual(['Unclaimed', 'Private profile']);
  });
  it('sends only the changed fields', () => {
    const before = { displayName: 'A One', profile: emptyProfileForm(), sports: emptySportsForm() };
    expect(fighterEditDiff(before, before)).toEqual({});
    const after = { displayName: ' A Two ', profile: { ...before.profile, city: 'Calgary' }, sports: { ...before.sports, profilePublic: false } };
    expect(fighterEditDiff(before, after)).toEqual({ display_name: 'A Two', city: 'Calgary', profile_public: false });
  });
  it('parses a list of codes without duplicates', () => {
    expect(parseList(' longsword, 5v5 ,,longsword')).toEqual(['longsword', '5v5']);
  });
});

describe('paging', () => {
  it('reads every page up to the cap', async () => {
    const fetchPage = vi.fn(async (o: number) => ({ rows: Array.from({ length: Math.min(200, 450 - o) }, (_, i) => o + i), total: 450 }));
    const r = await collectPages(fetchPage);
    expect(r.rows).toHaveLength(450);
    expect(r).toMatchObject({ total: 450, capped: false });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
  it('stops at the cap and says so', async () => {
    const r = await collectPages(async o => ({ rows: Array.from({ length: 200 }, (_, i) => o + i), total: 5000 }), 400);
    expect(r.rows).toHaveLength(400);
    expect(r.capped).toBe(true);
  });
  it('handles an empty list', async () => {
    expect(await collectPages(async () => ({ rows: [], total: 0 }))).toEqual({ rows: [], total: 0, capped: false });
  });
  it('shows more rows per click', () => {
    expect(visibleCount(1)).toBe(25);
    expect(visibleCount(3)).toBe(75);
    expect(visibleCount(0)).toBe(25);
  });
});

describe('overview and audit', () => {
  it('counts pending teams and unclaimed fighters', () => {
    const c = overviewCounts([team({ status: 'pending' }), team()], 9, [fighter({ claimed: false }), fighter()], 40, 3);
    expect(c).toEqual({ teams: 9, pendingTeams: 1, fighters: 40, unclaimedFighters: 1, organizations: 3 });
  });
  it('writes plain audit lines from field names', () => {
    expect(auditLine({ id: 1, at: 'x', action: 'admin.team_updated', details: { fields: ['name', 'founded_year'] } })).toEqual({ label: 'Team edited', detail: 'Changed: name, founded year' });
    expect(auditLine({ id: 2, at: 'x', action: 'team.something_new', details: {} })).toEqual({ label: 'Team something new', detail: '' });
  });
});

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chip, PageHead, Seg } from '../components/ui';
import { fetchFighterBasics, fetchOrgLites, fetchSeasons } from '../data/careers';
import { fetchFighterRanking, fetchTeamLeaders, fetchTeamRanking, type RankingRow, type RankingScope } from '../data/fighters';
import {
  buildRankingFilter, categoryLabel, defaultOrganization, DIVISIONS, divisionLabel, INACTIVE_ORG_NOTICE, medalSummary, orgOptionLabel, RANKING_CATEGORIES, RANKING_POINTS_SENTENCE,
  RANKING_SCOPES, scopeUses, seasonsOf, type Division, type RankingSubject
} from '../lib/careerView';
import { cardTitle, fighterCategoryOptions, leaderboardParams, overviewScope, resolveTeamSelection, teamCategoryOptions, teamOverview, type TeamLeaderCard } from '../lib/teamRankings';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { TeamDisciplineTotals } from './TeamDisciplineTotals';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const SUBJECTS: ReadonlyArray<readonly [RankingSubject, string]> = [['fighters', 'Fighters'], ['teams', 'Teams']];
/** Two different team statistics: fighters' individual points added up per discipline, and the team's own group fight results. */
type TeamTable = 'disciplines' | 'fights';
const TEAM_TABLES: ReadonlyArray<readonly [TeamTable, string]> = [['disciplines', 'Discipline totals'], ['fights', 'Team fights']];
const isScope = (s: string | null): s is RankingScope => RANKING_SCOPES.some(([k]) => k === s);
const isDivision = (s: string | null): s is Division => DIVISIONS.some(([k]) => k === s);

async function loadRows(subject: RankingSubject, f: NonNullable<ReturnType<typeof buildRankingFilter>['filter']>) {
  if (subject === 'teams') return { rows: await fetchTeamRanking(f), basics: new Map<string, { team: { name: string; slug: string } | null }>() };
  const rows = await fetchFighterRanking(f);
  return { rows, basics: await fetchFighterBasics(rows.map(r => r.subjectId)) };
}

export function RankingsPage() {
  useDocumentTitle('Rankings');
  const [params, setParams] = useSearchParams();
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const orgList = orgs.data ?? [];
  const subject: RankingSubject = params.get('who') === 'teams' ? 'teams' : 'fighters';
  const scopeRaw = params.get('scope');
  const scope: RankingScope = isScope(scopeRaw) ? scopeRaw : 'season';
  const orgParam = params.get('org');
  const organizationId = (orgParam ? orgList.find(o => o.id === orgParam || o.slug === orgParam)?.id : undefined) ?? defaultOrganization(orgList)?.id ?? '';
  const seasonList = seasonsOf(seasons.data ?? [], organizationId);
  const seasonId = params.get('season') && seasonList.some(s => s.id === params.get('season')) ? (params.get('season') as string) : seasonList[0]?.id ?? '';
  const categoryParam = params.get('category') ?? RANKING_CATEGORIES[0][0];
  const genderRaw = params.get('division');
  const genderParam: Division = isDivision(genderRaw) ? genderRaw : 'men';
  const uses = scopeUses(scope);
  const org = orgList.find(o => o.id === organizationId);

  // Teams: which categories exist, which team leads each, and whether a division applies all come from the ranking data for this scope,
  // organization and season. Fighters keep their own category list. "Discipline totals" is its own component and its own view.
  const teamTable: TeamTable = params.get('table') === 'fights' ? 'fights' : 'disciplines';
  const disciplinesView = subject === 'teams' && teamTable === 'disciplines';
  const teamsView = subject === 'teams' && teamTable === 'fights';
  const ovScope = overviewScope(scope);
  const leadersWanted = teamsView && ovScope !== null && !!organizationId && (ovScope !== 'season' || !!seasonId);
  const leaders = useAsync(() => (leadersWanted && ovScope ? fetchTeamLeaders({ scope: ovScope, organizationId, seasonId }) : Promise.resolve(undefined)), [leadersWanted, ovScope, organizationId, seasonId]);
  const cards = useMemo(() => teamOverview(leaders.data ?? []), [leaders.data]);
  const teamOptions = useMemo(() => teamCategoryOptions(cards), [cards]);
  const teamsByCategory = teamsView && uses.category;   // season and organization career: one table per category
  const picked = teamsByCategory ? resolveTeamSelection(teamOptions, categoryParam, genderParam) : null;
  const category = teamsByCategory ? picked?.category ?? '' : categoryParam;
  const gender: Division | '' = teamsByCategory ? picked?.gender ?? '' : genderParam;
  const divisionChoices = teamsByCategory ? DIVISIONS.filter(([k]) => teamOptions.find(o => o.code === category)?.divisions.includes(k)) : DIVISIONS;
  const noTeamRankings = teamsByCategory && leadersWanted && !leaders.loading && leaders.error == null && cards.length === 0;
  const { filter, missing } = buildRankingFilter({ scope, organizationId: uses.organization ? organizationId : '', seasonId, category, gender });
  const ready = !orgs.loading && !seasons.loading && filter !== null && !disciplinesView;
  const list = useAsync(() => (ready && filter ? loadRows(subject, filter) : Promise.resolve(undefined)), [ready, subject, JSON.stringify(filter)]);
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); if (key === 'org') next.delete('season'); setParams(next, { replace: true }); };
  const openLeaderboard = (c: TeamLeaderCard) => { setParams(leaderboardParams(c, scope, params), { replace: true }); window.scrollTo?.({ top: 0, behavior: 'smooth' }); };
  const categories = teamsByCategory ? teamOptions.map(o => [o.code, o.label] as const) : fighterCategoryOptions(category);
  const showOverview = teamsView && ovScope !== null && cards.length > 0;
  const listTitle = teamsByCategory && picked ? `${categoryLabel(picked.category)}${teamOptions.find(o => o.code === picked.category)!.divisions.length > 1 ? ` · ${divisionLabel(picked.gender)}` : ''}` : null;

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="League table" title="Rankings" lede="Who is ahead, by organization, season, category and division. Each organization's ranking is that organization's own official ranking. Fictional test events are never counted." />
      <div className="evfilter">
        <Seg label="Who" value={subject} options={SUBJECTS} onChange={v => set('who', v)} />
        <Seg label="Scope" value={scope} options={RANKING_SCOPES} onChange={v => set('scope', v)} />
        {subject === 'teams' && <Seg label="Team table" value={teamTable} options={TEAM_TABLES} onChange={v => set('table', v)} />}
      </div>
      <div className="evfilter">
        {uses.organization && orgList.length > 0 && (
          <label className="field-in" style={{ flex: '1 1 200px' }}>Organization
            <select value={organizationId} onChange={e => set('org', e.target.value)}>{orgList.map(o => <option key={o.id} value={o.id}>{orgOptionLabel(o)}</option>)}</select></label>
        )}
        {uses.season && seasonList.length > 0 && (
          <label className="field-in" style={{ flex: '1 1 180px' }}>Season
            <select value={seasonId} onChange={e => set('season', e.target.value)}>{seasonList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        )}
        {uses.category && !disciplinesView && categories.length > 0 && (
          <label className="field-in" style={{ flex: '1 1 160px' }}>Category
            <select value={category} onChange={e => set('category', e.target.value)}>{categories.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        )}
        {uses.division && !disciplinesView && gender !== '' && divisionChoices.length > 1 && <Seg label="Division" value={gender} options={divisionChoices} onChange={v => set('division', v)} />}
      </div>
      <p className="muted" style={{ fontSize: 14 }}>{RANKING_POINTS_SENTENCE} <Link to="/formats?tab=tournaments">How tournaments are tiered</Link></p>
      {org && !org.enabled && uses.organization && <p className="panel info" role="status"><Chip>Inactive</Chip> <b>{org.name}.</b> {INACTIVE_ORG_NOTICE}</p>}

      {disciplinesView && !orgs.loading && !seasons.loading && (
        <TeamDisciplineTotals scope={scope} organizationId={organizationId} seasonId={seasonId} params={params} setParams={p => setParams(p, { replace: true })} />
      )}
      {disciplinesView && scope === 'season' && !!organizationId && !seasons.loading && seasonList.length === 0 && (
        <div className="panel info"><h3>No seasons yet</h3><p className="muted">Season rankings are not available for this organization. You can still look up its recorded results.</p><button type="button" className="btn btn-ink" onClick={() => set('scope', 'career')}>See all-time rankings</button></div>
      )}
      {!disciplinesView && (orgs.loading || seasons.loading || list.loading || (leadersWanted && leaders.loading)) && (!missing || (teamsByCategory && leadersWanted)) && <p className="muted">Loading rankings…</p>}
      {orgs.error != null && <div role="alert"><p>{friendlyError(orgs.error, 'Could not load organizations.')}</p><button type="button" className="btn btn-line" onClick={orgs.reload}>Retry organizations</button></div>}
      {seasons.error != null && <div role="alert"><p>{friendlyError(seasons.error, 'Could not load seasons.')}</p><button type="button" className="btn btn-line" onClick={seasons.reload}>Retry seasons</button></div>}
      {leaders.error != null && <div role="alert"><p>{friendlyError(leaders.error, 'Could not load the team categories.')}</p><button type="button" className="btn btn-line" onClick={leaders.reload}>Retry team categories</button></div>}
      {list.error != null && <div role="alert"><p>{friendlyError(list.error, 'Could not load rankings.')}</p><button type="button" className="btn btn-line" onClick={list.reload}>Retry rankings</button></div>}
      {showOverview && <TeamOverview cards={cards} selected={teamsByCategory && picked ? `${picked.category}|${picked.gender}` : null} byCategory={scope !== 'org_all'} onOpen={openLeaderboard} />}
      {noTeamRankings && (
        <div className="panel info"><h3>No team rankings yet</h3>
          <p className="muted">No team has a recorded result for this {scope === 'season' ? 'season' : 'organization'} yet. Categories appear here as soon as teams have results in them.</p></div>
      )}
      {!disciplinesView && listTitle && list.data && list.data.rows.length > 0 && <h2 style={{ fontSize: 22 }}>{listTitle}: full ranking</h2>}
      {missing && !orgs.loading && !seasons.loading && orgs.error == null && seasons.error == null && !disciplinesView && !(teamsByCategory && leadersWanted) && (
        <div className="panel info"><h3>{orgList.length === 0 && scope !== 'career' ? 'No organizations yet' : 'Nothing to show yet'}</h3>
          <p className="muted">{scope === 'season' && organizationId && seasonList.length === 0 ? 'This organization has no seasons yet. You can still look up recorded results.' : orgList.length === 0 && scope !== 'career' ? 'Rankings by organization appear once an organization exists.' : missing}</p>
          {scope === 'season' && organizationId && seasonList.length === 0 && seasons.error == null && <button type="button" className="btn btn-ink" onClick={() => set('scope', 'career')}>See all-time rankings</button>}</div>
      )}
      {!disciplinesView && list.data && list.data.rows.length === 0 && !noTeamRankings && (
        <div className="panel info"><h3>No rankings yet</h3><p className="muted">Nobody has a recorded result for this choice. Rankings come from finished competitions and nothing is estimated.</p></div>
      )}
      <ol className="rankcards">
        {!disciplinesView && (list.data?.rows ?? []).map(r => <RankCard key={r.subjectId} r={r} team={list.data?.basics.get(r.subjectId)?.team ?? null} teams={subject === 'teams'} showDivision={scope === 'org_all' || scope === 'career'} />)}
      </ol>
    </section>
  );
}

function RankCard({ r, team, teams, showDivision }: { r: RankingRow; team: { name: string; slug: string } | null; teams: boolean; showDivision: boolean }) {
  const to = teams ? `/teams/${r.slug}` : `/fighters/${r.subjectId}`;
  return (
    <li className="panel rankcard">
      <span className="rk" aria-label={`Rank ${r.rank}`}>{r.rank}</span>
      <span style={{ minWidth: 0 }}>
        <Link to={to} className="n">{r.name}</Link>
        {team && <span className="l"><Link to={`/teams/${team.slug}`}>{team.name}</Link></span>}
        <span className="l">{medalSummary(r)}{showDivision && r.gender ? ` · ${divisionLabel(r.gender)}` : ''}</span>
      </span>
      <span className="pts"><b>{r.points}</b><span>points</span></span>
    </li>
  );
}

/** "Team fight leaders": the team(s) leading each team competition category (team entries' own results, not fighters' individual points). Tapping one opens that category's full ranking. */
function TeamOverview({ cards, selected, byCategory, onOpen }: { cards: TeamLeaderCard[]; selected: string | null; byCategory: boolean; onOpen: (c: TeamLeaderCard) => void }) {
  return (
    <section aria-labelledby="top-teams-h" style={{ display: 'grid', gap: 10 }}>
      <h2 id="top-teams-h" style={{ fontSize: 22 }}>Team fight leaders</h2>
      {!byCategory && <p className="muted" style={{ fontSize: 14 }}>Leaders in each category over the organization's whole history. Tap one for that category's full ranking.</p>}
      <ul className="topteams">
        {cards.map(c => (
          <li key={c.key}>
            <button type="button" className="panel topteam" aria-current={c.key === selected ? 'true' : undefined} onClick={() => onOpen(c)} aria-label={`${cardTitle(c)}: ${c.leaders.map(l => l.name).join(' and ')}. Open the full ranking.`}>
              <span className="eyebrow">{cardTitle(c)}</span>
              <span className="n">#1 {c.leaders[0].name}</span>
              {c.leaders.length > 1 && <span className="l">Tied with {c.leaders.slice(1).map(l => l.name).join(', ')}</span>}
              <span className="pts"><b>{c.points}</b> points</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

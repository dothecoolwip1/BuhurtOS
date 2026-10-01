import { Link, useSearchParams } from 'react-router-dom';
import { Chip, PageHead, Seg } from '../components/ui';
import { fetchFighterBasics, fetchOrgLites, fetchSeasons } from '../data/careers';
import { fetchFighterRanking, fetchTeamRanking, type RankingRow, type RankingScope } from '../data/fighters';
import {
  buildRankingFilter, categoryLabel, defaultOrganization, DIVISIONS, divisionLabel, INACTIVE_ORG_NOTICE, medalSummary, orgOptionLabel, RANKING_CATEGORIES, RANKING_POINTS_SENTENCE,
  RANKING_SCOPES, scopeUses, seasonsOf, type Division, type RankingSubject
} from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const SUBJECTS: ReadonlyArray<readonly [RankingSubject, string]> = [['fighters', 'Fighters'], ['teams', 'Teams']];
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
  const category = params.get('category') ?? RANKING_CATEGORIES[0][0];
  const genderRaw = params.get('division');
  const gender: Division = isDivision(genderRaw) ? genderRaw : 'men';
  const uses = scopeUses(scope);
  const org = orgList.find(o => o.id === organizationId);
  const { filter, missing } = buildRankingFilter({ scope, organizationId: uses.organization ? organizationId : '', seasonId, category, gender });
  const ready = !orgs.loading && !seasons.loading && filter !== null;
  const list = useAsync(() => (ready && filter ? loadRows(subject, filter) : Promise.resolve(undefined)), [ready, subject, JSON.stringify(filter)]);
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); if (key === 'org') next.delete('season'); setParams(next, { replace: true }); };
  const categories = [...RANKING_CATEGORIES, ...(RANKING_CATEGORIES.some(([k]) => k === category) ? [] : [[category, categoryLabel(category)] as const])];

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="League table" title="Rankings" lede="Who is ahead, by organization, season, category and division." />
      <div className="evfilter">
        <Seg label="Who" value={subject} options={SUBJECTS} onChange={v => set('who', v)} />
        <Seg label="Scope" value={scope} options={RANKING_SCOPES} onChange={v => set('scope', v)} />
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
        {uses.category && (
          <label className="field-in" style={{ flex: '1 1 160px' }}>Category
            <select value={category} onChange={e => set('category', e.target.value)}>{categories.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        )}
        {uses.division && <Seg label="Division" value={gender} options={DIVISIONS} onChange={v => set('division', v)} />}
      </div>
      <p className="muted" style={{ fontSize: 14 }}>{RANKING_POINTS_SENTENCE} <Link to="/formats?tab=tournaments">How tournaments are tiered</Link></p>
      {org && !org.enabled && uses.organization && <p className="panel info" role="status"><Chip>Inactive</Chip> <b>{org.name}.</b> {INACTIVE_ORG_NOTICE}</p>}

      {(orgs.loading || seasons.loading || list.loading) && !missing && <p className="muted">Loading rankings…</p>}
      {orgs.error != null && <p role="alert">{friendlyError(orgs.error, 'Could not load organizations.')}</p>}
      {seasons.error != null && <p role="alert">{friendlyError(seasons.error, 'Could not load seasons.')}</p>}
      {list.error != null && <p role="alert">{friendlyError(list.error, 'Could not load rankings.')}</p>}
      {missing && !orgs.loading && (
        <div className="panel info"><h3>{orgList.length === 0 && scope !== 'career' ? 'No organizations yet' : 'Nothing to show yet'}</h3>
          <p className="muted">{orgList.length === 0 && scope !== 'career' ? 'Rankings by organization appear once an organization exists.' : missing}{scope === 'season' && organizationId && seasonList.length === 0 && ' This organization has no seasons yet.'}</p></div>
      )}
      {list.data && list.data.rows.length === 0 && (
        <div className="panel info"><h3>No rankings yet</h3><p className="muted">Nobody has a recorded result for this choice. Rankings come from finished competitions and nothing is estimated.</p></div>
      )}
      <ol className="rankcards">
        {(list.data?.rows ?? []).map(r => <RankCard key={r.subjectId} r={r} team={list.data?.basics.get(r.subjectId)?.team ?? null} teams={subject === 'teams'} showDivision={scope === 'org_all' || scope === 'career'} />)}
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

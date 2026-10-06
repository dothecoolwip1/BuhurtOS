import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePlatformRole } from '../auth/usePlatformRole';
import { Crest } from '../components/Crest';
import { Chip, TestBadge } from '../components/ui';
import { isSynthetic, useSynthetic } from '../data/synthetic';
import { fetchTeamBySlug, fetchTeamEntries, type DirectoryEntry } from '../data/teamDirectory';
import { fetchFighterBasics, fetchOrgLites, fetchSeasons, fetchTeamRankings } from '../data/careers';
import { fetchDisciplineContributions, fetchEntryRoster, type RankingRow } from '../data/fighters';
import { fetchTeamCareer, fetchTeamDisciplineRanks, fetchTeamFights, fetchTeamFightersRepresented, fetchTeamHeadToHead, fetchTeamRepresentedResults, type TeamDisciplineRank, type TeamFight } from '../data/careerProfile';
import {
  CAREER_FILTER, careerFilters, careerLines, careerTotal, contextFor, contributionScope, disciplineTotals, fightsIn, headToHeadLine, medalsText, newestFirst, official, opponents, pointsText,
  rankingHighlights, recordText, representedList, representedText, splitText, teamEventHistory, type CareerFilter
} from '../lib/careerProfile';
import { categoryLabel, divisionLabel, orgName, plural, rosterGroups, todayIso } from '../lib/careerView';
import { fetchTeamEditRights } from '../data/teamEdit';
import { fetchClubEnabled } from '../data/clubMembership';
import { CLAIMED_LABEL, fetchMyTeamIds, fetchTeamRoster } from '../data/teamManager';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { listedFromLabel, locationText, NO_SOURCE_LABEL, PENDING_LABEL, relationLabel, roleLabel, sinceLabel } from '../lib/teamDirectory';
import { SocialLinksRow } from '../components/SocialLinks';
import { useAsync } from '../lib/useAsync';
import { RosterVisibility } from '../components/Lifecycle';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { crestTeam } from './TeamsPage';
import { Block, DisciplineList, FilterBar, FormStrip, MedalChip, RankingLines, SummaryTiles, TeamFightRow } from '../components/CareerBlocks';

export function TeamPage() {
  const { slug = '' } = useParams();
  const team = useAsync(() => fetchTeamBySlug(slug), [slug]);
  useDocumentTitle(team.data?.name ?? 'Team');
  if (team.loading) return <p className="muted">Loading team…</p>;
  if (team.error != null) return <p role="alert">{friendlyError(team.error, 'Could not load this team.')}</p>;
  if (!team.data) {
    return (
      <section className="panel info"><h3>Team not found</h3>
        <p style={{ color: 'var(--muted)' }}>This team does not exist, or it is not public yet.</p>
        <Link className="btn btn-line" to="/teams">All teams</Link></section>
    );
  }
  return <Workspace t={team.data} />;
}

/**
 * Pack 10: the sporting record of a team. Two things on purpose kept apart: the TEAM FIGHT RECORD (what the team itself fought: 5v5, 3v3, ...)
 * and the DISCIPLINE TOTALS (its fighters' individual ranking points added up, from the Team Discipline rankings). The current roster follows the
 * Pack 09D rules (hidden and inactive fighters are not current members); historical rosters are the rosters recorded at each competition.
 */
function Workspace({ t }: { t: DirectoryEntry }) {
  const synthetic = useSynthetic();
  const fictional = isSynthetic(synthetic, 'team', t.id);
  const context = contextFor(fictional);
  const { session } = useAuth();
  const { isOwner } = usePlatformRole();
  const userId = session?.user.id;
  const mineTeams = useAsync(() => (userId ? fetchMyTeamIds() : Promise.resolve([])), [userId]);
  const onTeam = (mineTeams.data ?? []).includes(t.id);
  const rights = useAsync(() => (userId ? fetchTeamEditRights(t.id) : Promise.resolve({ edit: false, rename: false })), [t.id, userId]);
  const roster = useAsync(() => fetchTeamRoster(t.id), [t.id]);
  const club = useAsync(() => fetchClubEnabled(t.id), [t.id]);
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#roster' && !roster.loading) document.getElementById('roster')?.scrollIntoView(); }, [hash, roster.loading]);
  const entries = useAsync(() => fetchTeamEntries(t.id), [t.id]);
  const career = useAsync(() => fetchTeamCareer(t.id), [t.id]);
  const fights = useAsync(() => fetchTeamFights(t.id), [t.id]);
  const representedResults = useAsync(() => fetchTeamRepresentedResults(t.id), [t.id]);
  const representedFighters = useAsync(() => fetchTeamFightersRepresented(t.id), [t.id]);
  const h2h = useAsync(() => fetchTeamHeadToHead(t.id), [t.id]);
  const rankings = useAsync(() => fetchTeamRankings(t.id), [t.id]);
  const disciplines = useAsync(() => fetchTeamDisciplineRanks(t.id), [t.id]);
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const basics = useAsync(() => fetchFighterBasics((roster.data ?? []).map(m => m.fighterId)), [(roster.data ?? []).map(m => m.fighterId).join(',')]);
  const today = todayIso();
  const orgById = useMemo(() => new Map((orgs.data ?? []).map(o => [o.id, o])), [orgs.data]);
  const seasonById = useMemo(() => new Map((seasons.data ?? []).map(s => [s.id, s])), [seasons.data]);
  const rankingLabel = (r: RankingRow) => {
    const org = r.organizationId ? orgById.get(r.organizationId) : undefined;
    const season = r.seasonId ? seasonById.get(r.seasonId) : undefined;
    return [org ? orgName(org) : 'All organizations', season?.name ?? (r.scope === 'season' ? null : 'all time'), r.category ? categoryLabel(r.category) : null, divisionLabel(r.gender) || null].filter(Boolean).join(' · ');
  };
  const memberOrg = t.affiliations.find(a => a.relation === 'member') ?? t.affiliations[0];
  const memberOrgId = memberOrg ? (orgs.data ?? []).find(o => o.slug === memberOrg.organizationSlug)?.id ?? null : null;

  // filter: career, a season, an organization; it narrows the team fight record, the discipline totals and the lists
  const filterSource = useMemo(() => [...(career.data ?? [])], [career.data]);
  const filters = useMemo(() => {
    const base = careerFilters(filterSource, seasons.data ?? [], orgs.data ?? [], context);
    // seasons with discipline totals but no team fight (a duel-only team) are filters too
    const extra = (disciplines.data ?? []).filter(d => d.scope === 'season' && d.seasonId && seasonById.has(d.seasonId) && !base.some(f => f.kind === 'season' && f.id === d.seasonId))
      .map(d => d.seasonId as string).filter((v, i, a) => a.indexOf(v) === i)
      .map(id => ({ kind: 'season' as const, id, label: seasonById.get(id)!.name }));
    return [...base, ...extra].sort((a, b) => (a.kind === 'career' ? -1 : b.kind === 'career' ? 1 : a.kind !== b.kind ? (a.kind === 'season' ? -1 : 1) : a.kind === 'season' ? (seasonById.get(b.id!)?.endsOn ?? '').localeCompare(seasonById.get(a.id!)?.endsOn ?? '') : 0));
  }, [filterSource, seasons.data, orgs.data, context, disciplines.data, seasonById]);
  const [filter, setFilter] = useState<CareerFilter>(CAREER_FILTER);
  const total = careerTotal(career.data ?? [], filter, context);
  const careerTop = careerTotal(career.data ?? [], CAREER_FILTER, context);
  const lines = careerLines(career.data ?? [], filter, context);
  const officialFights = useMemo(() => newestFirst(official(fightsIn(fights.data ?? [], filter), context)), [fights.data, filter, context]);
  const nameOf = (fighterId: string) => (representedFighters.data ?? []).find(f => f.fighterId === fighterId)?.displayName;
  // a real team's history never shows a fictional event's rows (a fictional team's shows only those); excluded events stay, marked
  const inContext = <T extends { synthetic: boolean }>(rows: T[]) => rows.filter(r => r.synthetic === (context === 'test'));
  const events = useMemo(() => teamEventHistory(inContext(fightsIn(fights.data ?? [], filter)), inContext(fightsIn(representedResults.data ?? [], filter)), nameOf), [fights.data, representedResults.data, filter, representedFighters.data, context]);
  const totals = useMemo(() => disciplineTotals(disciplines.data ?? [], filter, filter.kind === 'season' ? (seasonById.get(filter.id ?? '')?.organizationId ?? memberOrgId) : memberOrgId), [disciplines.data, filter, seasonById, memberOrgId]);
  const highlights = useMemo(() => rankingHighlights(rankings.data ?? [], seasons.data ?? [], today), [rankings.data, seasons.data, today]);
  const bestDisciplines = useMemo(() => disciplineTotals(disciplines.data ?? [], CAREER_FILTER, memberOrgId).slice(0, 2), [disciplines.data, memberOrgId]);
  const opponentList = useMemo(() => opponents(h2h.data ?? [], context), [h2h.data, context]);
  const rosterIds = useMemo(() => new Set((roster.data ?? []).map(m => m.fighterId)), [roster.data]);
  const represented = useMemo(() => representedList(representedFighters.data ?? [], context, rosterIds), [representedFighters.data, context, rosterIds]);
  const [params, setParams] = useSearchParams();
  const vs = params.get('vs');
  const chooseOpponent = (teamId: string | null) => { const next = new URLSearchParams(params); if (teamId) next.set('vs', teamId); else next.delete('vs'); setParams(next, { replace: true }); };
  const upcomingEntries = (entries.data ?? []).filter(e => e.endsOn >= today && e.eventStatus !== 'cancelled').sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const where = locationText(t);
  const nothingYet = !career.loading && !career.error && !careerTop && !disciplines.loading && (disciplines.data ?? []).length === 0;

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <Link className="more" to="/teams">← All teams</Link>
      <header className="teamhead">
        <Crest team={crestTeam(t)} size={88} />
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Team</p>
          <h1 style={{ fontSize: 'clamp(34px,6vw,72px)', marginTop: 8, overflowWrap: 'anywhere' }}>{t.name}</h1>
          <p className="badges" style={{ marginTop: 8 }}>
            {fictional && <TestBadge synthetic />}
            {t.status === 'pending' && <Chip tone="brass">{PENDING_LABEL}</Chip>}
            {memberOrg && <Chip tone="steel">{memberOrg.organizationName}</Chip>}
          </p>
          <div className="phead"><div className="sub">
            {where && <span>{where}</span>}
            {roster.data && <span>{plural(roster.data.length, 'active fighter')} on the roster</span>}
            {t.foundedYear && <span>Founded {t.foundedYear} <span className="muted">(as stated by the team)</span></span>}
          </div></div>
          {careerTop && (
            <p className="careerline" data-testid="team-line">
              <b>{plural(careerTop.matches, 'team fight')}</b> · {recordText(careerTop)}{careerTop.podiums > 0 && <> · {careerTop.golds} gold · {careerTop.silvers} silver · {careerTop.bronzes} bronze</>}
              {context === 'test' && <> <Chip>Test data</Chip></>}
            </p>
          )}
          {bestDisciplines.length > 0 && (
            <p className="careerline" data-testid="discipline-line" style={{ fontSize: 15 }}>
              Discipline totals: {bestDisciplines.map((d, i) => <span key={d.category}>{i > 0 && ' · '}<b style={{ fontSize: 15 }}>#{d.rank}</b> {d.categoryName}</span>)}
            </p>
          )}
          <RankingLines rows={highlights} label={rankingLabel} more="/rankings?who=teams" />
          <SocialLinksRow links={t.socialLinks} website={t.website} label={`${t.name} on the web`} />
        </div>
      </header>

      {rights.data?.edit && (
        <div className="evfilter">
          <Link className="btn btn-ink" to={`/teams/${t.slug}/edit`}>Edit team</Link>
          <span className="muted" style={{ fontSize: 14 }}>Change the description, links, shield and emblem.</span>
        </div>
      )}

      {club.data && (
        <div className="evfilter">
          <Link className="btn btn-line" to={`/teams/${t.slug}/membership`} data-testid="club-membership-link">Club membership</Link>
          <span className="muted" style={{ fontSize: 14 }}>Members: your membership, dues and AGM voting status.</span>
        </div>
      )}

      {t.status === 'approved' && !isOwner && !(session && (mineTeams.loading || onTeam)) && (
        <div className="evfilter">
          {session
            ? <Link className="btn btn-ink" to={`/team-manager?join=${encodeURIComponent(t.slug)}`}>Request to join</Link>
            : <Link className="btn btn-line" to="/account">Sign in to request to join</Link>}
          <span className="muted" style={{ fontSize: 14 }}>The team captain decides who joins.</span>
        </div>
      )}

      <section className="panel info" id="roster" style={{ scrollMarginTop: 96 }}>
        <h2 className="h3">Current roster</h2>
        {rights.data?.edit && <RosterVisibility teamId={t.id} onChanged={() => roster.reload()} />}
        {roster.loading && <p className="muted">Loading roster…</p>}
        {roster.error != null && <p role="alert">{friendlyError(roster.error, 'Could not load the roster.')}</p>}
        {!roster.loading && !roster.error && (roster.data ?? []).length === 0 && <p className="muted">No active fighters are on the public roster yet.</p>}
        {(roster.data ?? []).length > 0 && (() => {
          const byId = new Map((roster.data ?? []).map(m => [m.fighterId, m]));
          const groups = rosterGroups((roster.data ?? []).map(m => ({ fighterId: m.fighterId, displayName: m.displayName, gender: basics.data?.get(m.fighterId)?.gender ?? null })));
          const parts = ([['Men', groups.male], ['Women', groups.female], ['Other', groups.other], [groups.male.length + groups.female.length + groups.other.length > 0 ? 'Gender not stated' : 'Fighters', groups.unspecified]] as const).filter(([, list]) => list.length > 0);
          return (
            <>
              <p className="muted">{plural((roster.data ?? []).length, 'fighter')}{groups.male.length + groups.female.length > 0 && ` · ${groups.male.length} men, ${groups.female.length} women`}</p>
              {parts.map(([title, list]) => (
                <div key={title} className="rostergroup">
                  {parts.length > 1 && <p className="eyebrow">{title} ({list.length})</p>}
                  <ul className="plain roster">
                    {list.map(person => {
                      const m = byId.get(person.fighterId);
                      if (!m) return null;
                      return (
                        <li key={m.fighterId}>
                          <Link to={`/fighters/${m.fighterId}`}><b>{m.displayName}</b></Link>
                          <span className="s">
                            {m.isCaptain && <Chip tone="brass">Captain</Chip>}
                            {!m.isCaptain && m.role !== 'fighter' && <Chip>{roleLabel(m.role)}</Chip>}
                            {m.mercenary && <Chip>Mercenary</Chip>}
                            {sinceLabel(m.since) && <span className="muted">{sinceLabel(m.since)}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          );
        })()}
        <p className="muted" style={{ fontSize: 13 }}>Active fighters the team shows publicly. A name on a roster is a sporting record, not an account. Inactive fighters and fighters the team keeps off the public roster are not listed here; their history stays below.</p>
      </section>

      {nothingYet && (
        <section className="panel info" data-testid="team-empty">
          <h2 className="h3">Team record</h2>
          <p className="muted">No official results are recorded for {t.name} yet. The record fills in as organizers record team fights and results on BuhurtOS.</p>
        </section>
      )}

      {(careerTop || (disciplines.data ?? []).length > 0) && <FilterBar filters={filters} value={filter} onChange={setFilter} />}

      <Block title={filter.kind === 'career' ? 'Team fight record' : `Team fight record · ${filter.label}`} state={career} empty={() => !total} id="team-record"
        keep={careerTop ? <p className="muted">No team fights in {filter.label}.</p> : undefined}
        note={<>Group fights the team itself entered (5v5, 3v3 and so on). Its fighters' individual results are never in these numbers; they are under Discipline totals. {context === 'test' ? 'This is a fictional team: everything here is test data.' : 'Fictional events and events excluded from official statistics never count.'}</>}>
        {() => total && (
          <>
            <SummaryTiles t={total} team />
            {lines.length > 0 && <DisciplineList lines={lines} label="Record by category" />}
            {officialFights.length > 0 && <FormStrip outcomes={officialFights.slice(0, 10).map(f => f.outcome)} label="Form, newest first" />}
          </>
        )}
      </Block>

      <Block title="Discipline totals" state={disciplines} empty={() => totals.length === 0} id="discipline-totals"
        keep={(disciplines.data ?? []).length > 0 ? <p className="muted">No discipline totals in {filter.label}.</p> : undefined}
        note="The individual ranking points the team's fighters earned in each discipline while representing it, added up: the Team Discipline ranking. Separate from the team fight record above."
        aside={<Link className="more" to="/rankings?who=teams&table=disciplines">Team discipline rankings →</Link>}>
        {() => <ul className="plain disc">{totals.map(d => <DisciplineTotal key={d.category} d={d} teamId={t.id} scope={contributionScope(filter, filter.kind === 'season' ? (seasonById.get(filter.id ?? '')?.organizationId ?? memberOrgId) : memberOrgId)} />)}</ul>}
      </Block>

      <Block title="Fighters represented in results" state={representedFighters} empty={() => represented.length === 0} id="represented"
        note="Everyone who earned an individual result for the team or fought one of its team fights, from the official record. Not a membership list: BuhurtOS does not guess when someone joined or left.">
        {() => <RepresentedFighters list={represented} />}
      </Block>

      <Block title="Event history" state={fights} empty={() => events.length === 0} id="events"
        note="Team competed: the team entered the group fight itself. Represented: its fighters fought individual competitions for it.">
        {() => (
          <ul className="plain evhist">
            {events.map(e => (
              <li key={e.eventId}>
                <div className="rowline">
                  <span style={{ minWidth: 0 }}><Link to={`/events/${e.eventSlug}`}><b>{e.eventName}</b></Link>{e.synthetic && <> <TestBadge synthetic /></>}{e.statsExcluded && <> <Chip>Not counted in statistics</Chip></>}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{dateRange(e.startsOn, e.endsOn)}{e.organizationId && orgById.get(e.organizationId) ? ` · ${orgName(orgById.get(e.organizationId)!)}` : ''}</span>
                </div>
                {e.direct.map(d => (
                  <div key={d.competitionId} className="placing" style={{ marginTop: 6 }}>
                    <Chip tone="steel">Team competed</Chip> <Link to={`/events/${e.eventSlug}#results-${d.competitionId}`}>{d.competitionName}</Link>: {d.wins} W · {d.losses} L{d.draws > 0 ? ` · ${d.draws} D` : ''}
                    {d.place !== null && <> · <MedalChip medal={d.medal} place={d.place} /> · {pointsText(d.points)}</>}
                  </div>
                ))}
                {e.represented.results > 0 && (
                  <div className="placing" style={{ marginTop: 6 }}>
                    <Chip>Represented</Chip> {plural(e.represented.fighters, 'fighter')} in {plural(e.represented.results, 'individual competition')}{medalsText({ golds: e.represented.golds, silvers: e.represented.silvers, bronzes: e.represented.bronzes }) && ` · ${medalsText({ golds: e.represented.golds, silvers: e.represented.silvers, bronzes: e.represented.bronzes })}`}
                    {e.represented.names.length > 0 && <span className="muted"> · {e.represented.names.join(', ')}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Team fight history" state={fights} empty={() => officialFights.length === 0} id="team-fights" note="Newest first. The roster is the one recorded for that competition, never today's roster.">
        {() => <TeamFightList fights={officialFights} />}
      </Block>

      <Block title="Head to head" state={h2h} empty={() => opponentList.length === 0} id="head-to-head" note="Team fights against another team, counted from the fights themselves. Never built from discipline totals.">
        {() => <TeamHeadToHead me={t.name} list={opponentList} vs={vs} choose={chooseOpponent} />}
      </Block>

      <div className="panel info">
        <h2 className="h3">About</h2>
        {t.description ? <p>{t.description}<br /><span className="muted" style={{ fontSize: 13 }}>Written by the team, not checked by BuhurtOS.</span></p> : <p className="muted">The team has not added a description yet.</p>}
        <p className="muted" style={{ fontSize: 13 }}>{t.sources.length > 0 ? t.sources.map(s => listedFromLabel(s)).join(' · ') : NO_SOURCE_LABEL}. A listing is not an endorsement, and does not mean the team uses BuhurtOS.</p>
      </div>

      {(t.affiliations.length > 0 || t.claimedOrganizations.length > 0) && <div className="panel info">
        <h2 className="h3">Affiliations</h2>
        {t.affiliations.length > 0 && (
          <ul className="plain">
            {t.affiliations.map(a => (
              <li key={a.affiliationId}>
                <Link to={`/rankings?who=teams&scope=org_all&org=${encodeURIComponent(a.organizationSlug)}`}><b>{a.organizationName}</b></Link> <Chip tone="steel">{relationLabel(a.relation)}</Chip>
                <div className="muted" style={{ fontSize: 13 }}>
                  {a.sources.length > 0 ? a.sources.map(s => listedFromLabel(s)).join(' · ') : NO_SOURCE_LABEL}
                  {a.fromDate && ` · from ${a.fromDate}`}{a.toDate && ` · until ${a.toDate}`}
                </div>
              </li>
            ))}
          </ul>
        )}
        {t.claimedOrganizations.length > 0 && (
          <>
            <p className="eyebrow">Claimed by the team</p>
            <ul className="plain">{t.claimedOrganizations.map(o => <li key={o}><b>{o}</b> <Chip>{CLAIMED_LABEL}</Chip></li>)}</ul>
          </>
        )}
        <p className="muted" style={{ fontSize: 13 }}>Affiliations are recorded one by one. They are never worked out from where a team is. A listed organization has not endorsed BuhurtOS.</p>
      </div>}

      {(entries.loading || entries.error != null || upcomingEntries.length > 0) && <div className="panel info">
        <h2 className="h3">Upcoming events</h2>
        {entries.loading && <p className="muted">Loading events…</p>}
        {entries.error != null && <p role="alert">{friendlyError(entries.error, 'Could not load events.')}</p>}
        <ul className="plain">
          {upcomingEntries.map(e => (
            <li key={e.entryId}>
              <Link to={`/events/${e.eventSlug}`}><b>{e.eventName}</b></Link>{' '}
              {e.eventStatus === 'draft' && <Chip tone="brass">Draft: only visible to organizers</Chip>}
              <div className="muted" style={{ fontSize: 13 }}>{dateRange(e.startsOn, e.endsOn)} · {e.competitionName}</div>
            </li>
          ))}
        </ul>
      </div>}
    </section>
  );
}

/** One discipline total with "Show fighters": who earned it (the same breakdown as Rankings > Teams). */
function DisciplineTotal({ d, scope, teamId }: { d: TeamDisciplineRank; scope: ReturnType<typeof contributionScope>; teamId: string }) {
  const [open, setOpen] = useState(false);
  const lines = useAsync(() => (open ? fetchDisciplineContributions({ ...scope, category: d.category, gender: null, teamId }) : Promise.resolve(undefined)), [open, JSON.stringify(scope), d.category, teamId]);
  return (
    <li className="discline" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'start' }}>
      <span style={{ minWidth: 0 }}>
        <b>#{d.rank} {d.categoryName}</b>
        <span className="l">{plural(d.fighters, 'fighter')} · {plural(d.results, 'result')}</span>
        <button type="button" className="btn btn-line" style={{ marginTop: 6 }} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide fighters' : 'Show fighters'}</button>
        {open && (
          <div style={{ marginTop: 6 }}>
            {lines.loading && <p className="muted">Loading…</p>}
            {lines.error != null && <p role="alert">{friendlyError(lines.error, 'Could not load the fighters.')}</p>}
            {lines.data && <ContributionList rows={lines.data} total={d.points} />}
          </div>
        )}
      </span>
      <span className="pts"><b>{d.points}</b><span>{d.points === 1 ? 'point' : 'points'}</span></span>
    </li>
  );
}
function ContributionList({ rows, total }: { rows: Array<{ fighterId: string; displayName: string; points: number }>; total: number }) {
  return (
    <ul className="contriblist" aria-label="Fighters behind this total">
      {rows.map(c => <li key={c.fighterId}><Link to={`/fighters/${c.fighterId}`}>{c.displayName}</Link><b>{c.points}</b></li>)}
      <li><span>Total</span><b>{total}</b></li>
    </ul>
  );
}

function RepresentedFighters({ list }: { list: ReturnType<typeof representedList> }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 8);
  return (
    <>
      <ul className="plain roster">
        {shown.map(f => (
          <li key={f.fighterId}>
            <Link to={`/fighters/${f.fighterId}`}><b>{f.displayName}</b></Link>
            <span className="s">
              {f.current && <Chip tone="brass">On the roster</Chip>}
              {!f.active && <Chip>Inactive</Chip>}
              <span className="muted">{representedText(f)}{f.lastOn ? ` · last ${f.lastOn.slice(0, 4)}` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
      {list.length > 8 && <button type="button" className="btn btn-line" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${plural(list.length, 'fighter')}`}</button>}
    </>
  );
}

function TeamFightList({ fights }: { fights: readonly TeamFight[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? fights.slice(0, 100) : fights.slice(0, 5);
  return (
    <>
      <ul className="plain" aria-label="Team fights">{shown.map(f => <TeamFightRow key={f.matchId} f={f} roster={entryId => <EntryRosterList entryId={entryId} />} />)}</ul>
      {fights.length > 5 && <button type="button" className="btn btn-line" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show last 5' : `Show last ${Math.min(100, fights.length)}`}</button>}
    </>
  );
}
function EntryRosterList({ entryId }: { entryId: string }) {
  const rows = useAsync(() => fetchEntryRoster(entryId), [entryId]);
  if (rows.loading) return <p className="muted" style={{ margin: 0 }}>Loading roster…</p>;
  if (rows.error != null) return <p role="alert" style={{ margin: 0 }}>{friendlyError(rows.error, 'Could not load the roster.')}</p>;
  if (!rows.data || rows.data.length === 0) return <p className="muted" style={{ margin: 0 }}>No roster was recorded for this fight.</p>;
  return (
    <ul className="plain rosterlist" aria-label="Roster that day">
      {rows.data.map(r => <li key={r.fighterId}><Link className="chip" to={`/fighters/${r.fighterId}`}>{r.displayName}{r.role !== 'fighter' ? ` · ${r.role}` : ''}</Link></li>)}
    </ul>
  );
}

function TeamHeadToHead({ me, list, vs, choose }: { me: string; list: ReturnType<typeof opponents>; vs: string | null; choose: (id: string | null) => void }) {
  const [all, setAll] = useState(false);
  const chosen = vs ? list.find(o => o.id === vs) : undefined;
  useEffect(() => { if (vs && list.length > 0 && !chosen) choose(null); }, [vs, chosen, list.length, choose]);
  if (chosen) {
    return (
      <div className="h2h" data-testid="team-head-to-head">
        <p className="eyebrow">{me} vs {chosen.name}</p>
        <p className="h2h-line"><b>{plural(chosen.meetings, 'meeting')}</b> · {headToHeadLine(me, chosen)}</p>
        <ul className="plain" aria-label="By category">
          {chosen.byCategory.map(c => <li key={`${c.category}:${c.gender}`}><b>{c.categoryName}</b>{c.gender && c.gender !== 'open' ? ` (${divisionLabel(c.gender)})` : ''} <span className="muted">{splitText(c)}</span></li>)}
        </ul>
        <div className="evfilter">
          {chosen.slug && <Link className="btn btn-line" to={`/teams/${chosen.slug}`}>Open {chosen.name}</Link>}
          <button type="button" className="btn btn-line" onClick={() => choose(null)}>All opponents</button>
        </div>
      </div>
    );
  }
  const shown = all ? list : list.slice(0, 6);
  return (
    <>
      <ul className="plain opponents" aria-label="Opponent teams">
        {shown.map(o => (
          <li key={o.id}>
            <button type="button" className="panel opp" onClick={() => choose(o.id)} aria-label={`Head to head with ${o.name}: ${plural(o.meetings, 'meeting')}, ${headToHeadLine(me, o)}`}>
              <span className="n">{o.name}</span>
              <span className="l">{plural(o.meetings, 'meeting')} · {o.wins} W · {o.losses} L{o.draws > 0 ? ` · ${o.draws} D` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.length > 6 && <button type="button" className="btn btn-line" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${plural(list.length, 'opponent')}`}</button>}
    </>
  );
}

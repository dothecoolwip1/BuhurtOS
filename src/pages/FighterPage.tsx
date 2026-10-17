import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FighterLifecycle } from '../components/Lifecycle';
import { useAuth } from '../auth/AuthContext';
import { Chip, TestBadge } from '../components/ui';
import { isSynthetic, useSynthetic } from '../data/synthetic';
import { fetchFighterAppearances, fetchFighterMemberships, fetchFighterRankings, fetchOrgLites, fetchSeasons, type Appearance } from '../data/careers';
import { fetchFighterProfile, fetchMyFighterId, avatarUrl, type FighterProfile, type RankingRow } from '../data/fighters';
import { fetchFighterCareer, fetchFighterFights, fetchFighterHeadToHead, fetchFighterResults, type Fight } from '../data/careerProfile';
import { fetchFighterLifecycle } from '../data/lifecycle';
import {
  CAREER_FILTER, careerFilters, careerHighlights, careerLines, careerTotal, contextFor, eventHistory, fightsIn, headToHeadLine, newestFirst, official, opponents, pointsText,
  rankingHighlights, recordText, splitText, teamsRepresented, yearSpan, type CareerFilter
} from '../lib/careerProfile';
import { categoryLabel, divisionLabel, genderLabel, guestLabel, INACTIVE_ORG_NOTICE, membershipSpan, orgName, plural, sortFighterRankings, sortMemberships, todayIso } from '../lib/careerView';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { HISTORY_ROLE_NOTE, historyRoleLabel } from '../lib/teamDirectory';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { SocialLinksRow } from '../components/SocialLinks';
import { FighterGallery } from '../components/FighterGallery';
import { ClaimRequest } from '../components/ClaimRequest';
import { FighterDisciplineRecord } from '../components/discipline/FighterDisciplineRecord';
import { PastMedals } from '../components/PastMedals';
import { fetchClaimStates } from '../data/entrants';
import { Block, DisciplineList, FightRow, FilterBar, FormStrip, HighlightList, MedalChip, RankingLines, SummaryTiles } from '../components/CareerBlocks';

export function FighterPage() {
  const { id = '' } = useParams();
  const profile = useAsync(() => fetchFighterProfile(id), [id]);
  useDocumentTitle(profile.data?.displayName ?? 'Fighter');
  if (profile.loading) return <p className="muted">Loading fighter…</p>;
  if (profile.error != null) return <p role="alert">{friendlyError(profile.error, 'Could not load this fighter.')}</p>;
  if (!profile.data) {
    return (
      <section className="panel info"><h3>Fighter not found</h3>
        <p className="muted">This fighter does not exist, or the link is not right.</p>
        <Link className="btn btn-line" to="/fighters">All fighters</Link></section>
    );
  }
  return <Career p={profile.data} />;
}

/**
 * Pack 10: a sporting career profile. Who they are, whether they compete now, who they fight for, what they fight, how it has gone: the summary,
 * the disciplines, the recent fights, the events (with the team represented THERE), head to head. Every number is official (fictional and excluded
 * events never count); a fictional fighter's page shows its own fictional history, labelled.
 */
function Career({ p }: { p: FighterProfile }) {
  const id = p.fighterId;
  const { session } = useAuth();
  const userId = session?.user.id;
  const synthetic = useSynthetic();
  const fictional = isSynthetic(synthetic, 'fighter', id);
  const context = contextFor(fictional);
  const mine = useAsync(() => (userId ? fetchMyFighterId() : Promise.resolve(null)), [userId]);
  const isMine = mine.data === id;
  const claim = useAsync(() => fetchClaimStates([id]), [id]);
  const lifecycle = useAsync(() => fetchFighterLifecycle(id), [id]);
  // Past medals the fighter adds themself (PastMedals) change the career summary and the results: both re-read in place.
  const [medalKey, setMedalKey] = useState(0);
  const career = useAsync(() => fetchFighterCareer(id), [id], [medalKey]);
  const fights = useAsync(() => fetchFighterFights(id), [id]);
  const results = useAsync(() => fetchFighterResults(id), [id], [medalKey]);
  const h2h = useAsync(() => fetchFighterHeadToHead(id), [id]);
  const rankings = useAsync(() => fetchFighterRankings(id), [id]);
  const memberships = useAsync(() => fetchFighterMemberships(id), [id]);
  const appearances = useAsync(() => fetchFighterAppearances(id), [id]);
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const today = todayIso();
  const orgById = useMemo(() => new Map((orgs.data ?? []).map(o => [o.id, o])), [orgs.data]);
  const seasonById = useMemo(() => new Map((seasons.data ?? []).map(s => [s.id, s])), [seasons.data]);
  const rankingLabel = (r: RankingRow) => {
    const org = r.organizationId ? orgById.get(r.organizationId) : undefined;
    const season = r.seasonId ? seasonById.get(r.seasonId) : undefined;
    return [org ? orgName(org) : 'All organizations', season?.name ?? (r.scope === 'org_career' ? 'all time' : r.scope === 'career' ? 'all time' : null), r.category ? categoryLabel(r.category) : null, divisionLabel(r.gender) || null].filter(Boolean).join(' · ');
  };

  // filter: career, a season, an organization (only those with a record)
  const filters = useMemo(() => careerFilters(career.data ?? [], seasons.data ?? [], orgs.data ?? [], context), [career.data, seasons.data, orgs.data, context]);
  const [filter, setFilter] = useState<CareerFilter>(CAREER_FILTER);
  const total = careerTotal(career.data ?? [], filter, context);
  const individual = careerLines(career.data ?? [], filter, context, 'individual');
  const teamLines = careerLines(career.data ?? [], filter, context, 'team');
  const officialFights = useMemo(() => newestFirst(official(fightsIn(fights.data ?? [], filter), context)), [fights.data, filter, context]);
  const events = useMemo(() => eventHistory(fightsIn(results.data ?? [], filter), fightsIn(fights.data ?? [], filter)), [results.data, fights.data, filter]);
  const officialEvents = useMemo(() => events.filter(e => !e.statsExcluded && (context === 'test' ? e.synthetic : !e.synthetic)), [events, context]);
  const represented = useMemo(() => teamsRepresented(officialEvents), [officialEvents]);
  const highlights = useMemo(() => rankingHighlights(rankings.data ?? [], seasons.data ?? [], today), [rankings.data, seasons.data, today]);
  const careerTop = careerTotal(career.data ?? [], CAREER_FILTER, context);
  const allOfficialFights = useMemo(() => newestFirst(official(fights.data ?? [], context)), [fights.data, context]);
  const topDisciplines = careerLines(career.data ?? [], CAREER_FILTER, context, 'individual').slice(0, 3).map(l => l.categoryName ?? l.category ?? '');
  const shownDisciplines = topDisciplines.length > 0 ? topDisciplines : p.disciplines.map(categoryLabel);

  // head to head: ?vs=<fighter id>, chosen from the opponents list or by tapping an opponent in the fight list
  const [params, setParams] = useSearchParams();
  const vs = params.get('vs');
  const chooseOpponent = (fighterId: string | null) => {
    const next = new URLSearchParams(params);
    if (fighterId) next.set('vs', fighterId); else next.delete('vs');
    setParams(next, { replace: true });
    if (fighterId) setTimeout(() => document.getElementById('head-to-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const opponentList = useMemo(() => opponents(h2h.data ?? [], context), [h2h.data, context]);
  const inactive = !!lifecycle.data?.inactiveAt;
  const unclaimed = claim.data?.get(id) === false && !fictional;
  const where = [p.city, p.region, p.country].filter(Boolean).join(', ');
  const facts = [p.age !== null && `Age ${p.age}`, genderLabel(p.gender), p.joinedYear !== null && `Fighting since ${p.joinedYear}`].filter(Boolean) as string[];
  const hasStory = Boolean(p.fightingStyle || p.bio || p.highlights.length > 0);
  const nothingYet = !career.loading && !career.error && !careerTop;

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <Link className="more" to="/fighters">← All fighters</Link>
      <header className="teamhead">
        {avatarUrl(p.avatarPath)
          ? <img className="avatar" src={avatarUrl(p.avatarPath)!} alt={`Photo of ${p.displayName}`} width={120} height={120} />
          : <span className="avatar" aria-hidden="true">{p.displayName.charAt(0).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Fighter</p>
          <h1 style={{ fontSize: 'clamp(34px,6vw,72px)', marginTop: 8, overflowWrap: 'anywhere' }}>{p.displayName}</h1>
          <p className="badges" style={{ marginTop: 8 }}>
            {lifecycle.data && (inactive ? <Chip>Inactive</Chip> : <Chip tone="win">Active</Chip>)}
            {fictional && <TestBadge synthetic />}
            {unclaimed && <Chip>Unclaimed profile</Chip>}
          </p>
          <div className="phead"><div className="sub">
            {p.team ? <span>{inactive ? 'Last team: ' : 'Fights for '}<Link to={`/teams/${p.team.slug}`}><b>{p.team.name}</b></Link></span> : <span>No team</span>}
            {shownDisciplines.length > 0 && <span>{shownDisciplines.join(' · ')}</span>}
            {where && <span>{where}</span>}
            {facts.map(f => <span key={f}>{f}</span>)}
          </div></div>
          {careerTop && (
            <p className="careerline" data-testid="career-line">
              <b>{plural(careerTop.matches, 'fight')}</b> · {recordText(careerTop)}{careerTop.podiums > 0 && <> · {careerTop.golds} gold · {careerTop.silvers} silver · {careerTop.bronzes} bronze</>} · {pointsText(careerTop.points)}
              {context === 'test' && <> <Chip>Test data</Chip></>}
            </p>
          )}
          <RankingLines rows={highlights} label={rankingLabel} more="/rankings" />
          <SocialLinksRow links={p.socialLinks} label={`${p.displayName} on the web`} />
          {isMine && <p style={{ marginTop: 10 }}><Link className="btn btn-ink" to={`/fighters/${id}/edit`}>Edit my profile</Link></p>}
          <FighterLifecycle fighterId={id} name={p.displayName} />
          {p.organization && (
            <p style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip tone="steel">{p.organization.name}</Chip>{!p.organization.enabled && <Chip>Inactive organization</Chip>}
            </p>
          )}
        </div>
      </header>
      {p.organization && !p.organization.enabled && <p className="panel info" role="status">{INACTIVE_ORG_NOTICE}</p>}

      {unclaimed && !isMine && (
        <div className="panel info" style={{ display: 'grid', gap: 10, justifyItems: 'start' }} data-testid="claim-panel">
          <h3>Is this you?</h3>
          <p>This profile was created by an organizer and has no account yet. If it is you, claim it to keep this history.</p>
          {session
            ? <ClaimRequest fighterId={id} name={p.displayName} hasOwnProfile={!!mine.data} />
            : <Link className="btn btn-ink" to="/account">Sign in to claim it</Link>}
          <Link className="more" to={`/claim-profile?q=${encodeURIComponent(p.displayName)}`}>Find a different profile</Link>
        </div>
      )}

      {session && <FighterDisciplineRecord fighterId={id} isMine={isMine} />}
      {isMine && !fictional && <PastMedals fighterId={id} results={results.data ?? []} onChanged={() => setMedalKey(k => k + 1)} />}

      {nothingYet && (
        <section className="panel info" data-testid="career-empty">
          <h2 className="h3">Career</h2>
          <p className="muted">No official results are recorded for {p.displayName} yet. The career fills in as organizers record fights and results on BuhurtOS.</p>
        </section>
      )}

      {careerTop && <FilterBar filters={filters} value={filter} onChange={setFilter} />}

      <Block title={filter.kind === 'career' ? 'Career summary' : `${filter.label} summary`} state={career} empty={() => !total} id="career"
        keep={careerTop ? <p className="muted">Nothing recorded for {filter.label}.</p> : undefined}
        note={<>Fights and the record are from official fight results only; a team fight counts for every fighter on its roster. Medals and ranking points are the official placings. {context === 'test' ? 'This is a fictional fighter: everything here is test data and counts nowhere official.' : 'Fictional events and events excluded from official statistics never count.'}</>}>
        {() => total && <SummaryTiles t={total} />}
      </Block>

      {filter.kind === 'career' && careerTop && (
        <Block title="Highlights" state={fights} empty={() => careerHighlights({ total: careerTop, lines: career.data ?? [], events: officialEvents, rankings: rankings.data ?? [], fights: allOfficialFights, rankingLabel }).length === 0}>
          {() => <HighlightList items={careerHighlights({ total: careerTop, lines: careerLines(career.data ?? [], CAREER_FILTER, context), events: officialEvents, rankings: rankings.data ?? [], fights: allOfficialFights, rankingLabel })} />}
        </Block>
      )}

      <Block title="Disciplines" state={career} empty={() => individual.length === 0} id="disciplines" note="Individual competitions. Points are the ranking points earned in that discipline.">
        {() => <DisciplineList lines={individual} label="Record by discipline" />}
      </Block>

      <Block title="Team fights" state={career} empty={() => teamLines.length === 0} id="team-fights" note="Group fights this fighter was on the roster for, from the rosters recorded at each competition. A win is the team's win in a fight they fought in.">
        {() => <DisciplineList lines={teamLines} label="Record in team fights" />}
      </Block>

      <Block title="Recent fights" state={fights} empty={() => officialFights.length === 0} id="recent" note="Newest first. Tap an opponent for the head to head.">
        {() => <RecentFights fights={officialFights} onOpponent={chooseOpponent} />}
      </Block>

      <Block title="Head to head" state={h2h} empty={() => opponentList.length === 0} id="head-to-head" note="Direct meetings only: the two fought each other in an individual competition. Team fights and placings are never counted as meetings.">
        {() => (
          <HeadToHead me={p.displayName} list={opponentList} vs={vs} choose={chooseOpponent} fights={allOfficialFights} />
        )}
      </Block>

      <Block title="Event history" state={results} empty={() => events.length === 0} id="events" note="The team shown is the one represented at that event, from the record of the day; it never changes when a fighter changes team.">
        {() => (
          <ul className="plain evhist">
            {events.map(e => (
              <li key={e.eventId}>
                <div className="rowline">
                  <span style={{ minWidth: 0 }}><Link to={`/events/${e.eventSlug}`}><b>{e.eventName}</b></Link>{e.synthetic && <> <TestBadge synthetic /></>}{e.statsExcluded && <> <Chip>Not counted in statistics</Chip></>}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{dateRange(e.startsOn, e.endsOn)}{e.organizationId && orgById.get(e.organizationId) ? ` · ${orgName(orgById.get(e.organizationId)!)}` : ''}</span>
                </div>
                <div className="l">
                  {e.teams.length > 0 ? <>Represented {e.teams.map((t, i) => <span key={t.id}>{i > 0 && ' and '}{t.slug ? <Link to={`/teams/${t.slug}`}>{t.name}</Link> : t.name}</span>)}</> : 'No team recorded'}
                  {e.fights > 0 && <> · {plural(e.fights, 'fight')}: {e.wins} W · {e.losses} L{e.draws > 0 ? ` · ${e.draws} D` : ''}</>}
                </div>
                {e.placings.length > 0 && (
                  <ul className="plain placings">
                    {e.placings.map(pl => (
                      <li key={pl.competitionId} className="placing">
                        <MedalChip medal={pl.medal} place={pl.place} /> <Link to={`/events/${e.eventSlug}#results-${pl.competitionId}`}>{pl.competitionName}</Link>
                        {pl.entryStatus === 'disqualified' && <> <Chip>Disqualified</Chip></>}
                        <span className="muted"> · {pointsText(pl.points)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {e.placings.length === 0 && e.fights > 0 && <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>No official placing recorded yet.</p>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Teams represented" state={results} empty={() => represented.length === 0 && !p.team} id="teams" note="From the official record: the team a result or fight was earned for. BuhurtOS does not guess when a fighter joined or left a team.">
        {() => (
          <ul className="plain">
            {p.team && !represented.some(t => t.id === p.team?.id) && <li><Link to={`/teams/${p.team.slug}`}><b>{p.team.name}</b></Link> <Chip tone="brass">{inactive ? 'Last team' : 'Current team'}</Chip><div className="l">No official result for {p.team.name} yet.</div></li>}
            {represented.map(t => (
              <li key={t.id}>
                {t.slug ? <Link to={`/teams/${t.slug}`}><b>{t.name}</b></Link> : <b>{t.name}</b>} {t.id === p.team?.id && <Chip tone="brass">{inactive ? 'Last team' : 'Current team'}</Chip>} <span className="muted">{yearSpan(t.firstOn, t.lastOn)}</span>
                <div className="l">{t.events.map((e, i) => <span key={e.eventId}>{i > 0 && ' · '}<Link to={`/events/${e.eventSlug}`}>{e.eventName}</Link></span>)}</div>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="All rankings" state={rankings} empty={r => r.length === 0} note="Rank 1 is the most ranking points; equal points share a rank.">
        {rows => <Collapsible label={`Show all ${plural(rows.length, 'ranking')}`}>
          <ul className="plain">
            {sortFighterRankings(rows).map((r, i) => {
              const org = r.organizationId ? orgById.get(r.organizationId) : undefined;
              return <li key={i} className="rankline"><span className="rk">#{r.rank}</span><span style={{ minWidth: 0 }}>{rankingLabel(r)}{org && !org.enabled && <> <Chip>Inactive</Chip></>}<span className="l">{pointsText(r.points)} · {plural(r.competitions, 'competition')}</span></span></li>;
            })}
          </ul>
        </Collapsible>}
      </Block>

      {hasStory && (
        <section className="panel info">
          <h2 className="h3">About</h2>
          {p.fightingStyle && <p><b>Fighting style:</b> {p.fightingStyle}</p>}
          {p.bio && <p style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{p.bio}</p>}
          {p.highlights.length > 0 && (<><p className="eyebrow">In their own words</p><ul className="plain">{p.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul></>)}
          <p className="muted" style={{ fontSize: 13 }}>Written by the fighter, not checked by BuhurtOS.</p>
        </section>
      )}

      <FighterGallery fighterId={id} name={p.displayName} />

      <Block title="Upcoming" state={appearances} empty={a => upcoming(a, today).length === 0}>
        {a => (
          <ul className="plain">
            {upcoming(a, today).map(x => (
              <li key={x.entryId}>
                <Link to={`/events/${x.eventSlug}`}><b>{x.eventName}</b></Link>{' '}{x.eventStatus === 'draft' && <Chip tone="brass">Draft: only visible to organizers</Chip>}
                <div className="l">{dateRange(x.startsOn, x.endsOn)} · {x.competition}{x.forTeam && ` · ${x.role === 'mercenary' || x.role === 'guest' ? guestLabel(x.forTeam) : `for ${x.forTeam}`}`}</div>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <TeamHistory memberships={memberships} appearances={appearances} homeTeam={p.team?.slug ?? null} />
    </section>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-line" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : label}</button>
      {open && children}
    </>
  );
}

function RecentFights({ fights, onOpponent }: { fights: readonly Fight[]; onOpponent: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? fights.slice(0, 50) : fights.slice(0, 5);
  return (
    <>
      <FormStrip outcomes={fights.slice(0, 10).map(f => f.outcome)} label="Form, newest first" />
      <ul className="plain" aria-label="Recent fights">{shown.map(f => <FightRow key={f.matchId} f={f} onOpponent={onOpponent} />)}</ul>
      {fights.length > 5 && <button type="button" className="btn btn-line" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show last 5' : `Show last ${Math.min(50, fights.length)}`}</button>}
    </>
  );
}

function HeadToHead({ me, list, vs, choose, fights }: { me: string; list: ReturnType<typeof opponents>; vs: string | null; choose: (id: string | null) => void; fights: readonly Fight[] }) {
  const [all, setAll] = useState(false);
  const chosen = vs ? list.find(o => o.id === vs) : undefined;
  useEffect(() => { if (vs && list.length > 0 && !chosen) choose(null); }, [vs, chosen, list.length, choose]);
  if (chosen) {
    const meetings = fights.filter(f => f.opponentFighterId === chosen.id && f.kind === 'individual');
    return (
      <div className="h2h" data-testid="head-to-head">
        <p className="eyebrow">{me} vs {chosen.name}</p>
        <p className="h2h-line"><b>{plural(chosen.meetings, 'meeting')}</b> · {headToHeadLine(me, chosen)}</p>
        {chosen.byCategory.length > 0 && (
          <ul className="plain" aria-label="By discipline">
            {chosen.byCategory.map(c => <li key={`${c.category}:${c.gender}`}><b>{c.categoryName}</b>{c.gender && c.gender !== 'open' ? ` (${divisionLabel(c.gender)})` : ''} <span className="muted">{splitText(c)}</span></li>)}
          </ul>
        )}
        <ul className="plain" aria-label={`Fights against ${chosen.name}`}>{meetings.map(f => <FightRow key={f.matchId} f={f} />)}</ul>
        <div className="evfilter">
          <Link className="btn btn-line" to={`/fighters/${chosen.id}`}>Open {chosen.name}</Link>
          <button type="button" className="btn btn-line" onClick={() => choose(null)}>All opponents</button>
        </div>
      </div>
    );
  }
  const shown = all ? list : list.slice(0, 6);
  return (
    <>
      <ul className="plain opponents" aria-label="Opponents">
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

const upcoming = (a: Appearance[], today: string): Appearance[] =>
  a.filter(x => x.endsOn >= today && x.eventStatus !== 'cancelled').sort((x, y) => x.startsOn.localeCompare(y.startsOn));

/** Team memberships as recorded (with dates when the record has them) and guest appearances. Separate from "Teams represented", which is evidence from results. */
function TeamHistory({ memberships, appearances, homeTeam }: { memberships: AsyncState<Awaited<ReturnType<typeof fetchFighterMemberships>>>; appearances: AsyncState<Appearance[]>; homeTeam: string | null }) {
  const guests = (appearances.data ?? []).filter(a => (a.role === 'mercenary' || a.role === 'guest') && a.forTeam).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const rows = sortMemberships(memberships.data ?? []);
  if (memberships.loading) return <div className="panel info"><h2 className="h3">Team memberships</h2><p className="muted">Loading…</p></div>;
  if (memberships.error != null) return <div className="panel info"><h2 className="h3">Team memberships</h2><p role="alert">{friendlyError(memberships.error, 'Could not load team history.')}</p></div>;
  if (rows.length === 0 && guests.length === 0) return null;
  return (
    <div className="panel info">
      <h2 className="h3">Team memberships</h2>
      <ul className="plain">
        {rows.map(m => (
          <li key={m.id}>
            <Link to={`/teams/${m.teamSlug}`}><b>{m.mercenary ? guestLabel(m.teamName) : m.teamName}</b></Link>{' '}
            {m.teamSlug === homeTeam && !m.mercenary && <Chip tone="brass">Home team</Chip>} {m.role !== 'fighter' && <Chip>{historyRoleLabel(m.role)}</Chip>}
            {membershipSpan(m) && <div className="l">{membershipSpan(m)}</div>}
          </li>
        ))}
        {guests.map(g => (
          <li key={`g:${g.entryId}`}>
            <b>{guestLabel(g.forTeam as string)}</b>
            <div className="l"><Link to={`/events/${g.eventSlug}`}>{g.eventName}</Link> · {dateRange(g.startsOn, g.endsOn)}</div>
          </li>
        ))}
      </ul>
      {rows.some(m => m.role === 'captain') && <p className="muted" style={{ fontSize: 13 }}>{HISTORY_ROLE_NOTE}</p>}
      <p className="muted" style={{ fontSize: 13 }}>Memberships as recorded by the team. Fighting as a guest never changes a fighter's home team.</p>
    </div>
  );
}

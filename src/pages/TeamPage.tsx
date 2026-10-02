import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Crest } from '../components/Crest';
import { Chip } from '../components/ui';
import { fetchTeamBySlug, fetchTeamEntries, type DirectoryEntry } from '../data/teamDirectory';
import { fetchFighterBasics, fetchOrgLites, fetchSeasons, fetchTeamMatchOutcomes, fetchTeamRankings } from '../data/careers';
import { fetchTeamHistory, fetchTeamStats } from '../data/fighters';
import { categoryLabel, categoryRecords, divisionLabel, formatRecord, orgName, placeText, plural, rosterGroups, todayIso, tournamentHistory, winPctText } from '../lib/careerView';
import { CLAIMED_LABEL, fetchMyTeamIds, fetchTeamRoster } from '../data/teamManager';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { listedFromLabel, locationText, NO_SOURCE_LABEL, PENDING_LABEL, relationLabel, roleLabel, safeHttpsUrl, sinceLabel } from '../lib/teamDirectory';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { crestTeam } from './TeamsPage';

const NETWORK_NAME: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', discord: 'Discord', twitch: 'Twitch', other: 'Other link' };

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
        <Link className="btn btn-line btn-sm" to="/teams">All teams</Link></section>
    );
  }
  return <Workspace t={team.data} />;
}

function Workspace({ t }: { t: DirectoryEntry }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const mineTeams = useAsync(() => (userId ? fetchMyTeamIds() : Promise.resolve([])), [userId]);
  const onTeam = (mineTeams.data ?? []).includes(t.id);
  const roster = useAsync(() => fetchTeamRoster(t.id), [t.id]);
  const entries = useAsync(() => fetchTeamEntries(t.id), [t.id]);
  const stats = useAsync(() => fetchTeamStats(t.slug), [t.slug]);
  const history = useAsync(() => fetchTeamHistory(t.id), [t.id]);
  const rankings = useAsync(() => fetchTeamRankings(t.id), [t.id]);
  const outcomes = useAsync(() => fetchTeamMatchOutcomes(t.id), [t.id]);
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const basics = useAsync(() => fetchFighterBasics((roster.data ?? []).map(m => m.fighterId)), [(roster.data ?? []).map(m => m.fighterId).join(',')]);
  const today = todayIso();
  const upcomingEntries = (entries.data ?? []).filter(e => e.endsOn >= today && e.eventStatus !== 'cancelled').sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const where = locationText(t);
  const website = safeHttpsUrl(t.website);
  const socials = Object.entries(t.socialLinks).map(([k, v]) => ({ k, url: safeHttpsUrl(v) })).filter((s): s is { k: string; url: string } => s.url !== null);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <Link className="more" to="/teams">← All teams</Link>
      <div className="teamhead">
        <Crest team={crestTeam(t)} size={88} />
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Team</p>
          <h1 style={{ fontSize: 'clamp(38px,6vw,72px)', marginTop: 8 }}>{t.name}</h1>
          <div className="phead"><div className="sub">{where && <span>{where}</span>}{t.foundedYear && <span>Founded {t.foundedYear} <span className="muted">(as stated by the team)</span></span>}</div></div>
          {t.status === 'pending' && <p style={{ marginTop: 10 }}><Chip tone="brass">{PENDING_LABEL}</Chip></p>}
        </div>
      </div>

      {t.status === 'approved' && !(session && (mineTeams.loading || onTeam)) && (
        <div className="evfilter">
          {session
            ? <Link className="btn btn-ink" to={`/team-manager?join=${encodeURIComponent(t.slug)}`}>Request to join</Link>
            : <Link className="btn btn-line" to="/account">Sign in to request to join</Link>}
          <span className="muted" style={{ fontSize: 14 }}>The team captain decides who joins.</span>
        </div>
      )}

      <div className="panel info">
        <h3>About</h3>
        {t.description ? <p>{t.description}<br /><span className="muted" style={{ fontSize: 13 }}>Written by the team, not checked by BuhurtOS.</span></p> : <p className="muted">The team has not added a description yet.</p>}
        {(website || socials.length > 0) && (
          <div className="teamlinks">
            {website && <a className="btn btn-line btn-sm" href={website} target="_blank" rel="noopener noreferrer nofollow">Website</a>}
            {socials.map(s => <a key={s.k} className="btn btn-line btn-sm" href={s.url} target="_blank" rel="noopener noreferrer nofollow">{NETWORK_NAME[s.k] ?? 'Link'}</a>)}
          </div>
        )}
        <p className="muted" style={{ fontSize: 13 }}>{t.sources.length > 0 ? t.sources.map(s => listedFromLabel(s)).join(' · ') : NO_SOURCE_LABEL}. A listing is not an endorsement, and does not mean the team uses BuhurtOS.</p>
      </div>

      <div className="panel info">
        <h3>Affiliations</h3>
        {t.affiliations.length === 0 && t.claimedOrganizations.length === 0 && <p className="muted">No affiliations are recorded for this team.</p>}
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
      </div>

      <div className="panel info">
        <h3>Roster</h3>
        {roster.loading && <p className="muted">Loading roster…</p>}
        {roster.error != null && <p role="alert">{friendlyError(roster.error, 'Could not load the roster.')}</p>}
        {!roster.loading && !roster.error && (roster.data ?? []).length === 0 && <p className="muted">No roster has been added yet</p>}
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
        <p className="muted" style={{ fontSize: 13 }}>A name on a roster is a sporting record. It does not mean that person has a BuhurtOS account.</p>
      </div>

      {stats.error != null && <div className="panel info"><h3>Team record</h3><p role="alert">{friendlyError(stats.error, 'Could not load team statistics.')}</p></div>}
      {stats.data && (
        <div className="panel info">
          <h3>Team record</h3>
          {stats.data.events === 0 && stats.data.matches === 0 && stats.data.podiums === 0
            ? <p className="muted">No competitions are recorded for this team yet.</p>
            : (
              <>
                <div className="statgrid">
                  <div className="statcell"><b>{stats.data.events}</b><span>Events</span></div>
                  <div className="statcell"><b>{stats.data.matches}</b><span>Matches</span></div>
                  <div className="statcell"><b>{formatRecord(stats.data.wins, stats.data.losses, stats.data.draws)}</b><span>Group fight record</span></div>
                  <div className="statcell"><b>{winPctText(stats.data.winPct)}</b><span>Win rate</span></div>
                  <div className="statcell"><b>{stats.data.podiums}</b><span>Podiums ({stats.data.golds} gold, {stats.data.silvers} silver, {stats.data.bronzes} bronze)</span></div>
                  <div className="statcell"><b>{stats.data.tournamentWins}</b><span>Tournament wins</span></div>
                  <div className="statcell"><b>{stats.data.points}</b><span>League points</span></div>
                </div>
                {categoryRecords((outcomes.data ?? []).filter(o => o.category === '5v5' || o.category === '3v3')).length > 0 && (
                  <ul className="plain">
                    {categoryRecords((outcomes.data ?? []).filter(o => o.category === '5v5' || o.category === '3v3')).map(r => (
                      <li key={r.category}><b>{categoryLabel(r.category)}</b> <span className="muted">{formatRecord(r.wins, r.losses, r.draws)} in {plural(r.matches, 'match', 'matches')}</span></li>
                    ))}
                  </ul>
                )}
                {stats.data.recentForm.length > 0 && (
                  <>
                    <p className="eyebrow">Recent form, newest first</p>
                    <div className="record">{stats.data.recentForm.map((l, i) => <span key={i} className={`wl ${l === 'W' ? 'w' : l === 'L' ? 'l' : ''}`}>{l}</span>)}</div>
                  </>
                )}
              </>
            )}
        </div>
      )}

      {(rankings.data ?? []).length > 0 && (
        <div className="panel info">
          <h3>Rankings</h3>
          <ul className="plain">
            {[...(rankings.data ?? [])].sort((a, b) => a.rank - b.rank).map((r, i) => {
              const org = (orgs.data ?? []).find(o => o.id === r.organizationId);
              const season = (seasons.data ?? []).find(s => s.id === r.seasonId);
              const label = [org ? orgName(org) : 'All organizations', season?.name, r.category ? categoryLabel(r.category) : null, divisionLabel(r.gender) || null].filter(Boolean).join(' · ');
              return <li key={i} className="rankline"><span className="rk">#{r.rank}</span><span>{label}{org && !org.enabled && <> <Chip>Inactive</Chip></>}<span className="l">{r.points} points</span></span></li>;
            })}
          </ul>
          <Link className="more" to="/rankings?who=teams">See the full rankings →</Link>
        </div>
      )}

      <div className="panel info">
        <h3>Upcoming events</h3>
        {entries.loading && <p className="muted">Loading events…</p>}
        {entries.error != null && <p role="alert">{friendlyError(entries.error, 'Could not load events.')}</p>}
        {!entries.loading && !entries.error && upcomingEntries.length === 0 && <p className="muted">No upcoming events entered.</p>}
        <ul className="plain">
          {upcomingEntries.map(e => (
            <li key={e.entryId}>
              <Link to={`/events/${e.eventSlug}`}><b>{e.eventName}</b></Link>{' '}
              {e.eventStatus === 'draft' && <Chip tone="brass">Draft: only visible to organizers</Chip>}
              <div className="muted" style={{ fontSize: 13 }}>{dateRange(e.startsOn, e.endsOn)} · {e.competitionName}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel info">
        <h3>Tournament history</h3>
        {history.loading && <p className="muted">Loading results…</p>}
        {history.error != null && <p role="alert">{friendlyError(history.error, 'Could not load results.')}</p>}
        {!history.loading && !history.error && (history.data ?? []).length === 0 && <p className="muted">No finished competitions are recorded for this team yet.</p>}
        <ul className="plain">
          {tournamentHistory(history.data ?? []).map(h => (
            <li key={h.eventSlug}>
              <Link to={`/events/${h.eventSlug}`}><b>{h.eventName}</b></Link>
              <div className="l">{dateRange(h.startsOn, h.endsOn)}</div>
              <div className="placings">{h.placements.map((pl, i) => <span key={i} className="placing"><Chip tone={pl.medal === 'gold' ? 'brass' : pl.medal === 'silver' ? 'steel' : ''}>{placeText(pl.place)}</Chip> {pl.competition}</span>)}</div>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: 13 }}>Only results recorded on BuhurtOS by event organizers appear here.</p>
      </div>
    </section>
  );
}

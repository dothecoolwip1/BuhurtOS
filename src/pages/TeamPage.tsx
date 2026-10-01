import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Crest } from '../components/Crest';
import { Chip } from '../components/ui';
import { fetchTeamBySlug, fetchTeamEntries, fetchTeamResults, type DirectoryEntry } from '../data/teamDirectory';
import { CLAIMED_LABEL, fetchTeamRoster } from '../data/teamManager';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { listedFromLabel, locationText, NO_SOURCE_LABEL, ordinal, PENDING_LABEL, relationLabel, roleLabel, safeHttpsUrl, sinceLabel, summarizeResults } from '../lib/teamDirectory';
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
  const roster = useAsync(() => fetchTeamRoster(t.id), [t.id]);
  const entries = useAsync(() => fetchTeamEntries(t.id), [t.id]);
  const results = useAsync(() => fetchTeamResults(t.id), [t.id]);
  const where = locationText(t);
  const website = safeHttpsUrl(t.website);
  const socials = Object.entries(t.socialLinks).map(([k, v]) => ({ k, url: safeHttpsUrl(v) })).filter((s): s is { k: string; url: string } => s.url !== null);
  const summary = summarizeResults(results.data ?? []);
  const placed = (results.data ?? []).filter(r => r.finalPlace !== null);
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

      {t.status === 'approved' && (
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
                <b>{a.organizationName}</b> <Chip tone="steel">{relationLabel(a.relation)}</Chip>
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
        {(roster.data ?? []).length > 0 && (
          <ul className="plain roster">
            {(roster.data ?? []).map(m => (
              <li key={m.fighterId}>
                <b>{m.displayName}</b>
                <span className="s">
                  {m.isCaptain && <Chip tone="brass">Captain</Chip>}
                  {!m.isCaptain && m.role !== 'fighter' && <Chip>{roleLabel(m.role)}</Chip>}
                  {m.mercenary && <Chip>Mercenary</Chip>}
                  {sinceLabel(m.since) && <span className="muted">{sinceLabel(m.since)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontSize: 13 }}>A name on a roster is a sporting record. It does not mean that person has a BuhurtOS account.</p>
      </div>

      <div className="panel info">
        <h3>Events entered</h3>
        {entries.loading && <p className="muted">Loading events…</p>}
        {entries.error != null && <p role="alert">{friendlyError(entries.error, 'Could not load events.')}</p>}
        {!entries.loading && !entries.error && (entries.data ?? []).length === 0 && <p className="muted">No events entered yet.</p>}
        {(entries.data ?? []).length > 0 && (
          <ul className="plain">
            {(entries.data ?? []).map(e => (
              <li key={e.entryId}>
                <Link to={`/events/${e.eventSlug}`}><b>{e.eventName}</b></Link>{' '}
                {e.eventStatus === 'draft' && <Chip tone="brass">Draft: only visible to organizers</Chip>}
                {e.eventStatus === 'cancelled' && <Chip>Cancelled</Chip>}
                <div className="muted" style={{ fontSize: 13 }}>{dateRange(e.startsOn, e.endsOn)} · {e.competitionName}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel info">
        <h3>Results</h3>
        {results.loading && <p className="muted">Loading results…</p>}
        {results.error != null && <p role="alert">{friendlyError(results.error, 'Could not load results.')}</p>}
        {!results.loading && !results.error && !summary && <p className="muted">No finished competitions are recorded for this team yet.</p>}
        {summary && (
          <>
            <p><b>{summary.competitions}</b> finished {summary.competitions === 1 ? 'competition' : 'competitions'} across <b>{summary.events}</b> {summary.events === 1 ? 'event' : 'events'}. Best placing: <b>{ordinal(summary.bestPlace)}</b>. Podium finishes: <b>{summary.podiums}</b>.</p>
            <ul className="plain">
              {placed.map(r => (
                <li key={`${r.eventSlug}:${r.competitionName}`}>
                  <b>{ordinal(r.finalPlace as number)}</b> · <Link to={`/events/${r.eventSlug}`}>{r.eventName}</Link>
                  <div className="muted" style={{ fontSize: 13 }}>{r.competitionName}{r.points !== null && ` · ${r.points} points`}</div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted" style={{ fontSize: 13 }}>Only results recorded on BuhurtOS by event organizers appear here.</p>
      </div>
    </section>
  );
}

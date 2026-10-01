import { Link } from 'react-router-dom';
import { fetchMyTeams, type MyTeam } from '../../data/account';
import { dateRange } from '../../lib/dates';
import { friendlyError } from '../../lib/friendlyError';
import { roleLabel } from '../../lib/teamDirectory';
import { useAsync } from '../../lib/useAsync';
import { Avatar } from './shared';

export function TeamsTab() {
  const teams = useAsync(fetchMyTeams, []);
  if (teams.loading) return <p className="muted">Loading your teams…</p>;
  if (teams.error != null) return <p role="alert">{friendlyError(teams.error, 'Could not load your teams.')}</p>;
  const list = teams.data ?? [];
  if (list.length === 0) {
    return (
      <section className="panel info acct-card">
        <h2>You are not on a team yet</h2>
        <p className="muted">Ask a team to add you, or find one and request to join.</p>
        <Link className="btn btn-ink acct-bigbtn" to="/team-manager">Find or start a team</Link>
      </section>
    );
  }
  return <div className="acct-stack">{list.map(t => <TeamCard key={t.teamId} t={t} />)}</div>;
}

function TeamCard({ t }: { t: MyTeam }) {
  return (
    <section className="panel info acct-card">
      <div className="acct-teamhead">
        <Avatar path={t.logoPath} name={t.name} size={64} />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ overflowWrap: 'anywhere' }}>{t.name}</h2>
          <p className="muted">
            {t.isCaptain ? 'Captain' : roleLabel(t.role)}{t.since && ` since ${t.since}`}
            {t.organization && ` · ${t.organization.name}`} · {t.rosterCount} on the roster
          </p>
          {t.status === 'pending' && <p><span className="chip brass">Waiting for approval</span></p>}
          {t.isCaptain && (t.pendingRequests ?? 0) > 0 && <p><span className="chip brass">{t.pendingRequests} join request{t.pendingRequests === 1 ? '' : 's'} waiting</span></p>}
        </div>
      </div>
      {t.upcomingEvents.length > 0 && (
        <div><p className="eyebrow">Upcoming events</p>
          <ul className="plain">{t.upcomingEvents.map(e => <li key={e.eventId}><Link to={`/events/${e.slug}`}><b>{e.name}</b></Link> <span className="muted">{dateRange(e.startsOn, e.endsOn)}</span></li>)}</ul>
        </div>
      )}
      <div className="acct-row">
        <Link className="btn btn-line" to={`/teams/${t.slug}`}>Team page</Link>
        <Link className="btn btn-ink" to="/team-manager">Team manager</Link>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Dialog } from '../components/Dialog';
import { PageHead } from '../components/ui';
import { usePlatformRole } from '../auth/usePlatformRole';
import { fetchApprovedTeams, fetchMyCaptainedTeams, type TeamChoice } from '../data/myTeams';
import { cancelTeamJoin, cleanJoinMessage, fetchIsOrgAdmin, fetchMyTeamIds, fetchMyTeamRequests, fetchTeamRequestsInbox, MESSAGE_MAX, requestTeamJoin, type MyJoinRequest } from '../data/teamManager';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { filterTeams, myTeams, pendingTeamIds, placeOf, statusLabel } from '../registration/teamRequest';
import { NewTeamRequestForm } from './NewTeamRequestForm';
import { trackEvent } from '../lib/analytics';
import { TeamAdminPanel } from './TeamAdminPanel';
import { CaptainTeams, JoinRequestInbox } from './CaptainPanel';
import { lookupState } from '../lib/lookupState';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 };
const bad: React.CSSProperties = { color: 'var(--live)' };

/** One place for everything about teams and you: join a team, ask for a new one, answer people who want to join yours. */
export function TeamManagerPage() {
  useDocumentTitle('Team manager');
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Teams" title="Team manager" lede="Join your team or ask for a new one. Sign in first." /><SignIn reason="Sign in to join a team or ask for a new one." /></>;
  return <ManagerFor />;
}

/** The super admin is not a fighter and joins no team: he gets the admin console only. Everyone else gets the member view. */
function ManagerFor() {
  const { isOwner, loading } = usePlatformRole();
  if (loading) return <p className="muted">Loading…</p>;
  return isOwner ? <OwnerManager /> : <Manager />;
}

function OwnerManager() {
  const [key, setKey] = useState(0);
  const inbox = useAsync(fetchTeamRequestsInbox, [key]);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Super admin" title="Team manager" lede="Every team on BuhurtOS: edit any team page, approve new teams and name captains." />
      <TeamAdminPanel canApprove allTeams />
      <JoinRequestInbox inbox={inbox} onDone={() => setKey(k => k + 1)} quiet />
    </section>
  );
}

function Manager() {
  const [params] = useSearchParams();
  const { session } = useAuth();
  const { isOrganizer } = usePlatformRole();
  const orgAdmin = useAsync(() => (session ? fetchIsOrgAdmin(session.user.id) : Promise.resolve(false)), [session?.user.id]);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState(0);
  const refresh = () => setKey(k => k + 1);
  const teams = useAsync(fetchApprovedTeams, []);
  const mine = useAsync(fetchMyTeamRequests, [key]);
  const captained = useAsync(fetchMyCaptainedTeams, [key]);
  const inbox = useAsync(fetchTeamRequestsInbox, [key]);
  const myIds = useAsync(fetchMyTeamIds, [key]);

  const requests = mine.data ?? [];
  const on = useMemo(() => myTeams(captained.data ?? [], requests), [captained.data, requests]);
  const capState = lookupState(captained);
  const isCaptain = capState === 'found';
  const others = on.filter(t => !t.captain);
  const joinOpen = Boolean(params.get('join'));

  const secondary = (
    <>
      <JoinSection teams={teams.data ?? []} loading={teams.loading} error={teams.error} requests={requests} on={new Set([...on.map(t => t.teamId), ...(myIds.data ?? [])])} prefillSlug={params.get('join')} onChanged={refresh} />
      <MyRequests loading={mine.loading && !mine.data} error={mine.error} requests={requests} onChanged={refresh} />
      <p className="muted">
        Is your team not listed?{' '}
        <button type="button" className="btn btn-line" onClick={() => setAsking(true)}>Request a new team</button>
      </p>
    </>
  );

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Teams" title="Team manager" lede={isCaptain ? 'Manage the team you captain and answer people who want to join it.' : 'Find your team and ask to join, or ask for a new team to be added.'} />

      {(isOrganizer || orgAdmin.data) && <TeamAdminPanel canApprove={isOrganizer} />}

      {capState === 'loading' && <p className="muted" role="status">Loading your teams…</p>}
      {capState === 'error' && (
        <p role="alert" style={bad}>{friendlyError(captained.error, 'Could not load your teams.')}{' '}<button type="button" className="btn btn-line" onClick={captained.reload}>Retry</button></p>
      )}

      {isCaptain && (
        <>
          <CaptainTeams teams={captained.data ?? []} inbox={inbox.data ?? []} />
          {(captained.data ?? []).some(t => t.status === 'approved') && <JoinRequestInbox inbox={inbox} onDone={refresh} />}
        </>
      )}

      {capState !== 'loading' && others.length > 0 && (
        <section className="panel info" style={{ display: 'grid', gap: 8 }} aria-labelledby="on-h">
          <h2 id="on-h">{isCaptain ? 'Other teams you are on' : 'Your teams'}</h2>
          <ul style={list}>
            {others.map(t => <li key={t.teamId} style={{ overflowWrap: 'anywhere' }}>You are on <b>{t.name}</b>. <Link to={`/teams/${t.slug}`}>See the team page</Link></li>)}
          </ul>
        </section>
      )}

      {capState !== 'loading' && (isCaptain
        ? (
          <details className="panel info" open={joinOpen || undefined}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 44, display: 'flex', alignItems: 'center' }}>Looking for another team?</summary>
            <div style={{ display: 'grid', gap: 22, marginTop: 12 }}>{secondary}</div>
          </details>
        )
        : secondary)}

      {asking && (
        <Dialog title="Request a new team" variant="drawer" onClose={() => setAsking(false)}>
          <p className="muted">Search for your team first, so we do not end up with two of the same team. If it really is missing, fill this in. An organizer reviews it before it appears.</p>
          <NewTeamRequestForm onSubmitted={refresh} />
        </Dialog>
      )}
    </section>
  );
}

function JoinSection({ teams, loading, error, requests, on, prefillSlug, onChanged }: {
  teams: TeamChoice[]; loading: boolean; error: unknown; requests: MyJoinRequest[]; on: Set<string>; prefillSlug: string | null; onChanged: () => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<TeamChoice | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const waiting = pendingTeamIds(requests);

  useEffect(() => {
    if (!prefillSlug || picked) return;
    const t = teams.find(x => x.slug === prefillSlug);
    if (t) setPicked(t);
  }, [prefillSlug, teams, picked]);

  const results = filterTeams(teams, q);
  const msg = cleanJoinMessage(message);
  const blocked = (t: TeamChoice) => (on.has(t.id) ? 'You are already on this team.' : waiting.has(t.id) ? 'You already asked to join this team.' : null);

  const send = async () => {
    if (!picked || msg.error) return;
    setBusy(true); setProblem(null);
    try { await requestTeamJoin(picked.id, msg.message); trackEvent('team_join_requested'); setSent(picked.name); setPicked(null); setMessage(''); setQ(''); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-labelledby="join-h">
      <h2 id="join-h">Are you part of an existing team?</h2>
      <p className="muted">Find your team and ask to join. Its captain gets a notification and decides.</p>
      {sent && <p role="status" style={{ color: 'var(--win)' }}>Request sent to {sent}. The captain has been notified; you will see the answer here and in your notifications.</p>}
      {!picked ? (
        <>
          <label className="field-in">Search teams by name or city
            <input type="search" value={q} onChange={e => { setQ(e.target.value); setSent(null); }} autoComplete="off" placeholder="For example Frostgate or Edmonton" />
          </label>
          {loading && <p className="muted">Loading teams…</p>}
          {error != null && <p role="alert" style={bad}>{friendlyError(error, 'Could not load the team list.')}</p>}
          {q.trim().length >= 2 && results.length === 0 && !loading && <p className="muted" role="status">No team matches. If yours is missing, use “Request a new team” below.</p>}
          <ul style={list} aria-label="Matching teams">
            {results.map(t => {
              const why = blocked(t);
              return (
                <li key={t.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ overflowWrap: 'anywhere' }}><b>{t.name}</b>{placeOf(t) ? <span className="src"> · {placeOf(t)}</span> : null}</span>
                  {why ? <span className="src">{why}</span> : <button type="button" className="btn btn-ink" onClick={() => { setPicked(t); setProblem(null); setSent(null); }}>This is my team</button>}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <p>Ask to join <b>{picked.name}</b>{placeOf(picked) ? ` (${placeOf(picked)})` : ''}? Its captain will see your name and your message.</p>
          {blocked(picked) && <p role="status" className="src">{blocked(picked)}</p>}
          <label className="field-in">Message to the captain (optional)
            <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} maxLength={MESSAGE_MAX + 100} aria-invalid={Boolean(msg.error)} />
            <span>{MESSAGE_MAX - message.trim().length} characters left. For example, how the captain knows you.</span>
          </label>
          {msg.error && <p role="alert" style={bad}>{msg.error}</p>}
          {problem && <p role="alert" style={bad}>{problem}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy || Boolean(msg.error) || Boolean(blocked(picked))} onClick={() => void send()}>{busy ? 'Sending…' : 'Send request'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setPicked(null); setProblem(null); }}>Choose a different team</button>
          </div>
        </div>
      )}
    </section>
  );
}

function MyRequests({ loading, error, requests, onChanged }: { loading: boolean; error: unknown; requests: Awaited<ReturnType<typeof fetchMyTeamRequests>>; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = async (id: string) => {
    setBusyId(id); setProblem(null);
    try { await cancelTeamJoin(id); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusyId(null); }
  };
  return (
    <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="mine-h">
      <h2 id="mine-h">My requests</h2>
      {loading && <p className="muted">Loading…</p>}
      {error != null && <p role="alert" style={bad}>{friendlyError(error, 'Could not load your requests.')}</p>}
      {!loading && !error && requests.length === 0 && <p className="muted">You have not asked to join any team yet.</p>}
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <ul style={list}>
        {requests.filter(r => r.status !== 'cancelled').map(r => (
          <li key={r.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ overflowWrap: 'anywhere' }}>
              <b>{r.status === 'approved' ? <Link to={`/teams/${r.teamSlug}`}>{r.teamName}</Link> : r.teamName}</b>
              <span className="src"> · {statusLabel(r.status)} · asked {when(r.createdAt)}</span>
            </span>
            {r.status === 'pending' && <button type="button" className="btn btn-line" disabled={busyId === r.id} onClick={() => void cancel(r.id)}>Cancel request</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

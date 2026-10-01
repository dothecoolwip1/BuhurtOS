import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead } from '../components/ui';
import { fetchApprovedTeams, fetchMyCaptainedTeams, type TeamChoice } from '../data/myTeams';
import { cancelTeamJoin, cleanJoinMessage, decideTeamJoin, fetchMyTeamRequests, fetchTeamRequestsInbox, MESSAGE_MAX, requestTeamJoin, type JoinDecision, type MyJoinRequest } from '../data/teamManager';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { filterTeams, myTeams, pendingTeamIds, placeOf, statusLabel } from '../registration/teamRequest';
import { NewTeamRequestForm } from './NewTeamRequestForm';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 };
const bad: React.CSSProperties = { color: 'var(--live)' };

/** One place for everything about teams and you: join a team, ask for a new one, answer people who want to join yours. */
export function TeamManagerPage() {
  useDocumentTitle('Team manager');
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Teams" title="Team manager" lede="Join your team or ask for a new one. Sign in first." /><SignIn reason="Sign in to join a team or ask for a new one." /></>;
  return <Manager />;
}

function Manager() {
  const [params] = useSearchParams();
  const [key, setKey] = useState(0);
  const refresh = () => setKey(k => k + 1);
  const teams = useAsync(fetchApprovedTeams, []);
  const mine = useAsync(fetchMyTeamRequests, [key]);
  const captained = useAsync(fetchMyCaptainedTeams, [key]);
  const inbox = useAsync(fetchTeamRequestsInbox, [key]);

  const requests = mine.data ?? [];
  const on = useMemo(() => myTeams(captained.data ?? [], requests), [captained.data, requests]);

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Teams" title="Team manager" lede="Find your team and ask to join, or ask for a new team to be added." />

      {on.length > 0 && (
        <section className="panel info" style={{ display: 'grid', gap: 8 }} aria-labelledby="on-h">
          <h2 id="on-h">Your teams</h2>
          <ul style={list}>
            {on.map(t => (
              <li key={t.teamId} style={{ overflowWrap: 'anywhere' }}>
                You are on <b>{t.name}</b>{t.captain ? ' as captain' : ''}.{' '}
                {t.reviewing ? <span className="src">Waiting for an organizer to approve it. It is private until then.</span> : <Link to={`/teams/${t.slug}`}>See the team page</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(inbox.data ?? []).length > 0 && <Inbox items={inbox.data!} onDone={refresh} />}
      {inbox.error != null && <p role="alert" style={bad}>{friendlyError(inbox.error, 'Could not load requests to join your teams.')}</p>}

      <JoinSection teams={teams.data ?? []} loading={teams.loading} error={teams.error} requests={requests} on={new Set(on.map(t => t.teamId))} prefillSlug={params.get('join')} onChanged={refresh} />
      <MyRequests loading={mine.loading && !mine.data} error={mine.error} requests={requests} onChanged={refresh} />

      <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-labelledby="new-h">
        <h2 id="new-h">Is your team not listed? Request a new team</h2>
        <p className="muted">Search above first, so we do not end up with two of the same team. If it really is missing, fill this in. An organizer reviews it before it appears.</p>
        <NewTeamRequestForm onSubmitted={refresh} />
      </section>
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
    try { await requestTeamJoin(picked.id, msg.message); setSent(picked.name); setPicked(null); setMessage(''); setQ(''); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
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
          {q.trim().length >= 2 && results.length === 0 && !loading && <p className="muted" role="status">No team matches. If yours is missing, use the form below.</p>}
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

function Inbox({ items, onDone }: { items: Awaited<ReturnType<typeof fetchTeamRequestsInbox>>; onDone: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const decide = async (id: string, d: JoinDecision) => {
    setBusyId(id); setProblems(p => ({ ...p, [id]: '' }));
    try { await decideTeamJoin(id, d); onDone(); } catch (e) { setProblems(p => ({ ...p, [id]: friendlyError(e) })); } finally { setBusyId(null); }
  };
  return (
    <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="inbox-h">
      <h2 id="inbox-h">Requests to join your teams ({items.length})</h2>
      <ul style={list}>
        {items.map(r => (
          <li key={r.id} style={{ display: 'grid', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
            <span style={{ overflowWrap: 'anywhere' }}><b>{r.requesterName}</b> wants to join <b>{r.teamName}</b> <span className="src">· {when(r.createdAt)}</span></span>
            {r.message && <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--line)', overflowWrap: 'anywhere' }}>{r.message}</blockquote>}
            {problems[r.id] && <p role="alert" style={bad}>{problems[r.id]}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink" disabled={busyId === r.id} onClick={() => void decide(r.id, 'approved')}>Accept</button>
              <button type="button" className="btn btn-line" disabled={busyId === r.id} onClick={() => void decide(r.id, 'declined')}>Decline</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

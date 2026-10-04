import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { Chip, PageHead } from '../components/ui';
import { fetchMyDisplayName, saveMyDisplayName } from '../data/api';
import { fetchMyEvents } from '../data/myEvents';
import { avatarUrl, fetchFighterProfile, fetchMyFighterId } from '../data/fighters';
import { fetchMyCaptainedTeams } from '../data/myTeams';
import { fetchIsOrgAdmin, fetchTeamRequestsInbox } from '../data/teamManager';
import { friendlyError } from '../lib/friendlyError';
import { lookupState } from '../lib/lookupState';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from './AuthContext';
import { usePlatformRole } from './usePlatformRole';
import { SignIn } from './SignIn';

const Chevron = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;

/** A secondary lookup that failed: say so and let the person try again. Never reads as "you have none". */
function Failed({ what, error, retry }: { what: string; error: unknown; retry: () => void }) {
  return (
    <p className="acct-empty" role="alert">
      {friendlyError(error, `Could not load ${what}.`)}{' '}
      <button type="button" className="linklike" onClick={retry}>Retry</button>
    </p>
  );
}

function Row({ to, title, sub }: { to: string; title: string; sub?: string }) {
  return (
    <Link className="acct-row" to={to}>
      <span style={{ minWidth: 0 }}><b>{title}</b>{sub && <span className="acct-sub">{sub}</span>}</span>
      <Chevron />
    </Link>
  );
}

export function AccountPage() {
  useDocumentTitle('Account');
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Account" title="Sign in" /><SignIn /></>;
  // The lookups live below this gate, so they first run with a real user. Run before sign-in is known, a lookup would settle on
  // "nothing" for nobody, and that stale "nothing" would then pass for the answer about the person who just arrived.
  return <SignedIn session={session} />;
}

function SignedIn({ session }: { session: Session }) {
  const { signOut } = useAuth();
  const { isOwner, isOrganizer } = usePlatformRole();
  const userId = session.user.id;
  const mine = useAsync(fetchMyEvents, [userId]);
  const fighter = useAsync(async () => {
    const id = await fetchMyFighterId();
    return id ? fetchFighterProfile(id) : null;
  }, [userId]);
  const captained = useAsync(() => fetchMyCaptainedTeams(), [userId]);
  const orgAdmin = useAsync(() => fetchIsOrgAdmin(userId), [userId]);
  // The inbox is empty for anyone who captains nothing; the database decides who sees what.
  const inbox = useAsync(() => fetchTeamRequestsInbox(), [userId]);
  const [nameKey, setNameKey] = useState(0);
  const shown = useAsync(() => fetchMyDisplayName(userId), [userId, nameKey]);
  const [editingName, setEditingName] = useState(false);

  const email = session.user.email ?? '';
  const profile = fighter.data;
  const name = shown.data?.trim() || profile?.displayName || email.split('@')[0] || 'Your account';
  const photo = avatarUrl(profile?.avatarPath);
  const teams = captained.data ?? [];
  const myCount = mine.data ? mine.data.filter(e => !e.synthetic).length : null;
  const myTest = mine.data ? mine.data.filter(e => e.synthetic).length : 0;
  const myRoles = new Set((mine.data ?? []).flatMap(e => e.staffRoles));
  const fighterState = lookupState(fighter);
  const captainState = lookupState(captained);
  const pending = inbox.data ?? [];
  const waiting = (teamId: string) => pending.filter(r => r.teamId === teamId).length;
  const rolesChecking = (captained.loading && !captained.data) || (orgAdmin.loading && orgAdmin.data === undefined);
  const rolesFailed = captained.error != null || orgAdmin.error != null;

  return (
    <section className="fade-in acct" style={{ display: 'grid', gap: 22 }}>
      <header className="acct-head">
        {photo
          ? <img className="avatar" src={photo} alt="" width={84} height={84} />
          : <span className="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          {editingName
            ? <NameEditor userId={userId} initial={shown.data?.trim() || profile?.displayName || ''} onDone={() => { setEditingName(false); setNameKey(k => k + 1); }} />
            : <><h1 className="acct-name">{name}</h1><button type="button" className="linklike acct-edit" onClick={() => setEditingName(true)}>Change name</button></>}
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>{email}</p>
          <p className="acct-roles">
            {isOwner && <Chip tone="brass">Super admin</Chip>}
            {['head_marshal', 'marshal', 'scorekeeper', 'medic'].filter(r => myRoles.has(r)).map(r => <Chip key={r} tone="steel">{r === 'head_marshal' ? 'Head marshal' : r.charAt(0).toUpperCase() + r.slice(1)}</Chip>)}
            {isOrganizer && !isOwner && <Chip tone="steel">Organizer</Chip>}
            {orgAdmin.data && <Chip tone="steel">Organization admin</Chip>}
            {!isOwner && captainState === 'found' && <Chip>Captain</Chip>}
            {rolesChecking && !rolesFailed && <span className="muted" role="status" style={{ fontSize: 13 }}>Checking your roles…</span>}
            {rolesFailed && <span className="muted" role="alert" style={{ fontSize: 13 }}>Could not check your roles. <button type="button" className="linklike" onClick={() => { if (captained.error != null) captained.reload(); if (orgAdmin.error != null) orgAdmin.reload(); }}>Retry</button></span>}
          </p>
        </div>
      </header>

      <section aria-labelledby="acct-you">
        <h2 id="acct-you" className="acct-h">{isOwner ? 'Teams' : 'You'}</h2>
        <nav className="panel acct-list" aria-label="Your profile and teams">
          {isOwner
            ? <Row to="/team-manager" title="Team manager" sub="Every team: edit, approve new teams, name captains" />
            : <>
                {fighterState === 'loading' && <p className="acct-empty" role="status">Loading your fighter profile…</p>}
                {fighterState === 'error' && <Failed what="your fighter profile" error={fighter.error} retry={fighter.reload} />}
                {fighterState === 'found' && profile && <>
                  <Row to={`/fighters/${profile.fighterId}`} title="My fighter profile" sub="View your public profile, edit it and add a photo" />
                  {profile.team && <Row to={`/teams/${profile.team.slug}`} title={profile.team.name} sub="Your home team" />}
                </>}
                {fighterState === 'none' && (
                  <p className="acct-empty">
                    You do not have a public fighter page yet. It is created when a team captain accepts your request to join a team, or when a registration of yours is accepted at an event.{' '}
                    <Link to="/team-manager">Find your team</Link> · <Link to="/events">See events</Link>
                  </p>
                )}
                <Row to="/team-manager" title="Team manager" sub={captainState === 'found' ? 'Manage your team, find another team or request a new one' : 'Join a team, request a new one, see your requests'} />
              </>}
          {!isOwner && captainState === 'loading' && <p className="acct-empty" role="status">Loading the teams you captain…</p>}
          {!isOwner && captainState === 'error' && <Failed what="the teams you captain" error={captained.error} retry={captained.reload} />}
          {!isOwner && teams.map(t => (
            <Row key={t.teamId} to={t.status === 'pending' ? `/teams/${t.slug}` : '/team-manager'} title={t.name}
              sub={t.status === 'pending'
                ? 'Captain · waiting for organizer approval, not public yet'
                : waiting(t.teamId) > 0
                  ? `Captain · ${waiting(t.teamId)} join request${waiting(t.teamId) === 1 ? '' : 's'} waiting`
                  : 'Captain · manage the team and answer join requests'} />
          ))}
        </nav>
      </section>

      <section aria-labelledby="myev-h">
        <h2 id="myev-h" className="acct-h">My events</h2>
        <nav className="panel acct-list" aria-label="My events">
          <Row to="/my-events" title="My events" sub={mine.error != null ? 'Could not count them; open to retry' : myCount === null ? 'Loading…' : myCount === 0 && myTest === 0 ? 'Nothing yet: registrations, entries and staff roles show up here' : `${myCount} ${myCount === 1 ? 'event' : 'events'} you take part in, run or score${myTest ? ` · ${myTest} test` : ''}`} />
        </nav>
      </section>

      <section aria-labelledby="acct-me">
        <h2 id="acct-me" className="acct-h">Account</h2>
        <nav className="panel acct-list" aria-label="Account details">
          <Row to="/welcome?edit=1&next=%2Faccount" title="Profile details" sub="Your name, how you take part, where you are" />
        </nav>
      </section>

      <section aria-labelledby="acct-run">
        <h2 id="acct-run" className="acct-h">Run events</h2>
        <nav className="panel acct-list" aria-label="Organizer tools">
          <Row to="/events/new" title="Create an event" sub="Set up a tournament, practice or clinic" />
          {isOwner && <Row to="/platform/analytics" title="Analytics" sub="Visitors, who is on now, what people use (only you can see it)" />}
          {isOwner && <Row to="/platform/bugs" title="Bug reports" sub="Problems people sent with the bug button" />}
          {isOwner && <Row to="/platform/organizations" title="Organizations" sub="Switch organizations on or off and manage their admins" />}
        </nav>
      </section>

      <div><button className="btn btn-line" type="button" onClick={() => void signOut()}>Sign out</button></div>
    </section>
  );
}

function NameEditor({ userId, initial, onDone }: { userId: string; initial: string; onDone: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setProblem(null);
    try { await saveMyDisplayName(userId, value); onDone(); } catch (x) { setProblem(x instanceof Error && !('code' in x) ? x.message : friendlyError(x)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={e => void save(e)} style={{ display: 'grid', gap: 8 }}>
      <label className="field-in">Your name (shown to organizers and captains)
        <input value={value} maxLength={80} autoFocus onChange={e => setValue(e.target.value)} />
      </label>
      {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-ink btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip, PageHead } from '../components/ui';
import { fetchMyDisplayName, fetchMyEvents, saveMyDisplayName } from '../data/api';
import { avatarUrl, fetchFighterProfile, fetchMyFighterId } from '../data/fighters';
import { fetchMyCaptainedTeams } from '../data/myTeams';
import { fetchIsOrgAdmin } from '../data/teamManager';
import { DRAFT_NOTICE } from '../lib/draftView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from './AuthContext';
import { usePlatformRole } from './usePlatformRole';
import { SignIn } from './SignIn';

const Chevron = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;

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
  const { session, loading, signOut } = useAuth();
  const { isOwner, isOrganizer } = usePlatformRole();
  const userId = session?.user.id;
  const mine = useAsync(() => (userId ? fetchMyEvents(userId) : Promise.resolve([])), [userId]);
  const fighter = useAsync(async () => {
    if (!userId) return null;
    const id = await fetchMyFighterId();
    return id ? fetchFighterProfile(id) : null;
  }, [userId]);
  const captained = useAsync(() => (userId ? fetchMyCaptainedTeams() : Promise.resolve([])), [userId]);
  const orgAdmin = useAsync(() => (userId ? fetchIsOrgAdmin(userId) : Promise.resolve(false)), [userId]);
  const [nameKey, setNameKey] = useState(0);
  const shown = useAsync(() => (userId ? fetchMyDisplayName(userId) : Promise.resolve('')), [userId, nameKey]);
  const [editingName, setEditingName] = useState(false);
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Account" title="Sign in" /><SignIn /></>;

  const email = session.user.email ?? '';
  const profile = fighter.data;
  const name = shown.data?.trim() || profile?.displayName || email.split('@')[0] || 'Your account';
  const photo = avatarUrl(profile?.avatarPath);
  const teams = captained.data ?? [];
  const events = mine.data ?? [];

  return (
    <section className="fade-in acct" style={{ display: 'grid', gap: 22 }}>
      <header className="acct-head">
        {photo
          ? <img className="avatar" src={photo} alt="" width={84} height={84} />
          : <span className="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          {editingName && userId
            ? <NameEditor userId={userId} initial={shown.data?.trim() || profile?.displayName || ''} onDone={() => { setEditingName(false); setNameKey(k => k + 1); }} />
            : <h1 className="acct-name">{name} <button type="button" className="linklike acct-edit" onClick={() => setEditingName(true)}>Change name</button></h1>}
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>{email}</p>
          <p className="acct-roles">
            {isOwner && <Chip tone="brass">Super admin</Chip>}
            {isOrganizer && !isOwner && <Chip tone="steel">Organizer</Chip>}
            {orgAdmin.data && <Chip tone="steel">Organization admin</Chip>}
            {!isOwner && teams.length > 0 && <Chip>Captain</Chip>}
          </p>
        </div>
      </header>

      <section aria-labelledby="acct-you">
        <h2 id="acct-you" className="acct-h">{isOwner ? 'Teams' : 'You'}</h2>
        <nav className="panel acct-list" aria-label="Your profile and teams">
          {isOwner
            ? <Row to="/team-manager" title="Team manager" sub="Every team: edit, approve new teams, name captains" />
            : <>
                {profile
                  ? <Row to={`/fighters/${profile.fighterId}`} title="My fighter profile" sub="View your public profile, edit it and add a photo" />
                  : <p className="acct-empty">Your fighter profile appears once a registration of yours has been accepted at an event.</p>}
                <Row to="/team-manager" title="Team manager" sub="Join a team, request a new one, answer join requests" />
              </>}
          {!isOwner && teams.map(t => <Row key={t.teamId} to={`/teams/${t.slug}`} title={t.name} sub={t.status === 'pending' ? 'Captain · waiting for approval' : 'Captain · edit the team page'} />)}
        </nav>
      </section>

      <section aria-labelledby="acct-run">
        <h2 id="acct-run" className="acct-h">Run events</h2>
        <nav className="panel acct-list" aria-label="Organizer tools">
          <Row to="/events/new" title="Create an event" sub="Set up a tournament, practice or clinic" />
          {isOwner && <Row to="/platform/organizations" title="Organizations" sub="Switch organizations on or off and manage their admins" />}
        </nav>
      </section>

      {events.length > 0 && (
        <section aria-labelledby="myev-h">
          <h2 id="myev-h" className="acct-h">My events</h2>
          <nav className="panel acct-list" aria-label="My events">
            {events.map(e => <Row key={e.id} to={`/events/${e.slug}`} title={e.name} sub={e.status === 'draft' ? DRAFT_NOTICE : e.status === 'cancelled' ? 'Cancelled' : 'Published'} />)}
          </nav>
        </section>
      )}

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

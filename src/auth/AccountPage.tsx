import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { fetchMyEvents } from '../data/api';
import { fetchMyFighterId } from '../data/fighters';
import { DRAFT_NOTICE } from '../lib/draftView';
import { useAsync } from '../lib/useAsync';
import { useAuth } from './AuthContext';
import { usePlatformRole } from './usePlatformRole';
import { SignIn } from './SignIn';

export function AccountPage() {
  const { session, loading, signOut } = useAuth();
  const { isOwner } = usePlatformRole();
  const userId = session?.user.id;
  const mine = useAsync(() => (userId ? fetchMyEvents(userId) : Promise.resolve([])), [userId]);
  const fighterId = useAsync(() => (userId ? fetchMyFighterId() : Promise.resolve(null)), [userId]);
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Account" title="Sign in" /><SignIn /></>;
  return (
    <>
      <PageHead eyebrow="Account" title="Your account" lede={`Signed in as ${session.user.email ?? 'your account'}.`} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn btn-ink" to="/team-manager">Team manager</Link>
        {fighterId.data && <Link className="btn btn-line" to={`/fighters/${fighterId.data}`}>My profile</Link>}
        <Link className="btn btn-line" to="/events/new">Create an event</Link>
        {isOwner && <Link className="btn btn-line" to="/platform/organizations">Organizations</Link>}
        <button className="btn btn-line" type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
      {(mine.data ?? []).length > 0 && (
        <section aria-labelledby="myev-h" style={{ display: 'grid', gap: 8, marginTop: 18 }}>
          <h2 id="myev-h">My events</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {mine.data!.map(e => (
              <li key={e.id}><Link to={`/events/${e.slug}`}>{e.name}</Link> <span className="src">{e.status === 'draft' ? DRAFT_NOTICE : e.status === 'cancelled' ? 'Cancelled' : 'Published'}</span></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

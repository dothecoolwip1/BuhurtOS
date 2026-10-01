import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { useAuth } from './AuthContext';
import { SignIn } from './SignIn';

export function AccountPage() {
  const { session, loading, signOut } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Account" title="Sign in" /><SignIn /></>;
  return (
    <>
      <PageHead eyebrow="Account" title="Your account" lede={`Signed in as ${session.user.email ?? 'your account'}.`} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn btn-ink" to="/teams/new">Create a team</Link>
        <Link className="btn btn-line" to="/events/new">Create an event</Link>
        <button className="btn btn-line" type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
    </>
  );
}

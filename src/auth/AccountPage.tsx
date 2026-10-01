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
      <button className="btn btn-line" type="button" onClick={() => void signOut()}>Sign out</button>
    </>
  );
}

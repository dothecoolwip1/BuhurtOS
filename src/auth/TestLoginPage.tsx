import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from './AuthContext';

/** Only emails on this domain can use the password form. Real accounts have no passwords. */
export const TEST_DOMAIN = '@buhurtos-test.example';
export const isTestEmail = (email: string) => email.trim().toLowerCase().endsWith(TEST_DOMAIN);

/**
 * Sign-in for the dedicated test accounts, one per role, used to walk the site as each role. Not linked from anywhere.
 * The accounts only exist while testing (see supabase/seed/test_logins.sql and test_logins_remove.sql) and only touch the fictional NACL data.
 */
export function TestLoginPage() {
  useDocumentTitle('Test sign-in');
  const { session, signInWithPassword, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (session) {
    return (
      <section className="panel info" style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
        <h2>Signed in</h2>
        <p>Signed in as <b>{session.user.email}</b>.</p>
        <div className="formactions"><Link className="btn btn-ink" to="/account">Go to the account page</Link><button type="button" className="btn btn-line" onClick={() => void signOut()}>Sign out</button></div>
      </section>
    );
  }
  const ok = isTestEmail(email);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError(null);
    setError(await signInWithPassword(email, password));
    setBusy(false);
  };
  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 440 }}>
      <PageHead eyebrow="Testing" title="Test sign-in" lede="For the test accounts only. Everyone else signs in with a code or Google from the Account page." />
      <form onSubmit={e => void submit(e)} className="panel info" style={{ display: 'grid', gap: 12 }}>
        <label className="field-in">Test account email
          <input type="email" inputMode="email" autoComplete="username" value={email} placeholder={`fighter${TEST_DOMAIN}`} onChange={e => setEmail(e.target.value)} />
          {email && !ok && <span role="alert" style={{ color: 'var(--live)' }}>Test accounts end with {TEST_DOMAIN}.</span>}
        </label>
        <label className="field-in">Password
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
        <button type="submit" className="btn btn-ink" disabled={busy || !ok || password.length < 8}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  );
}


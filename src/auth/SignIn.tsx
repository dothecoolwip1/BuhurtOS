import { useEffect, useState } from 'react';
import { trackEvent } from '../lib/analytics';
import { useAuth } from './AuthContext';

/** Email code + Google. No passwords. */
export function SignIn({ reason }: { reason?: string }) {
  const { sendCode, verifyCode, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { trackEvent('sign_in_opened'); }, []);

  const run = async (fn: () => Promise<string | null>, ok?: () => void) => {
    setBusy(true); setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err); else ok?.();
  };

  return (
    <section className="card field" style={{ maxWidth: 440, margin: '24px auto' }} aria-labelledby="signin-h">
      <h2 id="signin-h">Sign in</h2>
      <p className="muted">{reason ?? 'Sign in to register, follow events and see your fights.'}</p>
      <button className="btn btn-line" type="button" disabled={busy} onClick={() => run(signInWithGoogle)}>Continue with Google</button>
      <p className="muted" style={{ textAlign: 'center' }}>or use an email code</p>
      {!sent ? (
        <form onSubmit={e => { e.preventDefault(); run(() => sendCode(email), () => setSent(true)); }} className="field-in">
          <label className="field-in">Email
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <button className="btn btn-ink" type="submit" disabled={busy || !email.includes('@')}>Email me a code</button>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); run(() => verifyCode(email, code)); }} className="field-in">
          <p>We sent a 6-digit code to <b>{email}</b>. It can take a minute; check spam.</p>
          <label className="field-in">Code
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required value={code} onChange={e => setCode(e.target.value)} />
          </label>
          <button className="btn btn-ink" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>Sign in</button>
          <button className="btn btn-line" type="button" onClick={() => { setSent(false); setCode(''); setError(null); }}>Use a different email</button>
        </form>
      )}
      {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
    </section>
  );
}

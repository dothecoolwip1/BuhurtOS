import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { sendMagicLink, signIn } from '../lib/auth';

export function LoginPage() {
  const { user } = useAppState();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={`/run${location.search}`} replace />;
  const run = async (action: 'password' | 'magic') => {
    setBusy(true); setMessage('');
    try {
      if (action === 'password') await signIn(email, password); else await sendMagicLink(email);
      setMessage(action === 'magic' ? 'Magic link sent. Check your email.' : 'Signed in.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Sign in failed.'); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell"><section className="auth-card"><span className="brand-mark large">B</span><span className="eyebrow">BuhurtOS</span><h1>Field Sign In</h1><p>Use your tournament account. Public event pages never require a login.</p><label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label>{message && <div className="auth-message">{message}</div>}<button className="primary big" disabled={busy || !email || !password} onClick={() => run('password')}>Sign In</button><button className="big" disabled={busy || !email} onClick={() => run('magic')}>Email Magic Link</button></section></main>;
}

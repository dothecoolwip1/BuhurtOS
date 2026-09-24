import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { requestPasswordReset, safeOpsRedirect, sendMagicLink, signIn, signUp, updatePassword } from '../lib/auth';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'recovery';

function messageFromUrl(search: string): string {
  const params = new URLSearchParams(search);
  const error = params.get('error_description') || params.get('error');
  if (error) return error.replace(/\+/g, ' ');
  if (params.get('mode') === 'verify') return 'Email verified. Your account is ready.';
  return '';
}

export function LoginPage() {
  const { user, authReady } = useAppState();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedMode = params.get('mode');
  const [mode, setMode] = useState<AuthMode>(requestedMode === 'recovery' ? 'recovery' : 'signin');
  const next = safeOpsRedirect(params.get('next'));
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(() => messageFromUrl(location.search));
  const [kind, setKind] = useState<'info' | 'error' | 'success'>('info');
  const [busy, setBusy] = useState(false);

  if (!authReady) return <main className="auth-shell"><section className="auth-card"><div className="state-card">Checking your session…</div></section></main>;
  if (user && mode !== 'recovery') return <Navigate to={next} replace />;

  const setFailure = (error: unknown) => {
    setKind('error');
    setMessage(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
  };

  const runSignIn = async () => {
    setBusy(true); setMessage('');
    try {
      await signIn(email, password);
      setKind('success'); setMessage('Signed in. Loading your access…');
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  };

  const runSignUp = async () => {
    if (password.length < 8) { setKind('error'); setMessage('Use a password with at least 8 characters.'); return; }
    if (password !== confirmPassword) { setKind('error'); setMessage('Passwords do not match.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await signUp(email, password, displayName);
      setKind('success');
      setMessage(result.verificationRequired ? 'Account created. Check your email to verify it before signing in.' : 'Account created and signed in.');
      if (result.verificationRequired) setMode('signin');
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  };

  const runMagicLink = async () => {
    setBusy(true); setMessage('');
    try {
      await sendMagicLink(email, next);
      setKind('success'); setMessage('If that email has an account, a sign in link is on its way.');
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  };

  const runResetRequest = async () => {
    setBusy(true); setMessage('');
    try {
      await requestPasswordReset(email);
      setKind('success');
      setMessage('If that email has an account, a password reset link is on its way.');
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  };

  const runPasswordUpdate = async () => {
    if (!user) { setKind('error'); setMessage('This recovery link is invalid or expired. Request a new one.'); return; }
    if (password.length < 8) { setKind('error'); setMessage('Use a password with at least 8 characters.'); return; }
    if (password !== confirmPassword) { setKind('error'); setMessage('Passwords do not match.'); return; }
    setBusy(true); setMessage('');
    try {
      await updatePassword(password);
      setKind('success'); setMessage('Password updated. You can continue to BuhurtOS.');
      setMode('signin');
    } catch (error) { setFailure(error); }
    finally { setBusy(false); }
  };

  return <main className="auth-shell"><section className="auth-card">
    <span className="brand-mark large">B</span><span className="eyebrow">BuhurtOS</span>
    <h1>{mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Reset Password' : mode === 'recovery' ? 'Choose New Password' : 'Field Sign In'}</h1>
    <p>{mode === 'signup' ? 'Create your private account. Sporting roles are assigned separately by authorized organizers.' : mode === 'forgot' ? 'We will send a reset link if the account exists.' : mode === 'recovery' ? 'Set a new password for your signed in recovery session.' : 'Use your tournament account. Public event pages never require a login.'}</p>

    {mode === 'signup' && <label>Display name<input type="text" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>}
    {mode !== 'recovery' && <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>}
    {(mode === 'signin' || mode === 'signup' || mode === 'recovery') && <label>{mode === 'recovery' ? 'New password' : 'Password'}<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>}
    {(mode === 'signup' || mode === 'recovery') && <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>}

    {message && <div className={`auth-message ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{message}</div>}

    {mode === 'signin' && <>
      <button className="primary big" disabled={busy || !email || !password} onClick={runSignIn}>{busy ? 'Signing in…' : 'Sign In'}</button>
      <button className="big" disabled={busy || !email} onClick={runMagicLink}>Email Sign In Link</button>
      <div className="auth-links"><button className="link-button" onClick={() => { setMode('forgot'); setMessage(''); }}>Forgot password?</button><button className="link-button" onClick={() => { setMode('signup'); setMessage(''); }}>Create account</button></div>
    </>}
    {mode === 'signup' && <>
      <button className="primary big" disabled={busy || !email || !displayName.trim() || !password || !confirmPassword} onClick={runSignUp}>{busy ? 'Creating…' : 'Create Account'}</button>
      <button className="link-button" onClick={() => { setMode('signin'); setMessage(''); }}>Back to sign in</button>
    </>}
    {mode === 'forgot' && <>
      <button className="primary big" disabled={busy || !email} onClick={runResetRequest}>{busy ? 'Sending…' : 'Send Reset Link'}</button>
      <button className="link-button" onClick={() => { setMode('signin'); setMessage(''); }}>Back to sign in</button>
    </>}
    {mode === 'recovery' && <>
      <button className="primary big" disabled={busy || !password || !confirmPassword} onClick={runPasswordUpdate}>{busy ? 'Updating…' : 'Update Password'}</button>
      {!user && <button className="link-button" onClick={() => { setMode('forgot'); setMessage(''); }}>Request a new reset link</button>}
    </>}
    <Link className="auth-public-link" to="/live">View public event coverage</Link>
  </section></main>;
}

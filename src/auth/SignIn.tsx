import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { trackEvent } from '../lib/analytics';
import { looksLikeEmail, MIN_PASSWORD, newPasswordProblem } from '../lib/authFlow';
import { useAuth } from './AuthContext';

type Mode = 'password' | 'signup' | 'signup_sent' | 'forgot' | 'forgot_sent' | 'code' | 'code_sent';

/** A password box with a show/hide switch. Autocomplete tells the browser's password manager what this field is. */
export function PasswordInput({ label, value, onChange, autoComplete, id, hint }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: 'current-password' | 'new-password'; id: string; hint?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field-in">
      <label htmlFor={id}>{label}</label>
      <div className="pw-row">
        <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={e => onChange(e.target.value)}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        <button type="button" className="pw-toggle" aria-pressed={shown} aria-controls={id} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setShown(s => !s)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <span className="src">{hint}</span>}
    </div>
  );
}

/**
 * Sign in or create an account (Pack 18): email + password first, then the older ways (email code, Google) underneath, all through Supabase Auth.
 * Rendered in place on the page the person asked for, so after signing in they are already where they wanted to be; email links carry that page too.
 */
export function SignIn({ reason, next: nextProp, startIn = 'password' }: { reason?: string; next?: string; startIn?: 'password' | 'signup' }) {
  const { sendCode, verifyCode, signInWithGoogle, signInWithPassword, signUpWithPassword, resendConfirmation, requestPasswordReset } = useAuth();
  const loc = useLocation();
  const next = nextProp ?? `${loc.pathname}${loc.search}${loc.hash}`;
  const [mode, setMode] = useState<Mode>(startIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { trackEvent('sign_in_opened'); }, []);

  // One request at a time: a second tap while the first is on its way does nothing.
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null); setNote(null);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };
  const go = (m: Mode) => { setMode(m); setError(null); setNote(null); setPassword(''); setCode(''); };
  const okEmail = looksLikeEmail(email);

  const submitPassword = (e: FormEvent) => { e.preventDefault(); void run(async () => { const err = await signInWithPassword(email, password); if (err) setError(err); }); };
  const submitSignup = (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(password);
    if (problem) { setError(problem); return; }
    void run(async () => {
      const r = await signUpWithPassword(email, password, next);
      if (r.error) setError(r.error); else if (r.confirm) { setPassword(''); setMode('signup_sent'); }
    });
  };
  const submitForgot = (e: FormEvent) => { e.preventDefault(); void run(async () => { const err = await requestPasswordReset(email, next); if (err) setError(err); else setMode('forgot_sent'); }); };

  const title = mode === 'signup' || mode === 'signup_sent' ? 'Create an account' : mode === 'forgot' || mode === 'forgot_sent' ? 'Reset your password' : 'Sign in';
  // with a password the address is the account's user name (what password managers pair with it); otherwise it is just an email
  const emailField = (
    <label className="field-in">Email
      <input type="email" name="email" autoComplete={mode === 'password' || mode === 'signup' ? 'username' : 'email'} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
        value={email} onChange={e => setEmail(e.target.value)} />
    </label>
  );

  return (
    <section className="card field auth-card" aria-labelledby="signin-h">
      <h2 id="signin-h">{title}</h2>
      {mode === 'password' && <p className="muted">{reason ?? 'Sign in to register, follow events and see your fights.'}</p>}

      {mode === 'password' && (
        <form onSubmit={submitPassword} className="auth-form" aria-label="Sign in with email and password">
          {emailField}
          <PasswordInput id="signin-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <button type="button" className="linklike auth-forgot" onClick={() => go('forgot')}>Forgot password?</button>
          <button className="btn btn-ink" type="submit" disabled={busy || !okEmail || password.length === 0}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="auth-switch">New to BuhurtOS? <button type="button" className="linklike" onClick={() => go('signup')}>Create account</button></p>
        </form>
      )}

      {mode === 'signup' && (
        <form onSubmit={submitSignup} className="auth-form" aria-label="Create an account">
          <p className="muted">Fighters, captains, organizers and staff all use the same kind of account. Your fighter record and team stay separate: you link them after.</p>
          {emailField}
          <PasswordInput id="signup-password" label="Choose a password" value={password} onChange={setPassword} autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
          <button className="btn btn-ink" type="submit" disabled={busy || !okEmail || password.length === 0}>{busy ? 'Creating…' : 'Create account'}</button>
          <p className="auth-switch">Already have an account? <button type="button" className="linklike" onClick={() => go('password')}>Sign in</button></p>
        </form>
      )}

      {mode === 'signup_sent' && (
        <div className="auth-form" role="status">
          <p><b>Check your email.</b> If <b style={{ overflowWrap: 'anywhere' }}>{email.trim()}</b> can be used for a new BuhurtOS account, we have sent it a link to confirm the address. Open the link to finish; it brings you back here.</p>
          <p className="src">Nothing after a few minutes? Check spam, or send it again. If you already have an account with this email, sign in instead or use "Forgot password?".</p>
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => void run(async () => { const err = await resendConfirmation(email, next); if (err) setError(err); else setNote('Sent again, if the address can be used.'); })}>
            {busy ? 'Sending…' : 'Send the link again'}
          </button>
          <p className="auth-switch"><button type="button" className="linklike" onClick={() => go('password')}>Back to sign in</button></p>
        </div>
      )}

      {mode === 'forgot' && (
        <form onSubmit={submitForgot} className="auth-form" aria-label="Reset your password">
          <p className="muted">Enter the email you sign in with. If it has a BuhurtOS account, we will email a link to choose a new password. Signed in with a code or Google before? This sets a password too.</p>
          {emailField}
          <button className="btn btn-ink" type="submit" disabled={busy || !okEmail}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
          <p className="auth-switch"><button type="button" className="linklike" onClick={() => go('password')}>Back to sign in</button></p>
        </form>
      )}

      {mode === 'forgot_sent' && (
        <div className="auth-form" role="status">
          <p><b>Check your email.</b> If <b style={{ overflowWrap: 'anywhere' }}>{email.trim()}</b> has a BuhurtOS account, a link to choose a new password is on its way (or was sent a moment ago). Open the newest one on this device; it works once and expires.</p>
          <p className="src">Nothing after a few minutes? Check spam, or ask again.</p>
          <p className="auth-switch"><button type="button" className="linklike" onClick={() => go('forgot')}>Ask again</button> · <button type="button" className="linklike" onClick={() => go('password')}>Back to sign in</button></p>
        </div>
      )}

      {(mode === 'code' || mode === 'code_sent') && (mode === 'code' ? (
        <form onSubmit={e => { e.preventDefault(); void run(async () => { const err = await sendCode(email); if (err) setError(err); else setMode('code_sent'); }); }} className="auth-form" aria-label="Sign in with an email code">
          <p className="muted">We email you a 6-digit code instead of using a password.</p>
          {emailField}
          <button className="btn btn-ink" type="submit" disabled={busy || !okEmail}>{busy ? 'Sending…' : 'Email me a code'}</button>
          <p className="auth-switch"><button type="button" className="linklike" onClick={() => go('password')}>Use a password instead</button></p>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void run(async () => { const err = await verifyCode(email, code); if (err) setError(err); }); }} className="auth-form" aria-label="Enter the email code">
          <p>We sent a 6-digit code to <b style={{ overflowWrap: 'anywhere' }}>{email}</b>. It can take a minute; check spam.</p>
          <label className="field-in">Code
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required value={code} onChange={e => setCode(e.target.value)} />
          </label>
          <button className="btn btn-ink" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button className="btn btn-line" type="button" onClick={() => go('code')}>Use a different email</button>
        </form>
      ))}

      {error && <p role="alert" className="auth-error">{error}</p>}
      {note && <p role="status" className="src">{note}</p>}

      {(mode === 'password' || mode === 'signup' || mode === 'code') && (
        <div className="auth-other">
          <p className="muted">{mode === 'code' ? 'Or' : 'Other ways to sign in'}</p>
          <button className="btn btn-line" type="button" disabled={busy} onClick={() => void run(async () => { const err = await signInWithGoogle(); if (err) setError(err); })}>Continue with Google</button>
          {mode !== 'code' && <button className="btn btn-line" type="button" disabled={busy} onClick={() => go('code')}>Email me a sign-in code</button>}
        </div>
      )}
    </section>
  );
}

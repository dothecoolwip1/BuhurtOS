import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { supabase } from '../lib/supabase';
import { authErrorMessage, authUrlError, hadAuthCode, linkErrorMessage, looksLikeEmail, newPasswordProblem, safeNext } from '../lib/authFlow';
import { initialHref } from '../lib/authUrl';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuth } from './AuthContext';
import { PasswordInput, SignIn } from './SignIn';

/** /sign-in?next=/somewhere : for links from outside a page (the inline sign-in on each page already keeps people where they are). */
export function SignInPage() {
  useDocumentTitle('Sign in');
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  if (loading) return <p className="muted">Loading…</p>;
  if (session) return <Navigate to={next} replace />;
  return <><PageHead eyebrow="Account" title="Sign in" /><SignIn next={next} startIn={params.get('mode') === 'signup' ? 'signup' : 'password'} /></>;
}

/** "Send me a new link": the same answer whatever the address. */
function NewLinkForm({ next }: { next: string }) {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const err = await requestPasswordReset(email, next);
    setBusy(false);
    if (err) setError(err); else setSent(true);
  };
  if (sent) return <p role="status"><b>Check your email.</b> If <b style={{ overflowWrap: 'anywhere' }}>{email.trim()}</b> has a BuhurtOS account, a new link is on its way. Open it in this browser.</p>;
  return (
    <form onSubmit={e => void submit(e)} className="auth-form" aria-label="Send a new reset link">
      <label className="field-in">Email
        <input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" required value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-ink" disabled={busy || !looksLikeEmail(email)}>{busy ? 'Sending…' : 'Send a new link'}</button>
      {error && <p role="alert" className="auth-error">{error}</p>}
    </form>
  );
}

/**
 * Where the password-reset email lands (Pack 18). Supabase turns a good link into a short "recovery" sign-in; this page then asks for the new
 * password twice. An expired, used, invalid or other-browser link is explained, with a way to get a new one. Leaving and coming back keeps working
 * for as long as that recovery sign-in lasts.
 */
export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  // only what THIS page load came with counts (an in-app visit later has no link)
  const fromLink = /\/reset-password(\?|#|$)/.test(initialHref.replace(/^[a-z]+:\/\/[^/]+/i, ''));
  const linkError = fromLink ? authUrlError(initialHref) : null;
  const hadCode = fromLink && hadAuthCode(initialHref);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (!err) { setDone(true); setPassword(''); setConfirm(''); return; }
    const code = (err as { code?: string }).code;
    // A normal sign-in (not a reset link) may need the current password: that is Account › Password.
    if (code === 'current_password_required' || code === 'reauthentication_needed') setError('To change a password while signed in normally, use Account › Password.');
    else setError(authErrorMessage(err, 'new_password'));
  };

  let body;
  if (loading) body = <p className="muted" role="status">Opening your link…</p>;
  else if (done) {
    body = (
      <div className="auth-form" role="status">
        <p><b>Password saved.</b> You are signed in. Next time, sign in with your email and the new password.</p>
        <button type="button" className="btn btn-ink" onClick={() => navigate(next, { replace: true })}>{next === '/' ? 'Go to BuhurtOS' : 'Continue where you were'}</button>
      </div>
    );
  } else if (session) {
    body = (
      <form onSubmit={e => void save(e)} className="auth-form" aria-label="Choose a new password">
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>For <b>{session.user.email}</b>.</p>
        {/* the user name field lets a password manager save the new password against the right account */}
        <input type="email" autoComplete="username" value={session.user.email ?? ''} readOnly hidden />
        <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
        <PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button type="submit" className="btn btn-ink" disabled={busy || !password || !confirm}>{busy ? 'Saving…' : 'Save password'}</button>
        {error && <p role="alert" className="auth-error">{error}</p>}
      </form>
    );
  } else {
    const why = linkError ? linkErrorMessage(linkError)
      : hadCode ? 'This link has expired, was already used, or was opened in a different browser from the one you asked in. Ask for a new one below.'
      : 'Open the link from the reset email to choose a new password. No email, or it expired? Ask for a new one below.';
    body = (
      <div className="auth-form">
        <p role={linkError || hadCode ? 'alert' : undefined}>{why}</p>
        <NewLinkForm next={next} />
        <p className="auth-switch"><Link to={`/sign-in?next=${encodeURIComponent(next)}`}>Back to sign in</Link></p>
      </div>
    );
  }
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Account" title="Choose a new password" />
      <div className="card field auth-card">{body}</div>
    </section>
  );
}

/**
 * Account › Password (Pack 18). With a current password: it is checked first (a fresh sign-in), then the new one is saved; Supabase's own rules
 * (current password, reauthentication) apply on top. An account that has only ever used codes or Google can set a first password; if Supabase
 * asks for reauthentication it emails a code and the change waits for it.
 */
export function ChangePassword({ email }: { email: string }) {
  const [hasPassword, setHasPassword] = useState(true);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nonceAsked, setNonceAsked] = useState(false);
  const [nonce, setNonce] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = newPasswordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null); setDone(false);
    try {
      if (hasPassword && !nonceAsked) {
        const check = await supabase.auth.signInWithPassword({ email, password: current });
        if (check.error) { setError(authErrorMessage(check.error, 'change_password')); return; }
      }
      const { error: err } = await supabase.auth.updateUser({ password, ...(hasPassword ? { current_password: current } : {}), ...(nonceAsked ? { nonce: nonce.trim() } : {}) });
      if (!err) { setDone(true); setCurrent(''); setPassword(''); setConfirm(''); setNonce(''); setNonceAsked(false); return; }
      if ((err as { code?: string }).code === 'reauthentication_needed') {
        const r = await supabase.auth.reauthenticate();
        if (r.error) { setError(authErrorMessage(r.error, 'change_password')); return; }
        setNonceAsked(true);
        setError(null);
        return;
      }
      setError(authErrorMessage(err, 'change_password'));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={e => void save(e)} className="auth-form" aria-label="Change password">
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      {hasPassword && <PasswordInput id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />}
      <label className="check-row"><input type="checkbox" checked={!hasPassword} onChange={e => { setHasPassword(!e.target.checked); setError(null); }} /> I have never set a password (I sign in with a code or Google)</label>
      <PasswordInput id="change-new" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
      <PasswordInput id="change-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {nonceAsked && (
        <label className="field-in" role="group">We emailed you a code to confirm it is you. Enter it here:
          <input inputMode="numeric" autoComplete="one-time-code" value={nonce} onChange={e => setNonce(e.target.value)} />
        </label>
      )}
      <button type="submit" className="btn btn-ink" disabled={busy || !password || !confirm || (hasPassword && !current) || (nonceAsked && nonce.trim().length < 6)}>
        {busy ? 'Saving…' : nonceAsked ? 'Confirm and save' : 'Save new password'}
      </button>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {done && <p role="status"><b>Password changed.</b> Use it next time you sign in.</p>}
      <p className="src">Forgot your current password? Sign out and use "Forgot password?" on the sign-in screen.</p>
    </form>
  );
}

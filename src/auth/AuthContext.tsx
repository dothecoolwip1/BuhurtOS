import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { disablePush } from '../lib/push';
import { identifyUser, isNewAccount, markSignInStarted, resetUser, takeSignInStarted, trackEvent, wantOnboarding } from '../lib/analytics';
import { authErrorMessage, siteUrl } from '../lib/authFlow';

/** Absolute link back to a page of this deployment (for the emails Supabase sends). */
const back = (path: string) => siteUrl(window.location.origin, import.meta.env.BASE_URL ?? '/', path);

interface AuthValue {
  session: Session | null;
  /** True until the first session lookup finishes, so pages do not flash "signed out". */
  loading: boolean;
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  /** Email + password through Supabase Auth (Pack 18). Null on success, otherwise words that never reveal whether the address has an account. */
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  /** Create an account. `confirm` = Supabase asked the person to confirm their email first (no session yet). `next` = where the email link returns. */
  signUpWithPassword: (email: string, password: string, next: string) => Promise<{ error: string | null; confirm: boolean }>;
  /** Send the confirmation email again. Same answer for every address. */
  resendConfirmation: (email: string, next: string) => Promise<string | null>;
  /** Forgot password: Supabase emails a reset link IF the address has an account; the answer is the same either way. */
  requestPasswordReset: (email: string, next: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => { if (live) { setSession(data.session); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s); setLoading(false);
      if (s) identifyUser(s.user.id);
      if (event === 'SIGNED_IN' && s) {
        // Only a sign-in the person started in this tab counts; a session restored on load or refreshed is not a login.
        const method = takeSignInStarted();
        if (method) {
          trackEvent(isNewAccount(s.user.created_at) ? 'sign_up' : 'login', { method });
          wantOnboarding(s.user.id);
        }
      }
      if (event === 'SIGNED_OUT') { resetUser(); void disablePush(null); }   // never leave this device subscribed to the previous person's alerts
    });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  const sendCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (!error) trackEvent('sign_in_code_sent');
    return error ? friendlyError(error) : null;
  }, []);
  const verifyCode = useCallback(async (email: string, code: string) => {
    markSignInStarted('code');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'email' });
    return error ? friendlyError(error) : null;
  }, []);
  const signInWithPassword = useCallback(async (email: string, password: string) => {
    markSignInStarted('password');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? authErrorMessage(error, 'sign_in') : null;
  }, []);
  const signUpWithPassword = useCallback(async (email: string, password: string, next: string) => {
    markSignInStarted('password');
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: back(next) } });
    if (error) return { error: authErrorMessage(error, 'sign_up'), confirm: false };
    // With "Confirm email" on, Supabase returns no session (and, for an address that already has an account, a look-alike answer): say "check your email".
    return { error: null, confirm: !data.session };
  }, []);
  const resendConfirmation = useCallback(async (email: string, next: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: back(next) } });
    return error ? authErrorMessage(error, 'resend') : null;
  }, []);
  const requestPasswordReset = useCallback(async (email: string, next: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: back(`/reset-password?next=${encodeURIComponent(next)}`) });
    return error ? authErrorMessage(error, 'reset_request') : null;
  }, []);
  const signInWithGoogle = useCallback(async () => {
    markSignInStarted('google');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
    return error ? friendlyError(error) : null;
  }, []);
  // Alerts are removed (here and on the server) while still signed in, so a shared phone never keeps delivering this person's fights.
  const signOut = useCallback(async () => { await disablePush(session?.user.id ?? null).catch(() => undefined); await supabase.auth.signOut(); }, [session]);

  const value = useMemo(() => ({ session, loading, sendCode, verifyCode, signInWithGoogle, signInWithPassword, signUpWithPassword, resendConfirmation, requestPasswordReset, signOut }),
    [session, loading, sendCode, verifyCode, signInWithGoogle, signInWithPassword, signUpWithPassword, resendConfirmation, requestPasswordReset, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

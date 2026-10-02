import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';

interface AuthValue {
  session: Session | null;
  /** True until the first session lookup finishes, so pages do not flash "signed out". */
  loading: boolean;
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  /** Only for the dedicated test accounts (see /test-login). */
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => { if (live) { setSession(data.session); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); setLoading(false); });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  const sendCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    return error ? friendlyError(error) : null;
  }, []);
  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'email' });
    return error ? friendlyError(error) : null;
  }, []);
  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? (error.message.toLowerCase().includes('invalid') ? 'That email and password do not match a test account.' : friendlyError(error)) : null;
  }, []);
  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
    return error ? friendlyError(error) : null;
  }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const value = useMemo(() => ({ session, loading, sendCode, verifyCode, signInWithGoogle, signInWithPassword, signOut }), [session, loading, sendCode, verifyCode, signInWithGoogle, signInWithPassword, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

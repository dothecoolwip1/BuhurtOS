import { supabase } from './supabase';

export type AuthRedirectKind = 'login' | 'verify' | 'recovery';

function authRedirect(kind: AuthRedirectKind, next = '/ops'): string {
  const params = new URLSearchParams();
  params.set('mode', kind);
  if (next.startsWith('/ops')) params.set('next', next);
  return `${window.location.origin}${window.location.pathname}#/ops/login?${params.toString()}`;
}

export function safeOpsRedirect(candidate: string | null | undefined, fallback = '/ops'): string {
  if (!candidate) return fallback;
  try {
    const decoded = decodeURIComponent(candidate);
    if (!decoded.startsWith('/ops')) return fallback;
    if (decoded.startsWith('//') || decoded.includes('://') || decoded.includes('\\')) return fallback;
    return decoded;
  } catch {
    return fallback;
  }
}

export async function signUp(email: string, password: string, displayName: string): Promise<{ verificationRequired: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured. Demo mode is available instead.');
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { display_name: displayName.trim() },
      emailRedirectTo: authRedirect('verify')
    }
  });
  if (error) throw error;
  return { verificationRequired: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured. Demo mode is available instead.');
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function sendMagicLink(email: string, next = '/ops'): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: authRedirect('login', safeOpsRedirect(next))
    }
  });
  if (error) throw error;
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: authRedirect('recovery')
  });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

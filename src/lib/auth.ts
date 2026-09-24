import { supabase } from './supabase';

export type AuthNotice = 'signed_out' | 'session_expired' | null;
export type ExternalAuthMode = 'signin' | 'recovery';

const DEFAULT_AUTH_RETURN = '/ops';

export function sanitizeAuthReturnPath(value?: string | null): string {
  if (!value) return DEFAULT_AUTH_RETURN;
  if (value.includes('\\') || /[\r\n]/.test(value) || value.startsWith('//')) return DEFAULT_AUTH_RETURN;
  try {
    const parsed = new URL(value, 'https://buhurtos.invalid');
    if (parsed.origin !== 'https://buhurtos.invalid') return DEFAULT_AUTH_RETURN;
    if (parsed.pathname !== '/ops' && !parsed.pathname.startsWith('/ops/')) return DEFAULT_AUTH_RETURN;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_AUTH_RETURN;
  }
}

export function authNoticeForEvent(event: string, hadAuthenticatedSession: boolean, intentionalSignOut: boolean): AuthNotice {
  if (event !== 'SIGNED_OUT') return null;
  if (intentionalSignOut) return 'signed_out';
  return hadAuthenticatedSession ? 'session_expired' : null;
}

function redirectUrl(mode: ExternalAuthMode, next?: string | null): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('auth_mode', mode);
  url.searchParams.set('auth_next', sanitizeAuthReturnPath(next));
  return url.toString();
}

export function readExternalAuthReturn(): { mode: ExternalAuthMode; next: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('auth_mode');
  if (rawMode !== 'signin' && rawMode !== 'recovery') return null;
  return { mode: rawMode, next: sanitizeAuthReturnPath(params.get('auth_next')) };
}

export function finishExternalAuthReturn(mode: ExternalAuthMode, next: string): void {
  if (typeof window === 'undefined') return;
  const safeNext = sanitizeAuthReturnPath(next);
  const target = mode === 'recovery'
    ? `/ops/login?mode=recovery&next=${encodeURIComponent(safeNext)}`
    : safeNext;
  window.history.replaceState({}, document.title, window.location.pathname);
  window.location.hash = `#${target}`;
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured. Demo mode is available instead.');
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signUp(email: string, password: string, displayName: string, next?: string | null): Promise<{ requiresVerification: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { display_name: displayName.trim() },
      emailRedirectTo: redirectUrl('signin', next)
    }
  });
  if (error) throw error;
  return { requiresVerification: !data.session };
}

export async function resendVerification(email: string, next?: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: redirectUrl('signin', next) }
  });
  if (error) throw error;
}

export async function requestPasswordReset(email: string, next?: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: redirectUrl('recovery', next)
  });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('buhurtos:intentional-signout', '1');
  const { error } = await supabase.auth.signOut();
  if (error) {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('buhurtos:intentional-signout');
    throw error;
  }
}

export async function sendMagicLink(email: string, next?: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: redirectUrl('signin', next),
      shouldCreateUser: false
    }
  });
  if (error) throw error;
}

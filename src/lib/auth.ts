import { supabase } from './supabase';

function requireClient() {
  if (!supabase) throw new Error('BuhurtOS authentication is not configured.');
  return supabase;
}

function appRedirect(route: string): string {
  if (typeof window === 'undefined') return route;
  return window.location.origin + window.location.pathname + '#' + route;
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendMagicLink(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: appRedirect('/ops') }
  });
  if (error) throw error;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: appRedirect('/ops/recover')
  });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const client = requireClient();
  if (password.length < 10) throw new Error('Use a password with at least 10 characters.');
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function completeAccountSetup(displayName: string, password: string): Promise<void> {
  const client = requireClient();
  const trimmedName = displayName.trim();
  if (trimmedName.length < 2) throw new Error('Enter your display name.');
  if (password.length < 10) throw new Error('Use a password with at least 10 characters.');
  const { error } = await client.auth.updateUser({
    password,
    data: { display_name: trimmedName }
  });
  if (error) throw error;
  await client.from('profiles').update({ display_name: trimmedName, account_status: 'active' }).eq('id', (await client.auth.getUser()).data.user?.id ?? '');
}

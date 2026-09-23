import { supabase } from './supabase';

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured. Demo mode is available instead.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const queryIndex = window.location.hash.indexOf('?');
  const hashQuery = queryIndex >= 0 ? window.location.hash.slice(queryIndex) : '';
  const emailRedirectTo = `${window.location.origin}${window.location.pathname}#/ops/login${hashQuery}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw error;
}

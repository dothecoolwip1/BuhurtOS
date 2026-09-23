import { supabase } from './supabase';
import { clearPrivateSnapshotCache } from './offlineSnapshot';
import { normalizeEmail, validateEmail, validatePassword } from './validation';

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
  const { error } = await client.auth.signInWithPassword({ email:normalizeEmail(email),password });
  if (error) throw error;
}

export async function signOut():Promise<void>{
  if(!supabase)return;
  const userId=(await supabase.auth.getUser()).data.user?.id;
  const {error}=await supabase.auth.signOut();
  if(error)throw error;
  if(userId)await clearPrivateSnapshotCache('user:'+userId);
}

export async function sendMagicLink(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithOtp({
    email:normalizeEmail(email),
    options: { emailRedirectTo: appRedirect('/ops') }
  });
  if (error) throw error;
}

export async function requestPasswordReset(email:string):Promise<void>{
  const client=requireClient();
  const validation=validateEmail(email);
  if(validation)throw new Error(validation);
  const {error}=await client.auth.resetPasswordForEmail(normalizeEmail(email),{
    redirectTo: appRedirect('/ops/recover')
  });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const client = requireClient();
  const validation=validatePassword(password);
  if(validation)throw new Error(validation);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function completeAccountSetup(displayName: string, password: string): Promise<void> {
  const client = requireClient();
  const trimmedName = displayName.trim();
  if (trimmedName.length < 2) throw new Error('Enter your display name.');
  const passwordValidation=validatePassword(password);
  if(passwordValidation)throw new Error(passwordValidation);
  const { error } = await client.auth.updateUser({
    password,
    data: { display_name: trimmedName }
  });
  if (error) throw error;
  await client.from('profiles').update({ display_name: trimmedName, account_status: 'active' }).eq('id', (await client.auth.getUser()).data.user?.id ?? '');
}

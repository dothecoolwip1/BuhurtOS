import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const publishableKey = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined)?.trim();

function validSupabaseUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export const isDemoModeAllowed = import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEMO_MODE === 'true';
export const configurationError = !url || !publishableKey
  ? 'BuhurtOS operations require VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
  : !validSupabaseUrl(url)
    ? 'VITE_SUPABASE_URL must be a valid HTTPS URL.'
    : null;

export const isSupabaseConfigured = configurationError === null;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    })
  : null;

export function subscribeToEvent(eventId: string, onChange: () => void): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel('event:' + eventId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'event_id=eq.' + eventId }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_roster_entries', filter: 'event_id=eq.' + eventId }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: 'event_id=eq.' + eventId }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fight_cards', filter: 'event_id=eq.' + eventId }, onChange)
    .subscribe();
}

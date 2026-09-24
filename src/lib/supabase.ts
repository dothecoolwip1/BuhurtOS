import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, publishableKey!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce'
  }
}) : null;

export const publicSupabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, publishableKey!, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  global: {
    headers: { 'x-buhurtos-access': 'public' }
  }
}) : null;

export function subscribeToEvent(eventId: string, onChange: () => void): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel(`event:${eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_roster_entries', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fight_cards', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, onChange)
    .subscribe();
}

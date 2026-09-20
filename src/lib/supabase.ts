import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isSupabaseConfigured = Boolean(url && publishableKey);
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, publishableKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

export function subscribeToEvent(eventId: string, onChange: () => void): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel(`event:${eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_roster_entries', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `event_id=eq.${eventId}` }, onChange)
    .subscribe();
}

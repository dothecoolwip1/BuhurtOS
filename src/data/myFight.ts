import { supabase } from '../lib/supabase';

/**
 * The entry ids in this event that belong to the signed-in person (their own fighter entries, and team entries for a team they are
 * accepted on). Answered by the my_event_entries database function, which returns entry ids only and nothing for anonymous callers.
 */
export async function fetchMyEventEntryIds(eventId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('my_event_entries', { p_event: eventId });
  if (error) throw error;
  return ((data ?? []) as { entry_id: string }[]).map(r => r.entry_id);
}

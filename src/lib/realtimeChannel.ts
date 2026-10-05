import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

let seq = 0;

/**
 * A realtime channel that belongs to exactly ONE subscriber.
 *
 * supabase-js hands back the SAME channel object when the same topic name is asked for twice. Two screens (or a screen and a hook inside it,
 * for example Manage and its Broadcast tab, which both watch the event record) that used one name shared a channel: the second one's `.on()`
 * throws "cannot add postgres_changes callbacks … after subscribe()" once the first has joined (which only happens with a live realtime
 * connection, i.e. in production), and when either unmounts its removeChannel tears the subscription out from under the other.
 * A per-subscriber suffix keeps every subscription independent. The name is only a label: what a channel listens to is set by its `.on()` filters.
 */
export function realtimeChannel(name: string): RealtimeChannel {
  seq += 1;
  return supabase.channel(`${name}:${seq}`);
}

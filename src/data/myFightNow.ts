import { supabase } from '../lib/supabase';

export type CalledStage = 'active' | 'on_deck' | 'in_the_hole';
export interface FightNow { eventSlug: string; eventName: string; competition: string; field: string; stage: CalledStage; opponent: string | null }
type Db = { event_slug: string; event_name: string; competition_name: string; field: string; stage: CalledStage; opponent: string | null };

/** The signed-in person's most pressing called fight in an event on today (my_fight_now). Null when none. */
export async function fetchFightNow(): Promise<FightNow | null> {
  const { data, error } = await supabase.rpc('my_fight_now');
  if (error) throw error;
  const r = (data as Db[])[0];
  return r ? { eventSlug: r.event_slug, eventName: r.event_name, competition: r.competition_name, field: r.field, stage: r.stage, opponent: r.opponent } : null;
}

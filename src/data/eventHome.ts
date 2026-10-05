import { supabase } from '../lib/supabase';
import type { LiveCompetition } from './api';
import { recordState } from '../lib/finalization';
import type { CompetitionFact } from '../lib/eventJourney';

const INACTIVE = new Set(['withdrawn', 'disqualified']);

/** Per competition: entrants still in, fights and fights done, record state. Two reads for the whole event; row level security decides what is seen. */
export async function fetchCompetitionFacts(competitions: readonly LiveCompetition[]): Promise<CompetitionFact[]> {
  const ids = competitions.map(c => c.id);
  if (ids.length === 0) return [];
  const [ents, mats] = await Promise.all([
    supabase.from('entries').select('competition_id,status').in('competition_id', ids),
    supabase.from('matches').select('competition_id,queue_state').in('competition_id', ids)
  ]);
  if (ents.error) throw ents.error;
  if (mats.error) throw mats.error;
  const e = ents.data as { competition_id: string; status: string }[];
  const m = mats.data as { competition_id: string; queue_state: string }[];
  return competitions.map(c => {
    const mine = m.filter(x => x.competition_id === c.id).map(x => ({ queueState: x.queue_state as 'final' }));
    return {
      id: c.id, name: c.name,
      active: e.filter(x => x.competition_id === c.id && !INACTIVE.has(x.status)).length,
      fights: mine.length, fightsDone: mine.filter(x => x.queueState === 'final').length,
      record: recordState(c, mine)
    };
  });
}

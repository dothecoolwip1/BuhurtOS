import type { MatchRecord, ScoreRound } from '../types';
import { enqueueMutation } from './offlineQueue';
import { validateScore } from './scoring';
import { supabase } from './supabase';

export async function submitMatchResult(match: MatchRecord, rounds: ScoreRound[], forfeit?: { side: 1 | 2; reason: string }): Promise<void> {
  const validation = validateScore(match.scoringConfig, rounds, forfeit);
  if (!validation.valid || !validation.result) throw new Error(validation.errors.join(' '));

  if (!navigator.onLine || !supabase) {
    await enqueueMutation({
      entity: 'match_result',
      entityId: match.id,
      operation: 'rpc',
      payload: { matchId: match.id, rounds, forfeit, expectedStatus: match.status },
      baseVersion: match.status
    });
    return;
  }

  const { error } = await supabase.rpc('submit_match_result', {
    p_match_id: match.id,
    p_rounds: rounds,
    p_forfeit_side: forfeit?.side ?? null,
    p_forfeit_reason: forfeit?.reason ?? null,
    p_expected_status: match.status
  });
  if (error) throw error;
}

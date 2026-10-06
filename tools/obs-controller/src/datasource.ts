import { fetchEvent } from '../../../src/data/api';
import type { LiveCompetition, LiveEvent } from '../../../src/data/api';
import { fetchCompetitionMatches, type CompetitionMatch } from '../../../src/data/matches';
import { fetchLiveScores, type LiveScore } from '../../../src/data/liveScores';
import { fetchLystPublic, type LystPublic } from '../../../src/data/lyst';
import { supabase } from '../../../src/lib/supabase';

/**
 * Everything the Companion reads from BuhurtOS, behind two small interfaces. The REAL implementation below reuses the app's own data modules (the SAME
 * functions the overlay uses, through the build's supabase shim); tests give the reader a fake.
 *   - public reads: matches, entries (names), live scores, lyst_public_state, the event and its competitions, and lyst_rounds (public for a public event)
 *   - the controller's two functions: controller_state() and broadcast_controller_heartbeat(p_status). Nothing else is ever called.
 */
export interface PublicDataSource {
  fetchEvent(slug: string): Promise<{ event: LiveEvent; competitions: LiveCompetition[] } | null>;
  fetchCompetition(competitionId: string): Promise<{ matches: CompetitionMatch[]; scores: LiveScore[] }>;
  fetchLyst(eventId: string): Promise<{ rows: LystPublic[]; sentAt: number; receivedAt: number }>;
  /** The time each match's FIRST round was created: when the fight first went live. Durable, from the database. */
  fetchFirstRounds(matchIds: string[]): Promise<Array<{ match_id: string; created_at: string }>>;
}

export interface ControllerState {
  event: { id: string; slug: string; name: string; timezone: string; status: string };
  control: { mode: 'auto' | 'manual'; target_kind: 'lyst' | 'holding' | 'break' | null; target_field: string | null; music_mode: 'auto' | 'muted' | 'paused'; auto_duck: boolean; priority_fields: string[]; rev: number; updated_at: string | null; updated_by_label: string | null };
  camera: { active: boolean; reason?: string | null; rev?: number | null; activated_at?: string | null; activated_by_label?: string | null };
  server_now: string;
}
export interface ControlSource {
  controllerState(): Promise<ControllerState>;
  heartbeat(status: Record<string, unknown>): Promise<void>;
}

export const realPublicData: PublicDataSource = {
  fetchEvent: slug => fetchEvent(slug),
  fetchCompetition: async id => { const [matches, scores] = await Promise.all([fetchCompetitionMatches(id), fetchLiveScores(id)]); return { matches, scores }; },
  fetchLyst: eventId => fetchLystPublic(eventId),
  async fetchFirstRounds(matchIds) {
    if (matchIds.length === 0) return [];
    const { data, error } = await supabase.from('lyst_rounds').select('match_id,created_at').in('match_id', matchIds).eq('round_no', 1);
    if (error) throw error;
    return (data ?? []) as Array<{ match_id: string; created_at: string }>;
  }
};

export const realControlSource: ControlSource = {
  async controllerState() {
    const { data, error } = await supabase.rpc('controller_state');
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as ControllerState;
  },
  async heartbeat(status) {
    const { error } = await supabase.rpc('broadcast_controller_heartbeat', { p_status: status });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
  }
};

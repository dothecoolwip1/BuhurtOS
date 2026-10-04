import { supabase } from '../lib/supabase';

export interface UnclaimedFighter { fighterId: string; name: string; team: string | null; city: string | null; region: string | null; entries: number; lastEvent: string | null }
export interface MyClaim { requestId: string; fighterId: string; fighterName: string; team: string | null; status: 'pending' | 'approved' | 'declined' | 'cancelled'; needsReview: boolean; note: string | null; createdAt: string; decidedAt: string | null }
export interface ClaimRow {
  requestId: string; createdAt: string; message: string | null; needsReview: boolean;
  claimant: { name: string | null; email: string | null; ownFighter: { id: string; name: string } | null };
  fighter: { id: string; name: string; team: string | null; city: string | null; region: string | null; claimed: boolean; entries: number; events: string[]; origin: string | null };
}
export type ClaimOutcome = 'approved' | 'declined' | 'already_claimed' | 'account_has_fighter';

type FoundDb = { fighter_id: string; display_name: string; team_name: string | null; city: string | null; region: string | null; entries: number | string; last_event: string | null };
/** Unclaimed fighters whose name, team or place matches. A match only helps someone find a candidate; it never links anything. */
export async function searchUnclaimedFighters(query: string): Promise<UnclaimedFighter[]> {
  const { data, error } = await supabase.rpc('search_unclaimed_fighters', { p_query: query });
  if (error) throw error;
  return ((data ?? []) as FoundDb[]).map(r => ({ fighterId: r.fighter_id, name: r.display_name, team: r.team_name, city: r.city, region: r.region, entries: Number(r.entries), lastEvent: r.last_event }));
}

/** Ask for ownership of an unclaimed fighter. Nothing is linked: a platform administrator decides. */
export async function requestFighterClaim(fighterId: string, message: string): Promise<{ requestId: string; needsReview: boolean }> {
  const { data, error } = await supabase.rpc('request_fighter_claim', { p_fighter: fighterId, p_message: message.trim() || null });
  if (error) throw error;
  const d = data as { request_id: string; needs_review: boolean };
  return { requestId: d.request_id, needsReview: d.needs_review === true };
}
export async function cancelFighterClaim(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_fighter_claim', { p_request: requestId });
  if (error) throw error;
}

type MineDb = { request_id: string; fighter_id: string; fighter_name: string; team_name: string | null; status: MyClaim['status']; needs_review: boolean; note: string | null; created_at: string; decided_at: string | null };
export async function fetchMyClaims(): Promise<MyClaim[]> {
  const { data, error } = await supabase.rpc('my_fighter_claims');
  if (error) throw error;
  return ((data ?? []) as MineDb[]).map(r => ({ requestId: r.request_id, fighterId: r.fighter_id, fighterName: r.fighter_name, team: r.team_name, status: r.status, needsReview: r.needs_review, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at }));
}

type RowDb = {
  request_id: string; created_at: string; message: string | null; needs_review: boolean;
  claimant: { name: string | null; email: string | null; own_fighter: { id: string; name: string } | null };
  fighter: { id: string; name: string; team: string | null; city: string | null; region: string | null; claimed: boolean; entries: number | string; events: string[] | null; origin: string | null };
};
/** Platform administrator only. */
export async function fetchFighterClaims(): Promise<ClaimRow[]> {
  const { data, error } = await supabase.rpc('list_fighter_claims');
  if (error) throw error;
  return ((data ?? []) as RowDb[]).map(r => ({
    requestId: r.request_id, createdAt: r.created_at, message: r.message, needsReview: r.needs_review,
    claimant: { name: r.claimant.name, email: r.claimant.email, ownFighter: r.claimant.own_fighter },
    fighter: { ...r.fighter, entries: Number(r.fighter.entries), events: r.fighter.events ?? [] }
  }));
}
export async function resolveFighterClaim(requestId: string, decision: 'approve' | 'decline', note: string): Promise<ClaimOutcome> {
  const { data, error } = await supabase.rpc('resolve_fighter_claim', { p_request: requestId, p_decision: decision, p_note: note });
  if (error) throw error;
  return data as ClaimOutcome;
}

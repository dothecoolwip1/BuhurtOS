import { supabase } from '../lib/supabase';

export interface IdentitySide { id: string; name: string; team: string | null; hasAccount: boolean; entries: number; synthetic: boolean; sources: string[] }
export interface IdentityReview { reviewId: string; source: 'registration' | 'team_join'; createdAt: string; newFighter: IdentitySide; candidate: IdentitySide }

type SideDb = { id: string; name: string; team: string | null; has_account: boolean; entries: number; synthetic: boolean; sources?: string[] };
const side = (s: SideDb): IdentitySide => ({ id: s.id, name: s.name, team: s.team, hasAccount: s.has_account, entries: Number(s.entries), synthetic: s.synthetic, sources: s.sources ?? [] });

/** Open look-alike fighters for the platform administrator. Nothing here merges anything. */
export async function fetchIdentityReviews(): Promise<IdentityReview[]> {
  const { data, error } = await supabase.rpc('list_fighter_identity_reviews');
  if (error) throw error;
  type R = { review_id: string; source: IdentityReview['source']; created_at: string; new_fighter: SideDb; candidate: SideDb };
  return ((data ?? []) as R[]).map(r => ({ reviewId: r.review_id, source: r.source, createdAt: r.created_at, newFighter: side(r.new_fighter), candidate: side(r.candidate) }));
}
export async function resolveIdentityReview(reviewId: string, decision: 'distinct' | 'duplicate', note: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_fighter_identity_review', { p_review: reviewId, p_decision: decision, p_note: note });
  if (error) throw error;
}

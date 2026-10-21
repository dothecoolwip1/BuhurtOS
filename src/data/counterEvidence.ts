/**
 * Counter evidence kept by the server for a person to review (20261023000500). Read and review only: nothing here changes a tally, an awarded score
 * or an official result. The database decides who sees what:
 *   - modern evidence (late or refused counts with a known run and fight): organizer / head marshal for the whole event, other scoring staff only for
 *     fights they may score (the secretary: the board only);
 *   - legacy evidence (saved by older phones with no run or fight): the event's organizer only. Its fight is UNKNOWN and is never attached.
 */
import { supabase } from '../lib/supabase';
import type { CountAction } from '../lib/lyst/counters';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const { data, error, status } = await supabase.rpc(fn, args).abortSignal(controller.signal);
    if (error) throw { ...error, status };
    return data as T;
  } finally { clearTimeout(timeout); }
}

/** Public labels of a fight. No account, contact or health data. */
export interface EvidenceFight {
  match_id: string; competition: string | null; round_label: string | null; field: string | null; a: string | null; b: string | null;
  queue_state: string; official: boolean; current: boolean;
}
interface EvidenceBase {
  id: string; seat_id: string; operator: string | null; side: 'a' | 'b' | null; role: 'official' | 'learning'; field_key: string;
  round: number | null; action: Record<string, unknown>; received_at: string;
  decision: 'noted' | 'dismissed' | null; review_reason: string | null; reviewed_at: string | null;
}
export interface ModernEvidence extends EvidenceBase { kind: 'modern'; run_id: string; generation: number; fight: EvidenceFight | null; reason: string }
export interface LegacyEvidence extends EvidenceBase {
  kind: 'legacy'; fight: null; fight_unknown: true;
  /** Where the seat was assigned when the upload arrived. A hint only: a seat can be carried between fights. */
  seat_fight_hint: EvidenceFight | null;
}
export type CounterEvidenceItem = ModernEvidence | LegacyEvidence;
export interface AcceptedCounterAction {
  id:string;kind:'accepted';seat_id:string;operator:string|null;side:'a'|'b'|null;role:'official'|'learning';field_key:string;
  run_id:string;round:number;generation:number;fight:EvidenceFight|null;count:{kind:'tap'|'undo';weight:number};
  server_operator:string|null;recorded_at:string;received_at:string|null;
  reported:Partial<Record<'operator'|'recordedAt'|'side'|'fighter'|'opponent',string>>&{invalid?:string[]};reported_unverified:true;
}
export interface EventCounterEvidence { modern: ModernEvidence[]; legacy: LegacyEvidence[]; accepted?:AcceptedCounterAction[];can_review_legacy: boolean; sees_all_fights: boolean; next_offset: number|null; server_now: string }

export const fetchEventCounterEvidence = (eventId: string, offset=0) => rpc<EventCounterEvidence>('event_counter_evidence', { p_event: eventId,p_offset:offset });

/** Reasoned review of legacy evidence (organizer only). All or nothing for the batch. */
export const reviewLegacyCounterEvidence = (ids: string[], decision: 'noted' | 'dismissed', reason: string) =>
  rpc<number>('review_legacy_counter_evidence', { p_ids: ids, p_decision: decision, p_reason: reason });
/** Modern evidence keeps its existing review (same function as the Lyst's delivery panel). */
export const reviewModernCounterEvidence = (ids: string[], decision: 'noted' | 'dismissed', reason: string) =>
  rpc<void>('review_counter_recovery_batch', { p_ids: ids, p_decision: decision, p_reason: reason });

export type LegacyUploadStatus = 'retained' | 'duplicate' | 'already_accepted' | 'already_retained';
/**
 * A counter phone sends ONE saved action that has no run id (an older queue). Only the seat's own holder, with a live session, may send it. The
 * server keeps it as review evidence with an unknown fight (or acknowledges an id it already counted); it is never added to a tally. On any error
 * the caller must keep its local copy.
 */
export const uploadLegacyCounterAction = (seatId: string, action: CountAction) =>
  rpc<{ status: LegacyUploadStatus; id: string }>('counter_upload_legacy_action', { p_seat: seatId, p_action: legacyPayload(action) });

/** Only the fields the server accepts, unchanged; a run id is never sent here (actions with one use the normal delivery). */
export function legacyPayload(a: CountAction): Record<string, unknown> {
  const out: Record<string, unknown> = { id: a.id, kind: a.kind, round: a.round };
  if (a.kind === 'tap') out.weight = a.weight;
  if (a.matchId !== undefined) out.matchId = a.matchId;
  if (a.recovery !== undefined) out.recovery = a.recovery;
  if (a.recordedAt !== undefined) out.recordedAt = a.recordedAt;
  if (a.undoWeight !== undefined) out.undoWeight = a.undoWeight;
  return out;
}

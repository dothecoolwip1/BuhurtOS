import { supabase } from './supabase';
import { COMMAND_SCHEMA, type OutboxEntry, type SendOutcome, type SendResult, type Sender } from './outbox';
import { confirmRoundArgs, disciplineArgs, type ConfirmRoundArgs, type DisciplineArgs } from '../data/lyst';

interface RpcErrorLike { message?: string; code?: string; status?: number }

/** Codes the database uses to refuse an event on purpose. Anything else is retried, so a score event is never dropped silently. */
const REJECT_CODES = new Set(['42501', 'P0001', 'P0002', 'PGRST202', 'PGRST204', 'PGRST116']);
const isReject = (code: string) => REJECT_CODES.has(code) || /^22/.test(code) || /^23/.test(code);

/**
 * Decide what a failed record_score_event call means for the outbox.
 * 'reject': the database refused it on purpose (no permission, match final or missing, bad data). Kept for review, never replayed blindly.
 * 'offline': nothing reached the server or the whole service is unavailable to us (no signal, connection failure, signed out, token expired).
 * 'retry': the server answered with trouble for this request (5xx, deadlock, lock timeout, a code we do not recognise). Only that match waits;
 * other matches carry on. Unknown failures are kept, never dropped; the outbox counts attempts so a stuck one is shown.
 * `status` is the HTTP status of the response (PostgrestError has none; supabase-js returns it beside the error).
 */
export function classifyRpcError(error: unknown, status?: number): SendResult {
  const e = (error ?? {}) as RpcErrorLike;
  const http = typeof status === 'number' ? status : e.status;
  if (typeof http === 'number' && http >= 500) return 'retry';
  const code = e.code ?? '';
  if (!code) return 'offline'; // fetch failed before the server answered
  if (GLOBAL_CODES.test(code) || code === 'PGRST301' || code === '28000') return 'offline';
  if (isReject(code)) return 'reject';
  return 'retry';
}
const GLOBAL_CODES = /^(08|PGRST00[0-2])/;

/** The outcome plus the server's words, so a refused entry can say why. */
export function senderOutcome(error: unknown, status?: number): SendOutcome {
  const result = classifyRpcError(error, status);
  return result === 'reject' ? { result, error: (error as RpcErrorLike | null)?.message ?? 'refused by the server' } : result;
}

export interface ScoreEventArgs { p_id: string; p_match: string; p_kind: string; p_payload: unknown; p_client_at: string }
export const scoreEventArgs = (e: Pick<OutboxEntry, 'id' | 'subject' | 'kind' | 'payload' | 'createdAt'>): ScoreEventArgs => ({
  p_id: e.id, p_match: e.subject, p_kind: e.kind, p_payload: e.payload ?? {}, p_client_at: new Date(e.createdAt).toISOString()
});

/**
 * Lyst Control rides the SAME outbox (no second offline system): the marshal's confirmed round, a recorded warning/card/deduction/DQ and a void are saved on
 * the device first, given the entry id as their command id, and sent in order per match. The timer is NOT here: it is server state and cannot be changed offline.
 */
export type LystPayload = Omit<ConfirmRoundArgs, 'command'> | Omit<DisciplineArgs, 'command'> | { id: string; reason: string };
export const LYST_KINDS = ['lyst.confirm_round', 'lyst.discipline', 'lyst.void'] as const;
export const isLystKind = (kind: string): boolean => (LYST_KINDS as readonly string[]).includes(kind);
export function lystCall(entry: Pick<OutboxEntry, 'id' | 'kind' | 'payload'>): { fn: string; args: Record<string, unknown> } | null {
  if (entry.kind === 'lyst.confirm_round') return { fn: 'lyst_confirm_round', args: confirmRoundArgs({ ...(entry.payload as Omit<ConfirmRoundArgs, 'command'>), command: entry.id }) };
  if (entry.kind === 'lyst.discipline') return { fn: 'lyst_record_discipline', args: disciplineArgs({ ...(entry.payload as Omit<DisciplineArgs, 'command'>), command: entry.id }) };
  if (entry.kind === 'lyst.void') { const p = entry.payload as { id: string; reason: string }; return { fn: 'lyst_void_discipline', args: { p_command: entry.id, p_id: p.id, p_reason: p.reason } }; }
  return null;
}
/** The server answered 'stale' to a confirm: the round changed on another device after this was written. It is kept (rejected) for a person to look at, never replayed blindly. */
export const lystAnswerOutcome = (data: unknown): SendOutcome =>
  (data as { status?: string } | null)?.status === 'stale'
    ? { result: 'reject', error: 'That round was changed on another device before this arrived. Look at the round and enter it again.' }
    : 'ok';

/**
 * The real sender. The entry id is the idempotency key, so sending it twice is harmless (the database ignores the repeat).
 * It only sends while the entry's own account is signed in: another account on the same device never delivers it.
 */
export const realSender: Sender = async entry => {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.id !== entry.userId) return 'offline';
  // Saved by a NEWER build than this one (for example after an emergency rollback): keep it, say why, never guess at its meaning.
  if (entry.schema > COMMAND_SCHEMA) return { result: 'reject', error: 'saved by a newer version of BuhurtOS than this one; reload the page to update, then it can be sent' };
  const lyst = lystCall(entry);
  if (lyst) {
    const { data: answer, error, status } = await supabase.rpc(lyst.fn, lyst.args);
    return error ? senderOutcome(error, status) : lystAnswerOutcome(answer);
  }
  if (entry.kind.startsWith('lyst.')) return { result: 'reject', error: 'this lyst action is not known to this version of BuhurtOS; reload the page to update' };
  const { error, status } = await supabase.rpc('record_score_event', scoreEventArgs(entry));
  return error ? senderOutcome(error, status) : 'ok';
};

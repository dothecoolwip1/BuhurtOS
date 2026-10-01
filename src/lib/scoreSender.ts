import { supabase } from './supabase';
import type { OutboxEntry, SendResult, Sender } from './outbox';

interface RpcErrorLike { message?: string; code?: string; status?: number }

/** Codes the database uses to refuse an event on purpose. Anything else is retried, so a score event is never dropped silently. */
const REJECT_CODES = new Set(['42501', 'P0001', 'P0002', 'PGRST202', 'PGRST204', 'PGRST116']);
const isReject = (code: string) => REJECT_CODES.has(code) || /^22/.test(code) || /^23/.test(code);

/**
 * Decide what a failed record_score_event call means for the outbox.
 * 'reject': the database refused it on purpose (no permission, match final or missing, bad data). Drop and report it.
 * 'retry': everything else (no signal, server busy, deadlock or serialization failure, lock timeout, signed out, token expired,
 * and any code we do not recognise). Unknown failures are kept, never dropped; the outbox counts attempts so a stuck one is shown.
 * `status` is the HTTP status of the response (PostgrestError has none; supabase-js returns it beside the error).
 */
export function classifyRpcError(error: unknown, status?: number): SendResult {
  const e = (error ?? {}) as RpcErrorLike;
  const http = typeof status === 'number' ? status : e.status;
  if (typeof http === 'number' && http >= 500) return 'retry';
  const code = e.code ?? '';
  if (!code) return 'retry'; // fetch failed before the server answered
  return isReject(code) ? 'reject' : 'retry';
}

export interface ScoreEventArgs { p_id: string; p_match: string; p_kind: string; p_payload: unknown; p_client_at: string }
export const scoreEventArgs = (e: OutboxEntry): ScoreEventArgs => ({
  p_id: e.id, p_match: e.subject, p_kind: e.kind, p_payload: e.payload ?? {}, p_client_at: new Date(e.createdAt).toISOString()
});

/** The real sender. The entry id is the idempotency key, so sending it twice is harmless (the database ignores the repeat). */
export const realSender: Sender = async entry => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return 'retry';
  const { error, status } = await supabase.rpc('record_score_event', scoreEventArgs(entry));
  return error ? classifyRpcError(error, status) : 'ok';
};

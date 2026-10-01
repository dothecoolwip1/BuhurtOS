import { supabase } from './supabase';
import type { OutboxEntry, SendResult, Sender } from './outbox';

interface RpcErrorLike { message?: string; code?: string; status?: number }

/**
 * Decide what a failed record_score_event call means for the outbox.
 * 'retry': nothing reached the database for good (no signal, server busy, signed out, token expired). Keep the entry.
 * 'reject': the database refused it on purpose (no permission, match final or missing, bad data). Drop and report it.
 */
export function classifyRpcError(error: unknown): SendResult {
  const e = (error ?? {}) as RpcErrorLike;
  if (typeof e.status === 'number' && e.status >= 500) return 'retry';
  const code = e.code ?? '';
  if (!code) return 'retry'; // fetch failed before the server answered
  if (code === '28000') return 'retry'; // signed out or session expired: keep the events until they sign in again
  if (/^PGRST30[1-3]$/.test(code)) return 'retry'; // JWT expired or invalid
  if (code.startsWith('PGRST')) return 'reject';
  if (/^(08|53|57|58|XX)/.test(code)) return 'retry'; // connection, resources, shutdown, internal
  return 'reject';
}

export interface ScoreEventArgs { p_id: string; p_match: string; p_kind: string; p_payload: unknown; p_client_at: string }
export const scoreEventArgs = (e: OutboxEntry): ScoreEventArgs => ({
  p_id: e.id, p_match: e.subject, p_kind: e.kind, p_payload: e.payload ?? {}, p_client_at: new Date(e.createdAt).toISOString()
});

/** The real sender. The entry id is the idempotency key, so sending it twice is harmless (the database ignores the repeat). */
export const realSender: Sender = async entry => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return 'retry';
  const { error } = await supabase.rpc('record_score_event', scoreEventArgs(entry));
  return error ? classifyRpcError(error) : 'ok';
};

/**
 * Lyst Control, as the app calls it. Every write is a controlled database function (public.lyst_* / counter_*): nothing here writes a table.
 * The marshal's call is the only official score; counter functions only ever touch the counter's own provisional tally.
 */
import { supabase } from '../lib/supabase';
import type { LystTimer, TimerAction, TimerMode } from '../lib/lyst/timer';
import type { LystDiscipline, LystRound, LystSettings } from '../lib/lyst/rounds';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface LystSeat { id: string; name: string; slot: string | null; side: 'a' | 'b' | null; role: 'official' | 'learning'; status: string; tallies: { round_no: number; total: number; submitted: boolean }[] }
export interface LystRequest { id: string; name: string; requested_at: string }
export interface LystRevision { round_no: number; kind: 'confirm' | 'correct'; previous_a: number | null; previous_b: number | null; awarded_a: number; awarded_b: number; recommended_a: number | null; recommended_b: number | null; reason: string | null; changed_at: string }
export interface LystState {
  server_now: string;
  match: { id: string; field_key: string; queue_state: string; version: number; stage: string };
  lyst: { counter_input: 'simple' | 'weighted' } | null;
  settings: LystSettings;
  timer: (LystTimer & { now_remaining_ms: number }) | null;
  rounds: LystRound[];
  revisions: LystRevision[];
  discipline: LystDiscipline[];
  seats: LystSeat[];
  requests: LystRequest[];
  join_code: { code: string; expires_at: string } | null;
}

/** One read of everything the tablet shows, with the device times around it (the clock offset is measured from them). */
export async function fetchLystState(matchId: string): Promise<{ state: LystState; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const state = await rpc<LystState>('lyst_state', { p_match: matchId });
  return { state, sentAt, receivedAt: Date.now() };
}

export const openLyst = (matchId: string, counterInput: 'simple' | 'weighted' = 'simple') => rpc<{ status: string; counter_input: 'simple' | 'weighted' }>('lyst_open', { p_match: matchId, p_counter_input: counterInput });

export interface TimerCommand {
  eventId: string; field: string; matchId: string; expectedRev: number; command: string; action: TimerAction;
  mode?: TimerMode | null; durationMs?: number | null; round?: number | null; deltaMs?: number;
}
export interface TimerAnswer { status: 'ok' | 'duplicate' | 'stale'; timer: (LystTimer & { now_remaining_ms: number }) | null; server_now: string }
export async function timerCommand(c: TimerCommand): Promise<{ answer: TimerAnswer; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const answer = await rpc<TimerAnswer>('lyst_timer_command', {
    p_event: c.eventId, p_field: c.field, p_match: c.matchId, p_expected_rev: c.expectedRev, p_command: c.command, p_action: c.action,
    p_mode: c.mode ?? null, p_duration_ms: c.durationMs ?? null, p_round: c.round ?? null, p_delta_ms: c.deltaMs ?? 0
  });
  return { answer, sentAt, receivedAt: Date.now() };
}

export interface ConfirmRoundArgs { command: string; matchId: string; round: number; a: number; b: number; expectedRev: number; recommendedA?: number | null; recommendedB?: number | null; reason?: string | null }
export const confirmRoundArgs = (c: ConfirmRoundArgs) => ({
  p_command: c.command, p_match: c.matchId, p_round: c.round, p_awarded_a: c.a, p_awarded_b: c.b, p_expected_rev: c.expectedRev,
  p_recommended_a: c.recommendedA ?? null, p_recommended_b: c.recommendedB ?? null, p_reason: c.reason ?? null
});
export const confirmRound = (c: ConfirmRoundArgs) => rpc<{ status: 'ok' | 'duplicate' | 'stale'; kind?: string }>('lyst_confirm_round', confirmRoundArgs(c));

export interface DisciplineArgs { command: string; matchId: string; round: number; side: 'a' | 'b'; kind: 'warning' | 'card' | 'deduction' | 'dq'; label?: string | null; amount?: number; reason?: string | null; calledBy?: string | null; related?: string | null }
export const disciplineArgs = (d: DisciplineArgs) => ({
  p_command: d.command, p_match: d.matchId, p_round: d.round, p_side: d.side, p_kind: d.kind, p_label: d.label ?? null, p_amount: d.amount ?? 0, p_reason: d.reason ?? null, p_called_by: d.calledBy ?? null, p_related: d.related ?? null
});
/** Pack 22: the rule a marshal's call was for (null removes it). Rides the same outbox; the entry id is the command id. */
export interface CiteRuleArgs { command: string; disciplineId: string; provisionId: string | null }
export const citeRuleArgs = (c: CiteRuleArgs) => ({ p_command: c.command, p_discipline: c.disciplineId, p_provision: c.provisionId });
export const recordDiscipline = (d: DisciplineArgs) => rpc<{ status: 'ok' | 'duplicate' }>('lyst_record_discipline', disciplineArgs(d));
export const voidDiscipline = (command: string, id: string, reason: string) => rpc<{ status: 'ok' | 'duplicate' }>('lyst_void_discipline', { p_command: command, p_id: id, p_reason: reason });

export const createJoinCode = (eventId: string, field: string) => rpc<{ code: string; expires_at: string; field_key: string }>('create_lyst_join_code', { p_event: eventId, p_field: field });
export const assignSeat = (seat: string, match: string, side: 'a' | 'b', role: 'official' | 'learning' = 'official', slot?: string | null) =>
  rpc<{ status: string; slot: string }>('assign_counter_seat', { p_seat: seat, p_match: match, p_side: side, p_role: role, p_slot: slot ?? null });
export const endSeat = (seat: string, decline = false) => rpc<{ status: string }>('end_counter_seat', { p_seat: seat, p_decline: decline });
export const carrySeats = (from: string, to: string) => rpc<{ status: string; moved: number }>('carry_counter_seats', { p_from: from, p_to: to });
export const finalizeFromLyst = (a: { command: string; matchId: string; expectedVersion: number; result: 'a' | 'b' | 'draw'; basis: 'score' | 'dq' | 'technical'; reason?: string | null }) =>
  rpc<{ status: 'accepted' | 'duplicate' | 'conflict' | 'stale'; version: number; repeat?: boolean }>('lyst_finalize', { p_command: a.command, p_match: a.matchId, p_expected_version: a.expectedVersion, p_result: a.result, p_basis: a.basis, p_reason: a.reason ?? null });
export const saveLystSettings = (eventId: string, settings: Partial<LystSettings>) => rpc<LystSettings>('set_lyst_settings', { p_event: eventId, p_settings: settings });

/* ---------------- the counter's phone ---------------- */
export interface CounterState {
  seat: { id: string; status: 'pending' | 'active' | 'expired' | 'ended' | 'declined'; slot?: string; side?: 'a' | 'b'; role?: 'official' | 'learning'; field_key: string } | null;
  event_slug?: string; competition?: string; round_label?: string; match_id?: string; final?: boolean; fighter?: string; counter_input?: 'simple' | 'weighted';
  round?: { no: number; status: 'running' | 'confirming' | 'confirmed' } | null; my_total?: number; submitted?: boolean; can_count?: boolean;
  timer?: (LystTimer & { now_remaining_ms: number }) | null; server_now: string;
}
export const requestSeat = (code: string) => rpc<{ status: string; message?: string; seat_id?: string; event_slug?: string; field_key?: string }>('request_counter_seat', { p_code: code });
export async function fetchCounterState(): Promise<{ state: CounterState; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const state = await rpc<CounterState>('counter_state', {});
  return { state, sentAt, receivedAt: Date.now() };
}
export const counterRecord = (id: string, seat: string, round: number, weight: number) => rpc<{ status: 'ok' | 'duplicate'; total: number }>('counter_record', { p_id: id, p_seat: seat, p_round: round, p_weight: weight });
export const counterUndo = (id: string, seat: string, round: number) => rpc<{ status: 'ok' | 'duplicate' | 'nothing'; total: number }>('counter_undo', { p_id: id, p_seat: seat, p_round: round });
export const counterSubmit = (seat: string, round: number) => rpc<{ status: string; total: number }>('counter_submit', { p_seat: seat, p_round: round });
export const leaveSeat = (seat: string) => endSeat(seat, false);

/* ---------------- public (Arena, Pack 14) ---------------- */
export interface LystPublic {
  match_id: string; event_id: string; field_key: string; queue_state: string;
  timer_mode: TimerMode | null; timer_status: 'idle' | 'running' | 'paused' | null; timer_duration_ms: number | null; timer_remaining_ms: number | null; timer_started_at: string | null; timer_rev: number | null; timer_round: number | null;
  round_no: number | null; round_status: 'running' | 'confirming' | 'confirmed' | null; official_a: number; official_b: number; rounds_confirmed: number;
  discipline: { round: number; side: 'a' | 'b'; kind: 'warning' | 'card' | 'deduction' | 'dq'; label: string | null; amount: number }[]; server_now: string;
}
export async function fetchLystPublic(eventId: string): Promise<{ rows: LystPublic[]; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const { data, error } = await supabase.from('lyst_public_state').select('*').eq('event_id', eventId);
  if (error) throw error;
  return { rows: (data ?? []) as LystPublic[], sentAt, receivedAt: Date.now() };
}

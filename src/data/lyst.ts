/**
 * Lyst Control, as the app calls it. Every write is a controlled database function (public.lyst_* / counter_*): nothing here writes a table.
 * The marshal's call is the only official score; counter functions only ever touch the counter's own provisional tally.
 */
import type { CountAction, EventSides, SideSpec } from '../lib/lyst/counters';
import { supabase } from '../lib/supabase';
import type { LystTimer, TimerAction, TimerMode } from '../lib/lyst/timer';
import type { LystDiscipline, LystRound, LystSettings } from '../lib/lyst/rounds';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const { data, error, status } = await supabase.rpc(fn, args).abortSignal(controller.signal);
    if (error) throw { ...error, status };
    return data as T;
  } finally { clearTimeout(timeout); }
}

/** One counter on this fight, as evidence: who (the operator's name), which side, official or learning, on a phone (and whether it is online) or a trainee's own account. */
export interface LystSeat {
  id: string; name: string; slot: string | null; side: 'a' | 'b' | null; role: 'official' | 'learning'; status: string;
  /** Pack 25: a counter phone (an event session) rather than a person's account; `online` is null for an account. */
  device?: boolean; online?: boolean | null;
  tallies: { round_no: number; total: number; submitted: boolean }[];
}
/** Pack 25: a phone bound to this field (whether or not it has a seat on the fight yet). */
export interface FieldCounter { session_id: string; operator: string | null; side: 'a' | 'b' | null; online: boolean }
export interface LystRevision { round_no: number; kind: 'confirm' | 'correct'; previous_a: number | null; previous_b: number | null; awarded_a: number; awarded_b: number; recommended_a: number | null; recommended_b: number | null; reason: string | null; changed_at: string }
export interface LystState {
  server_now: string;
  match: { id: string; field_key: string; queue_state: string; version: number; stage: string };
  lyst: { counter_input: CounterInput } | null;
  /** Pack 25: the match this field is running right now (counters follow it), and fighters per side (team fights). */
  field_current?: string | null; per_side?: number;
  settings: LystSettings;
  timer: (LystTimer & { now_remaining_ms: number }) | null;
  rounds: LystRound[];
  revisions: LystRevision[];
  discipline: LystDiscipline[];
  seats: LystSeat[];
  field_counters?: FieldCounter[];
  counter_delivery?: CounterDelivery[];
  counter_recovery?: CounterRecovery[];
  /** The TRAINING code of this field (Pack 25): a signed-in trainee scans it and counts as a learning counter at once. */
  join_code: { code: string; expires_at: string } | null;
}
export interface CounterDelivery {
  seat_id: string; operator: string; side: 'a' | 'b' | null; role: 'official' | 'learning';
  run_id: string | null; round: number | null; run_status: string | null;
  closed_at?:string|null;
  prepared_at: string | null; started_at: string | null; seen_at: string | null; pending: number | null; submitted: boolean;
}
export interface CounterRecovery {
  id: string; seat_id: string; operator: string; side: 'a' | 'b' | null; role: 'official' | 'learning';
  run_id: string; round: number; generation: number; action: CountAction; reason: string; received_at: string;
  decision: 'noted' | 'dismissed' | null; review_reason: string | null;
}
export interface PreparedCounterRun { id: string; match_id: string; no: number; generation: number; status: 'prepared' | 'running' | 'closed'; started_at: string | null }
export type CounterInput = 'simple' | 'weighted' | 'standing';

/** One read of everything the tablet shows, with the device times around it (the clock offset is measured from them). */
export async function fetchLystState(matchId: string): Promise<{ state: LystState; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const state = await rpc<LystState>('lyst_state', { p_match: matchId });
  return { state, sentAt, receivedAt: Date.now() };
}

export const openLyst = (matchId: string, counterInput: CounterInput = 'simple') => rpc<{ status: string; counter_input: CounterInput }>('lyst_open', { p_match: matchId, p_counter_input: counterInput });

export interface TimerCommand {
  eventId: string; field: string; matchId: string; expectedRev: number; command: string; action: TimerAction;
  mode?: TimerMode | null; durationMs?: number | null; round?: number | null; deltaMs?: number;
  overrideReason?: string | null; requestedAt?: string;
}
export interface TimerAnswer { status: 'ok' | 'duplicate' | 'stale' | 'expired'; timer: (LystTimer & { now_remaining_ms: number }) | null; server_now: string }
export async function timerCommand(c: TimerCommand): Promise<{ answer: TimerAnswer; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const answer = await rpc<TimerAnswer>('lyst_timer_command_reliable', {
    p_event: c.eventId, p_field: c.field, p_match: c.matchId, p_expected_rev: c.expectedRev, p_command: c.command, p_action: c.action,
    p_mode: c.mode ?? null, p_duration_ms: c.durationMs ?? null, p_round: c.round ?? null, p_delta_ms: c.deltaMs ?? 0,
    p_override_reason: c.overrideReason ?? null, p_requested_at: c.requestedAt ?? null
  });
  return { answer, sentAt, receivedAt: Date.now() };
}

export interface ConfirmRoundArgs { command: string; matchId: string; round: number; a: number; b: number; expectedRev: number; recommendedA?: number | null; recommendedB?: number | null; reason?: string | null }
export const confirmRoundArgs = (c: ConfirmRoundArgs) => ({
  p_command: c.command, p_match: c.matchId, p_round: c.round, p_awarded_a: c.a, p_awarded_b: c.b, p_expected_rev: c.expectedRev,
  p_recommended_a: c.recommendedA ?? null, p_recommended_b: c.recommendedB ?? null, p_reason: c.reason ?? null
});
export const confirmRound = (c: ConfirmRoundArgs) => rpc<{ status: 'ok' | 'duplicate' | 'stale'; kind?: string }>('lyst_confirm_round', confirmRoundArgs(c));

/** The latest round goes back to the counters: it runs again, their taps stay, their "done" marks reset. A confirmed round needs a reason. */
export interface ReturnRoundArgs { command: string; matchId: string; round: number; expectedRev: number; reason?: string | null }
export const returnRoundArgs = (c: ReturnRoundArgs) => ({ p_command: c.command, p_match: c.matchId, p_round: c.round, p_expected_rev: c.expectedRev, p_reason: c.reason ?? null });
export const returnRound = (c: ReturnRoundArgs) =>
  rpc<{ status: 'ok' | 'duplicate' | 'stale' | 'unchanged'; round?: LystRound; submissions_reset?: number }>('lyst_return_round', returnRoundArgs(c));

/** One fight on the secretary's board: names only. */
export interface BoardFight { match_id: string; a: string | null; b: string | null; competition: string | null; round_label: string | null; stage: string; queue_state: string; version: number; field_key: string; lyst_open: boolean }
export interface SecretaryBoard {
  event_id: string;
  fields: { key: string; label: string; now: BoardFight | null; on_deck: BoardFight | null; in_the_hole: BoardFight | null }[];
  /** What the viewer may do; the server checks every call regardless. */
  viewer: { secretary_only: boolean; organizer: boolean; operator: boolean; command: boolean; adjust_queue: boolean; announce: boolean; resolve_results: boolean; camera_off: boolean };
  server_now: string;
}
export const fetchSecretaryBoard = (eventId: string, field: string | null = null) => rpc<SecretaryBoard>('secretary_board', { p_event: eventId, p_field: field });

export interface DisciplineArgs { command: string; matchId: string; round: number; side: 'a' | 'b'; kind: 'warning' | 'card' | 'deduction' | 'dq'; label?: string | null; amount?: number; reason?: string | null; calledBy?: string | null; related?: string | null }
export const disciplineArgs = (d: DisciplineArgs) => ({
  p_command: d.command, p_match: d.matchId, p_round: d.round, p_side: d.side, p_kind: d.kind, p_label: d.label ?? null, p_amount: d.amount ?? 0, p_reason: d.reason ?? null, p_called_by: d.calledBy ?? null, p_related: d.related ?? null
});
/** Pack 22: the rule a marshal's call was for (null removes it). Rides the same outbox; the entry id is the command id. */
export interface CiteRuleArgs { command: string; disciplineId: string; provisionId: string | null }
export const citeRuleArgs = (c: CiteRuleArgs) => ({ p_command: c.command, p_discipline: c.disciplineId, p_provision: c.provisionId });
export const recordDiscipline = (d: DisciplineArgs) => rpc<{ status: 'ok' | 'duplicate' }>('lyst_record_discipline', disciplineArgs(d));
export const voidDiscipline = (command: string, id: string, reason: string) => rpc<{ status: 'ok' | 'duplicate' }>('lyst_void_discipline', { p_command: command, p_id: id, p_reason: reason });

/** The field's TRAINING code (Pack 25): lasts the day; a trainee scans it and practises as a learning counter. It grants nothing official. */
export const createJoinCode = (eventId: string, field: string) => rpc<{ code: string; expires_at: string; field_key: string }>('create_lyst_join_code', { p_event: eventId, p_field: field });
export const endSeat = (seat: string, decline = false) => rpc<{ status: string }>('end_counter_seat', { p_seat: seat, p_decline: decline });
export const finalizeFromLyst = (a: { command: string; matchId: string; expectedVersion: number; result: 'a' | 'b' | 'draw'; basis: 'score' | 'dq' | 'technical'; reason?: string | null }) =>
  rpc<{ status: 'accepted' | 'duplicate' | 'conflict' | 'stale'; version: number; repeat?: boolean }>('lyst_finalize', { p_command: a.command, p_match: a.matchId, p_expected_version: a.expectedVersion, p_result: a.result, p_basis: a.basis, p_reason: a.reason ?? null });
export const saveLystSettings = (eventId: string, settings: Partial<LystSettings>) => rpc<LystSettings>('set_lyst_settings', { p_event: eventId, p_settings: settings });

/* ---------------- the counter's phone (Pack 25) ---------------- */
/**
 * What a counter phone (an event session from the Counter QR) or a trainee (their own account, from the training QR) shows. The phone is bound to a
 * field and a side; the fight it counts is whatever the Lyst has open on that field. Only the caller's own seat and tally come back: never another counter,
 * never an official score, never an account id.
 */
export interface CounterField { key: string; label: string; open: boolean; /** who is fighting there right now (names), or null */ now?: { a: string | null; b: string | null } | null }
/** One fight on the phone's field, names only: what the public Live view shows anyway. */
export interface CounterFight { match_id: string; a: string | null; b: string | null; competition: string | null; round_label: string | null; result?: string | null; score_a?: number | null; score_b?: number | null; state?: string | null }
export interface CounterState {
  kind: 'device' | 'training';
  training?:boolean;
  officials?:{name:string;total:number}[]|null;
  session_id?: string | null; device_label?: string | null;
  event?: { id: string; slug: string; name: string; closed: boolean };
  fields?: CounterField[];
  binding?: { field_key: string | null; side: 'a' | 'b' | null; operator: string | null };
  field_label?: string | null;
  seat: { id: string; status: 'pending' | 'active' | 'expired' | 'ended' | 'declined'; side: 'a' | 'b' | null; role: 'official' | 'learning'; field_key: string; operator: string; match_id: string | null } | null;
  /** The seat is not on the field's current fight (or no fight is open): the phone follows by itself when the Lyst opens the next one. */
  waiting?: boolean;
  match_id?: string | null; competition?: string | null; round_label?: string | null; final?: boolean; fighter?: string | null; opponent?: string | null;
  counter_input?: CounterInput; per_side?: number | null; standing?: number | null;
  round?: { no: number; status: 'running' | 'confirming' | 'confirmed' } | null; my_total?: number; submitted?: boolean; can_count?: boolean;
  timer?: (LystTimer & { now_remaining_ms: number }) | null;
  /** The field's last finished fight, the one on now and the next in its running order (null each when there is none). */
  fights?: { last: CounterFight | null; now: CounterFight | null; next: CounterFight | null } | null;
  /** Pack 25.2: the event's names and colours for the two sides. */
  sides?: EventSides | null;
  server_now: string;
  prepared_run?: PreparedCounterRun | null;
  my_weights?: number[];
}
export const acknowledgeCounterRun = (seat: string, run: string, started: boolean, pending: number) => rpc<void>('counter_acknowledge_run', { p_seat: seat, p_run: run, p_started: started, p_pending: pending });
export const deliverCounterAction = (seat: string, action: CountAction) => rpc<{ status: 'ok' | 'duplicate' | 'nothing' | 'review'; total: number; weights?: number[]; reason?: string }>('counter_deliver_action', { p_seat: seat, p_run: action.runId, p_action: action });
export const reviewCounterRecovery = (ids: string[], decision: 'noted' | 'dismissed', reason: string) => rpc<void>('review_counter_recovery_batch', { p_ids: ids, p_decision: decision, p_reason: reason });
/** Pack 25.2: anyone who runs the Lyst (or the platform owner) sets the sides' names and colours for the event; either side may be sent alone. */
export const setEventSides = (eventId: string, sides: { a?: SideSpec; b?: SideSpec }) => rpc<EventSides>('set_event_sides', { p_event: eventId, p_sides: sides });
export async function fetchCounterState(): Promise<{ state: CounterState; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const state = await rpc<CounterState>('counter_state', {});
  return { state, sentAt, receivedAt: Date.now() };
}
/** Which Lyst, which side, who is counting. Any time, no approval; the tally of the fight carries on through an operator change on the same field and side. */
export const counterBind = (field: string, side: 'a' | 'b' | null, operator: string | null) => rpc<CounterState>('counter_bind', { p_field: field, p_side: side, p_operator: operator });
/** A new person takes the phone (or a trainee renames their seat). Logged; never a permission. */
export const counterSetOperator = (name: string) => rpc<CounterState>('counter_set_operator', { p_name: name });
/** The phone stops counting here (its binding and seat end; the evidence stays). */
export const counterLeave = () => rpc<CounterState>('counter_leave', {});
/** A trainee joins with the field's training code, their name and a side: seated at once as a LEARNING counter. */
export const joinTrainingCounter = (code: string, name: string, side: 'a' | 'b') =>
  rpc<{ status: string; message?: string; event_slug?: string; field_key?: string; state?: CounterState }>('join_training_counter', { p_code: code, p_name: name, p_side: side });
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

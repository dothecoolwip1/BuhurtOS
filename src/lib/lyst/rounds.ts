/**
 * Official lyst scoring, as the tablet shows it. THE MARSHAL'S CALL IS THE ONLY OFFICIAL SCORE: the numbers here come from the server's
 * lyst_round_scores (awarded by the marshal, minus recorded deductions). Nothing in this file reads, averages, maxes or votes counters.
 */
import type { TimerPreset } from './timer';

export type RoundStatus = 'running' | 'confirming' | 'confirmed';

export interface LystRound {
  match_id: string; round_no: number; status: RoundStatus; rev: number;
  awarded_a: number | null; awarded_b: number | null; deduct_a: number; deduct_b: number; official_a: number | null; official_b: number | null;
}

export const MAX_ROUND_SCORE = 99;
export const clampScore = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_ROUND_SCORE, Math.max(0, Math.trunc(n))) : 0);
/** One tap of a stepper. Never goes below zero or above the limit the database allows. */
export const bump = (value: number, delta: number): number => clampScore(value + delta);

export const confirmedRounds = (rounds: readonly LystRound[]): LystRound[] => rounds.filter(r => r.status === 'confirmed');
export const roundNumber = (rounds: readonly LystRound[]): number => rounds.reduce((m, r) => Math.max(m, r.round_no), 0);
export const currentRound = (rounds: readonly LystRound[]): LystRound | null => rounds.length ? rounds.reduce((a, b) => (b.round_no > a.round_no ? b : a)) : null;

/** Official totals: confirmed rounds only (the server already took recorded deductions off each round). */
export function officialTotals(rounds: readonly LystRound[]): { a: number; b: number; rounds: number } {
  const c = confirmedRounds(rounds);
  return { a: c.reduce((s, r) => s + (r.official_a ?? 0), 0), b: c.reduce((s, r) => s + (r.official_b ?? 0), 0), rounds: c.length };
}

/** Every started round has been confirmed by the marshal, and there is at least one. Only then can the match be finished. */
export const allRoundsConfirmed = (rounds: readonly LystRound[]): boolean => rounds.length > 0 && rounds.every(r => r.status === 'confirmed');

/** What the totals support. A SUGGESTION for the person finishing the match: they still choose, and the server re-checks it. */
export function resultSupportedByTotals(rounds: readonly LystRound[]): 'a' | 'b' | 'draw' | null {
  if (!allRoundsConfirmed(rounds)) return null;
  const t = officialTotals(rounds);
  return t.a > t.b ? 'a' : t.b > t.a ? 'b' : 'draw';
}

export type FinishBasis = 'score' | 'dq' | 'technical';

/** The words for the round state, in the sport's language. */
export const ROUND_STATUS_WORD: Record<RoundStatus, string> = { running: 'Being fought', confirming: 'Scores being confirmed', confirmed: 'Confirmed' };

/** What a stepper pair starts at: the awarded score if the round was confirmed (a correction), otherwise nothing is guessed: 0 and 0. */
export const entryStart = (r: LystRound | null): { a: number; b: number } => (r && r.status === 'confirmed' ? { a: r.awarded_a ?? 0, b: r.awarded_b ?? 0 } : { a: 0, b: 0 });

/** Has the marshal's entry changed from what is recorded? A confirmed round only needs a reason if it is being changed. */
export const isChange = (r: LystRound | null, a: number, b: number): boolean => Boolean(r && r.status === 'confirmed' && (r.awarded_a !== a || r.awarded_b !== b));

/* ---------------- discipline ---------------- */
/** Pack 29 adds the Outrance protocol kinds: an armour repair granted (90 s), a stoppage (KO, TKO, ...) and a note (a corner man expelled). */
/** 'reprimand' (Duels Regulations 4.2): its amount is points added to the OPPONENT (3, or 1 in sword and buckler), set by the server. */
export type DisciplineKind = 'warning' | 'card' | 'deduction' | 'dq' | 'armour' | 'stoppage' | 'note' | 'reprimand';
export interface LystDiscipline {
  id: string; round_no: number; side: 'a' | 'b'; kind: DisciplineKind; label: string | null; amount: number; voided_at: string | null;
  /** Pack 29: an Outrance call's key (yellow, red, ko, tko, tko_round, tko_equipment, ...). */
  key?: string | null;
  reason?: string | null; called_by?: string | null; void_reason?: string | null; created_at?: string;
}
export const KIND_WORD: Record<DisciplineKind, string> = { warning: 'Warning', card: 'Card', deduction: 'Point deduction', dq: 'Disqualification', armour: 'Armour repair', stoppage: 'Stoppage', note: 'Note', reprimand: 'Reprimand' };

/** One line for a record, e.g. "Yellow card · Round 2 · Alex". */
export function describeDiscipline(d: Pick<LystDiscipline, 'kind' | 'label' | 'amount' | 'round_no' | 'side'>, names: { a: string; b: string }): string {
  const what = d.kind === 'reprimand' ? `Reprimand (+${d.amount} to the opponent)` : d.kind === 'deduction' ? `−${d.amount} point${d.amount === 1 ? '' : 's'}` : d.kind === 'card' ? (d.label ?? 'Card') : (d.kind === 'armour' || d.kind === 'stoppage' || d.kind === 'note' || d.kind === 'dq') && d.label ? d.label : KIND_WORD[d.kind];
  return `${what} · Round ${d.round_no} · ${d.side === 'a' ? names.a : names.b}`;
}
export const activeDiscipline = (list: readonly LystDiscipline[]): LystDiscipline[] => list.filter(d => !d.voided_at);
export const hasDq = (list: readonly LystDiscipline[], side: 'a' | 'b'): boolean => activeDiscipline(list).some(d => d.kind === 'dq' && d.side === side);

/** Compact per-side tallies for the scoreboard strip. */
export function disciplineCounts(list: readonly LystDiscipline[], side: 'a' | 'b'): { warnings: number; cards: number; deducted: number; dq: boolean; reprimands: number } {
  const mine = activeDiscipline(list).filter(d => d.side === side);
  // a reprimand is not a card (Duels Regulations 4.2-4.5): counted apart, and a card labelled "Reprimand" from an older preset counts as one
  const isReprimand = (d: LystDiscipline) => d.kind === 'reprimand' || (d.kind === 'card' && /^reprimand$/i.test(d.label ?? ''));
  return { warnings: mine.filter(d => d.kind === 'warning').length, cards: mine.filter(d => d.kind === 'card' && !isReprimand(d)).length, deducted: mine.filter(d => d.kind === 'deduction').reduce((s, d) => s + d.amount, 0), dq: mine.some(d => d.kind === 'dq'), reprimands: mine.filter(isReprimand).length };
}

/** Sword and buckler (Duels Rules 2.2.1): the first to 2 round victories (a SUGGESTION: the person finishing decides; the server re-checks). */
export function bucklerRule(rounds: readonly LystRound[]): { decided: boolean; winner: 'a' | 'b' | null; extraRound: boolean; won: { a: number; b: number } } {
  const done = confirmedRounds(rounds);
  const won = { a: done.filter(r => (r.official_a ?? 0) > (r.official_b ?? 0)).length, b: done.filter(r => (r.official_b ?? 0) > (r.official_a ?? 0)).length };
  if (!allRoundsConfirmed(rounds)) return { decided: false, winner: null, extraRound: false, won };
  if (won.a >= 2 && won.a > won.b) return { decided: true, winner: 'a', extraRound: false, won };
  if (won.b >= 2 && won.b > won.a) return { decided: true, winner: 'b', extraRound: false, won };
  return { decided: false, winner: null, extraRound: done.length >= 2, won };
}

/* ---------------- settings ---------------- */
export interface LystSettings {
  presets: TimerPreset[]; auto_break: boolean; regular_rounds: number; extra_round_seconds: number; counter_input: 'auto' | 'simple' | 'weighted';
  cards: { key: string; label: string }[]; deduction_amounts: number[]; reasons: string[];
  /** Pack 25.2: the sides' names and colours as stored (either side may be missing: fill from the defaults with mergeSides). */
  sides?: { a?: { name: string; color: string }; b?: { name: string; color: string } } | null;
}

/** Duel rounds: the regular rounds run at the full length; once those are done and nobody leads by enough, extra rounds run at the shorter length. Both numbers are the event's settings. */
export const roundSeconds = (roundNo: number, settings: Pick<LystSettings, 'regular_rounds' | 'extra_round_seconds'>, fullSeconds: number): number =>
  roundNo > (settings.regular_rounds ?? 2) ? (settings.extra_round_seconds ?? 30) : fullSeconds;

/** What the existing duel rule says about the official totals (a SUGGESTION: the person finishing the match decides). */
export function leadRule(rounds: readonly LystRound[], settings: Pick<LystSettings, 'regular_rounds'>, lead = 2): { decided: boolean; winner: 'a' | 'b' | null; extraRound: boolean } {
  const done = confirmedRounds(rounds);
  const t = officialTotals(rounds);
  if (done.length < (settings.regular_rounds ?? 2) || !allRoundsConfirmed(rounds)) return { decided: false, winner: null, extraRound: false };
  const diff = t.a - t.b;
  if (Math.abs(diff) >= lead) return { decided: true, winner: diff > 0 ? 'a' : 'b', extraRound: false };
  return { decided: false, winner: null, extraRound: true };
}

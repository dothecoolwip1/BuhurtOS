import type { CompetitionEntry, CompetitionMatch } from '../data/matches';
import type { RosterMember } from './runSchedule';
import { sideFighters, timeLabel, type SideEntry } from './runSchedule';
import { sideLabel } from './entryLabel';

/**
 * Event day: everything the Command Center decides, as plain functions. No database, no React, no clock unless it is passed in.
 *
 * The rules for "who is next" and "can this match run" are ALSO written in the database (supabase migration 20261004000500: private.queue_ordered,
 * private.match_runnable, private.settle_field_queue), because the database is what really moves the queue. This file mirrors them so the screen can show
 * exactly what the database will do; supabase/tests/pack09a_gate.sql and src/lib/eventDay.test.ts use the same scenarios.
 */

/** A match with no field is on Field 1. The database keeps it empty; nothing writes "Field 1" just to display it. */
export const DEFAULT_FIELD = 'Field 1';
export const fieldName = (f: string | null | undefined): string => f?.trim() || DEFAULT_FIELD;
/** One field is one name, trimmed and case-insensitive. */
export const fieldKey = (f: string | null | undefined): string => fieldName(f).toLowerCase();
/**
 * The word a person reads for a field (Pack 26): the stored default "Field N" (and a bare "N" or "lyst N" someone typed) is shown as "Lyst N", the
 * sport's own word; a custom name is shown as the organizer wrote it. DISPLAY ONLY: routes, RPC arguments and keys keep the stored name.
 */
export function fieldLabel(f: string | null | undefined): string {
  const name = fieldName(f);
  const m = /^\s*(?:field|lyst)?\s*(\d{1,2})\s*$/i.exec(name);
  return m ? `Lyst ${Number(m[1])}` : name;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const plainCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);   // the database compares pools with collation "C"

export const LIVE_STATES = ['active', 'on_deck', 'in_the_hole'] as const;
export type LiveState = (typeof LIVE_STATES)[number];

/** Entries that cannot fight any more. */
export const INACTIVE_ENTRY = new Set(['withdrawn', 'disqualified']);
export const withdrawnEntryIds = (entries: readonly Pick<CompetitionEntry, 'id' | 'status'>[]): Set<string> => new Set(entries.filter(e => INACTIVE_ENTRY.has(e.status)).map(e => e.id));

// ---------------------------------------------------------------- can it run?
export type BlockCode = 'unknown_side' | 'withdrawn';
export interface Blocked { code: BlockCode; text: string; entryId?: string }

/** Why a match cannot be run yet, in plain words, or null when it can. */
export function blockedReason(m: Pick<CompetitionMatch, 'entryA' | 'entryB' | 'stage' | 'nameA' | 'nameB'>, withdrawn: ReadonlySet<string>): Blocked | null {
  if (!m.entryA || !m.entryB) {
    return { code: 'unknown_side', text: m.stage === 'third_place' && !m.entryA && !m.entryB ? 'Waiting for the semifinals to finish' : 'Waiting for an earlier fight to decide the other side' };
  }
  const gone = withdrawn.has(m.entryA) ? m.entryA : withdrawn.has(m.entryB) ? m.entryB : null;
  if (gone) {
    const name = gone === m.entryA ? sideLabel(m.entryA, m.nameA, 'A side') : sideLabel(m.entryB, m.nameB, 'A side');
    return { code: 'withdrawn', text: `${name} has withdrawn. Record a walkover or redraw`, entryId: gone };
  }
  return null;
}
export const isRunnable = (m: Pick<CompetitionMatch, 'entryA' | 'entryB' | 'stage' | 'nameA' | 'nameB'>, withdrawn: ReadonlySet<string>): boolean => blockedReason(m, withdrawn) === null;

// ---------------------------------------------------------------- running order
const stageRank = (stage: string): number => (stage === 'pool' || stage === 'round_robin' ? 0 : stage === 'elimination' ? 1 : stage === 'third_place' ? 2 : stage === 'final' ? 3 : 4);
/** Pool rounds by their number; elimination rounds earliest first. */
export function roundRank(stage: string, label: string): number {
  if (stage === 'pool' || stage === 'round_robin') return Number(/(\d+)/.exec(label)?.[1] ?? 0);
  const size = /^Round of (\d+)$/.exec(label)?.[1];
  if (size) return -Number(size);
  return label === 'Quarterfinal' ? -8 : label === 'Semifinal' ? -4 : 0;
}
const timeOf = (iso: string | null): number => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? t : Infinity; };

export type CompetitionSort = ReadonlyMap<string, number>;
/** The competition's running order position (the Sort column); unknown competitions go last. */
export const competitionSorts = (competitions: readonly { id: string; sort?: number }[]): Map<string, number> => new Map(competitions.map((c, i) => [c.id, c.sort ?? i]));

/**
 * The order waiting matches run in, the same rule the database uses:
 *   manual order (the organizer's, lower first; no manual order goes after those that have one), the saved plan (Pack 09D, same rule),
 *   scheduled time (no time goes last), the competition's order, stage (pool, elimination, third place, final), round, pool, position, id.
 */
export function compareRunOrder(a: CompetitionMatch, b: CompetitionMatch, sorts: CompetitionSort): number {
  const qa = a.queueOrder ?? Infinity, qb = b.queueOrder ?? Infinity;
  if (qa !== qb) return qa < qb ? -1 : 1;
  const pa = a.planOrder ?? Infinity, pb = b.planOrder ?? Infinity;   // Pack 09D: the saved plan, after the organizer's hand-made order
  if (pa !== pb) return pa < pb ? -1 : 1;
  const ta = timeOf(a.scheduledAt), tb = timeOf(b.scheduledAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  const sa = sorts.get(a.competitionId) ?? Infinity, sb = sorts.get(b.competitionId) ?? Infinity;
  if (sa !== sb) return sa < sb ? -1 : 1;
  return plainCompare(a.competitionId, b.competitionId)
    || stageRank(a.stage) - stageRank(b.stage)
    || roundRank(a.stage, a.roundLabel) - roundRank(b.stage, b.roundLabel)
    || plainCompare(a.pool ?? '', b.pool ?? '')
    || a.position - b.position
    || plainCompare(a.id, b.id);
}

// ---------------------------------------------------------------- a field, as the organizer sees it
export interface FieldBoard {
  key: string; name: string;
  /** Normally one. More than one is a problem the screen reports. */
  now: CompetitionMatch[];
  onDeck: CompetitionMatch[]; inTheHole: CompetitionMatch[];
  /** Ready to run, in running order. */
  upcoming: CompetitionMatch[];
  /** On this field and not final, but not ready: waiting for an earlier fight, or an entrant has withdrawn. */
  waiting: Array<{ match: CompetitionMatch; blocked: Blocked }>;
  done: number; total: number;
  /** running: a fight is on. ready: nothing active but something can start. stalled: unfinished matches but none can run. finished: everything scored. */
  state: 'running' | 'ready' | 'stalled' | 'finished';
}

/** One board per field that has matches, Field 1 first (natural order after it). Different fields never share a queue. */
export function buildFieldBoards(matches: readonly CompetitionMatch[], sorts: CompetitionSort, withdrawn: ReadonlySet<string>): FieldBoard[] {
  const byField = new Map<string, { name: string; list: CompetitionMatch[] }>();
  for (const m of matches) {
    const key = fieldKey(m.field);
    const g = byField.get(key) ?? { name: fieldName(m.field), list: [] };
    g.list.push(m);
    byField.set(key, g);
  }
  const boards: FieldBoard[] = [];
  for (const [key, g] of byField) {
    const open = g.list.filter(m => m.queueState !== 'final');
    const live = (s: LiveState) => open.filter(m => m.queueState === s).sort((a, b) => compareRunOrder(a, b, sorts));
    const scheduled = open.filter(m => m.queueState === 'scheduled');
    const upcoming = scheduled.filter(m => isRunnable(m, withdrawn)).sort((a, b) => compareRunOrder(a, b, sorts));
    const waiting = scheduled.flatMap(m => { const blocked = blockedReason(m, withdrawn); return blocked ? [{ match: m, blocked }] : []; }).sort((a, b) => compareRunOrder(a.match, b.match, sorts));
    const now = live('active'), onDeck = live('on_deck'), inTheHole = live('in_the_hole');
    const total = g.list.length;
    const anyRunnable = upcoming.length > 0 || [...onDeck, ...inTheHole].some(m => isRunnable(m, withdrawn));
    boards.push({
      key, name: g.name, now, onDeck, inTheHole, upcoming, waiting, done: total - open.length, total,
      state: now.length > 0 ? 'running' : open.length === 0 ? 'finished' : anyRunnable ? 'ready' : 'stalled'
    });
  }
  return boards.sort((a, b) => (a.key === DEFAULT_FIELD.toLowerCase() ? -1 : b.key === DEFAULT_FIELD.toLowerCase() ? 1 : natural(a.name, b.name)));
}

// ---------------------------------------------------------------- what pressing "next" will do
export interface AdvancePlan { promote: Array<{ matchId: string; to: LiveState }>; demote: string[] }

/**
 * What the database will do to this field on "Start the next match" (or after a result): fill the gaps from the top, never demote a ready match.
 *   nothing active (and `start`)  -> first ready of (on deck, in the hole, waiting) becomes active
 *   nothing on deck               -> first ready of (in the hole, waiting) goes on deck
 *   nothing in the hole           -> first ready waiting match goes in the hole
 * On-deck or in-the-hole matches that can no longer run go back to the line; a match that cannot run is never promoted.
 */
export function planAdvance(board: FieldBoard, withdrawn: ReadonlySet<string>, sorts: CompetitionSort, opts: { start: boolean }): AdvancePlan {
  const demote = [...board.onDeck, ...board.inTheHole].filter(m => !isRunnable(m, withdrawn)).map(m => m.id);
  const gone = new Set(demote);
  // The line: on deck, then in the hole, then waiting. A match that cannot run is never in it.
  let deck = board.onDeck.filter(m => !gone.has(m.id));
  const hole = board.inTheHole.filter(m => !gone.has(m.id));
  // A fight the planner holds (someone in it is not here today) is never called automatically (private.promote_one skips it too).
  const waiting = [...board.upcoming].filter(m => !m.planHold).sort((a, b) => compareRunOrder(a, b, sorts));
  const promote: AdvancePlan['promote'] = [];
  const take = (from: CompetitionMatch[][]): CompetitionMatch | undefined => { for (const list of from) if (list.length) return list.shift(); return undefined; };
  let hasActive = board.now.length > 0;
  if (opts.start && !hasActive) { const m = take([deck, hole, waiting]); if (m) { promote.push({ matchId: m.id, to: 'active' }); hasActive = true; } }
  if (deck.length === 0) { const m = take([hole, waiting]); if (m) { promote.push({ matchId: m.id, to: 'on_deck' }); deck = [m]; } }
  if (hole.length === 0) { const m = take([waiting]); if (m) promote.push({ matchId: m.id, to: 'in_the_hole' }); }
  return { promote, demote };
}

/** Finalizing a match that held a place in the live queue: the plan that follows. `wasActive` decides whether the next match is started. */
export function planAfterResult(board: FieldBoard, finishedId: string, wasActive: boolean, withdrawn: ReadonlySet<string>, sorts: CompetitionSort): AdvancePlan {
  const without: FieldBoard = {
    ...board,
    now: board.now.filter(m => m.id !== finishedId), onDeck: board.onDeck.filter(m => m.id !== finishedId), inTheHole: board.inTheHole.filter(m => m.id !== finishedId),
    upcoming: board.upcoming.filter(m => m.id !== finishedId)
  };
  return planAdvance(without, withdrawn, sorts, { start: wasActive });
}

// ---------------------------------------------------------------- competition progress
export type ProgressPhase = 'no_draw' | 'not_started' | 'in_progress' | 'pool_play' | 'pools_done' | 'bracket' | 'final_underway' | 'all_scored';
export interface CompetitionProgress {
  id: string; name: string; total: number; final: number; percent: number; phase: ProgressPhase; label: string; detail: string | null;
  /** Pool play is finished and no bracket exists: the organizer's next step. */
  needsBracket: boolean;
}

const isPoolStage = (s: string) => s === 'pool' || s === 'round_robin';
const countText = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Operational progress from real match state only. Nothing here says a competition is "complete" in the record sense; that is a later pack. */
export function competitionProgress(comp: { id: string; name: string }, matches: readonly CompetitionMatch[]): CompetitionProgress {
  const total = matches.length, final = matches.filter(m => m.queueState === 'final').length;
  const percent = total === 0 ? 0 : Math.round((final / total) * 100);
  const base = { id: comp.id, name: comp.name, total, final, percent, needsBracket: false };
  if (total === 0) return { ...base, phase: 'no_draw', label: 'No draw yet', detail: null };
  if (final === total) return { ...base, phase: 'all_scored', label: 'All matches scored', detail: `${total} of ${total} fights` };
  const live = matches.some(m => (LIVE_STATES as readonly string[]).includes(m.queueState));
  const pools = matches.filter(m => isPoolStage(m.stage)), bracket = matches.filter(m => !isPoolStage(m.stage));
  const poolFinal = pools.filter(m => m.queueState === 'final').length;
  const hasPoolStage = pools.some(m => m.stage === 'pool');
  if (final === 0 && !live) return { ...base, phase: 'not_started', label: 'Not started', detail: countText(total, 'fight', 'fights') };
  if (bracket.length === 0) {
    if (hasPoolStage && poolFinal === pools.length) {
      return { ...base, phase: 'pools_done', label: 'Pools complete, bracket needs building', detail: `${poolFinal} of ${pools.length} pool fights scored`, needsBracket: true };
    }
    return { ...base, phase: hasPoolStage ? 'pool_play' : 'in_progress', label: hasPoolStage ? 'Pool play' : 'In progress', detail: `${final} of ${total} fights scored` };
  }
  if (bracket.some(m => m.stage === 'final' && m.queueState === 'active')) return { ...base, phase: 'final_underway', label: 'Final underway', detail: `${final} of ${total} fights scored` };
  if (pools.length > 0 && poolFinal < pools.length) return { ...base, phase: 'pool_play', label: 'Pool play', detail: `${poolFinal} of ${pools.length} pool fights scored` };
  return { ...base, phase: 'bracket', label: 'Bracket underway', detail: `${final} of ${total} fights scored` };
}

// ---------------------------------------------------------------- who is in a match, and are they checked in?
export interface RegistrationFlag {
  id: string; fighterId: string; fullName: string; status: 'pending' | 'accepted' | 'declined' | 'withdrawn'; isVolunteer: boolean; checkedIn: boolean;
  /** Days the person said they can attend (yyyy-mm-dd); empty = not said. Pack 09D planning. */
  attendDates?: string[];
  /** Said they share equipment with someone (who is not recorded). Pack 09D planning: a warning only. */
  sharesEquipment?: boolean;
}
export type Slot = 'now' | 'on_deck' | 'in_the_hole' | 'next';
export interface CheckinGap { fighterId: string; name: string; problem: 'not_checked_in' | 'registration_not_accepted'; matchId: string; field: string; slot: Slot; teamName: string | null; registrationStatus: RegistrationFlag['status'] }

const SLOT_RANK: Record<Slot, number> = { now: 0, on_deck: 1, in_the_hole: 2, next: 3 };
export const SLOT_LABEL: Record<Slot, string> = { now: 'now', on_deck: 'on deck', in_the_hole: 'in the hole', next: 'coming up' };

/** How far down the waiting line "relevant to the queue" reaches. */
export const UPCOMING_WINDOW = 3;

/**
 * Fighters in the matches that matter right now (what is on, on deck, in the hole and the next few) whose registration says they are not ready.
 * Fighters with no registration on this event (organizer-added entrants, historical records) are not reported: there is nothing to check them against.
 * Each fighter is reported once, for their most urgent match.
 */
export function checkinGaps(boards: readonly FieldBoard[], entries: readonly SideEntry[], roster: readonly RosterMember[], regs: readonly RegistrationFlag[], window = UPCOMING_WINDOW): CheckinGap[] {
  const byFighter = new Map(regs.map(r => [r.fighterId, r]));
  const best = new Map<string, CheckinGap>();
  for (const b of boards) {
    const relevant: Array<[CompetitionMatch, Slot]> = [
      ...b.now.map(m => [m, 'now'] as [CompetitionMatch, Slot]), ...b.onDeck.map(m => [m, 'on_deck'] as [CompetitionMatch, Slot]),
      ...b.inTheHole.map(m => [m, 'in_the_hole'] as [CompetitionMatch, Slot]), ...b.upcoming.slice(0, window).map(m => [m, 'next'] as [CompetitionMatch, Slot])
    ];
    for (const [m, slot] of relevant) {
      for (const side of [m.entryA, m.entryB]) {
        const entry = side ? entries.find(e => e.id === side) : undefined;
        for (const p of sideFighters(side, entries, roster)) {
          const reg = byFighter.get(p.fighterId);
          if (!reg) continue;
          const problem = reg.status === 'accepted' ? (reg.checkedIn ? null : 'not_checked_in') : 'registration_not_accepted';
          if (!problem) continue;
          const gap: CheckinGap = { fighterId: p.fighterId, name: p.name, problem, matchId: m.id, field: fieldLabel(b.name), slot, teamName: entry?.teamId ? entry.name : null, registrationStatus: reg.status };
          const have = best.get(p.fighterId);
          if (!have || SLOT_RANK[slot] < SLOT_RANK[have.slot]) best.set(p.fighterId, gap);
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot] || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- needs attention
export type AttentionKind = 'result_review' | 'two_active' | 'withdrawn_in_live' | 'walkover_needed' | 'due_but_blocked' | 'double_booked' | 'not_checked_in' | 'bracket_needed';
export type Urgency = 'now' | 'soon' | 'later';
export type AttentionTarget = { to: 'run'; matchId?: string } | { to: 'checkin' } | { to: 'review' } | { to: 'field'; field: string; matchId?: string };
export interface AttentionItem { id: string; kind: AttentionKind; urgency: Urgency; title: string; detail: string | null; target: AttentionTarget; targetLabel: string }

const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, later: 2 };
const KIND_RANK: Record<AttentionKind, number> = { result_review: 0, two_active: 1, withdrawn_in_live: 2, double_booked: 3, not_checked_in: 4, due_but_blocked: 5, walkover_needed: 6, bracket_needed: 7 };

export interface ScheduleClash { fighterId: string; displayName: string; matchA: string; matchB: string; scheduledA: string; scheduledB: string; competitionA: string; competitionB: string; overlapMinutes: number }

export interface AttentionInput {
  boards: readonly FieldBoard[]; progress: readonly CompetitionProgress[]; clashes: readonly ScheduleClash[]; gaps: readonly CheckinGap[];
  resultConflicts: number; withdrawn: ReadonlySet<string>; competitionNames: ReadonlyMap<string, string>; timeZone: string; now: Date;
  /** A not-ready match is called "due" this many minutes before its scheduled time. */
  dueMinutes?: number;
}

const versus = (m: Pick<CompetitionMatch, 'entryA' | 'entryB' | 'nameA' | 'nameB'>) => `${sideLabel(m.entryA, m.nameA, 'To be decided')} vs ${sideLabel(m.entryB, m.nameB, 'To be decided')}`;

/**
 * Only things that need a person: no warning for the ordinary future placeholders of a bracket. A waiting match is mentioned only when it is due soon or
 * overdue, or when an entrant in it has withdrawn.
 */
export function attentionItems(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const matchIndex = new Map<string, { match: CompetitionMatch; field: string }>();
  for (const b of i.boards) for (const m of [...b.now, ...b.onDeck, ...b.inTheHole, ...b.upcoming, ...b.waiting.map(w => w.match)]) matchIndex.set(m.id, { match: m, field: b.name });

  if (i.resultConflicts > 0) {
    out.push({ id: 'result-review', kind: 'result_review', urgency: 'now', title: `${countText(i.resultConflicts, 'result needs', 'results need')} review`, detail: 'Two devices disagreed. The official result has not changed.', target: { to: 'review' }, targetLabel: 'Review' });
  }
  for (const b of i.boards) {
    if (b.now.length > 1) {
      out.push({ id: `two-active-${b.key}`, kind: 'two_active', urgency: 'now', title: `${b.now.length} fights are marked active on ${fieldLabel(b.name)}`, detail: b.now.map(versus).join(' · '), target: { to: 'run', matchId: b.now[1].id }, targetLabel: 'Fix in Draws and schedule' });
    }
    for (const m of [...b.now, ...b.onDeck, ...b.inTheHole]) {
      const blocked = blockedReason(m, i.withdrawn);
      if (blocked) out.push({ id: `live-blocked-${m.id}`, kind: 'withdrawn_in_live', urgency: 'now', title: `${versus(m)} cannot go ahead on ${fieldLabel(b.name)}`, detail: blocked.text, target: { to: 'run', matchId: m.id }, targetLabel: 'Open in Draws and schedule' });
    }
    for (const { match: m, blocked } of b.waiting) {
      if (blocked.code === 'withdrawn' && m.entryA && m.entryB) {
        out.push({ id: `walkover-${m.id}`, kind: 'walkover_needed', urgency: 'soon', title: `${versus(m)}: an entrant has withdrawn`, detail: blocked.text, target: { to: 'run', matchId: m.id }, targetLabel: 'Open in Draws and schedule' });
      } else if (m.scheduledAt && new Date(m.scheduledAt).getTime() <= i.now.getTime() + (i.dueMinutes ?? 20) * 60000) {
        out.push({ id: `due-${m.id}`, kind: 'due_but_blocked', urgency: 'soon', title: `${versus(m)} was due ${timeLabel(m.scheduledAt, i.timeZone)} on ${fieldLabel(b.name)}`, detail: blocked.text, target: { to: 'run', matchId: m.id }, targetLabel: 'Open in Draws and schedule' });
      }
    }
  }
  const clashSeen = new Set<string>();
  for (const c of i.clashes) {
    const a = matchIndex.get(c.matchA), b = matchIndex.get(c.matchB);
    const urgency: Urgency = [a, b].some(x => x && x.match.queueState !== 'scheduled') ? 'now' : 'soon';
    const key = `${c.fighterId}:${[c.matchA, c.matchB].sort().join(':')}`;
    if (clashSeen.has(key)) continue;
    clashSeen.add(key);
    const side = (comp: string, at: string, hit: typeof a) => `${i.competitionNames.get(comp) ?? 'a match'} at ${timeLabel(at, i.timeZone)}${hit ? ` (${hit.field})` : ''}`;
    out.push({
      id: `clash-${key}`, kind: 'double_booked', urgency, title: `${c.displayName} is booked twice`,
      detail: `${side(c.competitionA, c.scheduledA, a)} and ${side(c.competitionB, c.scheduledB, b)} overlap by ${c.overlapMinutes} min.`,
      target: { to: 'run', matchId: c.matchA }, targetLabel: 'Go to match'
    });
  }
  if (i.gaps.length > 0) {
    const notIn = i.gaps.filter(g => g.problem === 'not_checked_in'), notAccepted = i.gaps.filter(g => g.problem === 'registration_not_accepted');
    const names = (list: readonly CheckinGap[]) => `${list.slice(0, 3).map(g => `${g.name} (${SLOT_LABEL[g.slot]}, ${g.field})`).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;
    const worst = (list: readonly CheckinGap[]): Urgency => (list.some(g => g.slot === 'now' || g.slot === 'on_deck') ? 'now' : 'soon');
    if (notIn.length) out.push({ id: 'checkin-gaps', kind: 'not_checked_in', urgency: worst(notIn), title: `${countText(notIn.length, 'fighter', 'fighters')} not checked in`, detail: names(notIn), target: { to: 'checkin' }, targetLabel: 'Check in' });
    if (notAccepted.length) out.push({ id: 'checkin-not-accepted', kind: 'not_checked_in', urgency: worst(notAccepted), title: `${countText(notAccepted.length, 'fighter', 'fighters')} without an accepted registration`, detail: names(notAccepted), target: { to: 'checkin' }, targetLabel: 'Review' });
  }
  for (const p of i.progress) {
    if (p.needsBracket) out.push({ id: `bracket-${p.id}`, kind: 'bracket_needed', urgency: 'soon', title: `${p.name}: pools are finished`, detail: 'The bracket needs building.', target: { to: 'run' }, targetLabel: 'Build bracket' });
  }
  return out.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- wording for a match
/** Fighters who are in a fight that is on right now (active), on any field: a fight with one of them must not start elsewhere. Pack 11. */
export function fightingNow(matches: Iterable<Pick<CompetitionMatch, 'queueState' | 'entryA' | 'entryB' | 'field'>>, sides: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of matches) {
    if (m.queueState !== 'active') continue;
    for (const entry of [m.entryA, m.entryB]) for (const p of (entry ? sides.get(entry) ?? [] : [])) if (!out.has(p)) out.set(p, fieldLabel(m.field));
  }
  return out;
}

export const matchTitle = versus;
/** "Longsword · Semifinal" or "5v5 · Pool A, Round 2". */
export function matchContext(m: Pick<CompetitionMatch, 'pool' | 'roundLabel' | 'stage'>, competitionName: string): string {
  const round = m.roundLabel || m.stage;
  return `${competitionName} · ${m.pool ? `Pool ${m.pool}, ${round}` : round}`;
}

/** Default tab rule: Event day opens first only while the event is really running (today is inside its dates, in its time zone). */
export function eventIsRunning(startsOn: string, endsOn: string, timeZone: string, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return today >= startsOn && today <= endsOn;
}

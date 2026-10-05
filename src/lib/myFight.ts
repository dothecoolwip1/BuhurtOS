/**
 * Pure helpers for "My next fight": from the event's matches and the entry ids that belong to the signed-in person, work out
 * the next match, where it sits in the field's line, every other fight still to come (any competition), the rest since the last
 * one and the result so far. No database access and no invented facts: a position is counted from the field's queue and the saved
 * plan order (never a clock time), and a rest warning only from fights that really finished.
 */
import type { CompetitionMatch, QueueState } from '../data/matches';
import { fieldName } from './eventDay';
import { fieldQueue } from './fieldScoring';
import { sideLabel } from './entryLabel';
import { REST_TARGET } from './planner';

export const TBD_OPPONENT = 'Opponent to be decided';

export interface NextFight {
  match: CompetitionMatch;
  /** The entry of the viewer's side. */
  myEntry: string;
  opponent: string;
  /** Fights ahead of this one on its field: queued ones from the field's line, planned ones from the saved plan order; null when unknown. */
  ahead: number | null;
  /** The field it will run on ("Field 1" when none is written: that is the default field). */
  field: string;
  /** Held back by the planner (someone in it is registered for another day): the organizer calls it by hand. */
  held: boolean;
}
export interface FightResultLine { matchId: string; competitionId: string; roundLabel: string; opponent: string; outcome: 'won' | 'lost' | 'drawn'; mine: number | null; theirs: number | null }
export interface RestNote {
  /** Fights (any field, any competition) that finished after the viewer's last one. */
  since: number;
  target: number;
}
export interface MyFightSummary {
  next: NextFight | null;
  /** Every unfinished fight of the viewer, most pressing first (the first is `next`). */
  upcoming: NextFight[];
  results: FightResultLine[];
  wins: number; losses: number; draws: number;
  /** Matches in the event that involve one of the viewer's entries. */
  total: number;
  /** Set when the next fight is close (called, or 3 or fewer ahead) and fewer than REST_TARGET fights finished since the viewer's last one. */
  rest: RestNote | null;
}

const URGENCY: Record<QueueState, number> = { active: 0, on_deck: 1, in_the_hole: 2, scheduled: 3, final: 4 };
const QUEUED = new Set<QueueState>(['active', 'on_deck', 'in_the_hole']);

const isMine = (m: CompetitionMatch, ids: ReadonlySet<string>) => (m.entryA !== null && ids.has(m.entryA)) || (m.entryB !== null && ids.has(m.entryB));

function sides(m: CompetitionMatch, ids: ReadonlySet<string>) {
  const aMine = m.entryA !== null && ids.has(m.entryA);
  return aMine
    ? { myEntry: m.entryA!, opponent: sideLabel(m.entryB, m.nameB, TBD_OPPONENT), mine: m.scoreA, theirs: m.scoreB, iAm: 'a' as const }
    : { myEntry: m.entryB!, opponent: sideLabel(m.entryA, m.nameA, TBD_OPPONENT), mine: m.scoreB, theirs: m.scoreA, iAm: 'b' as const };
}

/** Order among unfinished fights: called ones first (active, on deck, in the hole), then the saved plan order, then start time and position. */
function compareUpcoming(x: CompetitionMatch, y: CompetitionMatch): number {
  return URGENCY[x.queueState] - URGENCY[y.queueState]
    || Number(x.planHold === true) - Number(y.planHold === true)
    || (x.planOrder ?? Number.MAX_SAFE_INTEGER) - (y.planOrder ?? Number.MAX_SAFE_INTEGER)
    || (x.scheduledAt ?? '￿').localeCompare(y.scheduledAt ?? '￿') || x.position - y.position;
}

/**
 * Fights ahead of `m` on its field. A called fight: its place in the field's line (0 = fighting now). A planned fight: every called fight on
 * the field plus the planned ones before it in the saved order. Null when the fight is neither called nor planned (nothing is guessed).
 */
export function fightsAhead(matches: readonly CompetitionMatch[], m: CompetitionMatch): number | null {
  const f = fieldName(m.field);
  const onField = matches.map(x => ({ ...x, field: fieldName(x.field) }));
  const queue = fieldQueue(onField, f);
  if (QUEUED.has(m.queueState)) { const i = queue.findIndex(q => q.id === m.id); return i >= 0 ? i : null; }
  if (m.queueState !== 'scheduled' || m.planOrder == null || m.planHold) return null;
  const plannedBefore = onField.filter(x => x.field === f && x.queueState === 'scheduled' && !x.planHold && x.planOrder != null && x.planOrder < m.planOrder!).length;
  return queue.length + plannedBefore;
}

/**
 * The viewer's unfinished matches, most pressing first, each with its place on its field; the finished ones with win/loss/draw count; and
 * a rest note when the next fight is close behind the last one. `matches` is every match of the event, so positions and rest are right.
 */
export function nextForEntries(matches: readonly CompetitionMatch[], entryIds: Iterable<string>, target = REST_TARGET): MyFightSummary {
  const ids = new Set(entryIds);
  const mine = matches.filter(m => isMine(m, ids));
  const open = mine.filter(m => m.queueState !== 'final').sort(compareUpcoming);
  const upcoming: NextFight[] = open.map(m => {
    const s = sides(m, ids);
    return { match: m, myEntry: s.myEntry, opponent: s.opponent, ahead: fightsAhead(matches, m), field: fieldName(m.field), held: m.planHold === true };
  });
  const next = upcoming[0] ?? null;
  const done = mine.filter(m => m.queueState === 'final').sort((x, y) => (x.finalizedAt ?? '').localeCompare(y.finalizedAt ?? '') || x.position - y.position);
  const results: FightResultLine[] = done.map(m => {
    const s = sides(m, ids);
    const outcome = m.result === 'draw' || m.result === null ? 'drawn' : m.result === s.iAm ? 'won' : 'lost';
    return { matchId: m.id, competitionId: m.competitionId, roundLabel: m.pool ? `Pool ${m.pool}, ${m.roundLabel}` : m.roundLabel, opponent: s.opponent, outcome, mine: s.mine, theirs: s.theirs };
  });
  let rest: RestNote | null = null;
  const last = done.length ? done[done.length - 1].finalizedAt : null;
  if (next && last && (QUEUED.has(next.match.queueState) || (next.ahead !== null && next.ahead <= target))) {
    const since = matches.filter(m => m.queueState === 'final' && !isMine(m, ids) && (m.finalizedAt ?? '') > last).length;
    if (since < target) rest = { since, target };
  }
  return {
    next, upcoming, results, total: mine.length, rest,
    wins: results.filter(r => r.outcome === 'won').length,
    losses: results.filter(r => r.outcome === 'lost').length,
    draws: results.filter(r => r.outcome === 'drawn').length
  };
}

export function aheadText(ahead: number): string {
  return ahead === 0 ? 'You are up next' : ahead === 1 ? '1 fight ahead of you' : `${ahead} fights ahead of you`;
}

export interface StatusText { label: string; detail: string; tone: 'go' | 'soon' | 'wait' }

/** Plain-language status for the next fight. `field` is the field it runs on; `ahead` comes from nextForEntries; `held` = held back by the planner. */
export function statusLabel(state: QueueState, ahead: number | null, field: string | null, held = false): StatusText {
  const f = field && field.trim() ? field.trim() : null;
  const where = f ? ` on ${f}` : '';
  switch (state) {
    case 'active': return { label: `You are fighting now${where}`, detail: f ? `Go to ${f}.` : 'Go to your field.', tone: 'go' };
    case 'on_deck': return { label: 'You are on deck. Go to the bullpen', detail: `You are next${where}. Get your gear on and be ready.`, tone: 'go' };
    case 'in_the_hole': return { label: 'You are in the hole', detail: ahead === null ? 'You are close to the front. Start getting ready.' : `${aheadText(ahead)}${where}. Start getting ready.`, tone: 'soon' };
    case 'scheduled':
      if (held) return { label: 'Held for another day', detail: 'You registered for a different day, so this fight is not in today’s line. The organizer calls it by hand when you are here.', tone: 'wait' };
      if (ahead === null) return { label: 'Scheduled', detail: 'Not in the line yet. This page updates by itself when you are called.', tone: 'wait' };
      if (ahead <= 3) return { label: 'Coming up soon', detail: `${aheadText(ahead)}${where}. Start getting ready; this page updates by itself when you are called.`, tone: 'soon' };
      return { label: 'Coming up', detail: `About ${aheadText(ahead).replace('You are up next', 'none ahead of you')}${where}, counting the fights already called. This page updates by itself when you are called.`, tone: 'wait' };
    case 'final': return { label: 'Finished', detail: '', tone: 'wait' };
  }
}

/** One short line for the rest note. */
export function restText(r: RestNote): string {
  const since = r.since === 0 ? 'You just fought: no fight has finished since your last one' : r.since === 1 ? 'Only 1 fight has finished since your last one' : `Only ${r.since} fights have finished since your last one`;
  return `${since} (the target is ${r.target} between appearances). Tell the marshal if you need more time.`;
}

export const recordText = (s: Pick<MyFightSummary, 'wins' | 'losses' | 'draws'>): string => {
  const parts = [`${s.wins} won`, `${s.losses} lost`];
  if (s.draws > 0) parts.push(`${s.draws} drawn`);
  return parts.join(', ');
};

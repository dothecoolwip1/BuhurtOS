/**
 * Automatic fix for double-booked fighters and fields. Pure: it plans moves, the caller saves them.
 *
 * Rule of thumb: nothing moves earlier, nothing jumps the queue. Matches are taken in their current order and each one is pushed later
 * only as far as needed so that none of its fighters is in another match, its field is free, and every match that feeds into it
 * (a bracket's earlier round) has ended. Matches that are already called or playing (on deck, in the hole, active) and finished matches
 * never move. Unscheduled matches are left alone.
 */

export interface ResolveMatch {
  id: string;
  scheduledAt: string | null;
  durationMinutes: number;
  field: string | null;
  /** Everyone who stands in the match (duel fighters, or team rosters). */
  fighters: readonly string[];
  /** Ids of matches whose winner (or loser) plays in this one. */
  feeders: readonly string[];
  /** Called, playing or final: keeps its time. */
  locked: boolean;
  /** Tie-break for matches at the same time: competition order, then position. */
  order: number;
}
export interface ResolveMove { matchId: string; from: string; to: string }
export interface ResolveResult { moves: ResolveMove[]; stillClashing: string[]; endBefore: string | null; endAfter: string | null }

const MIN = 60_000;

interface Interval { start: number; end: number }
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Plans the smallest forward moves that leave no fighter in two matches at once and no field running two matches at once. `restMinutes` adds a break after each match for its fighters. Times snap to `stepMinutes`. */
export function resolveSchedule(matches: readonly ResolveMatch[], opts: { restMinutes?: number; stepMinutes?: number } = {}): ResolveResult {
  const rest = Math.max(0, opts.restMinutes ?? 0) * MIN;
  const step = Math.max(1, opts.stepMinutes ?? 5) * MIN;
  const timed = matches.filter(m => m.scheduledAt && Number.isFinite(Date.parse(m.scheduledAt)));
  const byFighter = new Map<string, Interval[]>();
  const byField = new Map<string, Interval[]>();
  const endOf = new Map<string, number>();
  const add = (m: ResolveMatch, start: number) => {
    const iv = { start, end: start + m.durationMinutes * MIN };
    for (const f of m.fighters) byFighter.set(f, [...(byFighter.get(f) ?? []), { start: iv.start, end: iv.end + rest }]);
    if (m.field) byField.set(m.field.toLowerCase(), [...(byField.get(m.field.toLowerCase()) ?? []), iv]);
    endOf.set(m.id, iv.end);
  };
  // Blocking intervals for a match placed at `start`, from fighters (with rest) and its field.
  const blockers = (m: ResolveMatch, start: number): Interval[] => {
    const mine = { start, end: start + m.durationMinutes * MIN };
    const fighterWindow = { start, end: mine.end + rest };
    const out: Interval[] = [];
    for (const f of m.fighters) for (const iv of byFighter.get(f) ?? []) if (overlaps(fighterWindow, iv) || overlaps(mine, iv)) out.push(iv);
    if (m.field) for (const iv of byField.get(m.field.toLowerCase()) ?? []) if (overlaps(mine, iv)) out.push(iv);
    return out;
  };

  const stillClashing: string[] = [];
  const locked = timed.filter(m => m.locked).sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  for (const m of locked) {
    const t = Date.parse(m.scheduledAt!);
    if (blockers(m, t).length > 0) stillClashing.push(m.id);
    add(m, t);
  }

  const movable = timed.filter(m => !m.locked).sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!) || a.order - b.order);
  const moves: ResolveMove[] = [];
  for (const m of movable) {
    const original = Date.parse(m.scheduledAt!);
    let t = original;
    for (const f of m.feeders) { const e = endOf.get(f); if (e !== undefined && e > t) t = e; }
    for (let guard = 0; guard < 2000; guard++) {
      const b = blockers(m, t);
      if (b.length === 0) break;
      t = Math.max(...b.map(iv => iv.end));
    }
    if (t !== original) t = Math.ceil(t / step) * step;
    // Snapping can land on a new clash; keep stepping until clear.
    for (let guard = 0; guard < 2000 && blockers(m, t).length > 0; guard++) t += step;
    add(m, t);
    if (t !== original) moves.push({ matchId: m.id, from: m.scheduledAt!, to: new Date(t).toISOString() });
  }

  const lastEnd = (list: readonly { start: number; dur: number }[]) => (list.length ? new Date(Math.max(...list.map(x => x.start + x.dur * MIN))).toISOString() : null);
  const before = timed.map(m => ({ start: Date.parse(m.scheduledAt!), dur: m.durationMinutes }));
  const moved = new Map(moves.map(mv => [mv.matchId, Date.parse(mv.to)]));
  const after = timed.map(m => ({ start: moved.get(m.id) ?? Date.parse(m.scheduledAt!), dur: m.durationMinutes }));
  return { moves, stillClashing, endBefore: lastEnd(before), endAfter: lastEnd(after) };
}

/** True when today, in the event's time zone, is on or after the first day: from then on the schedule is only changed by hand. */
export function isEventDayOrLater(startsOn: string, timeZone: string, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return today >= startsOn;
}

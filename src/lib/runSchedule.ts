import { isoToLocal } from './dates';

/** Pure helpers for the Run tab schedule: time stepping, bulk plans, who stands in a match, and plain-language conflict lines. */

export const DEFAULT_DURATION = 15;
export const MIN_DURATION = 1;
export const MAX_DURATION = 720;

/** Add minutes to an ISO instant. Returns null for an unreadable date. */
export function addMinutes(iso: string, minutes: number): string | null {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + minutes * 60000).toISOString() : null;
}

/** A whole number of minutes between 1 and 720, or null. */
export function parseDuration(text: string | number): number | null {
  const s = typeof text === 'number' ? String(text) : text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= MIN_DURATION && n <= MAX_DURATION ? n : null;
}

/** "Field 1, Field 2" or one per line -> ["Field 1", "Field 2"]. Blank and repeated names are dropped. */
export function parseFields(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const f = raw.trim().slice(0, 40);
    if (f && !seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); out.push(f); }
  }
  return out;
}

export interface SlotInput { matchId: string; queueState: string; scheduledAt: string | null }
export interface ScheduleSlot { matchId: string; scheduledAt: string; field: string | null }

/**
 * "Schedule this competition from <start> every <n> minutes on <fields>".
 * Matches are taken in the order given. With k fields, k matches run at once, then the clock moves on by `everyMinutes`.
 * Final matches are never touched. `onlyUnscheduled` leaves matches that already have a time alone.
 */
export function planSchedule(matches: readonly SlotInput[], startIso: string, everyMinutes: number, fields: readonly string[], onlyUnscheduled = false): ScheduleSlot[] {
  if (!Number.isFinite(new Date(startIso).getTime()) || !(everyMinutes >= 1)) return [];
  const lanes: (string | null)[] = fields.length > 0 ? [...fields] : [null];
  const out: ScheduleSlot[] = [];
  let i = 0;
  for (const m of matches) {
    if (m.queueState === 'final') continue;
    if (onlyUnscheduled && m.scheduledAt) continue;
    const at = addMinutes(startIso, Math.floor(i / lanes.length) * everyMinutes);
    if (!at) return [];
    out.push({ matchId: m.matchId, scheduledAt: at, field: lanes[i % lanes.length] });
    i++;
  }
  return out;
}

/** When the last slot of a bulk plan ends. */
export function planEnd(slots: readonly ScheduleSlot[], durationMinutes: number): string | null {
  if (slots.length === 0) return null;
  const last = slots.reduce((a, s) => (s.scheduledAt > a ? s.scheduledAt : a), slots[0].scheduledAt);
  return addMinutes(last, durationMinutes);
}

/** "Sat 10:15" in the event's time zone. */
export function timeLabel(iso: string, timeZone = 'America/Edmonton'): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'an unknown time';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, weekday: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${day} ${time}`;
}

/** The date part of an instant in the event's time zone, for a default start day. */
export const localDay = (iso: string, timeZone?: string): string => isoToLocal(iso, timeZone).slice(0, 10);

export interface SideEntry { id: string; fighterId: string | null; teamId: string | null; name: string }
export interface RosterMember { entryId: string; fighterId: string; displayName: string }
export interface Person { fighterId: string; name: string }

/** The fighters who stand in one side of a match: the fighter of a duel entry, or the roster of a team entry. */
export function sideFighters(entryId: string | null, entries: readonly SideEntry[], roster: readonly RosterMember[]): Person[] {
  if (!entryId) return [];
  const e = entries.find(x => x.id === entryId);
  if (!e) return [];
  if (e.fighterId) return [{ fighterId: e.fighterId, name: e.name }];
  const seen = new Set<string>();
  return roster.filter(r => r.entryId === entryId && !seen.has(r.fighterId) && seen.add(r.fighterId)).map(r => ({ fighterId: r.fighterId, name: r.displayName }));
}

/** Both sides, once per person. */
export function matchFighters(entryA: string | null, entryB: string | null, entries: readonly SideEntry[], roster: readonly RosterMember[]): Person[] {
  const seen = new Set<string>();
  return [...sideFighters(entryA, entries, roster), ...sideFighters(entryB, entries, roster)].filter(p => !seen.has(p.fighterId) && seen.add(p.fighterId));
}

export interface BookingLike { competitionName: string; scheduledAt: string; overlapMinutes: number }

/** "Aldric Stone-test is already fighting Male Longsword at Sat 10:15 (overlaps by 5 minutes)." */
export const bookingLine = (name: string, b: BookingLike, timeZone?: string): string =>
  `${name} is already fighting ${b.competitionName} at ${timeLabel(b.scheduledAt, timeZone)} (overlaps by ${b.overlapMinutes} minute${b.overlapMinutes === 1 ? '' : 's'}).`;

/** "Needs attention: 3 fighters are double-booked", or null when there is nothing to fix. */
export function conflictsHeadline(fighterCount: number): string | null {
  if (fighterCount <= 0) return null;
  return `Needs attention: ${fighterCount} ${fighterCount === 1 ? 'fighter is' : 'fighters are'} double-booked`;
}

/** Short label for the ManagePage strip. */
export const conflictsStripLabel = (fighterCount: number): string | null =>
  fighterCount <= 0 ? null : `${fighterCount} ${fighterCount === 1 ? 'fighter' : 'fighters'} double-booked`;

export const distinctFighters = (rows: readonly { fighterId: string }[]): number => new Set(rows.map(r => r.fighterId)).size;

/** One side of a conflict, in words: "Male Longsword at Sat 10:15". */
export const conflictSide = (competitionName: string, scheduledAt: string, timeZone?: string): string => `${competitionName} at ${timeLabel(scheduledAt, timeZone)}`;

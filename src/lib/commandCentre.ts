/**
 * Pack 18: the Organizer Command Centre's thinking, in pure functions. It never decides anything about a fight: it reads the authoritative
 * state (the Pack 09A queue, Pack 13 Lyst Control, Pack 16 readiness, result conflicts) and says what needs a person, and where to fix it.
 * No scores, no clocks, no queue order are computed here.
 */
import type { CompetitionMatch } from '../data/matches';
import { controlPath, legacyManageTarget } from './eventPhaseView';
import type { LystPublic } from '../data/lyst';
import { attentionItems, type AttentionItem, type CompetitionProgress, type FieldBoard, type ScheduleClash, fieldKey, matchTitle } from './eventDay';
import { timeLabel } from './runSchedule';

// ---------------------------------------------------------------- the server snapshot (public.event_command_snapshot)
export interface CommandReadiness {
  fighters: number; volunteers: number; missing: number; arrived: number; checkedIn: number; ready: number; notReady: number;
  needsInspection: number; needsCorrection: number; failed: number; overrides: number; adminBlocked: number; pendingRegistrations: number;
}
export interface NotReadyFighter { registrationId: string; fighterId: string; name: string; team: string | null; attendance: string; inspection: string; reasons: string[] }
export interface FightWarning { matchId: string; side: 'a' | 'b'; fighterId: string; name: string; reasons: string[] }
export interface CommandSnapshot {
  serverNow: string;
  event: { id: string; slug: string; name: string; status: string; timezone: string; startsOn: string; endsOn: string; closed: boolean };
  /** What the database says this viewer may do (the page only reflects it): the permanent organizer, announcing, running the day (organizer or Temporary Organizer),
   *  Camera Off on / back on, and OBS-level broadcast control. */
  viewer: { organizer: boolean; announce: boolean; operator: boolean; cameraOff: boolean; cameraRelease: boolean; broadcast: boolean };
  readiness: CommandReadiness;
  notReady: NotReadyFighter[];
  overrides: { registrationId: string; name: string; reason: string | null }[];
  fightWarnings: FightWarning[];
  staff: { role: string; names: string[] }[];
  broadcast: { configured: boolean };
}

// ---------------------------------------------------------------- freshness: never show old operational data as live
export type Freshness = 'live' | 'stale' | 'offline';
export const STALE_AFTER_MS = 60_000;
export function freshness(lastOkMs: number | null, nowMs: number, online: boolean): Freshness {
  if (!online) return 'offline';
  if (lastOkMs === null || nowMs - lastOkMs > STALE_AFTER_MS) return 'stale';
  return 'live';
}

// ---------------------------------------------------------------- one item that needs a person
export type Urgency = 'now' | 'soon' | 'later' | 'info';
export interface CommandItem {
  id: string; urgency: Urgency;
  /** WHAT is wrong (one short line) */ what: string;
  /** WHO / WHAT it affects */ who: string | null;
  /** WHERE it applies (field, desk, competition) */ where: string | null;
  /** WHAT to do next: the label of the link, and the existing screen that fixes it */ action: string; href: string;
}
const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, later: 2, info: 3 };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const names = (list: readonly string[], max = 3) => `${list.slice(0, max).join(', ')}${list.length > max ? ` and ${list.length - max} more` : ''}`;

export interface CommandLinks { slug: string; organizer: boolean }
export const deskHref = (slug: string, filter?: string) => `/events/${slug}/checkin${filter ? `?f=${filter}` : ''}`;
export const fieldHref = (slug: string, field: string) => `/events/${slug}/field/${encodeURIComponent(field)}`;
/** An old Manage tab's place in Event Control (Pack 25): its mode and tool, with any extras (`&match=…`) appended. */
export const manageHref = (slug: string, tab: string, extra = '') => { const t = legacyManageTarget(tab); return `${controlPath(slug, t.mode, t.tool)}${extra}`; };

/** The fight that is on, and the next one called, per field, with the official Lyst state of the one on (state words only). */
export interface FieldSummary {
  key: string; name: string;
  state: 'running' | 'paused' | 'between_fights' | 'idle' | 'stalled' | 'finished';
  current: CompetitionMatch | null; next: CompetitionMatch | null;
  /** Pack 13 clock state of the current fight, as words: never a second clock. */
  clock: 'running' | 'paused' | 'set' | null; round: number | null;
  /** Called (on deck / in the hole) plus ready-to-run fights waiting on this field. */
  queueDepth: number;
  /** Minutes the field's next fight is past its scheduled time (only when 15 min or more). */
  behindMinutes: number | null;
  /** Not-ready fighters in the current and next fight. */
  warnings: FightWarning[];
}
export const BEHIND_MINUTES = 15;

export function fieldSummaries(boards: readonly FieldBoard[], lyst: readonly LystPublic[], warnings: readonly FightWarning[], now: Date): FieldSummary[] {
  const byMatch = new Map(lyst.map(r => [r.match_id, r]));
  return boards.map(b => {
    const current = b.now[0] ?? null;
    const next = b.onDeck[0] ?? b.inTheHole[0] ?? b.upcoming[0] ?? null;
    const row = current ? byMatch.get(current.id) : undefined;
    const clock = row?.timer_status === 'running' ? 'running' : row?.timer_status === 'paused' ? 'paused' : row?.timer_status === 'idle' ? 'set' : null;
    const due = current ?? next;
    const late = due?.scheduledAt ? Math.floor((now.getTime() - new Date(due.scheduledAt).getTime()) / 60000) : null;
    // a fight that is ON is behind only if it has not started its clock yet; a waiting next fight is behind when its time has passed
    const behind = late !== null && late >= BEHIND_MINUTES && !(current && clock === 'running') ? late : null;
    const state: FieldSummary['state'] = b.state === 'finished' ? 'finished'
      : current ? (clock === 'paused' ? 'paused' : clock === 'running' ? 'running' : 'between_fights')
      : b.state === 'ready' ? 'idle' : b.state === 'stalled' ? 'stalled' : 'idle';
    const ids = new Set([current?.id, next?.id].filter(Boolean) as string[]);
    return {
      key: b.key, name: b.name, state, current, next, clock, round: row?.timer_round ?? row?.round_no ?? null,
      queueDepth: b.onDeck.length + b.inTheHole.length + b.upcoming.length, behindMinutes: behind,
      warnings: warnings.filter(w => ids.has(w.matchId))
    };
  });
}

export const FIELD_STATE_LABEL: Record<FieldSummary['state'], string> = {
  running: 'Fight on, clock running', paused: 'Clock paused', between_fights: 'Fight on, clock not running', idle: 'Waiting to call the next fight',
  stalled: 'Nothing can run yet', finished: 'All fights done'
};

/**
 * Everything that needs a person, most urgent first. Built from Event day's own attention rules (so both screens agree), plus readiness
 * (Pack 16), the Lyst state (Pack 13) and the schedule. Each item names what, who, where, and links to the existing screen that fixes it.
 */
export function commandAttention(i: {
  snapshot: CommandSnapshot; boards: readonly FieldBoard[]; progress: readonly CompetitionProgress[]; clashes: readonly ScheduleClash[];
  conflicts: readonly { matchId: string; competitionName: string }[]; fields: readonly FieldSummary[]; withdrawn: ReadonlySet<string>;
  competitionNames: ReadonlyMap<string, string>; now: Date; links: CommandLinks;
}): CommandItem[] {
  const { snapshot: s, links: L } = i;
  const tz = s.event.timezone || 'America/Edmonton';
  const out: CommandItem[] = [];
  const fieldOf = new Map<string, string>();
  for (const b of i.boards) for (const m of [...b.now, ...b.onDeck, ...b.inTheHole, ...b.upcoming, ...b.waiting.map(w => w.match)]) fieldOf.set(m.id, b.name);

  // 1. result conflicts: decided on the field screen (head marshal) or Live ops (organizer)
  if (i.conflicts.length > 0) {
    const fields = [...new Set(i.conflicts.map(c => fieldOf.get(c.matchId)).filter(Boolean) as string[])];
    const first = fields[0];
    out.push({
      id: 'result-conflicts', urgency: 'now', what: `${plural(i.conflicts.length, 'result needs', 'results need')} a decision`,
      who: `Two devices disagreed in ${names([...new Set(i.conflicts.map(c => c.competitionName))])}. The official result has not changed.`,
      where: fields.length ? fields.join(', ') : null,
      action: 'Decide', href: L.organizer ? manageHref(L.slug, 'eventday') : first ? fieldHref(L.slug, first) : manageHref(L.slug, 'eventday')
    });
  }

  // 2. Event day's own match-structure rules (two active, withdrawn in a live fight, walkover, due but blocked, double booking, bracket needed)
  const base: AttentionItem[] = attentionItems({ boards: i.boards, progress: i.progress, clashes: i.clashes, gaps: [], resultConflicts: 0, withdrawn: i.withdrawn,
    competitionNames: i.competitionNames, timeZone: tz, now: i.now });
  for (const a of base) {
    const href = a.target.to === 'field' ? fieldHref(L.slug, a.target.field) : L.organizer ? manageHref(L.slug, 'run', a.target.to === 'run' && a.target.matchId ? `&match=${a.target.matchId}` : '')
      : (a.target.to === 'run' && a.target.matchId && fieldOf.get(a.target.matchId)) ? fieldHref(L.slug, fieldOf.get(a.target.matchId)!) : manageHref(L.slug, 'eventday');
    const where = a.target.to === 'run' && a.target.matchId ? fieldOf.get(a.target.matchId) ?? null : null;
    out.push({ id: `ed-${a.id}`, urgency: a.urgency, what: a.title, who: a.detail, where, action: L.organizer ? a.targetLabel : 'Open the field', href });
  }

  // 3. readiness of the people in the fights on now / called next (Pack 16, one rule; status words only)
  const liveIds = new Set(i.boards.flatMap(b => [...b.now, ...b.onDeck, ...b.inTheHole].map(m => m.id)));
  const inPlay = s.fightWarnings.filter(w => liveIds.has(w.matchId));
  if (inPlay.length > 0) {
    const people = [...new Map(inPlay.map(w => [w.fighterId, w])).values()];
    out.push({
      id: 'not-ready-in-play', urgency: 'now', what: `${plural(people.length, 'fighter', 'fighters')} called to fight but not ready`,
      who: names(people.map(w => `${w.name} (${(w.reasons[0] ?? 'not ready').toLowerCase()})`)),
      where: [...new Set(people.map(w => fieldOf.get(w.matchId)).filter(Boolean) as string[])].join(', ') || null,
      action: 'Open the desk', href: deskHref(L.slug, 'not_ready')
    });
  }
  const soon = s.fightWarnings.filter(w => !liveIds.has(w.matchId) && !inPlay.some(p => p.fighterId === w.fighterId));
  if (soon.length > 0) {
    const people = [...new Map(soon.map(w => [w.fighterId, w])).values()];
    out.push({
      id: 'not-ready-soon', urgency: 'soon', what: `${plural(people.length, 'fighter', 'fighters')} fighting within 90 minutes not ready`,
      who: names(people.map(w => `${w.name} (${(w.reasons[0] ?? 'not ready').toLowerCase()})`)), where: null, action: 'Open the desk', href: deskHref(L.slug, 'not_ready')
    });
  }
  const r = s.readiness;
  const notReadyNames = (pred: (f: NotReadyFighter) => boolean) => s.notReady.filter(pred).map(f => f.name);
  if (r.needsCorrection + r.failed > 0) {
    out.push({ id: 'armour-issues', urgency: 'soon', what: `${plural(r.needsCorrection + r.failed, 'fighter needs', 'fighters need')} armour fixed and reinspected`,
      who: names(notReadyNames(f => f.inspection === 'conditional' || f.inspection === 'failed')), where: 'Armour inspection', action: 'See armour issues', href: deskHref(L.slug, 'issues') });
  }
  if (r.arrived > 0) {
    out.push({ id: 'arrived-not-in', urgency: 'soon', what: `${plural(r.arrived, 'fighter has', 'fighters have')} arrived but not checked in`,
      who: names(notReadyNames(f => f.attendance === 'arrived')), where: 'Check-in desk', action: 'Check them in', href: deskHref(L.slug, 'arrived') });
  }
  if (r.missing > 0) {
    out.push({ id: 'missing', urgency: 'later', what: `${plural(r.missing, 'registered fighter is', 'registered fighters are')} not here yet`,
      who: names(notReadyNames(f => f.attendance === 'expected')), where: 'Check-in desk', action: 'See who', href: deskHref(L.slug, 'missing') });
  }
  if (r.needsInspection > 0) {
    out.push({ id: 'to-inspect', urgency: 'later', what: `${plural(r.needsInspection, 'fighter still needs', 'fighters still need')} armour inspection`, who: null, where: 'Armour inspection',
      action: 'See who', href: deskHref(L.slug, 'needs_inspection') });
  }
  if (r.adminBlocked > 0) {
    out.push({ id: 'admin', urgency: 'later', what: `${plural(r.adminBlocked, 'fighter has', 'fighters have')} insurance or fee not in order`, who: null, where: 'Check-in desk',
      action: 'See who', href: deskHref(L.slug, 'not_ready') });
  }
  if (r.pendingRegistrations > 0 && L.organizer) {
    out.push({ id: 'pending', urgency: 'later', what: `${plural(r.pendingRegistrations, 'registration is', 'registrations are')} waiting for review`, who: null, where: 'Registrations',
      action: 'Review', href: manageHref(L.slug, 'review') });
  }
  if (r.overrides > 0) {
    out.push({ id: 'overrides', urgency: 'info', what: `${plural(r.overrides, 'readiness override is', 'readiness overrides are')} in place`,
      who: names(s.overrides.map(o => (o.reason ? `${o.name} (${o.reason})` : o.name)), 2), where: 'Check-in desk', action: 'Review', href: deskHref(L.slug, 'all') });
  }

  // 4. the fields (Pack 13 / queue): a paused clock, a field behind schedule, a field waiting to call its next fight
  for (const f of i.fields) {
    if (f.state === 'paused' && f.current) {
      out.push({ id: `paused-${f.key}`, urgency: 'soon', what: `${f.name}: clock paused`, who: matchTitle(f.current), where: f.name, action: 'Open Lyst Control', href: fieldHref(L.slug, f.name) });
    }
    if (f.behindMinutes !== null) {
      const due = f.current ?? f.next;
      out.push({ id: `behind-${f.key}`, urgency: 'soon', what: `${f.name} is ${f.behindMinutes} min behind schedule`,
        who: due ? `${matchTitle(due)} was due ${timeLabel(due.scheduledAt!, tz)}` : null, where: f.name, action: 'Open the field', href: fieldHref(L.slug, f.name) });
    }
    if (f.state === 'idle' && f.next && !f.current && L.organizer) {
      out.push({ id: `idle-${f.key}`, urgency: 'soon', what: `${f.name} has no fight on`, who: `Next ready: ${matchTitle(f.next)}`, where: f.name,
        action: 'Call it in Live ops', href: manageHref(L.slug, 'eventday') });
    }
  }

  return out.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.id.localeCompare(b.id));
}

/** The header line: never a "health score", just what is actually open. */
export function overallState(items: readonly CommandItem[]): { tone: 'ok' | 'attention' | 'urgent'; headline: string } {
  const now = items.filter(i => i.urgency === 'now').length, act = items.filter(i => i.urgency !== 'info').length;
  if (act === 0) return { tone: 'ok', headline: 'All good: nothing needs you right now' };
  return { tone: now > 0 ? 'urgent' : 'attention', headline: `${plural(act, 'thing needs', 'things need')} attention${now ? ` (${now} now)` : ''}` };
}

/** The few lines worth showing at the very top: the most urgent items, by urgency then as listed, never the FYIs. */
export function glance(items: readonly CommandItem[], max = 3): { shown: CommandItem[]; more: number } {
  const act = items.filter(i => i.urgency !== 'info').slice().sort((x, y) => URGENCY_RANK[x.urgency] - URGENCY_RANK[y.urgency]);
  return { shown: act.slice(0, max), more: Math.max(0, act.length - max) };
}

/** Factual progress only: fights scored out of fights drawn, competitions by phase. No finish-time estimate (not defensible from this data). */
export function eventProgress(progress: readonly CompetitionProgress[]) {
  const total = progress.reduce((n, p) => n + p.total, 0), final = progress.reduce((n, p) => n + p.final, 0);
  return {
    total, final, remaining: total - final, percent: total ? Math.round((final / total) * 100) : 0,
    done: progress.filter(p => p.phase === 'all_scored').length,
    running: progress.filter(p => p.phase !== 'all_scored' && p.phase !== 'not_started' && p.phase !== 'no_draw').length,
    notStarted: progress.filter(p => p.phase === 'not_started').length,
    noDraw: progress.filter(p => p.phase === 'no_draw').length
  };
}

/** The fights an organizer cares about now: on, called, and the next few by running order. Not the bracket. */
export function fightsOverview(boards: readonly FieldBoard[], max = 6) {
  const tag = (m: CompetitionMatch, b: FieldBoard) => ({ match: m, field: b.name });
  const on = boards.flatMap(b => b.now.map(m => tag(m, b)));
  const called = boards.flatMap(b => [...b.onDeck, ...b.inTheHole].map(m => tag(m, b)));
  const later = boards.flatMap(b => b.upcoming.map((m, i) => ({ ...tag(m, b), i })))
    .sort((a, b) => (a.match.scheduledAt ?? '9').localeCompare(b.match.scheduledAt ?? '9') || a.i - b.i).slice(0, max).map(({ match, field }) => ({ match, field }));
  return { on, called, later };
}

/** Staff, in event-day order, with plain role names. "Assigned" only: BuhurtOS does not know who is physically present. */
export const ROLE_NAMES: Record<string, string> = {
  organizer: 'Organizers', head_marshal: 'Head marshal', marshal: 'Marshals', scorekeeper: 'Scorekeepers', check_in: 'Check-in desk', inspector: 'Armour inspectors', medic: 'Medics'
};
export const KEY_ROLES = ['head_marshal', 'scorekeeper', 'check_in', 'inspector', 'medic'] as const;
/** Key event-day roles nobody is assigned to (a fact, not a guess about presence). */
export function unassignedRoles(staff: readonly { role: string; names: string[] }[]): string[] {
  const have = new Set(staff.filter(s => s.names.length > 0).map(s => s.role));
  return KEY_ROLES.filter(r => !have.has(r));
}

export const sameField = (a: string | null | undefined, b: string | null | undefined) => fieldKey(a) === fieldKey(b);

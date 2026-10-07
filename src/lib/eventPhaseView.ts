/**
 * Pack 25: the public event page and Event Control are PHASE AWARE. One pure decision, reused by both, from facts the event already carries:
 *   draft      not published yet (staff only)
 *   upcoming   published, before its first day
 *   live       published, today is one of its days (in the event's own time zone), not closed
 *   completed  closed by the organizer, or past its last day
 * The phase decides what leads the page (registration, the fields, the results) and which Event Control mode opens first (set up, live ops, results).
 * It never changes data: an organizer can still open any mode or tool.
 */
export type EventPhase = 'draft' | 'upcoming' | 'live' | 'completed';
export type PublicView = 'overview' | 'live' | 'results';
export type ControlMode = 'setup' | 'live' | 'results';

export interface PhaseFacts {
  status: 'draft' | 'published' | 'cancelled';
  startsOn: string; endsOn: string;
  /** The event's own time zone (IANA). The venue's clock decides "today", not the phone's. */
  timezone?: string | null;
  closedAt?: string | null;
  archivedAt?: string | null;
}

/** "2026-10-07" in a time zone, for the instant given. An unknown zone falls back to the device's calendar day. */
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
}

export function eventPhaseOf(e: PhaseFacts, now: Date = new Date()): EventPhase {
  if (e.closedAt || e.archivedAt) return 'completed';
  const today = todayIn(e.timezone, now);
  if (today > e.endsOn) return 'completed';
  if (e.status !== 'published') return 'draft';
  if (today < e.startsOn) return 'upcoming';
  return 'live';
}

/** The destination a visitor lands on: live fights while the event runs, results afterwards, the overview before. */
export const defaultViewFor = (phase: EventPhase): PublicView => (phase === 'live' ? 'live' : phase === 'completed' ? 'results' : 'overview');
/** Event Control opens on the mode the day needs: set up before the event, live ops while it runs, results after. */
export const defaultModeFor = (phase: EventPhase): ControlMode => (phase === 'live' ? 'live' : phase === 'completed' ? 'results' : 'setup');

export const PHASE_WORD: Record<EventPhase, string> = { draft: 'Draft', upcoming: 'Upcoming', live: 'Live', completed: 'Complete' };
export const PHASE_TONE: Record<EventPhase, 'brass' | 'steel' | 'live' | 'win'> = { draft: 'brass', upcoming: 'steel', live: 'live', completed: 'win' };

export const VIEW_WORD: Record<PublicView, string> = { overview: 'Overview', live: 'Live', results: 'Results' };
export const MODE_WORD: Record<ControlMode, string> = { setup: 'Set up', live: 'Live ops', results: 'Results' };

export const isPublicView = (v: unknown): v is PublicView => v === 'overview' || v === 'live' || v === 'results';
export const isControlMode = (v: unknown): v is ControlMode => v === 'setup' || v === 'live' || v === 'results';

/** The address of a public view: the overview is the bare event address; Live and Results have their own. */
export const viewPath = (slug: string, view: PublicView): string => (view === 'overview' ? `/events/${slug}` : `/events/${slug}/${view}`);
export const controlPath = (slug: string, mode?: ControlMode, tool?: string): string => {
  const q = new URLSearchParams();
  if (mode) q.set('mode', mode);
  if (tool) q.set('tool', tool);
  const s = q.toString();
  return `/events/${slug}/control${s ? `?${s}` : ''}`;
};

/**
 * Where the old Manage tabs and the Command Centre live now (legacy addresses keep working through a redirect).
 * Each old tab is a mode (its screen within Event Control) and, where the old screen is still a tool, that tool.
 */
export function legacyManageTarget(tab: string | null): { mode: ControlMode; tool?: string } {
  switch (tab) {
    case 'eventday': case 'command': return { mode: 'live' };
    case 'finalize': return { mode: 'results' };
    case 'review': return { mode: 'setup', tool: 'registrations' };
    case 'fighters': return { mode: 'setup', tool: 'entrants' };
    case 'checkin': return { mode: 'live', tool: 'checkin' };
    case 'run': return { mode: 'setup', tool: 'run' };
    case 'build': return { mode: 'setup', tool: 'build' };
    case 'competitions': return { mode: 'setup', tool: 'competitions' };
    case 'setup': return { mode: 'setup', tool: 'settings' };
    case 'people': return { mode: 'setup', tool: 'staff' };
    case 'teams': return { mode: 'setup', tool: 'teams' };
    case 'broadcast': return { mode: 'setup', tool: 'broadcast' };
    default: return { mode: 'setup' };
  }
}

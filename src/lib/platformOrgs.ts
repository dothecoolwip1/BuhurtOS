import type { AdminOrganization } from '../data/organizations';

/** Pure helpers for the platform organization screens: view model and the enable/disable state machine. No UI authority lives here. */

export interface OrgCount { key: string; label: string; value: number }
export interface OrgAdminRow {
  id: string; slug: string; title: string; shortLabel: string | null; enabled: boolean;
  statusLabel: 'Active' | 'Disabled'; statusTone: 'win' | ''; counts: OrgCount[]; adminsCount: number;
}
/** Full name is the title; the short name is shown beside it only when it adds something. */
export function toOrgAdminRow(o: AdminOrganization): OrgAdminRow {
  return {
    id: o.id, slug: o.slug, title: o.name, shortLabel: o.shortName && o.shortName !== o.name ? o.shortName : null, enabled: o.enabled,
    statusLabel: o.enabled ? 'Active' : 'Disabled', statusTone: o.enabled ? 'win' : '',
    counts: [
      { key: 'teams', label: 'Teams', value: o.teamsCount },
      { key: 'fighters', label: 'Fighters', value: o.fightersCount },
      { key: 'completed', label: 'Completed events', value: o.eventsCompleted },
      { key: 'current', label: 'Current events', value: o.eventsCurrent },
      { key: 'upcoming', label: 'Upcoming events', value: o.eventsUpcoming },
      { key: 'admins', label: 'Admins', value: o.adminsCount }
    ],
    adminsCount: o.adminsCount
  };
}

export const DISABLE_NOTICE = 'This will disable normal organization access while preserving teams, fighters, tournament history, rankings, statistics, and records.';
export const disableTitle = (name: string) => `Disable ${name}?`;

// ---------------------------------------------------------------- toggle state machine (one per organization row)
export type ToggleState =
  | { phase: 'idle' }
  | { phase: 'confirm-disable'; reason: string }
  | { phase: 'pending'; target: boolean; reason: string | null }
  | { phase: 'failed'; target: boolean; message: string };
export type ToggleAction =
  | { type: 'request'; enabled: boolean }          // the person flipped the switch; `enabled` is what the SERVER says right now
  | { type: 'reason'; reason: string }
  | { type: 'cancel' }
  | { type: 'confirm'; reason: string | null }     // reason already cleaned (see cleanReason)
  | { type: 'done' }                               // the RPC returned; the caller re-fetches from the server
  | { type: 'fail'; message: string }
  | { type: 'dismiss' };
export const TOGGLE_IDLE: ToggleState = { phase: 'idle' };

/**
 * Switching off asks first; switching on is one tap. Nothing is optimistic: the switch always shows the server value, and while a call is
 * pending (or a dialog is open) further requests are ignored so two taps cannot race.
 */
export function toggleReducer(state: ToggleState, a: ToggleAction): ToggleState {
  switch (a.type) {
    case 'request':
      if (state.phase === 'pending' || state.phase === 'confirm-disable') return state;
      return a.enabled ? { phase: 'confirm-disable', reason: '' } : { phase: 'pending', target: true, reason: null };
    case 'reason': return state.phase === 'confirm-disable' ? { phase: 'confirm-disable', reason: a.reason } : state;
    case 'cancel': return state.phase === 'confirm-disable' ? TOGGLE_IDLE : state;
    case 'confirm': return state.phase === 'confirm-disable' ? { phase: 'pending', target: false, reason: a.reason } : state;
    case 'done': return state.phase === 'pending' ? TOGGLE_IDLE : state;
    case 'fail': return state.phase === 'pending' ? { phase: 'failed', target: state.target, message: a.message } : state;
    case 'dismiss': return state.phase === 'failed' ? TOGGLE_IDLE : state;
  }
}
export const toggleBusy = (s: ToggleState) => s.phase === 'pending';
/** The switch shows what the server last said, never what the person asked for. */
export const switchChecked = (serverEnabled: boolean, _s: ToggleState) => serverEnabled;
export const pendingText = (s: ToggleState): string | null => (s.phase === 'pending' ? (s.target ? 'Enabling…' : 'Disabling…') : null);

// ---------------------------------------------------------------- public organization page
export interface OrgEventInput { id: string; slug: string; name: string; startsOn: string; endsOn: string; status: string; city: string | null; region: string | null }
export interface OrgEventsView { upcoming: OrgEventInput[]; past: OrgEventInput[] }
/**
 * Splits events at today (calendar dates, UTC like the database). Cancelled and draft events never appear. A disabled organization has no
 * upcoming list at all: only history is shown, and an event that is still running is not presented as operating either.
 */
export function splitOrgEvents(events: OrgEventInput[], today: string, orgEnabled: boolean): OrgEventsView {
  const shown = events.filter(e => e.status === 'published');
  const past = shown.filter(e => e.endsOn < today).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  if (!orgEnabled) return { upcoming: [], past };
  const upcoming = shown.filter(e => e.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return { upcoming, past };
}
/** Fighters from a team roster and from memberships, counted once each. */
export const countDistinct = (...lists: string[][]): number => new Set(lists.flat()).size;
export const rankingsPath = (slug: string) => `/rankings?org=${encodeURIComponent(slug)}`;
export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

/** Where is the person on the platform pages? Pure so a test can pin the "never leak" rule. */
export type PlatformGate = 'loading' | 'owner' | 'denied';
export function platformGate(authLoading: boolean, signedIn: boolean, roleLoading: boolean, isOwner: boolean): PlatformGate {
  if (authLoading || (signedIn && roleLoading)) return 'loading';
  return signedIn && isOwner ? 'owner' : 'denied';
}

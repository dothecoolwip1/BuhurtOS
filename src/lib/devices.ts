/**
 * Pack 18.1: temporary event devices, in words (pure, so what an organizer reads and prints is tested). The database decides who may do anything;
 * this only names things, orders the list and builds the link a QR carries.
 *
 * A code is a credential. Nothing in this file stores one, logs one or puts one anywhere but the URL FRAGMENT of the sign-in link.
 */

export type DeviceRole = 'counter' | 'scorekeeper' | 'marshal' | 'announcer' | 'temporary_organizer';
export type CredentialRole = DeviceRole | 'broadcast_controller';
export type CredentialStatus = 'active' | 'expired' | 'revoked';
export type CredentialKind = 'device' | 'controller';

export interface Credential {
  id: string; kind: CredentialKind; label: string; role: CredentialRole | string; status: CredentialStatus;
  used: boolean; expiresAt: string | null; createdAt: string; lastSigninAt: string | null; lastSeenAt: string | null;
  signedInElsewhereAt: string | null; revokedAt: string | null; replaced: boolean;
}

// ---------------------------------------------------------------- words
export const ROLE_WORDS: Record<CredentialRole, string> = {
  counter: 'Counter', scorekeeper: 'Secretary / Scorekeeper', marshal: 'Marshal', announcer: 'Announcer',
  temporary_organizer: 'Event Admin / Temporary Organizer', broadcast_controller: 'Stream controller'
};
export const roleWord = (role: string): string => (ROLE_WORDS as Record<string, string>)[role] ?? role;

/** What each device role can do, in a line (shown while choosing). */
export const ROLE_HINTS: Record<DeviceRole, string> = {
  counter: 'Counts hits for one fight on the Lyst tablet.',
  scorekeeper: 'Scores fights, adjusts the running order, announces, reads the Command Centre.',
  marshal: 'Scores fights on a field. Can cut the cameras.',
  announcer: 'Sees who is ready. Can cut the cameras.',
  temporary_organizer: 'Runs the day for you: results, check-in, announcements, broadcast. Cannot manage devices or event settings.'
};
export const DEVICE_ROLES: DeviceRole[] = ['counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer'];

export const STATUS_WORDS: Record<CredentialStatus, string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
export const statusWord = (s: string): string => (STATUS_WORDS as Record<string, string>)[s] ?? s;

export const LABEL_MAX = 40;

// ---------------------------------------------------------------- the usual set for an event
export const USUAL_SET: { label: string; role: DeviceRole }[] = [
  { label: 'Counter Phone 1', role: 'counter' }, { label: 'Counter Phone 2', role: 'counter' },
  { label: 'Counter Phone 3', role: 'counter' }, { label: 'Counter Phone 4', role: 'counter' },
  { label: 'Secretary Tablet', role: 'scorekeeper' }, { label: 'Marshal Phone', role: 'marshal' },
  { label: 'Announcer Tablet', role: 'announcer' }, { label: 'Event Admin Tablet', role: 'temporary_organizer' }
];
export const CONTROLLER_LABEL = 'Stream laptop';

/** The usual set minus the names this event already has in use (case-insensitive: the database refuses duplicates among non-revoked codes). */
export function usualSetToCreate(existing: readonly Pick<Credential, 'label' | 'status'>[]): { toCreate: typeof USUAL_SET; skipped: string[] } {
  const taken = new Set(existing.filter(c => c.status !== 'revoked').map(c => c.label.trim().toLowerCase()));
  const toCreate = USUAL_SET.filter(d => !taken.has(d.label.toLowerCase()));
  return { toCreate, skipped: USUAL_SET.filter(d => taken.has(d.label.toLowerCase())).map(d => d.label) };
}

// ---------------------------------------------------------------- the code
/** `k7q2 m9xd-4trh` -> `K7Q2M9XD4TRH` (same rule as the sign-in function: dashes and spaces ignored, O reads 0, I and L read 1). Null when it cannot be a code. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(c) ? c : null;
}
/** `K7Q2M9XD4TRH` -> `K7Q2-M9XD-4TRH` */
export function groupCode(code: string): string {
  const c = normalizeCode(code);
  return c ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}` : code;
}
/**
 * The link a QR carries. The code is in the URL FRAGMENT only: a fragment is never sent to a server, a proxy or an analytics call, and the sign-in
 * page removes it from the address bar before anything else runs. `base` is Vite's BASE_URL ('/' or '/app/').
 */
export function deviceQrUrl(origin: string, base: string, code: string): string {
  const c = normalizeCode(code);
  if (!c) throw new Error('not a device code');
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${b.startsWith('/') ? b : `/${b}`}device#c=${c}`;
}

// ---------------------------------------------------------------- times (always the event's own time zone: "Monday 00:00" must mean the same to everybody)
const fmt = (iso: string | null, tz: string, o: Intl.DateTimeFormatOptions): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(d); } catch { return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...o }).format(d); }
};
/** "Access ends Mon 00:00 MDT" (the event's time zone; null when there is no end). */
export function accessEndsLabel(expiresAt: string | null, tz: string): string | null {
  const day = fmt(expiresAt, tz, { weekday: 'short' });
  const time = fmt(expiresAt, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const zone = fmt(expiresAt, tz, { timeZoneName: 'short' })?.split(' ').pop();
  return day && time ? `Access ends ${day} ${time}${zone ? ` ${zone}` : ''}` : null;
}
/** "Signed in on another device at 14:05": the time in the event's time zone. */
export function signedInElsewhereLabel(at: string | null, tz: string): string | null {
  const t = fmt(at, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return t ? `Signed in on another device at ${t}` : null;
}
/** "Last seen 3 min ago" / "Never signed in". Uses the device clock only for a rough age. */
export function lastSeenLabel(c: Pick<Credential, 'lastSeenAt' | 'lastSigninAt' | 'used'>, nowMs: number): string {
  const at = c.lastSeenAt ?? c.lastSigninAt;
  if (!at) return c.used ? 'Signed in before' : 'Not signed in yet';
  const s = Math.max(0, Math.round((nowMs - Date.parse(at)) / 1000));
  if (!Number.isFinite(s)) return 'Not signed in yet';
  if (s < 20) return 'Last seen just now';
  if (s < 90) return `Last seen ${s} s ago`;
  if (s < 3600) return `Last seen ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Last seen ${Math.round(s / 3600)} h ago`;
  return `Last seen ${Math.round(s / 86400)} d ago`;
}

// ---------------------------------------------------------------- the list
const ROLE_ORDER: Record<string, number> = { counter: 0, scorekeeper: 1, marshal: 2, announcer: 3, temporary_organizer: 4, broadcast_controller: 5 };
const STATUS_ORDER: Record<string, number> = { active: 0, expired: 1, revoked: 2 };
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
/** Active first, then by role (counters, secretary, marshal, announcer, event admin), then by name with numbers in order (Phone 2 before Phone 10). */
export function sortCredentials<T extends Pick<Credential, 'status' | 'role' | 'label' | 'revokedAt' | 'createdAt'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
    natural(a.label, b.label) ||
    b.createdAt.localeCompare(a.createdAt));
}
/** Temporary devices (people-sized screens) and the one stream controller, each sorted; revoked and expired ones kept apart so the live list stays short. */
export function splitCredentials(rows: readonly Credential[]) {
  const sorted = sortCredentials(rows);
  const devices = sorted.filter(c => c.kind === 'device');
  const controllers = sorted.filter(c => c.kind === 'controller');
  return {
    devices: devices.filter(c => c.status === 'active'),
    pastDevices: devices.filter(c => c.status !== 'active'),
    controller: controllers.find(c => c.status === 'active') ?? null,
    pastControllers: controllers.filter(c => c.status !== 'active')
  };
}
export const isActive = (c: Pick<Credential, 'status'>): boolean => c.status === 'active';

// ---------------------------------------------------------------- staff roles (names only list; the database refuses what a viewer may not grant)
export const STAFF_ROLE_WORDS: Record<string, string> = {
  organizer: 'Organizer', head_marshal: 'Head marshal', marshal: 'Marshal', scorekeeper: 'Secretary / Scorekeeper', announcer: 'Announcer',
  medic: 'Medic', check_in: 'Check-in desk', inspector: 'Armour inspector'
};
export const staffRoleWord = (r: string): string => STAFF_ROLE_WORDS[r] ?? r;
/** The roles a viewer may hand out: a Temporary Organizer may add every role except Organizer; only a permanent organizer adds an organizer. */
export function staffRoleChoices(viewerIsOrganizer: boolean): string[] {
  const all = ['head_marshal', 'marshal', 'scorekeeper', 'announcer', 'medic', 'check_in', 'inspector'];
  return viewerIsOrganizer ? ['organizer', ...all] : all;
}

/** The browser key the device sign-in page keeps its session under (Pack 18.1 contract section 5). Only used to tell "a device is signed in" from "nobody is". */
export const DEVICE_SESSION_KEY = 'bos-device-session';
export function hasDeviceSession(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    const raw = storage?.getItem(DEVICE_SESSION_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as { secret?: unknown; access_token?: unknown } | null;
    return !!v && typeof v === 'object' && typeof v.secret === 'string' && typeof v.access_token === 'string';
  } catch { return false; }
}

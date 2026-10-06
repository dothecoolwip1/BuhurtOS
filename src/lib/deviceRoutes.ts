/**
 * What a temporary event device is, what it is called on screen, where it lands after sign-in and which pages it may open (Pack 18.1).
 * Pure tables and helpers, tested. The route guard only decides what to OFFER: the database refuses everything a device may not do.
 */
export type DeviceRole = 'counter' | 'scorekeeper' | 'marshal' | 'announcer' | 'temporary_organizer';

/** The words people read on a device. The role keys are database terms; these are sporting terms. */
export const ROLE_LABEL: Record<DeviceRole, string> = {
  counter: 'Counter',
  scorekeeper: 'Secretary / Scorekeeper',
  marshal: 'Marshal',
  announcer: 'Announcer',
  temporary_organizer: 'Event Admin / Temporary Organizer'
};

export const isDeviceRole = (r: unknown): r is DeviceRole => typeof r === 'string' && r in ROLE_LABEL;
export const roleLabel = (role: string): string => (isDeviceRole(role) ? ROLE_LABEL[role] : role.replace(/_/g, ' '));

/** Who may press Camera Off (the control itself asks the database and shows only what that person may do). */
export const canActivateCameraOff = (role: string): boolean => role === 'scorekeeper' || role === 'marshal' || role === 'announcer' || role === 'temporary_organizer';

/**
 * Staff roles this device counts as, for DISPLAY only (the database decides every action): a Temporary Organizer is a head marshal, marshal and
 * scorekeeper at once, and also an "operator" (organizer-level powers on this event only). It is never an organizer.
 */
export function effectiveRolesFor(role: string): string[] {
  switch (role) {
    case 'scorekeeper': return ['scorekeeper'];
    case 'marshal': return ['marshal'];
    case 'announcer': return ['announcer'];
    case 'temporary_organizer': return ['head_marshal', 'marshal', 'scorekeeper'];
    default: return [];
  }
}
export const isOperatorRole = (role: string): boolean => role === 'temporary_organizer';

export interface RouteSubject { role: string; slug: string }

/** Where a device lands after sign-in, on `/`, and whenever it opens a page it may not use. */
export function landingFor({ role, slug }: RouteSubject): string {
  const e = `/events/${encodeURIComponent(slug)}`;
  switch (role) {
    case 'counter': return '/lyst/counter';
    case 'scorekeeper': return `${e}/command`;
    case 'temporary_organizer': return `${e}/command`;
    case 'announcer': return `${e}/announcer`;
    default: return e;   // marshal: the field picker (DeviceHome)
  }
}

const strip = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The pages anyone may read, devices included: the event's public page, the venue display, rules and privacy. */
function isPublicPath(path: string): boolean {
  return path === '/rules' || path === '/privacy' || /^\/events\/[^/]+\/arena(\/[^/]+)?$/.test(path);
}

/** May this device open this path? `slug` is the device's own event: its tools never open for another event. */
export function pathAllowed({ role, slug }: RouteSubject, rawPath: string): boolean {
  const path = strip(rawPath);
  if (isPublicPath(path)) return true;
  const own = `/events/${encodeURIComponent(slug)}`;
  const decoded = `/events/${slug}`;
  const under = (base: string, rest: string) => path === `${base}${rest}` || path === `${decoded}${rest}`;
  const underPrefix = (rest: string) => path.startsWith(`${own}${rest}/`) || path.startsWith(`${decoded}${rest}/`);
  if (under(own, '')) return role !== 'counter';                     // the event's home for this device (field picker); a counter has none
  switch (role) {
    case 'counter': return path === '/lyst/counter' || path === '/lyst/join' || /^\/lyst\/join\/[^/]+$/.test(path);
    case 'scorekeeper': return under(own, '/command') || underPrefix('/field');
    case 'marshal': return underPrefix('/field');
    case 'announcer': return under(own, '/announcer');
    case 'temporary_organizer': return under(own, '/command') || under(own, '/checkin') || underPrefix('/field');
    default: return false;
  }
}

/** The path to show: the page itself when allowed, else the device's landing page. */
export const guardPath = (s: RouteSubject, path: string): string => (pathAllowed(s, path) ? path : landingFor(s));

/**
 * "Access ends Mon 00:00 MDT": the time the device stops working, in the EVENT's time zone (the venue's clock, not the phone's).
 * The date is added when it is more than five days away.
 */
export function accessEndsLabel(expiresAtIso: string, timeZone: string, now: number = Date.now()): string {
  const at = Date.parse(expiresAtIso);
  if (!Number.isFinite(at)) return 'Access end time unknown';
  const parts = (tz: string) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(at))) o[p.type] = p.value;
    return o;
  };
  let o: Record<string, string>;
  try { o = parts(timeZone); } catch { o = parts('UTC'); }
  const far = at - now > 5 * 86_400_000;
  const when = `${o.weekday}${far ? ` ${o.month} ${o.day}` : ''} ${o.hour}:${o.minute}`;
  return `Access ends ${when}${o.timeZoneName ? ` ${o.timeZoneName}` : ''}`;
}

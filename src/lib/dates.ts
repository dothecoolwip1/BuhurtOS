/** Dates in the database are plain calendar dates (no time zone), so they are formatted as UTC to avoid off-by-one days. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };

export function dateBox(startsOn: string) {
  const { y, m, d } = parts(startsOn);
  return { month: MONTHS[m - 1], day: String(d).padStart(2, '0'), year: String(y) };
}

/** "Nov 14-15, 2026", "Nov 30 - Dec 1, 2026" or "Nov 14, 2026". */
export function dateRange(startsOn: string, endsOn: string): string {
  const a = parts(startsOn), b = parts(endsOn);
  if (startsOn === endsOn) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d}-${b.d}, ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} - ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
  return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} - ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}

export type RegistrationWindow = 'not_open' | 'open' | 'closed';
export function registrationWindow(opensAt: string | null, closesAt: string | null, now = new Date()): RegistrationWindow {
  if (opensAt && now < new Date(opensAt)) return 'not_open';
  if (closesAt && now >= new Date(closesAt)) return 'closed';
  return 'open';
}

/** Offset of a time zone from UTC, in minutes, at a given instant (negative for Mountain time). */
function zoneOffsetMinutes(ts: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ts / 60000) * 60000) / 60000;
}

/** "2026-11-08T23:59" typed in the event's time zone -> the exact instant, as an ISO string in UTC. */
export function localToIso(local: string, timeZone = 'America/Edmonton'): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = guess - zoneOffsetMinutes(guess, timeZone) * 60000;
  ts = guess - zoneOffsetMinutes(ts, timeZone) * 60000; // second pass settles daylight-saving edges
  return new Date(ts).toISOString();
}

/** An instant -> "2026-11-08T23:59" as a person in that time zone would type it. */
export function isoToLocal(iso: string | null, timeZone = 'America/Edmonton'): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  return new Date(ts + zoneOffsetMinutes(ts, timeZone) * 60000).toISOString().slice(0, 16);
}

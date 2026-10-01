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

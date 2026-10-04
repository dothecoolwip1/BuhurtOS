/** The calendar days of an event, from its own first and last day. Dates are plain ISO days, formatted as UTC so no day shifts. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** "Saturday, Dec 5" for an ISO day; the raw value when it is not a day. */
export function dayLabel(iso: string): string {
  const d = utc(iso);
  if (!d) return iso;
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Every day from the first to the last, in order (at most 14, so a wrong date range cannot produce hundreds of boxes). */
export function eventDays(startsOn: string, endsOn: string): Array<{ iso: string; label: string }> {
  const a = utc(startsOn);
  const b = utc(endsOn) ?? a;
  if (!a || !b) return [];
  const out: Array<{ iso: string; label: string }> = [];
  for (let d = new Date(a); d <= b && out.length < 14; d.setUTCDate(d.getUTCDate() + 1)) out.push({ iso: toIso(d), label: dayLabel(toIso(d)) });
  return out;
}

/** What a registrant said about attendance: event days first, then the legacy sat/sun answer, else "not given". */
export function attendanceText(attendDates: readonly string[] | null | undefined, legacyDays: readonly string[] | null | undefined): string {
  if (attendDates && attendDates.length) return attendDates.map(dayLabel).join(' and ');
  if (legacyDays && legacyDays.length) return legacyDays.map(d => (d === 'sat' ? 'Saturday' : d === 'sun' ? 'Sunday' : d)).join(' and ');
  return 'not given';
}

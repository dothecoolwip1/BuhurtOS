/**
 * Pack 22: suspension end dates are whole days in UTC, the same way the database compares them with an event's days (`ends_at::date`) and labels
 * them (`to_char(ends_at at time zone 'UTC', ...)`). Using the browser's local time instead moved "until 12 October" to the 13th in North America
 * and pushed it one more day on every edit.
 */
export const endOfDayUtc = (day: string): string => `${day}T23:59:59Z`;
export const dayOfUtc = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
export const showDayUtc = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;

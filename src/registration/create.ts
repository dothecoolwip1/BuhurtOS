/** Pure helpers for the "new event" and "new team" forms. Rules mirror the database checks, which stay the authority. */

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Turns a name into a URL slug: lowercase letters and digits joined by single hyphens. */
export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function slugError(slug: string): string | null {
  if (!slug) return 'Enter a web address name.';
  if (!SLUG_PATTERN.test(slug)) return 'Use lowercase letters, numbers and single hyphens, with no hyphen at the start or end.';
  if (slug.length > 60) return 'Keep it to 60 characters or fewer.';
  return null;
}

export interface NewEventForm { name: string; slug: string; startsOn: string; endsOn: string; venue: string; address: string }
export interface NewTeamForm { name: string; slug: string; city: string; region: string; country: string }
export type Errors = Record<string, string>;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function validateNewEvent(f: NewEventForm): Errors {
  const e: Errors = {};
  const n = f.name.trim();
  if (n.length < 3 || n.length > 120) e.name = 'The event name needs 3 to 120 characters.';
  const s = slugError(f.slug); if (s) e.slug = s;
  if (!isDate(f.startsOn)) e.startsOn = 'Choose the first day.';
  if (!isDate(f.endsOn)) e.endsOn = 'Choose the last day.';
  else if (isDate(f.startsOn) && f.endsOn < f.startsOn) e.endsOn = 'The last day cannot be before the first day.';
  return e;
}

export function validateNewTeam(f: NewTeamForm): Errors {
  const e: Errors = {};
  const n = f.name.trim();
  if (n.length < 2 || n.length > 80) e.name = 'The team name needs 2 to 80 characters.';
  const s = slugError(f.slug); if (s) e.slug = s;
  return e;
}

/** Blank optional text becomes null so the database stores "none", not an empty string. */
export const blankToNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

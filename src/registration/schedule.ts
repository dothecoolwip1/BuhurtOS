/**
 * Event-day times as the organizer wrote them. Events store only free text (time_note and the description), so this
 * lifts out the sentences that contain a clock time and shows them verbatim. It never builds a time that is not in the text.
 */
export interface ScheduleEntry { day: string; text: string; times: string[] }

const TIME = /\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s?(?:a\.m\.|p\.m\.|am|pm)(?![a-z])|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gi;
const WEEKDAY = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseSchedule(...sources: (string | null | undefined)[]): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    // Split on sentence ends and line breaks, but not on the dots inside "a.m." or "10:30".
    const parts = src.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
    for (const raw of parts) {
      const times = raw.match(TIME);
      if (!times) continue;
      const text = raw.replace(/\.$/, '');
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const wd = WEEKDAY.exec(text);
      const day = wd ? cap(wd[1].toLowerCase()) : /\b(both|each|every) days?\b/i.test(text) ? 'Both days' : 'Event days';
      out.push({ day, text, times: [...times] });
    }
  }
  return out;
}

/** Groups entries by their day label, keeping the order they first appear in. */
export function groupByDay(entries: ScheduleEntry[]): { day: string; entries: ScheduleEntry[] }[] {
  const map = new Map<string, ScheduleEntry[]>();
  for (const e of entries) map.set(e.day, [...(map.get(e.day) ?? []), e]);
  return [...map].map(([day, list]) => ({ day, entries: list }));
}

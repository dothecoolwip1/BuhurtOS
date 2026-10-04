/** Pure helpers for "My events": why an event is there, which group it belongs to, and the order inside each group. */

export interface MyEvent {
  id: string; slug: string; name: string; status: 'draft' | 'published' | 'cancelled'; eventType: string;
  startsOn: string; endsOn: string; city: string | null; region: string | null; venue: string | null; registrationMode: string;
  synthetic: boolean; staffRoles: string[];
  registration: { id: string; status: string; feeDueCents: number; feePaid: boolean; insurance: string; isVolunteer: boolean; checkedIn: boolean } | null;
  fighterEntry: boolean; captainEntry: boolean; pendingRegistrations: number | null;
}

export type MyEventGroup = 'now' | 'upcoming' | 'drafts' | 'past';

const ROLE_LABEL: Record<string, string> = { organizer: 'Organizer', head_marshal: 'Head marshal', marshal: 'Marshal', scorekeeper: 'Scorekeeper', medic: 'Medic' };
const REG_LABEL: Record<string, string> = { pending: 'Registration waiting for review', accepted: 'Registration accepted', declined: 'Registration declined', withdrawn: 'Registration withdrawn' };

export interface Why { label: string; tone: '' | 'brass' | 'win' | 'steel' | 'live' }

/** Every reason the event is on the list, roles first, then the person's own registration, then entries. One event, all reasons. */
export function whyLabels(e: MyEvent): Why[] {
  const out: Why[] = [];
  for (const r of e.staffRoles) out.push({ label: ROLE_LABEL[r] ?? r, tone: 'steel' });
  if (e.registration) {
    const s = e.registration.status;
    out.push({ label: (e.registration.isVolunteer ? 'Volunteer · ' : '') + (REG_LABEL[s] ?? s), tone: s === 'accepted' ? 'win' : s === 'pending' ? 'brass' : '' });
  }
  if (e.fighterEntry) out.push({ label: 'You are entered', tone: 'win' });
  if (e.captainEntry) out.push({ label: 'Your team is entered', tone: 'steel' });
  return out;
}

/** What the person still has to do, from facts the database holds (nothing is guessed). */
export function outstanding(e: MyEvent): string[] {
  const r = e.registration;
  if (!r || r.status !== 'accepted') return [];
  const out: string[] = [];
  if (r.feeDueCents > 0 && !r.feePaid) out.push('Fee not marked paid');
  if (r.insurance === 'proof_pending') out.push('Insurance proof not received');
  if (r.insurance === 'needs_cover') out.push('Insurance cover not arranged');
  return out;
}

export function groupOf(e: MyEvent, today: string): MyEventGroup {
  if (e.status === 'draft') return 'drafts';
  if (e.endsOn < today) return 'past';
  if (e.startsOn <= today) return 'now';
  return 'upcoming';
}

/** now, upcoming and drafts soonest first; past newest first. Ties by name so the order never depends on the database. */
export function groupMyEvents(events: readonly MyEvent[], today: string): Record<MyEventGroup, MyEvent[]> {
  const g: Record<MyEventGroup, MyEvent[]> = { now: [], upcoming: [], drafts: [], past: [] };
  for (const e of events) g[groupOf(e, today)].push(e);
  const soonest = (a: MyEvent, b: MyEvent) => a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name);
  g.now.sort(soonest); g.upcoming.sort(soonest); g.drafts.sort(soonest);
  g.past.sort((a, b) => b.startsOn.localeCompare(a.startsOn) || a.name.localeCompare(b.name));
  return g;
}

/** Search by name, place or venue; test events only when asked for. */
export function filterMyEvents(events: readonly MyEvent[], query: string, showTest: boolean): MyEvent[] {
  const q = query.trim().toLowerCase();
  return events.filter(e => (showTest || !e.synthetic) && (!q || [e.name, e.city, e.region, e.venue].some(x => x?.toLowerCase().includes(q))));
}

export const GROUP_TITLE: Record<MyEventGroup, string> = { now: 'Happening now', upcoming: 'Coming up', drafts: 'Drafts', past: 'Past' };

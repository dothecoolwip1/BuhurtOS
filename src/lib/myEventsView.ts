/** Pure helpers for "My events" cards: why an event is there and what the person still has to do. Search, filters, grouping and order are
 *  the shared event rules in eventFilters.ts (the same for Events, Calendar and My events). */

export interface MyEvent {
  id: string; slug: string; name: string; status: 'draft' | 'published' | 'cancelled'; eventType: string;
  startsOn: string; endsOn: string; city: string | null; region: string | null; venue: string | null; registrationMode: string;
  synthetic: boolean; staffRoles: string[];
  registration: { id: string; status: string; feeDueCents: number; feePaid: boolean; insurance: string; isVolunteer: boolean; checkedIn: boolean } | null;
  fighterEntry: boolean; captainEntry: boolean; pendingRegistrations: number | null;
  /** An organizer added this person and they have not registered yet (Pack 07 invitation). */
  invited: boolean;
}

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
  if (e.invited) out.push({ label: 'Added by organizer', tone: 'brass' });
  return out;
}

/** What the person still has to do, from facts the database holds (nothing is guessed). */
export function outstanding(e: MyEvent): string[] {
  const r = e.registration;
  if (e.invited && (!r || r.status === 'withdrawn' || r.status === 'declined')) return ['Complete your registration, or withdraw'];
  if (!r || r.status !== 'accepted') return [];
  const out: string[] = [];
  if (r.feeDueCents > 0 && !r.feePaid) out.push('Fee not marked paid');
  if (r.insurance === 'proof_pending') out.push('Insurance proof not received');
  if (r.insurance === 'needs_cover') out.push('Insurance cover not arranged');
  return out;
}

import { describe, expect, it } from 'vitest';
import { outstanding, whyLabels, type MyEvent } from './myEventsView';

const ev = (p: Partial<MyEvent>): MyEvent => ({
  id: p.slug ?? 'x', slug: 'x', name: 'X', status: 'published', eventType: 'tournament', startsOn: '2026-11-14', endsOn: '2026-11-15', city: 'Red Deer', region: 'AB', venue: null,
  registrationMode: 'buhuros', synthetic: false, staffRoles: [], registration: null, fighterEntry: false, captainEntry: false, pendingRegistrations: null, invited: false, ...p
});

describe('whyLabels', () => {
  it('names every reason once, roles first', () => {
    const e = ev({ staffRoles: ['organizer', 'scorekeeper'], registration: { id: 'r', status: 'accepted', feeDueCents: 0, feePaid: false, insurance: 'hacsa_member', isVolunteer: false, checkedIn: false }, captainEntry: true });
    expect(whyLabels(e).map(w => w.label)).toEqual(['Organizer', 'Scorekeeper', 'Registration accepted', 'Your team is entered']);
  });
  it('marks a volunteer registration', () => {
    expect(whyLabels(ev({ registration: { id: 'r', status: 'pending', feeDueCents: 0, feePaid: false, insurance: 'hacsa_member', isVolunteer: true, checkedIn: false } }))[0].label).toBe('Volunteer · Registration waiting for review');
  });
  it('names an organizer invitation (Pack 07) as a reason', () => {
    expect(whyLabels(ev({ invited: true })).map(w => w.label)).toEqual(['Added by organizer']);
  });
});

describe('outstanding', () => {
  it('lists only what the database knows is missing, and only once accepted', () => {
    const r = { id: 'r', status: 'accepted', feeDueCents: 4000, feePaid: false, insurance: 'proof_pending', isVolunteer: false, checkedIn: false };
    expect(outstanding(ev({ registration: r }))).toEqual(['Fee not marked paid', 'Insurance proof not received']);
    expect(outstanding(ev({ registration: { ...r, status: 'pending' } }))).toEqual([]);
    expect(outstanding(ev({ registration: { ...r, feePaid: true, insurance: 'hacsa_member' } }))).toEqual([]);
  });
  it('asks an invited person to complete the registration', () => {
    expect(outstanding(ev({ invited: true }))).toEqual(['Complete your registration, or withdraw']);
  });
});

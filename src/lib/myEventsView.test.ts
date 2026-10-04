import { describe, expect, it } from 'vitest';
import { filterMyEvents, groupMyEvents, outstanding, whyLabels, type MyEvent } from './myEventsView';

const ev = (p: Partial<MyEvent>): MyEvent => ({
  id: p.slug ?? 'x', slug: 'x', name: 'X', status: 'published', eventType: 'tournament', startsOn: '2026-11-14', endsOn: '2026-11-15', city: 'Red Deer', region: 'AB', venue: null,
  registrationMode: 'buhuros', synthetic: false, staffRoles: [], registration: null, fighterEntry: false, captainEntry: false, pendingRegistrations: null, ...p
});

describe('whyLabels', () => {
  it('names every reason once, roles first', () => {
    const e = ev({ staffRoles: ['organizer', 'scorekeeper'], registration: { id: 'r', status: 'accepted', feeDueCents: 0, feePaid: false, insurance: 'hacsa_member', isVolunteer: false, checkedIn: false }, captainEntry: true });
    expect(whyLabels(e).map(w => w.label)).toEqual(['Organizer', 'Scorekeeper', 'Registration accepted', 'Your team is entered']);
  });
  it('marks a volunteer registration', () => {
    expect(whyLabels(ev({ registration: { id: 'r', status: 'pending', feeDueCents: 0, feePaid: false, insurance: 'hacsa_member', isVolunteer: true, checkedIn: false } }))[0].label).toBe('Volunteer · Registration waiting for review');
  });
});

describe('outstanding', () => {
  it('lists only what the database knows is missing, and only once accepted', () => {
    const r = { id: 'r', status: 'accepted', feeDueCents: 4000, feePaid: false, insurance: 'proof_pending', isVolunteer: false, checkedIn: false };
    expect(outstanding(ev({ registration: r }))).toEqual(['Fee not marked paid', 'Insurance proof not received']);
    expect(outstanding(ev({ registration: { ...r, status: 'pending' } }))).toEqual([]);
    expect(outstanding(ev({ registration: { ...r, feePaid: true, insurance: 'hacsa_member' } }))).toEqual([]);
  });
});

describe('groupMyEvents', () => {
  const today = '2026-11-14';
  const list = [
    ev({ slug: 'later', name: 'Later', startsOn: '2026-12-05', endsOn: '2026-12-06' }),
    ev({ slug: 'old2', name: 'Old 2', startsOn: '2025-05-01', endsOn: '2025-05-02' }),
    ev({ slug: 'now', name: 'Now', startsOn: '2026-11-14', endsOn: '2026-11-15' }),
    ev({ slug: 'draft', name: 'Draft', status: 'draft', startsOn: '2027-01-01', endsOn: '2027-01-01' }),
    ev({ slug: 'old1', name: 'Old 1', startsOn: '2026-09-12', endsOn: '2026-09-13' }),
    ev({ slug: 'soon', name: 'Soon', startsOn: '2026-11-20', endsOn: '2026-11-20' })
  ];
  it('puts events in now / upcoming / drafts / past with a deterministic order', () => {
    const g = groupMyEvents(list, today);
    expect(g.now.map(e => e.slug)).toEqual(['now']);
    expect(g.upcoming.map(e => e.slug)).toEqual(['soon', 'later']);
    expect(g.drafts.map(e => e.slug)).toEqual(['draft']);
    expect(g.past.map(e => e.slug)).toEqual(['old1', 'old2']);
  });
  it('orders the same regardless of input order', () => {
    const a = groupMyEvents(list, today), b = groupMyEvents([...list].reverse(), today);
    expect(a).toEqual(b);
  });
});

describe('filterMyEvents', () => {
  const list = [ev({ slug: 'a', name: 'Rumble-test', synthetic: true }), ev({ slug: 'b', name: 'QA Cup', city: 'Lacombe' })];
  it('hides test events unless asked and searches name or place', () => {
    expect(filterMyEvents(list, '', false).map(e => e.slug)).toEqual(['b']);
    expect(filterMyEvents(list, '', true)).toHaveLength(2);
    expect(filterMyEvents(list, 'lacombe', false).map(e => e.slug)).toEqual(['b']);
    expect(filterMyEvents(list, 'rumble', true).map(e => e.slug)).toEqual(['a']);
  });
});

import { describe, expect, it } from 'vitest';
import { homeCards } from './homeView';
import type { MyEvent } from './myEventsView';

const ev = (o: Partial<MyEvent>): MyEvent => ({
  id: 'e', slug: 'e', name: 'Event', status: 'published', eventType: 'tournament', startsOn: '2026-10-10', endsOn: '2026-10-11', city: null, region: null, venue: null, registrationMode: 'buhuros',
  synthetic: false, staffRoles: [], registration: { id: 'r', status: 'accepted', feeDueCents: 0, feePaid: true, insurance: 'hacsa_member', isVolunteer: false, checkedIn: false },
  fighterEntry: true, captainEntry: false, pendingRegistrations: null, invited: false, ...o
});
const fight = { eventSlug: 'rumble', eventName: 'Rumble', competition: 'Longsword', field: 'Field 1', stage: 'on_deck' as const, opponent: 'Aldric' };

describe('home: what matters right now', () => {
  it('is calm (no cards) when nothing needs attention', () => {
    expect(homeCards({ fight: null, events: [], today: '2026-10-05', captainRequests: 0 })).toEqual([]);
    expect(homeCards({ fight: null, events: [ev({ status: 'cancelled' }), ev({ registration: null, fighterEntry: false })], today: '2026-10-05', captainRequests: 0 })).toEqual([]);
  });
  it('puts a called fight first, naming field and opponent, linking to My next fight', () => {
    const [c] = homeCards({ fight, events: [], today: '2026-10-10', captainRequests: 0 });
    expect(c).toMatchObject({ key: 'fight', tone: 'go', title: 'You\'re on deck', to: '/events/rumble#my-next-fight' });
    expect(c.detail).toBe('Longsword · Field 1 · vs Aldric');
    expect(homeCards({ fight: { ...fight, stage: 'in_the_hole' }, events: [], today: 'x', captainRequests: 0 })[0]).toMatchObject({ tone: 'soon', title: 'You\'re in the hole' });
    expect(homeCards({ fight: { ...fight, stage: 'active', opponent: null }, events: [], today: 'x', captainRequests: 0 })[0].detail).toBe('Longsword · Field 1');
  });
  it('shows the event that is on today (once), with what is still outstanding', () => {
    const cards = homeCards({ fight, events: [ev({ id: 'a', slug: 'rumble', startsOn: '2026-10-10', endsOn: '2026-10-10' }), ev({ id: 'b', slug: 'other', name: 'Other Cup', startsOn: '2026-10-10', endsOn: '2026-10-10', registration: { id: 'r', status: 'accepted', feeDueCents: 5000, feePaid: false, insurance: 'hacsa_member', isVolunteer: false, checkedIn: false } })], today: '2026-10-10', captainRequests: 0 });
    expect(cards.map(c => c.key)).toEqual(['fight', 'today-b']);
    expect(cards[1].detail).toBe('Fee not marked paid');
  });
  it('otherwise the next event the person is really in, soonest first, never an unaccepted one', () => {
    const cards = homeCards({ fight: null, events: [ev({ id: 'far', name: 'Far', startsOn: '2026-12-01', endsOn: '2026-12-01' }), ev({ id: 'near', name: 'Near', startsOn: '2026-10-20', endsOn: '2026-10-21' }), ev({ id: 'pend', name: 'Pending', startsOn: '2026-10-08', endsOn: '2026-10-08', fighterEntry: false, registration: { id: 'r', status: 'pending', feeDueCents: 0, feePaid: false, insurance: '', isVolunteer: false, checkedIn: false } })], today: '2026-10-05', captainRequests: 0 });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ title: 'Next up: Near', to: '/events/e' });
  });
  it('tells a captain about waiting requests, and never shows more than three cards', () => {
    expect(homeCards({ fight: null, events: [], today: '2026-10-05', captainRequests: 1 })[0].title).toBe('1 join request is waiting for you');
    expect(homeCards({ fight: null, events: [], today: '2026-10-05', captainRequests: 4 })[0].title).toBe('4 join requests are waiting for you');
    const many = [1, 2, 3, 4].map(n => ev({ id: `t${n}`, slug: `t${n}`, name: `T${n}`, startsOn: '2026-10-05', endsOn: '2026-10-05' }));
    expect(homeCards({ fight, events: many, today: '2026-10-05', captainRequests: 2 })).toHaveLength(3);
  });
});

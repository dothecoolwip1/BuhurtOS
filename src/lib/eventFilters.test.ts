import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../data/api';
import {
  activeFilterCount, applyEventFilter, DEFAULT_FILTER, eventAttention, eventFilterParams, eventsOnDay, filterOptions, googleCalendarUrl, groupEvents, icsForEvent, indexEvents,
  monthGrid, parseEventFilter, sortEvents, addMonths, parseMonth
} from './eventFilters';

const ev = (p: Partial<LiveEvent> & { id: string; name: string; startsOn: string; endsOn: string }): LiveEvent => ({
  slug: p.id, description: '', eventType: 'tournament', status: 'published', venue: null, address: null, city: null, region: 'AB', country: null, latitude: null, longitude: null,
  feeCents: 0, feeProvince: null, feeNote: null, registrationOpensAt: null, registrationClosesAt: null, leagues: ['duels'], registrationMode: 'buhuros', externalUrl: null, timeNote: null, volunteerInfo: null,
  competitionCount: 2, organizationId: null, seasonId: null, ...p
});
const today = '2026-10-03';
const orgs = [{ id: 'o1', slug: 'hacsa', name: 'HACSA', shortName: null, enabled: true }];
const events = [
  ev({ id: 'now', name: 'Rumble', startsOn: '2026-10-02', endsOn: '2026-10-04', organizationId: 'o1', leagues: ['buhurt', 'duels'] }),
  ev({ id: 'soon', name: 'Steel Cup', startsOn: '2026-10-20', endsOn: '2026-10-20', city: 'Red Deer' }),
  ev({ id: 'later', name: 'Winter Melee', startsOn: '2026-12-01', endsOn: '2026-12-01', region: 'SK', eventType: 'practice' }),
  ev({ id: 'draft', name: 'Red Deer Rumble', startsOn: '2026-11-14', endsOn: '2026-11-15', status: 'draft', competitionCount: 0 }),
  ev({ id: 'old', name: 'Spring Open', startsOn: '2026-04-01', endsOn: '2026-04-02' }),
  ev({ id: 'older', name: 'Autumn Open', startsOn: '2025-09-01', endsOn: '2025-09-01' }),
  ev({ id: 'fake', name: 'Central Alberta Steel Open-test', startsOn: '2026-10-25', endsOn: '2026-10-25' })
];
const synthetic = new Set(['event:fake']);
const relations = new Map<string, string[]>([['soon', ['fighter']], ['draft', ['organizer']], ['old', ['marshal', 'organizer']]]);
const indexed = indexEvents(events, synthetic, relations, orgs);

describe('sorting and grouping', () => {
  it('happening now, then upcoming soonest first, then drafts, then past newest first; never database order', () => {
    expect(sortEvents(indexed, today).map(e => e.id)).toEqual(['now', 'soon', 'fake', 'later', 'draft', 'old', 'older']);
    const g = groupEvents(indexed, today);
    expect(g.now.map(e => e.id)).toEqual(['now']);
    expect(g.past.map(e => e.id)).toEqual(['old', 'older']);
  });
  it('says what a draft needs', () => {
    expect(eventAttention(indexed.find(e => e.id === 'draft')!)).toBe('Needs competition setup');
    expect(eventAttention({ status: 'draft', eventType: 'practice', competitionCount: 0, venue: null, address: null })).toBe('Needs a venue');
    expect(eventAttention({ status: 'published', eventType: 'tournament', competitionCount: 0, venue: null, address: null })).toBeNull();
  });
});

describe('filtering', () => {
  it('hides test events by default and shows them with the toggle', () => {
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all' }, today).map(e => e.id)).not.toContain('fake');
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', test: true }, today).map(e => e.id)).toContain('fake');
  });
  it('upcoming keeps running events and drafts, past keeps only finished ones', () => {
    expect(applyEventFilter(indexed, DEFAULT_FILTER, today).map(e => e.id).sort()).toEqual(['draft', 'later', 'now', 'soon']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'past' }, today).map(e => e.id).sort()).toEqual(['old', 'older']);
  });
  it('searches name, city, province and organization, ignoring case and accents', () => {
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', q: 'red deer' }, today).map(e => e.id).sort()).toEqual(['draft', 'soon']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', q: 'HACSA' }, today).map(e => e.id)).toEqual(['now']);
  });
  it('filters by format, organization, province, type and status', () => {
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', format: 'buhurt' }, today).map(e => e.id)).toEqual(['now']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', org: 'o1' }, today).map(e => e.id)).toEqual(['now']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', region: 'SK' }, today).map(e => e.id)).toEqual(['later']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', type: 'practice' }, today).map(e => e.id)).toEqual(['later']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', status: 'finished' }, today).map(e => e.id).sort()).toEqual(['old', 'older']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', status: 'draft' }, today).map(e => e.id)).toEqual(['draft']);
  });
  it('My events is only events with a relationship, never everything an owner could edit', () => {
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all' }, today, true).map(e => e.id).sort()).toEqual(['draft', 'old', 'soon']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', role: 'organizer' }, today, true).map(e => e.id).sort()).toEqual(['draft', 'old']);
    expect(applyEventFilter(indexed, { ...DEFAULT_FILTER, when: 'all', role: 'medic' }, today, true)).toEqual([]);
    expect(indexEvents(events, synthetic, new Map(), orgs).every(e => e.roles.length === 0)).toBe(true);
  });
  it('offers only the options that exist', () => {
    const o = filterOptions(indexed, orgs);
    expect(o.orgs.map(x => x.id)).toEqual(['o1']);
    expect(o.regions).toEqual(['AB', 'SK']);
    expect(o.types).toEqual(['practice', 'tournament']);
  });
});

describe('filters in the URL', () => {
  it('round-trips and ignores unknown values', () => {
    const f = parseEventFilter(new URLSearchParams('q=steel&format=duels&province=AB&when=past&test=1&role=captain&status=nope'));
    expect(f).toMatchObject({ q: 'steel', format: 'duels', region: 'AB', when: 'past', test: true, role: 'captain', status: '' });
    expect(eventFilterParams(f).toString()).toBe('q=steel&format=duels&province=AB&when=past&test=1&role=captain');
    expect(eventFilterParams(DEFAULT_FILTER).toString()).toBe('');
    expect(activeFilterCount(f)).toBe(4);
  });
  it('a page can set its own defaults', () => {
    expect(parseEventFilter(new URLSearchParams(''), { when: 'all' }).when).toBe('all');
    expect(eventFilterParams({ ...DEFAULT_FILTER, when: 'all' }, { when: 'all' }).toString()).toBe('');
  });
});

describe('calendar', () => {
  it('builds a Monday-first month grid and marks today', () => {
    const g = monthGrid(2026, 10, today);
    expect(g[0].map(d => d.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(g[0][5]).toMatchObject({ iso: '2026-10-03', today: true, inMonth: true });
    expect(g.length).toBe(5);
    expect(monthGrid(2027, 2, today).length).toBe(4); // February 2027 starts on a Monday and has 28 days: exactly four rows
  });
  it('multi-day events show on every day they cover', () => {
    expect(eventsOnDay(indexed, '2026-10-03').map(e => e.id)).toEqual(['now']);
    expect(eventsOnDay(indexed, '2026-10-05')).toEqual([]);
  });
  it('moves between months and parses the month from the URL', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(parseMonth('2026-11', today)).toEqual({ y: 2026, m: 11 });
    expect(parseMonth('junk', today)).toEqual({ y: 2026, m: 10 });
  });
  it('exports an all-day event to Google Calendar and .ics', () => {
    const e = indexed.find(x => x.id === 'now')!;
    expect(googleCalendarUrl(e, 'https://buhurtos.ca')).toContain('dates=20261002%2F20261005');
    const ics = icsForEvent(e, 'https://buhurtos.ca', new Date('2026-10-03T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261002');
    expect(ics).toContain('DTEND;VALUE=DATE:20261005');
    expect(ics).toContain('SUMMARY:Rumble');
  });
});

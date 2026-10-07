import { describe, expect, it } from 'vitest';
import { controlPath, eventPath, defaultModeFor, defaultViewFor, eventPhaseOf, legacyManageTarget, todayIn, viewPath } from './eventPhaseView';

const at = (iso: string) => new Date(iso);
const ev = (o: Partial<Parameters<typeof eventPhaseOf>[0]> = {}) => ({ status: 'published' as const, startsOn: '2026-10-10', endsOn: '2026-10-11', timezone: 'America/Edmonton', closedAt: null, archivedAt: null, ...o });

describe('the event phase', () => {
  it('is judged on the event\'s own calendar day, not the phone\'s', () => {
    // 05:30 UTC on Oct 10 is still Oct 9 in Edmonton: not live yet
    expect(todayIn('America/Edmonton', at('2026-10-10T05:30:00Z'))).toBe('2026-10-09');
    expect(eventPhaseOf(ev(), at('2026-10-10T05:30:00Z'))).toBe('upcoming');
    expect(eventPhaseOf(ev(), at('2026-10-10T14:00:00Z'))).toBe('live');
    expect(eventPhaseOf(ev(), at('2026-10-12T05:30:00Z'))).toBe('live');       // 23:30 Edmonton on the last day
    expect(eventPhaseOf(ev(), at('2026-10-12T06:30:00Z'))).toBe('completed');
  });
  it('a draft is a draft until published; a closed or archived event is complete whatever the date', () => {
    expect(eventPhaseOf(ev({ status: 'draft' }), at('2026-10-10T14:00:00Z'))).toBe('draft');
    expect(eventPhaseOf(ev({ closedAt: '2026-10-11T22:00:00Z' }), at('2026-10-10T14:00:00Z'))).toBe('completed');
    expect(eventPhaseOf(ev({ archivedAt: '2027-01-01T00:00:00Z' }), at('2026-09-01T14:00:00Z'))).toBe('completed');
    expect(eventPhaseOf(ev({ status: 'draft' }), at('2026-12-01T14:00:00Z'))).toBe('completed');   // a draft left in the past reads as past
  });
  it('an unknown time zone falls back without throwing', () => {
    expect(todayIn('Not/AZone', at('2026-10-10T14:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('leads with the fields while live, the results afterwards, the overview before; Event Control follows the same day', () => {
    expect(defaultViewFor('upcoming')).toBe('overview'); expect(defaultViewFor('draft')).toBe('overview');
    expect(defaultViewFor('live')).toBe('live'); expect(defaultViewFor('completed')).toBe('results');
    expect(defaultModeFor('upcoming')).toBe('setup'); expect(defaultModeFor('live')).toBe('live'); expect(defaultModeFor('completed')).toBe('results');
  });
  it('addresses: the bare event leads with its phase; each view has its own; Event Control carries its mode and tool', () => {
    expect(eventPath('rumble')).toBe('/events/rumble');
    expect(viewPath('rumble', 'overview')).toBe('/events/rumble/overview');
    expect(viewPath('rumble', 'live')).toBe('/events/rumble/live');
    expect(controlPath('rumble')).toBe('/events/rumble/control');
    expect(controlPath('rumble', 'live')).toBe('/events/rumble/control?mode=live');
    expect(controlPath('rumble', 'setup', 'competitions')).toBe('/events/rumble/control?mode=setup&tool=competitions');
  });
  it('every old Manage tab and the Command Centre have a home in Event Control', () => {
    expect(legacyManageTarget('eventday')).toEqual({ mode: 'live' });
    expect(legacyManageTarget('command')).toEqual({ mode: 'live' });
    expect(legacyManageTarget('finalize')).toEqual({ mode: 'results' });
    expect(legacyManageTarget('review')).toEqual({ mode: 'setup', tool: 'registrations' });
    expect(legacyManageTarget('checkin')).toEqual({ mode: 'live', tool: 'checkin' });
    expect(legacyManageTarget('people')).toEqual({ mode: 'setup', tool: 'staff' });
    expect(legacyManageTarget('home')).toEqual({ mode: 'setup' });
    expect(legacyManageTarget(null)).toEqual({ mode: 'setup' });
  });
});

import { describe, expect, it } from 'vitest';
import { accessEndsLabel, canActivateCameraOff, effectiveRolesFor, guardPath, landingFor, pathAllowed, roleLabel } from './deviceRoutes';

const S = 'red-deer-rumble';
const subj = (role: string) => ({ role, slug: S });

describe('role words', () => {
  it('uses the sporting names', () => {
    expect(roleLabel('counter')).toBe('Counter');
    expect(roleLabel('scorekeeper')).toBe('Secretary / Scorekeeper');
    expect(roleLabel('marshal')).toBe('Marshal');
    expect(roleLabel('announcer')).toBe('Announcer');
    expect(roleLabel('temporary_organizer')).toBe('Event Admin / Temporary Organizer');
    expect(roleLabel('something_else')).toBe('something else');
  });
  it('camera off is offered to everyone who protects the broadcast, never the counter', () => {
    for (const r of ['scorekeeper', 'marshal', 'announcer', 'temporary_organizer']) expect(canActivateCameraOff(r)).toBe(true);
    expect(canActivateCameraOff('counter')).toBe(false);
  });
  it('display roles follow the contract', () => {
    expect(effectiveRolesFor('counter')).toEqual([]);
    expect(effectiveRolesFor('scorekeeper')).toEqual(['scorekeeper']);
    expect(effectiveRolesFor('marshal')).toEqual(['marshal']);
    expect(effectiveRolesFor('announcer')).toEqual(['announcer']);
    expect(effectiveRolesFor('temporary_organizer')).toEqual(['head_marshal', 'marshal', 'scorekeeper']);
    expect(effectiveRolesFor('temporary_organizer')).not.toContain('organizer');
  });
});

describe('landing', () => {
  it('lands each role on its own screen', () => {
    expect(landingFor(subj('counter'))).toBe('/lyst/counter');
    expect(landingFor(subj('scorekeeper'))).toBe(`/events/${S}/control?mode=live`);
    expect(landingFor(subj('temporary_organizer'))).toBe(`/events/${S}/control?mode=live`);
    expect(landingFor(subj('announcer'))).toBe(`/events/${S}/announcer`);
    expect(landingFor(subj('marshal'))).toBe(`/events/${S}`);
  });
  it('every landing page is open to its own role', () => {
    for (const r of ['counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer']) expect(pathAllowed(subj(r), landingFor(subj(r)))).toBe(true);
  });
});

describe('pathAllowed', () => {
  const ok = (role: string, path: string) => pathAllowed(subj(role), path);
  it('a counter reaches only the counter flow and public pages', () => {
    expect(ok('counter', '/lyst/counter')).toBe(true);
    expect(ok('counter', '/lyst/join')).toBe(true);
    expect(ok('counter', '/lyst/join/ABC123')).toBe(true);
    expect(ok('counter', `/events/${S}/field/Field%201`)).toBe(false);
    expect(ok('counter', `/events/${S}/command`)).toBe(false);
    expect(ok('counter', `/events/${S}`)).toBe(false);
    expect(ok('counter', '/rules')).toBe(true);
  });
  it('a marshal reaches field screens, not the command centre or the desk', () => {
    expect(ok('marshal', `/events/${S}/field/Field%201`)).toBe(true);
    expect(ok('marshal', `/events/${S}/field/Field 2`)).toBe(true);
    expect(ok('marshal', `/events/${S}/command`)).toBe(false);
    expect(ok('marshal', `/events/${S}/checkin`)).toBe(false);
    expect(ok('marshal', `/events/${S}/announcer`)).toBe(false);
    expect(ok('marshal', '/lyst/counter')).toBe(false);
  });
  it('a secretary / scorekeeper reaches the command centre and field screens, not the desk', () => {
    expect(ok('scorekeeper', `/events/${S}/control`)).toBe(true);
    expect(ok('scorekeeper', `/events/${S}/command`)).toBe(true);   // the old address still redirects
    expect(ok('scorekeeper', `/events/${S}/field/Field%201`)).toBe(true);
    expect(ok('scorekeeper', `/events/${S}/checkin`)).toBe(false);
    expect(ok('scorekeeper', `/events/${S}/manage`)).toBe(false);
  });
  it('the announcer reaches the announcer view only', () => {
    expect(ok('announcer', `/events/${S}/announcer`)).toBe(true);
    expect(ok('announcer', `/events/${S}/field/Field%201`)).toBe(false);
    expect(ok('announcer', `/events/${S}/command`)).toBe(false);
  });
  it('a temporary organizer reaches command, field screens and the check-in desk, never manage or accounts', () => {
    for (const p of [`/events/${S}/control`, `/events/${S}/command`, `/events/${S}/checkin`, `/events/${S}/field/Field%201`]) expect(ok('temporary_organizer', p)).toBe(true);
    for (const p of [`/events/${S}/manage`, `/events/${S}/register`, '/account', '/welcome', '/platform', '/my-events', '/team-manager', '/sign-in', '/events/new']) expect(ok('temporary_organizer', p)).toBe(false);
  });
  it('tools never open for another event', () => {
    expect(ok('temporary_organizer', '/events/other-event/control')).toBe(false);
    expect(ok('marshal', '/events/other-event/field/Field%201')).toBe(false);
    expect(ok('temporary_organizer', `/events/${S}x/control`)).toBe(false);
  });
  it('public pages are readable by every role', () => {
    for (const r of ['counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer']) {
      for (const p of ['/rules', '/privacy', `/events/${S}/arena`, `/events/${S}/arena/Field%201`, '/rules/']) expect(ok(r, p)).toBe(true);
    }
  });
  it('account, profile, onboarding and team pages are never offered', () => {
    for (const r of ['counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer']) {
      for (const p of ['/account', '/welcome', '/sign-in', '/my-events', '/teams', '/fighters/abc/edit', '/claim-profile', '/test-login']) expect(ok(r, p)).toBe(false);
    }
  });
  it('guardPath sends a refused page to the landing page', () => {
    expect(guardPath(subj('marshal'), '/account')).toBe(`/events/${S}`);
    expect(guardPath(subj('counter'), '/')).toBe('/lyst/counter');
    expect(guardPath(subj('marshal'), `/events/${S}/field/Field%201`)).toBe(`/events/${S}/field/Field%201`);
  });
});

describe('accessEndsLabel', () => {
  // ends_on 2026-10-10, America/Edmonton: the event ends Sun 00:00 MDT, access ends Mon 2026-10-12 00:00 MDT = 06:00 UTC
  const ends = '2026-10-12T06:00:00Z';
  it('is written in the EVENT time zone, not the viewer\'s', () => {
    const l = accessEndsLabel(ends, 'America/Edmonton', Date.parse('2026-10-11T12:00:00Z'));
    expect(l).toMatch(/^Access ends Mon 00:00/);
    expect(l).toMatch(/MDT$/);
    expect(accessEndsLabel(ends, 'UTC', Date.parse('2026-10-11T12:00:00Z'))).toMatch(/^Access ends Mon 06:00/);
    expect(accessEndsLabel(ends, 'Asia/Tokyo', Date.parse('2026-10-11T12:00:00Z'))).toMatch(/^Access ends Mon 15:00/);
  });
  it('winter time is standard time (Toronto: stable rules in every time-zone database)', () => {
    expect(accessEndsLabel('2026-12-07T05:00:00Z', 'America/Toronto', Date.parse('2026-12-06T12:00:00Z'))).toMatch(/^Access ends Mon 00:00.*EST$/);
  });
  it('adds the date when it is more than five days away', () => {
    expect(accessEndsLabel(ends, 'America/Edmonton', Date.parse('2026-10-01T12:00:00Z'))).toMatch(/^Access ends Mon Oct 12 00:00/);
  });
  it('survives a bad zone or date', () => {
    expect(accessEndsLabel(ends, 'Not/AZone', Date.parse('2026-10-11T12:00:00Z'))).toMatch(/^Access ends Mon 06:00/);
    expect(accessEndsLabel('not a date', 'UTC')).toBe('Access end time unknown');
  });
});

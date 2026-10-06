import { describe, expect, it } from 'vitest';
import {
  USUAL_SET, accessEndsLabel, deviceQrUrl, groupCode, hasDeviceSession, lastSeenLabel, normalizeCode, roleWord, signedInElsewhereLabel, sortCredentials, splitCredentials,
  staffRoleChoices, staffRoleWord, statusWord, usualSetToCreate, type Credential
} from './devices';

const cred = (over: Partial<Credential> = {}): Credential => ({
  id: 'c', kind: 'device', label: 'Counter Phone 1', role: 'counter', status: 'active', used: false, expiresAt: null, createdAt: '2026-10-10T12:00:00Z',
  lastSigninAt: null, lastSeenAt: null, signedInElsewhereAt: null, revokedAt: null, replaced: false, ...over
});

describe('devices in words', () => {
  it('names the statuses and the roles the way an organizer says them', () => {
    expect(statusWord('active')).toBe('Active');
    expect(statusWord('revoked')).toBe('Revoked');
    expect(statusWord('expired')).toBe('Expired');
    expect(roleWord('counter')).toBe('Counter');
    expect(roleWord('scorekeeper')).toBe('Secretary / Scorekeeper');
    expect(roleWord('marshal')).toBe('Marshal');
    expect(roleWord('announcer')).toBe('Announcer');
    expect(roleWord('temporary_organizer')).toBe('Event Admin / Temporary Organizer');
    expect(roleWord('broadcast_controller')).toBe('Stream controller');
    expect(roleWord('something_new')).toBe('something_new');          // never blank, never "undefined"
  });
  it('words every staff role, including the new Announcer', () => {
    expect(staffRoleWord('announcer')).toBe('Announcer');
    expect(staffRoleWord('scorekeeper')).toBe('Secretary / Scorekeeper');
    expect(staffRoleWord('check_in')).toBe('Check-in desk');
  });
  it('a Temporary Organizer is never offered the Organizer role; a permanent organizer is', () => {
    expect(staffRoleChoices(false)).not.toContain('organizer');
    expect(staffRoleChoices(false)).toContain('announcer');
    expect(staffRoleChoices(true)[0]).toBe('organizer');
    expect(staffRoleChoices(true)).toContain('announcer');
  });
});

describe('access end and last seen, in the event time zone', () => {
  it('"Access ends" is the event\'s own clock, not the viewer\'s', () => {
    // Monday 12 Oct 2026 00:00 in Edmonton (MDT, UTC-6) is 06:00 UTC
    expect(accessEndsLabel('2026-10-12T06:00:00Z', 'America/Edmonton')).toBe('Access ends Mon 00:00 MDT');
    // the same instant on a Toronto event is 02:00 EDT
    expect(accessEndsLabel('2026-10-12T06:00:00Z', 'America/Toronto')).toBe('Access ends Mon 02:00 EDT');
    expect(accessEndsLabel('2026-10-12T06:00:00Z', 'Europe/London')).toMatch(/^Access ends Mon 07:00/);
  });
  it('follows daylight saving: the same local midnight is a different instant in winter', () => {
    expect(accessEndsLabel('2026-12-07T07:00:00Z', 'America/Edmonton')).toBe('Access ends Mon 00:00 MST');
  });
  it('has nothing to say without a time, or with a bad one; a bad zone falls back instead of throwing', () => {
    expect(accessEndsLabel(null, 'America/Edmonton')).toBeNull();
    expect(accessEndsLabel('not a date', 'America/Edmonton')).toBeNull();
    expect(accessEndsLabel('2026-10-12T06:00:00Z', 'Not/AZone')).toMatch(/^Access ends Mon 06:00/);
  });
  it('the signed-in-elsewhere warning names the time on the event clock', () => {
    expect(signedInElsewhereLabel('2026-10-10T20:05:00Z', 'America/Edmonton')).toBe('Signed in on another device at 14:05');
    expect(signedInElsewhereLabel(null, 'America/Edmonton')).toBeNull();
  });
  it('last seen reads like a person would say it', () => {
    const now = Date.parse('2026-10-10T20:00:00Z');
    const at = (s: number) => new Date(now - s * 1000).toISOString();
    expect(lastSeenLabel({ lastSeenAt: null, lastSigninAt: null, used: false }, now)).toBe('Not signed in yet');
    expect(lastSeenLabel({ lastSeenAt: null, lastSigninAt: null, used: true }, now)).toBe('Signed in before');
    expect(lastSeenLabel({ lastSeenAt: at(3), lastSigninAt: null, used: true }, now)).toBe('Last seen just now');
    expect(lastSeenLabel({ lastSeenAt: at(45), lastSigninAt: null, used: true }, now)).toBe('Last seen 45 s ago');
    expect(lastSeenLabel({ lastSeenAt: at(600), lastSigninAt: null, used: true }, now)).toBe('Last seen 10 min ago');
    expect(lastSeenLabel({ lastSeenAt: null, lastSigninAt: at(7200), used: true }, now)).toBe('Last seen 2 h ago');
    expect(lastSeenLabel({ lastSeenAt: at(-30), lastSigninAt: null, used: true }, now)).toBe('Last seen just now');   // a clock a little ahead never goes negative
  });
});

describe('the code and its QR link', () => {
  it('groups a code as XXXX-XXXX-XXXX and reads it back however it was typed', () => {
    expect(groupCode('K7Q2M9XD4TRH')).toBe('K7Q2-M9XD-4TRH');
    expect(normalizeCode('k7q2-m9xd-4trh')).toBe('K7Q2M9XD4TRH');
    expect(normalizeCode(' k7q2 m9xd 4trh ')).toBe('K7Q2M9XD4TRH');
    expect(normalizeCode('K7Q2-M9XD-4TR')).toBeNull();
    expect(normalizeCode('K7Q2-M9XD-4TRHH')).toBeNull();
    expect(normalizeCode('U7Q2-M9XD-4TRH')).toBeNull();               // no U in the alphabet
    expect(normalizeCode('O7Q2-M9XD-4TRI')).toBe('07Q2M9XD4TR1');     // look-alikes read as 0 and 1, as the sign-in function does
  });
  it('the QR link carries the code in the URL FRAGMENT only', () => {
    const url = deviceQrUrl('https://app.buhurtos.ca', '/', 'K7Q2-M9XD-4TRH');
    expect(url).toBe('https://app.buhurtos.ca/device#c=K7Q2M9XD4TRH');
    const u = new URL(url);
    expect(u.pathname).toBe('/device');
    expect(u.search).toBe('');
    expect(u.hash).toBe('#c=K7Q2M9XD4TRH');
    expect(u.pathname + u.search).not.toContain('K7Q2');               // nothing a server, proxy or analytics call would ever see
  });
  it('respects a sub-path base and either spelling of it', () => {
    expect(deviceQrUrl('http://localhost:4173', '/app/', 'k7q2m9xd4trh')).toBe('http://localhost:4173/app/device#c=K7Q2M9XD4TRH');
    expect(deviceQrUrl('http://localhost:4173', '/app', 'k7q2m9xd4trh')).toBe('http://localhost:4173/app/device#c=K7Q2M9XD4TRH');
    expect(deviceQrUrl('http://localhost:4173', '', 'k7q2m9xd4trh')).toBe('http://localhost:4173/device#c=K7Q2M9XD4TRH');
  });
  it('refuses to build a link from something that is not a code', () => {
    expect(() => deviceQrUrl('https://x.test', '/', 'hello')).toThrow();
  });
});

describe('sorting and the usual set', () => {
  it('lists active devices first, by role, then by name with numbers in order', () => {
    const rows = [
      cred({ id: '1', label: 'Counter Phone 10' }), cred({ id: '2', label: 'Counter Phone 2' }), cred({ id: '3', label: 'Marshal Phone', role: 'marshal' }),
      cred({ id: '4', label: 'Secretary Tablet', role: 'scorekeeper' }), cred({ id: '5', label: 'Counter Phone 1', status: 'revoked', revokedAt: '2026-10-10T13:00:00Z' }),
      cred({ id: '6', label: 'Event Admin Tablet', role: 'temporary_organizer' }), cred({ id: '7', label: 'Announcer Tablet', role: 'announcer' })
    ];
    expect(sortCredentials(rows).map(r => r.id)).toEqual(['2', '1', '4', '3', '7', '6', '5']);
    expect(rows.map(r => r.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);       // the input is not reordered
  });
  it('keeps the stream laptop apart from the people-sized devices and the past apart from the present', () => {
    const s = splitCredentials([
      cred({ id: 'a', label: 'Counter Phone 1' }), cred({ id: 'b', label: 'Stream laptop', kind: 'controller', role: 'broadcast_controller' }),
      cred({ id: 'c', label: 'Old laptop', kind: 'controller', role: 'broadcast_controller', status: 'revoked' }), cred({ id: 'd', label: 'Counter Phone 2', status: 'expired' })
    ]);
    expect(s.devices.map(c => c.id)).toEqual(['a']);
    expect(s.controller?.id).toBe('b');
    expect(s.pastDevices.map(c => c.id)).toEqual(['d']);
    expect(s.pastControllers.map(c => c.id)).toEqual(['c']);
    expect(splitCredentials([]).controller).toBeNull();
  });
  it('the usual set is Counter Phone 1 to 4, Secretary, Marshal, Announcer and Event Admin tablets', () => {
    expect(USUAL_SET.map(d => d.label)).toEqual(['Counter Phone 1', 'Counter Phone 2', 'Counter Phone 3', 'Counter Phone 4', 'Secretary Tablet', 'Marshal Phone', 'Announcer Tablet', 'Event Admin Tablet']);
    expect(USUAL_SET.map(d => d.role)).toEqual(['counter', 'counter', 'counter', 'counter', 'scorekeeper', 'marshal', 'announcer', 'temporary_organizer']);
  });
  it('asking for the usual set twice does not try to make a name that is already in use (the database would refuse it)', () => {
    const all = usualSetToCreate([]);
    expect(all.toCreate).toHaveLength(8);
    const again = usualSetToCreate([cred({ label: 'counter phone 1' }), cred({ label: 'Marshal Phone', status: 'revoked' }), cred({ label: 'Secretary Tablet', status: 'expired' })]);
    expect(again.skipped).toEqual(['Counter Phone 1', 'Secretary Tablet']);       // a revoked name is free again; an expired one is still taken
    expect(again.toCreate.map(d => d.label)).toContain('Marshal Phone');
    expect(again.toCreate).toHaveLength(6);
  });
});

describe('is a device signed in on this browser', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('needs a session object with a secret and a token', () => {
    expect(hasDeviceSession(store(JSON.stringify({ secret: 's', access_token: 't', expires_at: 1 })))).toBe(true);
    expect(hasDeviceSession(store(null))).toBe(false);
    expect(hasDeviceSession(store('{"secret":"s"}'))).toBe(false);
    expect(hasDeviceSession(store('not json'))).toBe(false);
    expect(hasDeviceSession(null)).toBe(false);
    expect(hasDeviceSession({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });
});

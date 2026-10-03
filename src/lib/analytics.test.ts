import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { isNewAccount, referrerHost, sanitizeProps, SENSITIVE_PATH, stripUrl, uaFamily, utmSource, validEventName } from './analytics';
import { ACCOUNT_PATH } from '../auth/ProfileGate';

describe('analytics privacy helpers', () => {
  it('drops sensitive keys, long values, objects and query strings', () => {
    expect(sanitizeProps({ method: 'code', password: 'x', access_token: 't', email: 'a@b.c', otp_code: '123456', contact_phone: '1', message: 'hi',
      nested: { a: 1 }, BadKey: 1, where: 'teams', path: '/events/x?code=9#y', query: 'q'.repeat(300), n: 3, ok: true, nan: NaN }))
      .toEqual({ method: 'code', where: 'teams', path: '/events/x', query: 'q'.repeat(100), n: 3, ok: true });
    expect(Object.keys(sanitizeProps(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]))))).toHaveLength(12);
  });
  it('strips query strings and anchors from paths and URLs only', () => {
    expect([stripUrl('/a?x=1#y'), stripUrl('https://x.ca/b?token=1'), stripUrl('plain ? text')]).toEqual(['/a', 'https://x.ca/b', 'plain ? text']);
  });
  it('accepts only short snake_case event names', () => {
    expect([validEventName('sign_up'), validEventName('DROP TABLE'), validEventName('x'), validEventName('a'.repeat(41))]).toEqual([true, false, false, false]);
  });
  it('reads browser and OS families without versions', () => {
    expect(uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(uaFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toEqual({ browser: 'Chrome', os: 'Android' });
  });
  it('keeps only another site as referrer, and a clean utm_source', () => {
    expect([referrerHost('https://www.Google.com/search?q=x', 'buhurtos.ca'), referrerHost('https://buhurtos.ca/teams', 'buhurtos.ca'), referrerHost('', 'x')]).toEqual(['www.google.com', null, null]);
    expect([utmSource('?utm_source=Discord'), utmSource('?utm_source=<script>'), utmSource('')]).toEqual(['discord', null, null]);
  });
  it('tells a fresh account from an old one', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect([isNewAccount('2026-10-01T11:50:00Z', now), isNewAccount('2026-09-01T11:50:00Z', now), isNewAccount(undefined, now)]).toEqual([true, false, false]);
  });
});

describe('which pages need an account', () => {
  const pub = ['/', '/events', '/events/rumble', '/teams', '/teams/bears', '/fighters', '/fighters/abc', '/rankings', '/rules', '/formats', '/organizations', '/organizations/nacl', '/marshal', '/welcome'];
  const acct = ['/account', '/team-manager', '/platform', '/platform/activity', '/events/new', '/events/rumble/register', '/events/rumble/manage', '/events/rumble/field/1', '/teams/bears/edit', '/fighters/abc/edit'];
  it('public pages never send anyone to setup', () => { expect(pub.filter(p => ACCOUNT_PATH.test(p))).toEqual([]); });
  it('account pages do', () => { expect(acct.filter(p => !ACCOUNT_PATH.test(p))).toEqual([]); });
  it('replay pauses on private pages', () => { expect(['/account', '/events/x/register', '/teams/bears/edit', '/welcome'].every(p => SENSITIVE_PATH.test(p))).toBe(true); expect(SENSITIVE_PATH.test('/teams/bears')).toBe(false); });
});

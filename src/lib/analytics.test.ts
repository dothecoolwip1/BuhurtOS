import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { isNewAccount, referrerHost, sanitizeProps, scrubCapture, scrubMessage, stripUrl, uaFamily, validEventName } from './analytics';
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
  it('keeps only another site as referrer', () => {
    expect([referrerHost('https://www.Google.com/search?q=x', 'buhurtos.ca'), referrerHost('https://buhurtos.ca/teams', 'buhurtos.ca'), referrerHost('', 'x')]).toEqual(['www.google.com', null, null]);
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
});

describe('scrubCapture: the last stop before PostHog', () => {
  const raw = {
    event: '$pageview',
    properties: {
      $current_url: 'https://buhurtos.ca/teams?q=SECRET#frag', $pathname: '/teams', $session_entry_url: 'https://buhurtos.ca/?token=SECRET&email=a@b.test#x',
      $referrer: 'https://www.google.com/search?q=SECRET', $referring_domain: 'www.google.com', $host: 'buhurtos.ca', $browser: 'Chrome', $os: 'Windows',
      $raw_user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0', $browser_version: 141, $screen_width: 1280, $viewport_height: 800, $browser_language: 'en-CA', title: 'Abel Coil - BuhurtOS',
      utm_source: 'newsletter', $session_entry_utm_source: 'newsletter', $initial_utm_campaign: 'x', gclid: 'g', $initial_gclid: 'g', $initial__kx: 'k', $prev_pageview_max_scroll: 900, $prev_pageview_pathname: '/'
    },
    $set_once: { $initial_current_url: 'https://buhurtos.ca/team-manager?x=SECRET', $initial_referrer: 'https://l.example.org/path?a=1', $initial_utm_source: null }
  };
  const out = scrubCapture(raw);
  it('keeps the path and removes query strings and anchors from every URL-like value, including person properties', () => {
    expect(out.properties.$current_url).toBe('https://buhurtos.ca/teams');
    expect(out.properties.$pathname).toBe('/teams');
    expect(out.properties.$session_entry_url).toBe('https://buhurtos.ca/');
    expect(out.$set_once.$initial_current_url).toBe('https://buhurtos.ca/team-manager');
    expect(JSON.stringify(out)).not.toMatch(/SECRET|frag|[?#]/);
  });
  it('reduces a referrer to the site it came from', () => {
    expect(out.properties.$referrer).toBe('https://www.google.com');
    expect(out.$set_once.$initial_referrer).toBe('https://l.example.org');
    expect(scrubCapture({ properties: { $referrer: '$direct' } }).properties?.$referrer).toBe('$direct');
  });
  it('keeps the disclosed browser facts', () => {
    expect(out.properties).toMatchObject({ $browser: 'Chrome', $os: 'Windows', $host: 'buhurtos.ca', $referring_domain: 'www.google.com', $prev_pageview_pathname: '/' });
  });
  it('drops fields that are not part of the disclosed set: raw user agent, versions, screen sizes, language, page title, campaign values, scroll depth', () => {
    const keys = Object.keys(out.properties);
    expect(keys.filter(k => /raw_user_agent|version|screen|viewport|language|^title$|utm|gclid|_kx|scroll/.test(k))).toEqual([]);
    expect(Object.keys(out.$set_once)).not.toContain('$initial_utm_source');
  });
  it('does not change the original event', () => {
    expect(raw.properties.$current_url).toContain('?q=SECRET');
  });
});

describe('scrubMessage', () => {
  it('removes query strings and email addresses from error text and keeps it short', () => {
    expect(scrubMessage('Failed https://x.ca/a?token=abc for jo@example.test')).toBe('Failed https://x.ca/a for [email]');
    expect(scrubMessage('x'.repeat(300))).toHaveLength(100);
  });
});

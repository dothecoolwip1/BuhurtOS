import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A temporary event device is never tracked (Pack 18.1): track_activity, track_event and report_bug write the caller's id into columns tied to
 * accounts, which a device does not have. Also: the QR link's code (`/device#c=...`) can never reach an analytics call.
 */
const SESSION = {
  secret: 'S3CRET-secret-secret-secret-0123456789', access_token: 'jwt-0', expires_at: 1_900_000_000,
  whoami: { session_id: 'sess-1', kind: 'device', role: 'marshal', label: 'Marshal Phone', event: { id: 'e1', slug: 'rr', name: 'RR', timezone: 'UTC' }, expires_at: '2030-01-01T00:00:00Z' }
};
function store(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
async function load(initial: Record<string, string>) {
  vi.resetModules();
  const fetchSpy = vi.fn(async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('localStorage', store(initial));
  vi.stubGlobal('sessionStorage', store({}));
  const analytics = await import('./analytics');
  return { analytics, fetchSpy };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('analytics in device mode', () => {
  it('sends nothing: no page view, no event, no identify, no start-up listeners', async () => {
    const { analytics, fetchSpy } = await load({ 'bos-device-session': JSON.stringify(SESSION) });
    analytics.initAnalytics();
    analytics.trackPageView('/events/rr/field/Field%201');
    analytics.trackEvent('score_action_refused', { count: 1 });
    analytics.identifyUser('sess-1');
    analytics.resetUser();
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('the same calls DO go out for a person (so the test above proves something)', async () => {
    const { analytics, fetchSpy } = await load({});
    analytics.trackEvent('sign_in_code_sent');
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    const urls = fetchSpy.mock.calls.map(c => String((c as unknown[])[0]));
    expect(urls.some(u => u.includes('track_event'))).toBe(true);
  });
  it('the QR link\'s code never survives into an analytics path', async () => {
    const { analytics } = await load({});
    expect(analytics.stripUrl('/device#c=K7Q2M9XD4TRH')).toBe('/device');
    expect(analytics.stripUrl('https://x.ca/device?c=K7Q2M9XD4TRH#c=K7Q2M9XD4TRH')).toBe('https://x.ca/device');
    expect(analytics.sanitizeProps({ code: 'K7Q2M9XD4TRH', secret: 'x', token: 'y', path: '/device#c=K7Q2M9XD4TRH' })).toEqual({ path: '/device' });
    expect(analytics.scrubMessage('failed at https://x.ca/device#c=K7Q2M9XD4TRH')).not.toContain('K7Q2M9XD4TRH');
  });
});

describe('analytics in an automated browser (rehearsals, Playwright, WebDriver)', () => {
  it('sends nothing when navigator.webdriver is set', async () => {
    vi.stubGlobal('navigator', { ...navigator, webdriver: true });
    const { analytics, fetchSpy } = await load({});
    analytics.initAnalytics();
    analytics.trackPageView('/events');
    analytics.trackEvent('sign_in_code_sent');
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('isAutomated reads only the webdriver flag', async () => {
    const { analytics } = await load({});
    expect(analytics.isAutomated({ webdriver: true })).toBe(true);
    expect(analytics.isAutomated({ webdriver: false })).toBe(false);
    expect(analytics.isAutomated({})).toBe(false);
  });
});

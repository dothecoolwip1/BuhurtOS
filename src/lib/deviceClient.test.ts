import { describe, expect, it, vi } from 'vitest';
import { DEVICE_NOT_AVAILABLE, createDeviceClient, makeAuthShim, shimSession, type ShimSource } from './deviceClient';
import type { DeviceWhoami, StoredDeviceSession } from './deviceSession';

const who: DeviceWhoami = {
  session_id: 'sess-1', kind: 'device', role: 'scorekeeper', label: 'Secretary Tablet',
  event: { id: 'ev-1', slug: 'red-deer-rumble', name: 'Red Deer Rumble', timezone: 'America/Edmonton' }, expires_at: '2026-10-12T06:00:00Z'
};
const sess = (over: Partial<StoredDeviceSession> = {}): StoredDeviceSession => ({ secret: 'sec', access_token: 'jwt-0', expires_at: 1_800_000_600, whoami: who, ...over });
function source(initial: StoredDeviceSession | null = sess()) {
  let current = initial;
  const out = vi.fn(async () => { current = null; });
  const src: ShimSource = { getSession: () => current, getAccessToken: async () => current?.access_token ?? null, signOut: out };
  return { src, out, set: (s: StoredDeviceSession | null) => { current = s; } };
}

describe('the session the app sees', () => {
  it('is minimal: the user id is the DEVICE SESSION id, there is no email, and the token is the device token', () => {
    const s = shimSession(who, 'jwt-0', 1_800_000_600, 1_800_000_000_000);
    expect(s.user.id).toBe('sess-1');
    expect(s.user.email).toBeUndefined();
    expect(s.access_token).toBe('jwt-0');
    expect(s.refresh_token).toBe('');
    expect(s.expires_in).toBe(600);
    expect(s.user.app_metadata).toMatchObject({ device: true });
    expect(JSON.stringify(s)).not.toContain('sec');
  });
});

describe('the .auth shim', () => {
  it('getSession answers from the device session, with a fresh token', async () => {
    const { src, set } = source();
    const auth = makeAuthShim(src) as unknown as { getSession: () => Promise<{ data: { session: { user: { id: string }; access_token: string } | null }; error: null }> };
    expect((await auth.getSession()).data.session?.user.id).toBe('sess-1');
    set(sess({ access_token: 'jwt-9' }));
    expect((await auth.getSession()).data.session?.access_token).toBe('jwt-9');
  });
  it('getSession is null once the session is gone, getUser says so without throwing', async () => {
    const { src } = source(null);
    const auth = makeAuthShim(src) as unknown as { getSession: () => Promise<{ data: { session: unknown } }>; getUser: () => Promise<{ data: { user: unknown }; error: unknown }> };
    expect((await auth.getSession()).data.session).toBeNull();
    const u = await auth.getUser();
    expect(u.data.user).toBeNull();
    expect(u.error).toBeTruthy();
  });
  it('getUser returns the device\'s user', async () => {
    const { src } = source();
    const auth = makeAuthShim(src) as unknown as { getUser: () => Promise<{ data: { user: { id: string } } }> };
    expect((await auth.getUser()).data.user.id).toBe('sess-1');
  });
  it('onAuthStateChange is a quiet subscription that can be cancelled', () => {
    const { src } = source();
    const auth = makeAuthShim(src) as unknown as { onAuthStateChange: (cb: () => void) => { data: { subscription: { unsubscribe: () => void } } } };
    const cb = vi.fn();
    const r = auth.onAuthStateChange(cb);
    expect(() => r.data.subscription.unsubscribe()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
  it('signOut signs the DEVICE out', async () => {
    const { src, out } = source();
    const auth = makeAuthShim(src) as unknown as { signOut: () => Promise<{ error: unknown }> };
    expect((await auth.signOut()).error).toBeNull();
    expect(out).toHaveBeenCalledTimes(1);
  });
  it('everything a person does (sign in, update a password, send a code) is refused politely, never thrown', async () => {
    const { src } = source();
    const auth = makeAuthShim(src) as unknown as Record<string, (...a: unknown[]) => Promise<{ error: { message: string } }>>;
    for (const fn of ['signInWithPassword', 'signInWithOtp', 'verifyOtp', 'signUp', 'updateUser', 'resetPasswordForEmail', 'signInWithOAuth', 'reauthenticate', 'resend']) {
      const r = await auth[fn]({});
      expect(r.error.message).toBe(DEVICE_NOT_AVAILABLE);
    }
  });
  it('is not mistaken for a promise', () => {
    const { src } = source();
    expect((makeAuthShim(src) as unknown as { then?: unknown }).then).toBeUndefined();
  });
});

describe('the client', () => {
  it('is a real supabase-js client in accessToken mode whose .auth is the shim (supabase-js would throw on it)', async () => {
    const { src } = source();
    const client = createDeviceClient('http://localhost:54321', 'pub', src);
    expect(typeof client.rpc).toBe('function');
    expect(typeof client.from).toBe('function');
    expect(typeof client.channel).toBe('function');
    const { data } = await client.auth.getSession();
    expect(data.session?.user.id).toBe('sess-1');
    expect(() => client.auth.onAuthStateChange(() => undefined)).not.toThrow();
  });
  it('sends the device token on every request, the public key as apikey, and nothing else of ours', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const { src } = source();
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(input), headers: new Headers(init?.headers) }); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    try {
      const client = createDeviceClient('http://localhost:54321', 'pub-key', src);
      await client.rpc('device_whoami');
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toContain('/rest/v1/rpc/device_whoami');
      expect(seen[0].headers.get('authorization')).toBe('Bearer jwt-0');
      expect(seen[0].headers.get('apikey')).toBe('pub-key');
    } finally { globalThis.fetch = real; }
  });
  it('after the session ends, requests go out as the public (anonymous) visitor, never with a stale device token', async () => {
    const seen: Headers[] = [];
    const { src, set } = source();
    const real = globalThis.fetch;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    try {
      const client = createDeviceClient('http://localhost:54321', 'pub-key', src);
      set(null);
      await client.from('events').select('id');
      expect(seen[0].get('authorization')).not.toContain('jwt-0');
    } finally { globalThis.fetch = real; }
  });
  it('hands the live-updates socket each fresh token when the session refreshes (a long event outlives many 10-minute tokens)', () => {
    const { src } = source();
    const listeners = new Set<() => void>();
    const withSub: ShimSource = { ...src, subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; } };
    const client = createDeviceClient('http://localhost:54321', 'pub-key', withSub);
    const setAuth = vi.spyOn(client.realtime, 'setAuth').mockResolvedValue(undefined as never);
    expect(listeners.size).toBe(1);
    listeners.forEach(f => f());
    expect(setAuth).toHaveBeenCalledTimes(1);
    expect(setAuth).toHaveBeenCalledWith();   // no argument: the client asks the device session for the token itself
  });
});

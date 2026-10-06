import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { DeviceManager, DeviceWhoami } from './deviceSession';

/**
 * The Supabase client of a temporary event device (Pack 18.1). A device is not a person: it has no account, so the normal client's sign-in machinery
 * does not apply. supabase-js supports exactly this with its `accessToken` option (an async function that returns the current JWT, here the
 * short-lived device token, refreshed before it runs out). In that mode supabase-js makes `.auth` throw on any use, but about forty places in the app read
 * `useAuth()` / `supabase.auth`, so `.auth` is replaced by a small SHIM that answers from the device session:
 *   getSession / getUser   a minimal Session whose user.id is the DEVICE SESSION id (not an account id), no email
 *   onAuthStateChange      a subscription that never fires (the device mode never changes without a page load)
 *   signOut                signs the device out
 *   everything else        a plain "not available on a temporary device" error, never a throw
 * Realtime and REST both use the same token through `accessToken`.
 */

export const DEVICE_NOT_AVAILABLE = 'That is not available on a temporary device.';

export function shimUser(w: DeviceWhoami): User {
  return {
    id: w.session_id, aud: 'authenticated', role: 'authenticated', app_metadata: { device: true, role: w.role }, user_metadata: {},
    created_at: new Date(0).toISOString(), is_anonymous: false
  } as User;
}
export function shimSession(w: DeviceWhoami, accessToken: string, expiresAtS: number, nowMs = Date.now()): Session {
  return {
    access_token: accessToken, refresh_token: '', token_type: 'bearer', expires_at: expiresAtS,
    expires_in: Math.max(0, Math.floor(expiresAtS - nowMs / 1000)), user: shimUser(w)
  } as Session;
}

/** The pieces of the device manager the shim needs (so it can be tested without a browser). */
export type ShimSource = Pick<DeviceManager, 'getSession' | 'getAccessToken' | 'signOut'> & Partial<Pick<DeviceManager, 'subscribe'>>;

export function makeAuthShim(src: ShimSource) {
  const session = async (): Promise<Session | null> => {
    const s = src.getSession();
    if (!s) return null;
    const token = (await src.getAccessToken()) ?? s.access_token;
    const fresh = src.getSession() ?? s;
    return shimSession(fresh.whoami, token, fresh.expires_at);
  };
  const refused = async () => ({ data: { user: null, session: null }, error: { name: 'DeviceAuthError', message: DEVICE_NOT_AVAILABLE, status: 400 } });
  const known: Record<string, unknown> = {
    getSession: async () => ({ data: { session: await session() }, error: null }),
    getUser: async () => { const s = await session(); return s ? { data: { user: s.user }, error: null } : { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'No device session.', status: 400 } }; },
    onAuthStateChange: () => ({ data: { subscription: { id: 'device', callback: () => undefined, unsubscribe: () => undefined } } }),
    signOut: async () => { await src.signOut(); return { error: null }; }
  };
  return new Proxy(known, {
    get: (t, prop) => (typeof prop === 'string' && prop in t ? t[prop] : typeof prop === 'string' && prop !== 'then' ? refused : undefined)
  });
}

/**
 * Build the device client. `accessToken` hands supabase-js the live token; `.auth` is replaced by the shim (an own property set in the
 * constructor, so it is simply redefined: every method of the real client keeps its own `this`).
 */
export function createDeviceClient(url: string, key: string, src: ShimSource): SupabaseClient {
  const client = createClient(url, key, { accessToken: () => src.getAccessToken() });
  Object.defineProperty(client, 'auth', { value: makeAuthShim(src), configurable: true, enumerable: true, writable: false });
  // A live-updates socket is opened with the token it had at the time; hand it each fresh token as the device refreshes (a long event outlives many 10-minute tokens).
  src.subscribe?.(() => { try { void client.realtime.setAuth(); } catch { /* polling keeps the screens current regardless */ } });
  return client;
}

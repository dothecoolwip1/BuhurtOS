import { parseCodeFragment, normalizeDeviceCode } from './deviceCode';
import { effectiveRolesFor } from './deviceRoutes';

/**
 * A temporary event device's session on this browser (Pack 18.1): sign in once with a code, stay signed in, refresh quietly.
 *
 * What is kept: `localStorage['bos-device-session']` = { secret, access_token, expires_at, whoami }. The SECRET is what keeps the device signed in;
 * the short-lived token (10 minutes) is what each request carries; the database checks the session on every call, so neither carries any authority itself.
 * What is never kept or shown: the code. It travels once, in a POST body (never a URL, query string, log, console line, analytics call or error message).
 *
 * Switching between "a person's account" and "a device" is a full page load (the Supabase client is built once, for one mode).
 * Storage can be blocked: every read and write is guarded, and a sign-in that cannot be remembered is refused instead of half working.
 */

export const DEVICE_STORAGE_KEY = 'bos-device-session';
/** One-shot note for the sign-in page after a session ended on its own (revoked, expired, replaced). Not a secret. */
export const ENDED_NOTE_KEY = 'bos-device-ended';
export const INVALID_CODE_MESSAGE = 'That code did not work. Check it, or ask the organizer for a new one.';
export const ENDED_MESSAGE = "This device's access has ended.";
/** Refresh this long before the token runs out. */
export const REFRESH_AHEAD_S = 60;
const RETRY_MS = 15_000;
const MIN_WAIT_MS = 2_000;

export interface DeviceWhoami {
  session_id: string; credential_id?: string; kind: 'device' | 'controller'; role: string; label: string;
  /** Pack 27B: a Training Counter QR session (practice only). */
  training?: boolean;
  event: { id: string; slug: string; name: string; timezone: string; ends_on?: string };
  expires_at: string;
  /** Added by device_whoami(): the staff roles this device counts as (display only). */
  effective_roles?: string[];
}
export interface StoredDeviceSession { secret: string; access_token: string; expires_at: number; whoami: DeviceWhoami }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v.length > 0;

function parseWhoami(v: unknown): DeviceWhoami | null {
  if (!isObj(v) || !str(v.session_id) || !str(v.role) || !str(v.label) || !isObj(v.event)) return null;
  const e = v.event;
  if (!str(e.id) || !str(e.slug) || !str(e.name) || !str(e.timezone)) return null;
  return {
    session_id: v.session_id as string, credential_id: str(v.credential_id) ? v.credential_id as string : undefined,
    kind: v.kind === 'controller' ? 'controller' : 'device', role: v.role as string, label: v.label as string, training: v.training === true,
    event: { id: e.id as string, slug: e.slug as string, name: e.name as string, timezone: e.timezone as string, ends_on: str(e.ends_on) ? e.ends_on as string : undefined },
    expires_at: str(v.expires_at) ? v.expires_at as string : '',
    effective_roles: Array.isArray(v.effective_roles) ? (v.effective_roles as unknown[]).filter((r): r is string => typeof r === 'string') : undefined
  };
}

/** The stored value, or null for anything that is not a complete session (a damaged or foreign value never switches the app into device mode). */
export function parseStoredSession(raw: string | null): StoredDeviceSession | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || !str(v.secret) || !str(v.access_token) || typeof v.expires_at !== 'number' || !Number.isFinite(v.expires_at)) return null;
    const whoami = parseWhoami(v.whoami);
    return whoami ? { secret: v.secret as string, access_token: v.access_token as string, expires_at: v.expires_at, whoami } : null;
  } catch { return null; }
}

/** How long until the next quiet refresh: `REFRESH_AHEAD_S` before the token ends, never sooner than a couple of seconds from now. */
export function msUntilRefresh(expiresAtS: number, nowMs: number): number {
  return Math.max(MIN_WAIT_MS, expiresAtS * 1000 - REFRESH_AHEAD_S * 1000 - nowMs);
}
/** True when the token has run out or is about to. */
export const needsRefresh = (expiresAtS: number, nowMs: number): boolean => expiresAtS * 1000 - nowMs <= REFRESH_AHEAD_S * 1000;

export type SignInResult = { ok: true; whoami: DeviceWhoami } | { ok: false; reason: 'invalid' | 'network' | 'storage' | 'controller'; message: string };

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export interface DeviceDeps {
  url: string;
  key: string;
  fetch: typeof fetch;
  /** Called fresh each time: storage can be blocked, and blocking can change. Null = no storage at all. */
  storage: () => StorageLike | null;
  noteStorage: () => StorageLike | null;
  now: () => number;
  /** A full page load onto a path of this app (sign-in page after the device signs out or its access ends). */
  leave: (path: string) => void;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

export function createDeviceManager(deps: DeviceDeps) {
  const read = (): StoredDeviceSession | null => { try { return parseStoredSession(deps.storage()?.getItem(DEVICE_STORAGE_KEY) ?? null); } catch { return null; } };
  const write = (s: StoredDeviceSession): boolean => {
    try { const st = deps.storage(); if (!st) return false; st.setItem(DEVICE_STORAGE_KEY, JSON.stringify(s)); return st.getItem(DEVICE_STORAGE_KEY) !== null; } catch { return false; }
  };
  const wipe = () => { try { deps.storage()?.removeItem(DEVICE_STORAGE_KEY); } catch { /* blocked */ } };

  let current: StoredDeviceSession | null = read();
  let ending = false;
  let inflight: Promise<boolean> | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(f => { try { f(); } catch { /* a listener must never break the session */ } });

  const post = async (body: Record<string, unknown>): Promise<Response | null> => {
    try {
      return await deps.fetch(`${deps.url}/functions/v1/device-session`, {
        method: 'POST', headers: { apikey: deps.key, 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', referrerPolicy: 'no-referrer'
      });
    } catch { return null; }   // no signal: the caller decides; the error text is never kept (it could echo the request)
  };

  const schedule = () => {
    if (timer !== null) { deps.clearTimeout(timer); timer = null; }
    if (!current) return;
    timer = deps.setTimeout(() => { void refresh(); }, msUntilRefresh(current.expires_at, deps.now()));
  };

  /** The session is over (revoked, expired, replaced, signed out elsewhere): forget it here, leave a one-time note, load the sign-in page (or `to`). */
  function endLocally(withNote = true, to = '/device'): void {
    if (ending) return;
    ending = true;
    if (timer !== null) { deps.clearTimeout(timer); timer = null; }
    current = null; wipe();
    if (withNote) { try { deps.noteStorage()?.setItem(ENDED_NOTE_KEY, '1'); } catch { /* the page still loads */ } }
    emit();
    deps.leave(to);
  }

  function accept(body: unknown, previous: DeviceWhoami | null, secret: string): StoredDeviceSession | null {
    if (!isObj(body) || !str(body.access_token) || typeof body.expires_at !== 'number') return null;
    const whoami = parseWhoami(body.whoami);
    if (!whoami) return null;
    // device_whoami() adds the effective roles; a plain refresh does not carry them, so keep what we already know for the same session.
    if (!whoami.effective_roles && previous && previous.session_id === whoami.session_id) whoami.effective_roles = previous.effective_roles;
    return { secret, access_token: body.access_token as string, expires_at: body.expires_at, whoami };
  }

  /** One refresh at a time, however many callers ask. Resolves true when there is a fresh token. A 401 ends the session. */
  function refresh(): Promise<boolean> {
    if (!current) return Promise.resolve(false);
    if (inflight) return inflight;
    const secret = current.secret;
    inflight = (async () => {
      try {
        const res = await post({ action: 'refresh', session_secret: secret });
        if (!res) { retryLater(); return false; }
        if (res.status === 401 || res.status === 403) { endLocally(); return false; }
        if (!res.ok) { retryLater(); return false; }
        const next = accept(await res.json().catch(() => null), current?.whoami ?? null, secret);
        if (!next || !current || current.secret !== secret) { retryLater(); return false; }
        current = next; write(next); schedule(); emit();
        return true;
      } finally { inflight = null; }
    })();
    return inflight;
  }
  function retryLater() {
    if (!current || ending) return;
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(() => { void refresh(); }, RETRY_MS);
  }

  return {
    /** Device mode is on while a complete session is stored. */
    isActive: () => current !== null && !ending,
    getSession: () => current,
    getWhoami: () => current?.whoami ?? null,
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },

    /** The code goes out once, in a POST body. Nothing is stored until the server accepts it. */
    async signIn(input: string): Promise<SignInResult> {
      const code = normalizeDeviceCode(input);
      if (!code) return { ok: false, reason: 'invalid', message: INVALID_CODE_MESSAGE };
      const res = await post({ action: 'signin', code });
      if (!res) return { ok: false, reason: 'network', message: 'Could not reach the server. Check the signal and try again.' };
      if (res.status === 401 || res.status === 403 || res.status === 400) return { ok: false, reason: 'invalid', message: INVALID_CODE_MESSAGE };
      if (!res.ok) return { ok: false, reason: 'network', message: 'The server did not answer properly. Try again in a moment.' };
      const body: unknown = await res.json().catch(() => null);
      const secret = isObj(body) && str(body.session_secret) ? body.session_secret as string : '';
      const next = secret ? accept(body, null, secret) : null;
      if (!next) return { ok: false, reason: 'network', message: 'The server did not answer properly. Try again in a moment.' };
      if (next.whoami.kind !== 'device') {
        void post({ action: 'signout', session_secret: secret });
        return { ok: false, reason: 'controller', message: 'This code is for the stream controller, not for a phone or tablet.' };
      }
      if (!write(next)) {
        void post({ action: 'signout', session_secret: secret });
        return { ok: false, reason: 'storage', message: 'This browser is blocking site storage, so the device could not stay signed in. Allow site data for this page, then try again.' };
      }
      ending = false; current = next; schedule(); emit();
      return { ok: true, whoami: next.whoami };
    },

    refresh,
    /** The token every request carries. Refreshes first when it is about to run out; when that is not possible the old one is returned (the database will refuse it). */
    async getAccessToken(): Promise<string | null> {
      if (!current) return null;
      if (needsRefresh(current.expires_at, deps.now())) await refresh();
      return current?.access_token ?? null;
    },
    /** Called when the page comes back to the front, the signal returns, or another tab changed the stored session. */
    async wake(): Promise<void> {
      const stored = read();
      if (current && !stored) { endLocally(); return; }          // signed out (or ended) in another tab
      if (stored && current && stored.secret !== current.secret) { current = stored; emit(); }
      if (current && needsRefresh(current.expires_at, deps.now())) await refresh();
      else schedule();
    },
    start() { schedule(); },
    /** Merge what device_whoami() says (effective roles, the event's end date, the true expiry) into the stored session. */
    applyWhoami(raw: unknown): void {
      if (!current || !isObj(raw)) return;
      const merged = parseWhoami({ ...current.whoami, ...raw, event: { ...current.whoami.event, ...(isObj(raw.event) ? raw.event : {}) } });
      if (!merged) return;
      if (JSON.stringify(merged) === JSON.stringify(current.whoami)) return;   // nothing new: no re-render, no write
      current = { ...current, whoami: merged };
      write(current); emit();
    },
    /** The server said this session has ended (device_whoami refused it). */
    endLocally,
    /**
     * Sign out on purpose: tell the server (best effort), forget it here, load the sign-in page. No "ended" note.
     * Pack 27A: a counter phone that EXITS goes back to the ordinary site instead (`to`), where a signed-in person's own account is untouched: the
     * device session lived under its own storage key and never replaced the account's.
     */
    async signOut(to = '/device'): Promise<void> {
      const s = current;
      if (s) {
        try { await Promise.race([post({ action: 'signout', session_secret: s.secret }), new Promise(r => deps.setTimeout(() => r(null), 4000))]); } catch { /* signed out here regardless */ }
      }
      endLocally(false, to);
    },
    /** The one-time "access has ended" note for the sign-in page. */
    takeEndedNote(): boolean {
      try { const st = deps.noteStorage(); const v = st?.getItem(ENDED_NOTE_KEY) === '1'; if (v) st?.removeItem(ENDED_NOTE_KEY); return v; } catch { return false; }
    }
  };
}
export type DeviceManager = ReturnType<typeof createDeviceManager>;

// ---------------------------------------------------------------- the QR fragment
let pendingCode: string | null = null;
let metaSet = false;
const onDevicePath = (pathname: string) => /(^|\/)device\/?$/.test(pathname);

/** Keeps a referrer from carrying anything off this page while a code is on it. */
export function setNoReferrer(): void {
  if (typeof document === 'undefined' || metaSet) return;
  metaSet = true;
  const m = document.createElement('meta');
  m.name = 'referrer'; m.content = 'no-referrer'; m.setAttribute('data-device', '1');
  document.head.appendChild(m);
}

/**
 * `/device#c=XXXXXXXXXXXX` (what the QR opens): read the code into memory and take the fragment OFF the address immediately, before any request,
 * so it never reaches history entries shown to people, screenshots of the address bar, analytics or a referrer. Runs once, when the app starts.
 */
export function captureFragment(loc: Pick<Location, 'pathname' | 'search' | 'hash'>, hist: Pick<History, 'replaceState' | 'state'>): string | null {
  if (!onDevicePath(loc.pathname) || !loc.hash) return pendingCode;
  setNoReferrer();
  const code = parseCodeFragment(loc.hash);
  try { hist.replaceState(hist.state, '', loc.pathname + loc.search); } catch { /* the address stays; the code is in memory */ }
  if (code) pendingCode = code;
  return pendingCode;
}
/** The code a QR carried, once. */
export function takePendingCode(): string | null { const c = pendingCode; pendingCode = null; return c; }

// ---------------------------------------------------------------- the one manager for this page load
const guard = (f: () => StorageLike | null): StorageLike | null => { try { return f(); } catch { return null; } };
let config = { url: '', key: '' };
/** Called once by src/lib/supabase.ts, which owns the project URL and the public key. */
export function configureDevice(c: { url: string; key: string }): void { config = c; }

let manager: DeviceManager | null = null;
export function deviceManager(): DeviceManager {
  manager ??= createDeviceManager({
    get url() { return config.url; }, get key() { return config.key; },
    fetch: (...a) => fetch(...a),
    storage: () => guard(() => (typeof localStorage === 'undefined' ? null : localStorage)),
    noteStorage: () => guard(() => (typeof sessionStorage === 'undefined' ? null : sessionStorage)),
    now: () => Date.now(),
    // Leaving for the sign-in page keeps a code the QR just carried (a signed-out phone scanning the Counter QR again signs in at once).
    leave: path => { const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, ''); const c = path === '/device' ? takePendingCode() : null; window.location.replace(`${base}${path}${c ? `#c=${c}` : ''}`); },
    setTimeout: (f, ms) => window.setTimeout(f, ms),
    clearTimeout: t => window.clearTimeout(t as number)
  });
  return manager;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') captureFragment(window.location, window.history);

/** True when this browser holds a device session. Decided when the app starts; changing it is a full page load. */
export const isDeviceMode = (): boolean => deviceManager().isActive();
export const storedWhoami = (): DeviceWhoami | null => deviceManager().getWhoami();
/** The roles this device counts as, for display (device_whoami's answer when known, else derived from its role). */
export function deviceRoles(w: DeviceWhoami | null = storedWhoami()): string[] { return w ? (w.effective_roles ?? effectiveRolesFor(w.role)) : []; }

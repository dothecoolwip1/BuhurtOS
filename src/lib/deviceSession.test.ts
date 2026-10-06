import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_STORAGE_KEY, ENDED_NOTE_KEY, INVALID_CODE_MESSAGE, captureFragment, createDeviceManager, msUntilRefresh, needsRefresh, parseStoredSession, takePendingCode,
  type DeviceDeps, type DeviceWhoami
} from './deviceSession';

const CODE = 'K7Q2M9XD4TRH';
const SECRET = 'S3CRET-secret-secret-secret-0123456789';
const whoami = (over: Partial<DeviceWhoami> = {}): DeviceWhoami => ({
  session_id: 'sess-1', credential_id: 'cred-1', kind: 'device', role: 'marshal', label: 'Marshal Phone',
  event: { id: 'ev-1', slug: 'red-deer-rumble', name: 'Red Deer Rumble', timezone: 'America/Edmonton' }, expires_at: '2026-10-12T06:00:00.000Z', ...over
});
const memory = (blocked = false) => {
  const m = new Map<string, string>();
  return { map: m, api: blocked ? null : { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } };
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Calls { url: string; body: Record<string, unknown>; init: RequestInit }
function setup(opts: { handler?: (call: Calls) => Response | Promise<Response>; blocked?: boolean; stored?: object; now?: number } = {}) {
  const local = memory(opts.blocked), note = memory();
  if (opts.stored) local.map.set(DEVICE_STORAGE_KEY, JSON.stringify(opts.stored));
  const calls: Calls[] = [];
  const clock = { now: opts.now ?? 1_800_000_000_000 };
  const left: string[] = [];
  const timers: { f: () => void; ms: number }[] = [];
  const deps: DeviceDeps = {
    url: 'https://proj.example', key: 'pub-key',
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url: String(url), body: JSON.parse(String(init.body)), init };
      calls.push(call);
      return opts.handler ? opts.handler(call) : json(500, {});
    }) as unknown as typeof fetch,
    storage: () => local.api, noteStorage: () => note.api, now: () => clock.now,
    leave: p => { left.push(p); },
    setTimeout: (f, ms) => { const t = { f, ms }; timers.push(t); return t; },
    clearTimeout: t => { const i = timers.indexOf(t as { f: () => void; ms: number }); if (i >= 0) timers.splice(i, 1); }
  };
  return { mgr: createDeviceManager(deps), calls, local, note, clock, left, timers };
}
const okSignin = (exp: number, who = whoami()) => json(200, { access_token: 'jwt-1', expires_in: 600, expires_at: exp, session_secret: SECRET, whoami: who });

const NOW = 1_800_000_000_000;
const EXP = NOW / 1000 + 600;
const stored = (over: object = {}) => ({ secret: SECRET, access_token: 'jwt-0', expires_at: EXP, whoami: whoami(), ...over });

describe('storage shape', () => {
  it('accepts a complete session', () => { expect(parseStoredSession(JSON.stringify(stored()))?.whoami.role).toBe('marshal'); });
  it('refuses anything else, so a damaged value never switches the app into device mode', () => {
    for (const raw of [null, '', 'nope', '{}', '[]', JSON.stringify({ ...stored(), secret: '' }), JSON.stringify({ ...stored(), expires_at: 'x' }), JSON.stringify({ ...stored(), whoami: { role: 'marshal' } })]) expect(parseStoredSession(raw)).toBeNull();
  });
});

describe('refresh timing', () => {
  it('refreshes 60 seconds before the token ends', () => {
    expect(msUntilRefresh(1000, 0)).toBe(940_000);
    expect(msUntilRefresh(1000, 900_000)).toBe(40_000);
  });
  it('never spins: at least two seconds, even when already late', () => { expect(msUntilRefresh(1000, 5_000_000)).toBe(2000); });
  it('needsRefresh is true inside the last minute', () => {
    expect(needsRefresh(1000, 941_000)).toBe(true);
    expect(needsRefresh(1000, 100_000)).toBe(false);
  });
});

describe('sign in', () => {
  it('posts the code in a JSON body, stores the session, and starts the refresh timer', async () => {
    const t = setup({ handler: () => okSignin(EXP) });
    const r = await t.mgr.signIn('k7q2-m9xd-4trh');
    expect(r.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe('https://proj.example/functions/v1/device-session');
    expect(t.calls[0].init.method).toBe('POST');
    expect(t.calls[0].body).toEqual({ action: 'signin', code: CODE });
    expect((t.calls[0].init.headers as Record<string, string>).apikey).toBe('pub-key');
    const kept = JSON.parse(t.local.map.get(DEVICE_STORAGE_KEY)!);
    expect(kept.secret).toBe(SECRET);
    expect(kept.access_token).toBe('jwt-1');
    expect(t.mgr.isActive()).toBe(true);
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0].ms).toBe((EXP - 60) * 1000 - NOW);
  });
  it('the code is never in a URL, a query string, a stored value or an error', async () => {
    const t = setup({ handler: () => okSignin(EXP) });
    await t.mgr.signIn(CODE);
    expect(t.calls[0].url).not.toContain(CODE);
    expect(t.calls[0].url).not.toContain('?');
    expect(JSON.stringify([...t.local.map.values()])).not.toContain(CODE);
    const bad = setup({ handler: () => json(401, { error: INVALID_CODE_MESSAGE }) });
    const r = await bad.mgr.signIn(CODE);
    expect(JSON.stringify(r)).not.toContain(CODE);
    expect(JSON.stringify([...bad.local.map.values(), ...bad.note.map.values()])).not.toContain(CODE);
  });
  it('a wrong, expired, withdrawn or throttled code all give the identical answer (the server\'s one 401)', async () => {
    const answers = new Set<string>();
    for (const status of [401, 403, 400]) {
      const t = setup({ handler: () => json(status, { error: 'whatever the server says' }) });
      answers.add(JSON.stringify(await t.mgr.signIn(CODE)));
      expect(t.local.map.size).toBe(0);
    }
    expect(answers.size).toBe(1);
    expect([...answers][0]).toContain(INVALID_CODE_MESSAGE);
  });
  it('a code that cannot be a code never leaves the browser', async () => {
    const t = setup({ handler: () => okSignin(EXP) });
    const r = await t.mgr.signIn('SHORT');
    expect(r).toMatchObject({ ok: false, reason: 'invalid', message: INVALID_CODE_MESSAGE });
    expect(t.calls).toHaveLength(0);
  });
  it('no signal is not "wrong code"', async () => {
    const t = setup({ handler: () => { throw new Error('network down'); } });
    const r = await t.mgr.signIn(CODE);
    expect(r).toMatchObject({ ok: false, reason: 'network' });
    expect(JSON.stringify(r)).not.toContain(CODE);
  });
  it('refuses the stream controller\'s credential on a phone or tablet, and closes the session it opened', async () => {
    const t = setup({ handler: c => (c.body.action === 'signout' ? json(200, { ok: true }) : okSignin(EXP, whoami({ kind: 'controller', role: 'broadcast_controller' }))) });
    const r = await t.mgr.signIn(CODE);
    expect(r).toMatchObject({ ok: false, reason: 'controller' });
    expect(t.local.map.size).toBe(0);
    expect(t.calls.map(c => c.body.action)).toContain('signout');
  });
  it('blocked storage: refuses honestly instead of half working, and closes the session', async () => {
    const t = setup({ blocked: true, handler: c => (c.body.action === 'signout' ? json(200, { ok: true }) : okSignin(EXP)) });
    const r = await t.mgr.signIn(CODE);
    expect(r).toMatchObject({ ok: false, reason: 'storage' });
    expect(t.mgr.isActive()).toBe(false);
    expect(t.calls.map(c => c.body.action)).toEqual(['signin', 'signout']);
  });
  it('storage that throws never breaks reading or ending a session', () => {
    const t = setup({ stored: stored() });
    expect(t.mgr.isActive()).toBe(true);
    const throwing = createDeviceManager({
      url: 'u', key: 'k', fetch: (async () => json(401, {})) as unknown as typeof fetch,
      storage: () => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } }),
      noteStorage: () => null, now: () => NOW, leave: () => undefined, setTimeout: () => 0, clearTimeout: () => undefined
    });
    expect(throwing.isActive()).toBe(false);
    expect(() => throwing.endLocally()).not.toThrow();
  });
});

describe('a stored session', () => {
  it('turns device mode on and survives a reload (a new manager over the same storage)', () => {
    const t = setup({ stored: stored() });
    expect(t.mgr.isActive()).toBe(true);
    expect(t.mgr.getWhoami()?.label).toBe('Marshal Phone');
    const again = createDeviceManager({ url: 'u', key: 'k', fetch: fetch, storage: () => t.local.api, noteStorage: () => null, now: () => NOW, leave: () => undefined, setTimeout: () => 0, clearTimeout: () => undefined });
    expect(again.getWhoami()?.session_id).toBe('sess-1');
  });
  it('a plain person session (nothing stored) is not device mode', () => { expect(setup().mgr.isActive()).toBe(false); });
});

describe('refresh', () => {
  it('posts the secret, takes the new token and the new end time, and keeps the effective roles it already knew', async () => {
    const t = setup({ stored: stored({ whoami: whoami({ effective_roles: ['marshal'] }) }), handler: () => json(200, { access_token: 'jwt-2', expires_in: 600, expires_at: EXP + 600, whoami: whoami() }), now: NOW });
    expect(await t.mgr.refresh()).toBe(true);
    expect(t.calls[0].body).toEqual({ action: 'refresh', session_secret: SECRET });
    const kept = JSON.parse(t.local.map.get(DEVICE_STORAGE_KEY)!);
    expect(kept.access_token).toBe('jwt-2');
    expect(kept.expires_at).toBe(EXP + 600);
    expect(kept.whoami.effective_roles).toEqual(['marshal']);
    expect(kept.secret).toBe(SECRET);
  });
  it('is single-flight: many callers, one request', async () => {
    let release!: (r: Response) => void;
    const t = setup({ stored: stored(), now: (EXP - 10) * 1000, handler: () => new Promise<Response>(r => { release = r; }) });
    const a = t.mgr.refresh(), b = t.mgr.refresh(), c = t.mgr.getAccessToken();
    expect(t.calls).toHaveLength(1);
    release(json(200, { access_token: 'jwt-2', expires_in: 600, expires_at: EXP + 600, whoami: whoami() }));
    expect(await a).toBe(true); expect(await b).toBe(true);
    expect(await c).toBe('jwt-2');
    expect(t.calls).toHaveLength(1);
  });
  it('a 401 ends the session here: forgets it, leaves a one-time note, loads the sign-in page', async () => {
    const t = setup({ stored: stored(), handler: () => json(401, { error: 'x' }) });
    expect(await t.mgr.refresh()).toBe(false);
    expect(t.mgr.isActive()).toBe(false);
    expect(t.local.map.has(DEVICE_STORAGE_KEY)).toBe(false);
    expect(t.note.map.get(ENDED_NOTE_KEY)).toBe('1');
    expect(t.left).toEqual(['/device']);
    expect(t.mgr.takeEndedNote()).toBe(true);
    expect(t.mgr.takeEndedNote()).toBe(false);   // once
  });
  it('no signal or a busy server keeps the session and tries again in 15 seconds', async () => {
    for (const handler of [() => { throw new Error('offline'); }, () => json(503, {})]) {
      const t = setup({ stored: stored(), handler });
      expect(await t.mgr.refresh()).toBe(false);
      expect(t.mgr.isActive()).toBe(true);
      expect(t.local.map.has(DEVICE_STORAGE_KEY)).toBe(true);
      expect(t.left).toEqual([]);
      expect(t.timers.at(-1)?.ms).toBe(15_000);
    }
  });
  it('getAccessToken refreshes only inside the last minute', async () => {
    const early = setup({ stored: stored(), handler: () => json(500, {}), now: NOW });
    expect(await early.mgr.getAccessToken()).toBe('jwt-0');
    expect(early.calls).toHaveLength(0);
    const late = setup({ stored: stored(), handler: () => json(200, { access_token: 'jwt-2', expires_in: 600, expires_at: EXP + 600, whoami: whoami() }), now: (EXP - 30) * 1000 });
    expect(await late.mgr.getAccessToken()).toBe('jwt-2');
    expect(late.calls).toHaveLength(1);
  });
  it('wake (screen back, signal back) refreshes a token that is about to end, and notices a sign-out in another tab', async () => {
    const t = setup({ stored: stored(), handler: () => json(200, { access_token: 'jwt-2', expires_in: 600, expires_at: EXP + 600, whoami: whoami() }), now: (EXP - 10) * 1000 });
    await t.mgr.wake();
    expect(t.calls).toHaveLength(1);
    const other = setup({ stored: stored() });
    other.local.map.delete(DEVICE_STORAGE_KEY);
    await other.mgr.wake();
    expect(other.mgr.isActive()).toBe(false);
    expect(other.left).toEqual(['/device']);
  });
});

describe('sign out and whoami', () => {
  it('signs out: tells the server with the secret, forgets it, loads the sign-in page with no "ended" note', async () => {
    const t = setup({ stored: stored(), handler: () => json(200, { ok: true }) });
    await t.mgr.signOut();
    expect(t.calls[0].body).toEqual({ action: 'signout', session_secret: SECRET });
    expect(t.local.map.has(DEVICE_STORAGE_KEY)).toBe(false);
    expect(t.note.map.has(ENDED_NOTE_KEY)).toBe(false);
    expect(t.left).toEqual(['/device']);
  });
  it('signs out locally even when the server cannot be reached', async () => {
    const t = setup({ stored: stored(), handler: () => { throw new Error('offline'); } });
    await t.mgr.signOut();
    expect(t.mgr.isActive()).toBe(false);
    expect(t.left).toEqual(['/device']);
  });
  it('device_whoami\'s answer is merged into the stored session', () => {
    const t = setup({ stored: stored() });
    t.mgr.applyWhoami({ session_id: 'sess-1', role: 'marshal', label: 'Marshal Phone', effective_roles: ['marshal'], expires_at: '2026-10-12T06:00:00.000Z', event: { id: 'ev-1', slug: 'red-deer-rumble', name: 'Red Deer Rumble', timezone: 'America/Edmonton', ends_on: '2026-10-10' } });
    const kept = JSON.parse(t.local.map.get(DEVICE_STORAGE_KEY)!);
    expect(kept.whoami.effective_roles).toEqual(['marshal']);
    expect(kept.whoami.event.ends_on).toBe('2026-10-10');
    expect(kept.secret).toBe(SECRET);
  });
  it('a 401 on any session call never writes the secret or the code into the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(k => vi.spyOn(console, k).mockImplementation(() => undefined));
    const t = setup({ handler: () => json(401, {}) });
    await t.mgr.signIn(CODE);
    const s = setup({ stored: stored(), handler: () => json(401, {}) });
    await s.mgr.refresh();
    await s.mgr.signOut();
    for (const sp of spies) { expect(JSON.stringify(sp.mock.calls)).not.toContain(CODE); expect(JSON.stringify(sp.mock.calls)).not.toContain(SECRET); sp.mockRestore(); }
  });
});

describe('the QR fragment', () => {
  beforeEach(() => { takePendingCode(); });
  afterEach(() => { takePendingCode(); });
  const hist = () => ({ state: null, replaceState: vi.fn() });
  it('takes the fragment OFF the address at once and keeps the code in memory only', () => {
    const h = hist();
    const code = captureFragment({ pathname: '/device', search: '', hash: `#c=${CODE}` }, h as unknown as History);
    expect(code).toBe(CODE);
    expect(h.replaceState).toHaveBeenCalledTimes(1);
    expect(h.replaceState.mock.calls[0][2]).toBe('/device');
    expect(String(h.replaceState.mock.calls[0][2])).not.toContain(CODE);
    expect(takePendingCode()).toBe(CODE);
    expect(takePendingCode()).toBeNull();   // once
  });
  it('keeps an innocent query string and drops the fragment even when the code in it is not valid', () => {
    const h = hist();
    expect(captureFragment({ pathname: '/BuhurtOS/device', search: '?x=1', hash: '#c=garbage' }, h as unknown as History)).toBeNull();
    expect(h.replaceState.mock.calls[0][2]).toBe('/BuhurtOS/device?x=1');
  });
  it('leaves every other page\'s address alone', () => {
    const h = hist();
    captureFragment({ pathname: '/events/x', search: '', hash: '#scorekeeping' }, h as unknown as History);
    expect(h.replaceState).not.toHaveBeenCalled();
  });
});

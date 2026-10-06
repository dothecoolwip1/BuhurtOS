import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHeartbeat, HEARTBEAT_MAX_BYTES, type HeartbeatInput } from '../src/heartbeat';
import { MemoryCredentialStore } from '../src/credentials';
import { Logger, Redactor } from '../src/log';
import { ControllerSession } from '../src/session';
import { guardRequest, startUi } from '../src/ui/server';
import { CONTROLLER_CODE, makeHarness, OBS_PASSWORD, waitFor, type Harness } from './harness';

describe('local screen: loopback-only guard', () => {
  const ok = { remoteAddress: '127.0.0.1', host: '127.0.0.1:4777', method: 'GET' };
  it('accepts the operator\'s own browser on loopback with a matching Host', () => {
    expect(guardRequest(ok, 4777)).toBeNull();
    expect(guardRequest({ ...ok, host: 'localhost:4777' }, 4777)).toBeNull();
    expect(guardRequest({ ...ok, host: '[::1]:4777', remoteAddress: '::1' }, 4777)).toBeNull();
    expect(guardRequest({ ...ok, remoteAddress: '::ffff:127.0.0.1' }, 4777)).toBeNull();
  });
  it('refuses any peer that is not loopback', () => {
    for (const addr of ['192.168.1.50', '10.0.0.2', '::ffff:192.168.1.5', 'fe80::1', '8.8.8.8', '0.0.0.0', undefined, '']) expect(guardRequest({ ...ok, remoteAddress: addr }, 4777), String(addr)?.toString())?.toMatchObject({ status: 403 });
  });
  it('refuses a wrong or missing Host (DNS rebinding) and the wrong port', () => {
    for (const host of ['evil.example:4777', 'evil.example', '127.0.0.1', '127.0.0.1:4778', '127.0.0.1.evil.example:4777', 'localhost', '192.168.1.5:4777', '', undefined, '127.0.0.1:4777@evil.example', '0.0.0.0:4777'])
      expect(guardRequest({ ...ok, host }, 4777), String(host))?.toMatchObject({ status: 421 });
  });
  it('a change (POST) needs the marker header AND JSON, and any Origin must be our own', () => {
    const post = { ...ok, method: 'POST', marker: '1', contentType: 'application/json' };
    expect(guardRequest(post, 4777)).toBeNull();
    expect(guardRequest({ ...post, origin: 'http://127.0.0.1:4777' }, 4777)).toBeNull();
    expect(guardRequest({ ...post, origin: 'https://evil.example' }, 4777)).toMatchObject({ status: 403 });
    expect(guardRequest({ ...post, origin: 'null' }, 4777)).toMatchObject({ status: 403 });
    expect(guardRequest({ ...post, marker: undefined }, 4777)).toMatchObject({ status: 403 });
    expect(guardRequest({ ...post, marker: '0' }, 4777)).toMatchObject({ status: 403 });
    expect(guardRequest({ ...post, contentType: 'text/plain' }, 4777)).toMatchObject({ status: 415 });
    expect(guardRequest({ ...post, contentType: 'application/x-www-form-urlencoded' }, 4777)).toMatchObject({ status: 415 });
    expect(guardRequest({ ...post, fetchSite: 'cross-site' }, 4777)).toMatchObject({ status: 403 });
    expect(guardRequest({ ...ok, method: 'PUT' }, 4777)).toMatchObject({ status: 405 });
    expect(guardRequest({ ...ok, method: 'DELETE' }, 4777)).toMatchObject({ status: 405 });
    expect(guardRequest({ ...ok, fetchSite: 'cross-site' }, 4777)).toMatchObject({ status: 403 });
  });
});

function call(port: number, path: string, o: { method?: string; host?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: string; json: () => Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: { host: o.host ?? `127.0.0.1:${port}`, ...(data ? { 'content-length': String(Buffer.byteLength(data)) } : {}), ...o.headers } }, res => {
      const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => { const body = Buffer.concat(c).toString(); resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) as Record<string, unknown> }); });
    });
    req.on('error', reject); req.end(data);
  });
}
const JSON_POST = { 'content-type': 'application/json', 'x-bos-companion': '1' };

describe('local screen: the real server', () => {
  let h: Harness; let ui: Awaited<ReturnType<typeof startUi>>; let port = 0; let quit = 0;
  beforeAll(async () => {
    h = await makeHarness({ startController: true });
    ui = await startUi({ controller: h.controller, session: h.session, store: h.store, logger: h.logger, saveConfig: f => h.files.updateConfig(f), onQuit: () => { quit++; } }, 0);
    port = ui.port;
    await waitFor(() => h.controller.obs.connected);
  });
  afterAll(async () => { await ui.close(); await h.stop(); });

  it('listens on loopback ONLY', () => {
    const addr = ui.server.address() as { address: string };
    expect(addr.address).toBe('127.0.0.1');
  });
  it('serves the page and the state to the laptop itself; the page has no external requests', async () => {
    const page = await call(port, '/');
    expect(page.status).toBe(200); expect(page.body).toContain('BuhurtOS Broadcast Companion'); expect(page.body).toContain('CAMERA OFF');
    expect(page.body).not.toMatch(/<script[^>]+src=|<link[^>]+href="(?!data:)/);   // no external scripts or stylesheets
    expect(page.body).not.toMatch(/innerHTML\s*=/);                                                                                           // built with textContent, never innerHTML
    const st = await call(port, '/api/state');
    expect(st.status).toBe(200); expect(st.json()).toMatchObject({ version: '0.1.0', obs: { connected: true } });
  });
  it('refuses a wrong Host (rebinding) and wrong methods with a plain error', async () => {
    expect((await call(port, '/api/state', { host: 'evil.example' })).status).toBe(421);
    expect((await call(port, '/api/state', { host: `127.0.0.1:${port + 1}` })).status).toBe(421);
    expect((await call(port, '/api/state', { method: 'PUT', headers: JSON_POST, body: {} })).status).toBe(405);
    expect((await call(port, '/nope')).status).toBe(404);
  });
  it('refuses changes without the marker header, as text/plain, or from another origin; nothing changes', async () => {
    const before = h.files.state.cameraOffLocal;
    expect((await call(port, '/api/camera-off', { method: 'POST', body: {} })).status).toBe(403);
    expect((await call(port, '/api/camera-off', { method: 'POST', headers: { 'x-bos-companion': '1', 'content-type': 'text/plain' }, body: {} })).status).toBe(415);
    expect((await call(port, '/api/camera-off', { method: 'POST', headers: { ...JSON_POST, origin: 'https://evil.example' }, body: {} })).status).toBe(403);
    expect(h.files.state.cameraOffLocal).toBe(before);
  });
  it('never returns a secret: not the OBS password, the controller code, the session secret or a token', async () => {
    await call(port, '/api/credentials', { method: 'POST', headers: JSON_POST, body: { obsPassword: OBS_PASSWORD, controllerCode: CONTROLLER_CODE } });
    const st = (await call(port, '/api/state')).body + (await call(port, '/')).body;
    for (const s of [OBS_PASSWORD, CONTROLLER_CODE, CONTROLLER_CODE.replace(/-/g, ''), 'sess-secret-0123456789', 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc']) expect(st.includes(s), s).toBe(false);
    expect(h.logs.join('\n')).not.toContain(OBS_PASSWORD); expect(h.logs.join('\n')).not.toContain(CONTROLLER_CODE);
  });
  it('the big local button latches Camera Off, saves it to disk first, and only the clear button releases it', async () => {
    expect((await call(port, '/api/camera-off', { method: 'POST', headers: JSON_POST, body: {} })).status).toBe(200);
    expect(h.files.state.cameraOffLocal).toBe(true);
    await waitFor(() => h.standin.state.program === 'Camera Off', 3000, 'Camera Off scene');
    expect((await call(port, '/api/state')).json()).toMatchObject({ camera: { effective: true, local: true } });
    expect((await call(port, '/api/auto', { method: 'POST', headers: JSON_POST, body: {} })).status).toBe(200);     // Return to Auto does not clear it
    await new Promise(r => setTimeout(r, 200));
    expect(h.standin.state.program).toBe('Camera Off');
    expect((await call(port, '/api/camera-off/clear', { method: 'POST', headers: JSON_POST, body: {} })).status).toBe(200);
    await waitFor(() => h.standin.state.program === 'Holding', 3000, 'back to holding');
  });
  it('validates what it is sent', async () => {
    expect((await call(port, '/api/take', { method: 'POST', headers: JSON_POST, body: { kind: 'evil' } })).status).toBe(400);
    expect((await call(port, '/api/take', { method: 'POST', headers: JSON_POST, body: { kind: 'lyst' } })).status).toBe(400);
    expect((await call(port, '/api/music', { method: 'POST', headers: JSON_POST, body: { mode: 'loud' } })).status).toBe(400);
    expect((await call(port, '/api/test-scene', { method: 'POST', headers: JSON_POST, body: {} })).status).toBe(400);
    const big = await call(port, '/api/mapping', { method: 'POST', headers: JSON_POST, body: { pad: 'x'.repeat(100_000) } });
    expect(big.status).toBe(413);
  });
  it('local Take / Holding / Break / Return to Auto work as manual choices; mapping and audio setup are saved', async () => {
    h.world.setField('field 2', 'live');
    await waitFor(() => h.controller.status().fields.some(f => f.key === 'field 2' && f.mode === 'live'), 3000, 'the controller to see Field 2 live');
    await call(port, '/api/take', { method: 'POST', headers: JSON_POST, body: { kind: 'lyst', field: 'Field 2' } });
    await waitFor(() => h.standin.state.program === 'Lyst 2 Live', 3000, 'Lyst 2');
    await call(port, '/api/take', { method: 'POST', headers: JSON_POST, body: { kind: 'break' } });
    await waitFor(() => h.standin.state.program === 'Break', 3000, 'Break');
    await call(port, '/api/auto', { method: 'POST', headers: JSON_POST, body: {} });
    await waitFor(() => h.standin.state.program === 'Lyst 2 Live', 3000, 'AUTO follows the live fight');
    await call(port, '/api/mapping', { method: 'POST', headers: JSON_POST, body: { mapping: { lysts: { 'field 2': { live: 'Lyst 2 Live' } }, holding: 'Holding', break: null, cameraOff: 'Camera Off' } } });
    expect(h.files.config.mapping.break).toBeNull();
    await call(port, '/api/audio', { method: 'POST', headers: JSON_POST, body: { audio: { normalLevelDb: -10, fadeMs: 500 } } });
    expect(h.files.config.audio).toMatchObject({ normalLevelDb: -10, fadeMs: 500, musicSource: 'Music' });
  });
  it('quit is a request to the owner (exit code 64 in the real program)', async () => {
    await call(port, '/api/quit', { method: 'POST', headers: JSON_POST, body: {} });
    await waitFor(() => quit === 1);
  });
});

describe('heartbeat body', () => {
  const input = (o: Partial<HeartbeatInput> = {}): HeartbeatInput => ({
    obsConnected: true, obsVersion: '32.0.0', obsProblem: null, mode: 'auto', modeSource: 'server',
    onAir: { kind: 'lyst', field: 'field 1', scene: 'Lyst 1 Live', reason: 'Following Field 1: in a fight' }, fight: { field: 'field 1', mode: 'live', summary: 'A vs B, round 2' },
    cameraOff: false, cameraOffLocal: false, cameraOffSource: null, alsoLive: [{ field: 'field 2', label: 'Field 2', summary: 'C vs D', firstLiveMs: 1, mapped: true }], problems: [],
    music: { state: 'muted', ducking: 'on', mic: 'quiet', locked: false }, controllerVersion: '0.1.0', stale: false, staleSeconds: null, ...o
  });
  it('has the keys the contract suggests', () => {
    const b = buildHeartbeat(input());
    for (const k of ['obs_connected', 'obs_version', 'mode', 'on_air', 'fight', 'camera_off', 'camera_off_local', 'also_live', 'mapping_problems', 'music', 'controller_version', 'stale']) expect(b, k).toHaveProperty(k);
    expect(b.on_air).toEqual({ kind: 'lyst', field: 'field 1', scene: 'Lyst 1 Live', reason: 'Following Field 1: in a fight' });
    expect(b.music).toEqual({ state: 'muted', ducking: 'on', mic: 'quiet', locked: false });
  });
  it('stays under 4 KB however much there is to report, and never contains a secret or a raw level', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ code: 'live_scene_missing' as const, field: `field ${i}`, text: 'x'.repeat(400), severity: 'error' as const }));
    const live = Array.from({ length: 40 }, (_, i) => ({ field: `field ${i}`, label: 'L'.repeat(90), summary: 'y'.repeat(500), firstLiveMs: i, mapped: true }));
    const b = buildHeartbeat(input({ problems: many, alsoLive: live, onAir: { kind: 'lyst', field: 'f', scene: 's'.repeat(500), reason: 'r'.repeat(500) }, obsProblem: 'p'.repeat(500) }));
    expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThanOrEqual(HEARTBEAT_MAX_BYTES);
    expect(JSON.stringify(b)).not.toMatch(/password|secret|token|peak|inputLevels|streamKey/i);
  });
});

describe('controller session (device-session Edge Function client)', () => {
  const answer = (o: Record<string, unknown> = {}) => new Response(JSON.stringify({ access_token: 'jwt.part.one', expires_at: 1_000_000 + 600, expires_in: 600, session_secret: 'S'.repeat(43), whoami: { session_id: 's', label: 'Stream Laptop', event: { id: 'e', slug: 'rumble', name: 'Rumble', timezone: 'UTC' } }, ...o }), { status: 200 });
  const mk = (handler: (body: Record<string, unknown>, url: string, init: RequestInit) => Response | Promise<Response>, o: { now?: () => number } = {}) => {
    const store = new MemoryCredentialStore();
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const logger = new Logger({ redactor: new Redactor(), echo: false });
    const fetchFn = (async (url: string, init: RequestInit) => { const body = JSON.parse(String(init.body)) as Record<string, unknown>; calls.push({ url: String(url), body, headers: init.headers as Record<string, string> }); return handler(body, String(url), init); }) as unknown as typeof fetch;
    let now = 1_000_000_000;
    const s = new ControllerSession({ baseUrl: () => 'https://x.supabase.co', anonKey: () => 'pk', store, logger, fetchFn, now: o.now ?? (() => now) });
    return { s, store, calls, advance: (ms: number) => { now += ms; } };
  };
  it('no code: nothing is called and the status says so (AUTO still runs from public data)', async () => {
    const { s, calls } = mk(() => answer());
    await s.ensure(); expect(s.status).toBe('no_code'); expect(calls).toHaveLength(0); expect(await s.getToken()).toBeNull();
  });
  it('signs in with the code at /functions/v1/device-session with the apikey header, keeps the secret in the store, and returns the token', async () => {
    const { s, store, calls } = mk(() => answer({ expires_at: 1_000_000 + 600 }), { now: () => 1_000_000_000 });
    await store.set('controller_code', 'K7Q2-M9XD-4TRH');
    await s.ensure();
    expect(calls[0]).toMatchObject({ url: 'https://x.supabase.co/functions/v1/device-session', body: { action: 'signin', code: 'K7Q2-M9XD-4TRH' } });
    expect(calls[0].headers).toMatchObject({ apikey: 'pk', 'content-type': 'application/json' });
    expect(s.status).toBe('ok'); expect(s.whoami?.label).toBe('Stream Laptop'); expect(await store.get('session_secret')).toBe('S'.repeat(43));
    expect(await s.getToken()).toBe('jwt.part.one');
  });
  it('refreshes before the token expires, with the session secret (not the code), and shares one attempt between concurrent callers', async () => {
    let now = 1_000_000_000; const exp = () => Math.floor(now / 1000) + 600;
    const { s, store, calls } = mk((b) => answer({ access_token: `jwt-${calls.length}.b.c`, expires_at: exp(), session_secret: b.action === 'signin' ? 'N'.repeat(43) : undefined }), { now: () => now });
    await store.set('controller_code', 'K7Q2-M9XD-4TRH');
    await s.ensure(); expect(calls).toHaveLength(1);
    now += 60_000; await s.ensure(); expect(calls).toHaveLength(1);                       // 9 minutes left: nothing to do
    now += 500_000; await Promise.all([s.ensure(), s.ensure(), s.ensure()]);               // under 90 s left: ONE refresh
    expect(calls).toHaveLength(2); expect(calls[1].body).toEqual({ action: 'refresh', session_secret: 'N'.repeat(43) });
    expect(JSON.stringify(calls[1].body)).not.toContain('K7Q2');
  });
  it('a network outage keeps the valid token, reports offline once it ends, and recovers; it never throws', async () => {
    let now = 1_000_000_000; let down = false;
    const { s, store, calls } = mk(() => { if (down) throw new Error('fetch failed'); return answer({ expires_at: Math.floor(now / 1000) + 600 }); }, { now: () => now });
    await store.set('controller_code', 'K7Q2-M9XD-4TRH'); await s.ensure();
    down = true; now += 520_000;
    await expect(s.ensure()).resolves.toBeUndefined();
    expect(s.status).toBe('ok'); expect(await s.getToken()).toBe('jwt.part.one'); expect(s.lastProblem).toMatch(/cannot reach BuhurtOS/);
    now += 100_000; await s.ensure(); expect(s.status).toBe('offline'); expect(await s.getToken()).toBeNull();      // expired and still down: public reads only
    down = false; now += 5_000; await s.ensure(); expect(s.status).toBe('ok'); expect(calls.length).toBeGreaterThan(2);
  });
  it('a refused code is not hammered: backs off, says why, and recovers when a new code is entered', async () => {
    let now = 1_000_000_000; let refuse = true;
    const { s, store, calls } = mk(() => (refuse ? new Response('{"error":"no"}', { status: 401 }) : answer({ expires_at: Math.floor(now / 1000) + 600 })), { now: () => now });
    await store.set('controller_code', 'WRONG-CODE-XXXX');
    await s.ensure(); expect(s.status).toBe('rejected'); expect(s.lastProblem).toMatch(/refused the controller code/);
    const n = calls.length; await s.ensure(); await s.ensure(); expect(calls.length).toBe(n);   // within the backoff: no new attempts
    now += 31_000; await s.ensure(); expect(calls.length).toBe(n + 1);
    now += 61_000; await s.ensure(); const m = calls.length; now += 121_000; await s.ensure(); expect(calls.length).toBeGreaterThan(m);
    refuse = false; await s.useNewCode('K7Q2-M9XD-4TRH'); expect(s.status).toBe('ok');
  });
  it('a refresh answered 401 (session ended) signs in again with the stored code', async () => {
    let now = 1_000_000_000; let ended = false;
    const { s, store, calls } = mk((b) => (b.action === 'refresh' && ended ? new Response('{}', { status: 401 }) : answer({ expires_at: Math.floor(now / 1000) + 600, access_token: `t${calls.length}.b.c` })), { now: () => now });
    await store.set('controller_code', 'K7Q2-M9XD-4TRH'); await s.ensure();
    ended = true; now += 560_000; await s.ensure();
    expect(calls.map(c => c.body.action)).toEqual(['signin', 'refresh', 'signin']); expect(s.status).toBe('ok');
  });
  it('clearing the code forgets the session', async () => {
    const { s, store } = mk(() => answer());
    await store.set('controller_code', 'K7Q2-M9XD-4TRH'); await s.ensure();
    await s.clearCode(); expect(s.status).toBe('no_code'); expect(await store.get('session_secret')).toBeNull(); expect(await s.getToken()).toBeNull();
  });
});

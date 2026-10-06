import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { startStandIn, STANDIN_LABEL } from '../../../scripts/obs-standin/server.mjs';
import { ALLOWED_REQUESTS, DANGEROUS_REQUESTS, violations } from '../../../scripts/obs-standin/allowlist.mjs';
import { COMPANION_VERSION } from '../src/version';
import { sleep } from './harness';

const require = createRequire(import.meta.url);
const WebSocket = require('ws') as typeof import('ws').default;
const root = join(__dirname, '..');

// A raw protocol client, independent of the Companion's own client: it checks the STAND-IN behaves like obs-websocket v5.
const sha = (s: string) => createHash('sha256').update(s).digest('base64');
async function raw(url: string, password: string | null, subs = 0) {
  const ws = new WebSocket(url, 'obswebsocket.json');
  const inbox: Array<{ op: number; d: Record<string, any> }> = []; let closed: { code: number; reason: string } | null = null;
  ws.on('message', m => inbox.push(JSON.parse(m.toString()))); ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; }); ws.on('error', () => undefined);
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const next = async (op: number, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const i = inbox.findIndex(m => m.op === op); if (i >= 0) return inbox.splice(i, 1)[0]; await sleep(5); } throw new Error(`no op ${op}`); };
  const hello = await next(0);
  const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: subs };
  if (hello.d.authentication && password !== null) identify.authentication = sha(sha(password + hello.d.authentication.salt) + hello.d.authentication.challenge);
  ws.send(JSON.stringify({ op: 1, d: identify }));
  return { ws, hello, inbox, next, closed: () => closed, send: (op: number, d: unknown) => ws.send(JSON.stringify({ op, d })) };
}

describe('OBS STAND-IN (it is NOT OBS): protocol manners', () => {
  it('is labelled as a stand-in everywhere it speaks', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      expect(STANDIN_LABEL).toMatch(/not OBS/i);
      const c = await raw(so.url, 'pw'); await c.next(2);
      c.send(6, { requestType: 'GetVersion', requestId: 'v' });
      const r = await c.next(7);
      expect(r.d.responseData.platformDescription).toMatch(/not OBS/i);
      expect(r.d.responseData.obsWebSocketVersion).toBe('5.5.0');
      c.ws.close();
    } finally { await so.close(); }
  });

  it('sends a fresh challenge and salt per connection, accepts the right proof, closes 4009 on a wrong one, 4007 on a request before identify', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      const a = await raw(so.url, 'pw'), b = await raw(so.url, 'pw');
      expect(a.hello.d.authentication.challenge).not.toBe(b.hello.d.authentication.challenge);
      expect(a.hello.d.authentication.salt).not.toBe(b.hello.d.authentication.salt);
      expect((await a.next(2)).d.negotiatedRpcVersion).toBe(1);
      const bad = await raw(so.url, 'wrong'); await sleep(100); expect(bad.closed()).toMatchObject({ code: 4009 });
      const early = new WebSocket(so.url, 'obswebsocket.json'); const codes: number[] = []; early.on('close', c => codes.push(c)); early.on('error', () => undefined);
      await new Promise<void>(r => early.once('open', () => r())); early.send(JSON.stringify({ op: 6, d: { requestType: 'GetVersion', requestId: 'x' } })); await sleep(100);
      expect(codes).toEqual([4007]);
      expect(so.identifiedSessions()).toBe(2);
      a.ws.close(); b.ws.close();
    } finally { await so.close(); }
  });

  it('answers with OBS-shaped responses and error codes (600 not found, 300 missing field, 402 out of range, 204 unknown request)', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      const c = await raw(so.url, 'pw'); await c.next(2);
      const ask = async (type: string, data?: unknown) => { c.send(6, { requestType: type, requestId: type + Math.random(), requestData: data }); return (await c.next(7)).d; };
      expect((await ask('GetSceneList')).responseData).toMatchObject({ currentProgramSceneName: 'Holding', scenes: expect.arrayContaining([expect.objectContaining({ sceneName: 'Lyst 1 Live', sceneUuid: expect.any(String), sceneIndex: expect.any(Number) })]) });
      expect((await ask('SetCurrentProgramScene', { sceneName: 'Nope' })).requestStatus).toMatchObject({ result: false, code: 600 });
      expect((await ask('SetCurrentProgramScene', {})).requestStatus).toMatchObject({ result: false, code: 300 });
      expect((await ask('SetInputVolume', { inputName: 'Music', inputVolumeDb: 99 })).requestStatus).toMatchObject({ code: 402 });
      expect((await ask('SetInputVolume', { inputName: 'Music', inputVolumeDb: -5, inputVolumeMul: 1 })).requestStatus).toMatchObject({ code: 400 });
      expect((await ask('NoSuchRequest')).requestStatus).toMatchObject({ result: false, code: 204 });
      expect((await ask('SetCurrentProgramScene', { sceneName: 'Break' })).requestStatus).toMatchObject({ result: true, code: 100 });
      expect((await ask('GetCurrentProgramScene')).responseData).toMatchObject({ sceneName: 'Break', currentProgramSceneName: 'Break' });
      expect((await ask('GetInputVolume', { inputName: 'Music' })).responseData).toMatchObject({ inputVolumeDb: 0, inputVolumeMul: 1 });
      expect((await ask('GetSourceFilterList', { sourceName: 'Music' })).responseData.filters[0]).toMatchObject({ filterName: 'Ducking', filterKind: 'compressor_filter', filterEnabled: true });
      expect((await ask('GetMediaInputStatus', { inputName: 'Music' })).responseData).toMatchObject({ mediaState: 'OBS_MEDIA_STATE_STOPPED' });
      expect((await ask('GetMediaInputStatus', { inputName: 'Announcer Mic' })).requestStatus.code).toBe(604);
      c.ws.close();
    } finally { await so.close(); }
  });

  it('request batches: results in order, haltOnFailure stops at the first failure, every request is logged as a batch request', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      const c = await raw(so.url, 'pw'); await c.next(2);
      c.send(8, { requestId: 'b1', haltOnFailure: false, executionType: 0, requests: [{ requestType: 'GetVersion' }, { requestType: 'SetCurrentProgramScene', requestData: { sceneName: 'Nope' } }, { requestType: 'GetStats' }] });
      const r = (await c.next(9)).d;
      expect(r.requestId).toBe('b1'); expect(r.results.map((x: { requestStatus: { result: boolean } }) => x.requestStatus.result)).toEqual([true, false, true]);
      c.send(8, { requestId: 'b2', haltOnFailure: true, requests: [{ requestType: 'GetVersion' }, { requestType: 'SetCurrentProgramScene', requestData: { sceneName: 'Nope' } }, { requestType: 'GetStats' }] });
      expect((await c.next(9)).d.results).toHaveLength(2);
      expect(so.log.every(e => e.viaBatch)).toBe(true);
      c.ws.close();
    } finally { await so.close(); }
  });

  it('events follow subscriptions: scene and input changes only to those who asked; meters only to those who asked for them', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      const scenesOnly = await raw(so.url, 'pw', 4), withMeters = await raw(so.url, 'pw', 4 | 8 | 65536), none = await raw(so.url, 'pw', 0);
      await scenesOnly.next(2); await withMeters.next(2); await none.next(2);
      so.setProgramByHand('Break'); so.setMutedByHand('Music', true); so.injectMeter('Announcer Mic', { db: -10, ms: 300 });
      await sleep(250);
      const types = (c: typeof scenesOnly) => c.inbox.filter(m => m.op === 5).map(m => m.d.eventType);
      expect(types(scenesOnly)).toEqual(['CurrentProgramSceneChanged']);
      expect(types(withMeters)).toContain('CurrentProgramSceneChanged'); expect(types(withMeters)).toContain('InputMuteStateChanged'); expect(types(withMeters)).toContain('InputVolumeMeters');
      expect(types(none)).toEqual([]);
      const meter = withMeters.inbox.find(m => m.d.eventType === 'InputVolumeMeters' && m.d.eventData.inputs.some((i: { inputName: string; inputLevelsMul: number[][] }) => i.inputName === 'Announcer Mic' && i.inputLevelsMul[0][0] > 0.1));
      expect(meter).toBeTruthy();
      so.exit(); await sleep(100);
      scenesOnly.ws.terminate(); withMeters.ws.terminate(); none.ws.terminate();
    } finally { await so.close(); }
  });

  it('really does what it is asked, including the things the Companion must NEVER ask: a mistake would show up', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      const c = await raw(so.url, 'pw'); await c.next(2);
      const ask = async (type: string, data?: unknown) => { c.send(6, { requestType: type, requestId: type, requestData: data }); return (await c.next(7)).d; };
      expect((await ask('GetStreamServiceSettings')).responseData.streamServiceSettings.key).toMatch(/FAKE/);
      expect((await ask('StartStream')).requestStatus.result).toBe(true);
      expect(so.state.streaming).toBe(true); expect(so.state.everStreamStarted).toBe(true);
      expect(so.state.dangerousSeen).toEqual(['GetStreamServiceSettings', 'StartStream']);
      const bad = so.violations();
      expect(bad.map(b => b.type)).toEqual(['GetStreamServiceSettings', 'StartStream']);
      expect(bad[0].why[0]).toMatch(/not on the allow-list/);
      c.ws.close();
    } finally { await so.close(); }
  });

  it('fault injection: drop, exit, restart (program scene resets), slow, hung and failing requests, password change', async () => {
    const so = await startStandIn({ password: 'pw' });
    try {
      const c = await raw(so.url, 'pw'); await c.next(2);
      so.dropConnections(); await sleep(100); expect(c.closed()).not.toBeNull();
      so.setProgramByHand('Break');
      await so.restart({ downMs: 50 });
      expect(so.state.program).toBe('Holding');
      const d = await raw(so.url, 'pw'); await d.next(2);
      so.setLatency(150); const t0 = Date.now(); d.send(6, { requestType: 'GetStats', requestId: 's' }); await d.next(7); expect(Date.now() - t0).toBeGreaterThanOrEqual(140); so.setLatency(0);
      so.hangNext('GetStats'); d.send(6, { requestType: 'GetStats', requestId: 'h' }); await sleep(150); expect(d.inbox.filter(m => m.op === 7)).toHaveLength(0);
      so.failNext('GetStats', 702, 'x'); d.send(6, { requestType: 'GetStats', requestId: 'f' }); expect((await d.next(7)).d.requestStatus).toMatchObject({ result: false, code: 702 });
      so.setPassword('new'); await sleep(100); expect(d.closed()).not.toBeNull();
      const e = await raw(so.url, 'new'); expect((await e.next(2)).d.negotiatedRpcVersion).toBe(1);
      await so.exit(); await expect(raw(so.url, 'new')).rejects.toBeTruthy();
      e.ws.terminate();
    } finally { await so.close(); }
  });

  it('the allow-list checker flags scoped misuse (a different input muted, a stray filter, media STOP) and ignores clean logs', () => {
    const log = [
      { type: 'SetInputMute', data: { inputName: 'Announcer Mic', inputMuted: true } }, { type: 'SetInputVolume', data: { inputName: 'Other', inputVolumeDb: -3 } },
      { type: 'SetSourceFilterEnabled', data: { sourceName: 'Music', filterName: 'Gate' } }, { type: 'TriggerMediaInputAction', data: { inputName: 'Playlist', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP' } },
      { type: 'SetInputMute', data: { inputName: 'Music', inputMuted: true } }, { type: 'GetVersion' }
    ];
    const bad = violations(log, { mutable: ['Music'], music: 'Music', filter: 'Ducking', media: 'Playlist' }) as Array<{ type: string }>;
    expect(bad.map(b => b.type)).toEqual(['SetInputMute', 'SetInputVolume', 'SetSourceFilterEnabled', 'TriggerMediaInputAction']);
    expect(violations(log.slice(4))).toEqual([]);
    expect(ALLOWED_REQUESTS).toHaveLength(19); expect(DANGEROUS_REQUESTS).toContain('GetStreamServiceSettings');
  });
});

describe('the bundle', () => {
  it('builds into ONE file that swaps the browser supabase client for the Node shim and holds no forbidden request', () => {
    const out = execFileSync('node', ['build.mjs'], { cwd: root, encoding: 'utf8' });
    expect(out).toMatch(/built dist\/companion\.mjs v0\.1\.0/);
    const bundle = readFileSync(join(root, 'dist', 'companion.mjs'), 'utf8');
    expect(bundle).not.toContain('mvbxlebznlgroptwwdsm');                       // the browser client's default (hosted) project address is not in it
    expect(bundle).not.toMatch(/import\.meta\.env\.[A-Z_]+/);                 // nothing reads the browser build's environment
    expect(bundle).toContain('configureSupabase'); expect(bundle).toContain('/functions/v1/device-session'); expect(bundle).toContain('buildArena'); expect(bundle).toContain('broadcastScene');
    expect(bundle).toContain('decideProgram');
    for (const t of DANGEROUS_REQUESTS) expect(bundle.includes(`'${t}'`) || bundle.includes(`"${t}"`), t).toBe(false);
  });
  it('the version in the code is the version in package.json', () => {
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe(COMPANION_VERSION);
  });
});

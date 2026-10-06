import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startStandIn } from '../../../scripts/obs-standin/server.mjs';
import { ALLOWED_REQUESTS as STANDIN_ALLOWED, DANGEROUS_REQUESTS } from '../../../scripts/obs-standin/allowlist.mjs';
import { ALLOWED_REQUESTS, assertBatchAllowed, checkRequest, isAllowedRequest, ObsRequestDenied, type ObsPolicy } from '../src/obs/allowlist';
import { ObsClient } from '../src/obs/client';
import { quietLogger } from '../src/log';
import { OBS_PASSWORD, waitFor } from './harness';

const POLICY: ObsPolicy = { mutableInputs: ['Music', 'Camera 1 Audio'], volumeInput: 'Music', duckingSource: 'Music', duckingFilter: 'Ducking', mediaSource: 'Music Files' };

describe('request allow-list (default deny)', () => {
  it('is exactly the 19 requests of the plan, and matches the stand-in harness copy', () => {
    expect([...ALLOWED_REQUESTS].sort()).toEqual([...STANDIN_ALLOWED].sort());
    expect(ALLOWED_REQUESTS).toHaveLength(19);
  });

  const VALID: Array<[string, Record<string, unknown> | undefined]> = [
    ['GetVersion', undefined], ['GetStats', undefined], ['GetSceneList', undefined], ['GetCurrentProgramScene', undefined],
    ['SetCurrentProgramScene', { sceneName: 'Lyst 1 Live' }], ['GetStudioModeEnabled', undefined], ['GetInputList', undefined], ['GetInputList', { inputKind: 'ffmpeg_source' }],
    ['GetInputMute', { inputName: 'Anything' }], ['SetInputMute', { inputName: 'Music', inputMuted: true }], ['SetInputMute', { inputName: 'Camera 1 Audio', inputMuted: false }],
    ['GetInputVolume', { inputName: 'Anything' }], ['SetInputVolume', { inputName: 'Music', inputVolumeDb: -14 }], ['SetInputVolume', { inputName: 'Music', inputVolumeMul: 0.5 }],
    ['GetSourceFilterList', { sourceName: 'Music' }], ['GetSourceFilter', { sourceName: 'Music', filterName: 'Ducking' }],
    ['SetSourceFilterEnabled', { sourceName: 'Music', filterName: 'Ducking', filterEnabled: false }],
    ['SetSourceFilterSettings', { sourceName: 'Music', filterName: 'Ducking', filterSettings: { ratio: 8, sidechain_source: 'Announcer Mic' }, overlay: true }],
    ['GetMediaInputStatus', { inputName: 'Music Files' }],
    ['TriggerMediaInputAction', { inputName: 'Music Files', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' }],
    ['TriggerMediaInputAction', { inputName: 'Music Files', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE' }],
    ['GetStreamStatus', undefined], ['GetRecordStatus', undefined]
  ];
  it.each(VALID)('allows %s %j', (type, data) => { expect(checkRequest(type, data, POLICY)).toBeNull(); });

  it('every request type the plan forbids is refused (and stream / stream-key requests are impossible)', () => {
    expect(DANGEROUS_REQUESTS.length).toBeGreaterThan(30);
    for (const t of DANGEROUS_REQUESTS) { expect(isAllowedRequest(t), t).toBe(false); expect(checkRequest(t, {}, POLICY), t).toMatch(/not a request the Companion may send/); }
    for (const t of ['StartStream', 'StopStream', 'ToggleStream', 'GetStreamServiceSettings', 'SetStreamServiceSettings', 'StartRecord', 'StartVirtualCam', 'TriggerHotkeyByName', 'CallVendorRequest', 'SetInputSettings', 'RemoveScene', 'Sleep', 'SaveSourceScreenshot'])
      expect(checkRequest(t, undefined, POLICY), t).not.toBeNull();
  });

  it('refuses odd request types: case changes, whitespace, prototype names, non-strings', () => {
    for (const t of ['getversion', 'GETVERSION', 'GetVersion ', ' GetVersion', 'GetVersion\n', 'Get Version', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'GetVersion\u0000StartStream']) expect(checkRequest(t, undefined, POLICY), JSON.stringify(t)).not.toBeNull();
    for (const t of [undefined, null, 0, 1, true, {}, [], ['GetVersion'], () => 'GetVersion', Symbol('x')]) expect(checkRequest(t, undefined, POLICY), String(typeof t)).not.toBeNull();
  });

  it('refuses a request that carries fields it should not (nothing is smuggled along)', () => {
    expect(checkRequest('GetVersion', { sneaky: 1 }, POLICY)).toMatch(/not a field/);
    expect(checkRequest('SetCurrentProgramScene', { sceneName: 'A', extra: true }, POLICY)).toMatch(/not a field/);
    expect(checkRequest('GetVersion', 'x', POLICY)).not.toBeNull();
    expect(checkRequest('GetVersion', [], POLICY)).not.toBeNull();
  });

  it('SetCurrentProgramScene needs a scene name or uuid, as text', () => {
    for (const d of [{}, { sceneName: '' }, { sceneName: 5 }, { sceneName: 'a'.repeat(300) }, { sceneName: 'A', sceneUuid: 'B' }]) expect(checkRequest('SetCurrentProgramScene', d, POLICY), JSON.stringify(d)).not.toBeNull();
  });

  it('mute and volume only touch the configured music source (and configured camera audio for mute)', () => {
    expect(checkRequest('SetInputMute', { inputName: 'Announcer Mic', inputMuted: true }, POLICY)).toMatch(/configured music source/);
    expect(checkRequest('SetInputMute', { inputName: 'Music', inputMuted: 'yes' }, POLICY)).not.toBeNull();
    expect(checkRequest('SetInputMute', { inputUuid: 'x', inputMuted: true }, POLICY)).not.toBeNull();
    expect(checkRequest('SetInputVolume', { inputName: 'Announcer Mic', inputVolumeDb: -10 }, POLICY)).toMatch(/music source/);
    expect(checkRequest('SetInputVolume', { inputName: 'Camera 1 Audio', inputVolumeDb: -10 }, POLICY)).not.toBeNull();   // mutable, but its volume is not ours to change
    for (const d of [{ inputName: 'Music' }, { inputName: 'Music', inputVolumeDb: -5, inputVolumeMul: 0.5 }, { inputName: 'Music', inputVolumeDb: 6 }, { inputName: 'Music', inputVolumeDb: -101 }, { inputName: 'Music', inputVolumeMul: 3 }, { inputName: 'Music', inputVolumeMul: -1 }, { inputName: 'Music', inputVolumeDb: 'loud' }])
      expect(checkRequest('SetInputVolume', d, POLICY), JSON.stringify(d)).not.toBeNull();
    // with nothing configured, nothing can be muted or changed
    const none: ObsPolicy = { mutableInputs: [], volumeInput: null, duckingSource: null, duckingFilter: null, mediaSource: null };
    expect(checkRequest('SetInputMute', { inputName: 'Music', inputMuted: true }, none)).not.toBeNull();
    expect(checkRequest('SetInputVolume', { inputName: 'Music', inputVolumeDb: -5 }, none)).not.toBeNull();
  });

  it('filter changes are only for the configured ducking filter on the configured music source', () => {
    for (const d of [{ sourceName: 'Announcer Mic', filterName: 'Ducking', filterEnabled: true }, { sourceName: 'Music', filterName: 'Gate', filterEnabled: true }, { sourceName: 'Music', filterName: 'Ducking', filterEnabled: 1 }, { sourceName: 'Music', filterName: 'Ducking' }])
      expect(checkRequest('SetSourceFilterEnabled', d, POLICY), JSON.stringify(d)).not.toBeNull();
    for (const d of [{ sourceName: 'Music', filterName: 'Gate', filterSettings: {} }, { sourceName: 'Music', filterName: 'Ducking', filterSettings: 'x' }, { sourceName: 'Music', filterName: 'Ducking', filterSettings: { nested: { a: 1 } } }, { sourceName: 'Music', filterName: 'Ducking', filterSettings: { 'bad key!': 1 } }, { sourceName: 'Music', filterName: 'Ducking', filterSettings: { a: 1 }, overlay: 'yes' }])
      expect(checkRequest('SetSourceFilterSettings', d, POLICY), JSON.stringify(d)).not.toBeNull();
    const unset: ObsPolicy = { ...POLICY, duckingSource: null, duckingFilter: null };
    expect(checkRequest('SetSourceFilterEnabled', { sourceName: 'Music', filterName: 'Ducking', filterEnabled: true }, unset)).not.toBeNull();
  });

  it('media: play and pause only, only on the configured Media Source', () => {
    for (const a of ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS', 'play', '', undefined])
      expect(checkRequest('TriggerMediaInputAction', { inputName: 'Music Files', mediaAction: a }, POLICY), String(a)).not.toBeNull();
    expect(checkRequest('TriggerMediaInputAction', { inputName: 'Other', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' }, POLICY)).toMatch(/configured Media Source/);
    expect(checkRequest('TriggerMediaInputAction', { inputName: 'Music Files', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' }, { ...POLICY, mediaSource: null })).not.toBeNull();
  });

  it('a batch is checked as a whole: one denied request refuses it all', () => {
    const ok = [{ requestType: 'GetVersion' }, { requestType: 'SetCurrentProgramScene', requestData: { sceneName: 'A' } }];
    expect(() => assertBatchAllowed(ok, POLICY)).not.toThrow();
    for (const bad of [
      [...ok, { requestType: 'StartStream' }], [{ requestType: 'GetStreamServiceSettings' }, ...ok], [{ requestType: 'Sleep', requestData: { sleepMillis: 10 } }],
      [{ requestType: 'SetInputMute', requestData: { inputName: 'Announcer Mic', inputMuted: true } }], [{ requestType: 'GetVersion', requestData: { x: 1 } }], [{ requestType: 'GetVersion', hotkey: 'x' }],
      [], 'nope', [null], [{}], Array.from({ length: 51 }, () => ({ requestType: 'GetVersion' }))
    ]) expect(() => assertBatchAllowed(bad, POLICY), JSON.stringify(bad).slice(0, 80)).toThrow(ObsRequestDenied);
  });
});

describe('the client in front of the (stand-in) OBS: a refused request never reaches the socket', () => {
  it('every denied request, single or in a batch, is rejected IN THE CLIENT; the stand-in logs nothing and the stream was never touched', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    const client = new ObsClient({ port: so.port, getPassword: async () => OBS_PASSWORD, policy: () => POLICY, logger: quietLogger(), backoffMs: [20, 40] });
    try {
      client.start();
      await waitFor(() => client.connected && client.version !== null, 5000, 'identify and version read');
      so.clearLog();
      const raw = client as unknown as { request(t: string, d?: unknown): Promise<unknown>; batch(i: unknown[], o?: unknown): Promise<unknown> };
      for (const t of DANGEROUS_REQUESTS) await expect(raw.request(t, {}), t).rejects.toBeInstanceOf(ObsRequestDenied);
      await expect(raw.request('SetInputMute', { inputName: 'Announcer Mic', inputMuted: true })).rejects.toBeInstanceOf(ObsRequestDenied);
      await expect(raw.batch([{ requestType: 'GetVersion' }, { requestType: 'StartStream' }])).rejects.toBeInstanceOf(ObsRequestDenied);
      await expect(raw.batch([{ requestType: 'StopStream' }, { requestType: 'GetVersion' }])).rejects.toBeInstanceOf(ObsRequestDenied);
      expect(so.log).toHaveLength(0);                                   // nothing was sent: not even the harmless request in the refused batch
      expect(so.state.everStreamStarted).toBe(false);
      expect(so.state.dangerousSeen).toEqual([]);
      // and an allowed batch works and is logged as a batch
      const res = await client.batch([{ requestType: 'GetVersion' }, { requestType: 'GetStreamStatus' }]);
      expect(res.map(r => r.ok)).toEqual([true, true]);
      expect(so.log.every(e => e.viaBatch)).toBe(true);
      expect(so.violations()).toEqual([]);
    } finally { await client.stop(); await so.close(); }
  });
});

// ------------------------------------------------------------------------------------------------ source scan: forbidden requests do not appear in code
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : []; });
}
describe('source scan: the forbidden requests are not in the program at all', () => {
  const root = join(__dirname, '..', 'src');
  const files = sources(root);
  it('no source file mentions a forbidden request name as text to send (the allow-list file only documents them in comments)', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
      for (const t of DANGEROUS_REQUESTS) expect(text.includes(`'${t}'`) || text.includes(`"${t}"`) || text.includes(`\`${t}\``), `${f} mentions ${t}`).toBe(false);
    }
  });
  it('the only place that writes a request to the socket is the client, and it takes requests only after the allow-list check', () => {
    const client = readFileSync(join(root, 'obs', 'client.ts'), 'utf8');
    const sendCalls = files.flatMap(f => (readFileSync(f, 'utf8').match(/\bws\.send\(/g) ?? []).map(() => f.replace(root, '')));
    expect(sendCalls.sort()).toEqual(['/obs/client.ts', '/obs/client.ts']);          // the Identify message and the one send() path
    expect(client).toMatch(/assertRequestAllowed\(type, data, this\.opts\.policy\(\)\);\s*\n\s*const id/);
    expect(client).toMatch(/assertBatchAllowed\(items, this\.opts\.policy\(\)\);\s*\n\s*const id/);
    // nobody else imports the websocket library
    expect(files.filter(f => /from 'ws'/.test(readFileSync(f, 'utf8'))).map(f => f.replace(root, ''))).toEqual(['/obs/client.ts']);
  });
});

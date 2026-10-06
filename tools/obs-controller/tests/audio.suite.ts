import { describe, expect, it } from 'vitest';
import { AudioExecutor, planAudio, type AudioObs, type AudioPlanInput } from '../src/audio';
import { DEFAULT_AUDIO, type AudioConfig } from '../src/config';
import { loudestMul, MicSummary, toDb } from '../src/mic';
import { quietLogger } from '../src/log';
import { startStandIn } from '../../../scripts/obs-standin/server.mjs';
import { ObsClient } from '../src/obs/client';
import { EMPTY_POLICY, type ObsPolicy } from '../src/obs/allowlist';
import { OBS_PASSWORD, waitFor } from './harness';

const CFG: AudioConfig = { ...DEFAULT_AUDIO, musicSource: 'Music', micSource: 'Announcer Mic', duckingFilter: 'Ducking', mediaSource: null, normalLevelDb: -14, fadeMs: 40 };
const base = (o: Partial<AudioPlanInput> = {}): AudioPlanInput => ({
  onAir: { kind: 'holding', phase: null }, camera: { active: false, medical: false }, medicalLock: false, musicMode: 'auto', autoDuck: true,
  present: { music: true, mic: true, filter: true }, cfg: CFG, ...o
});

describe('audio policy table (plan 9.4)', () => {
  it.each([
    ['fight live', { onAir: { kind: 'lyst' as const, phase: 'fightLive' as const } }, 'muted'],
    ['its round break / pause (still fightLive)', { onAir: { kind: 'lyst' as const, phase: 'fightLive' as const } }, 'muted'],
    ['result on screen (post)', { onAir: { kind: 'lyst' as const, phase: 'post' as const } }, 'muted'],
    ['fighters getting ready (armed)', { onAir: { kind: 'lyst' as const, phase: 'armed' as const } }, 'on'],
    ['a quiet Lyst', { onAir: { kind: 'lyst' as const, phase: 'quiet' as const } }, 'on'],
    ['between fights / holding', { onAir: { kind: 'holding' as const, phase: null } }, 'on'],
    ['scheduled break', { onAir: { kind: 'break' as const, phase: null } }, 'on'],
    ['Camera Off (any reason)', { camera: { active: true, medical: false } }, 'muted'],
    ['Camera Off, medical', { camera: { active: true, medical: true } }, 'muted'],
    ['medical lock after the cameras are released', { medicalLock: true }, 'muted'],
    ['muted from the control screen', { musicMode: 'muted' as const }, 'muted'],
    ['paused from the control screen', { musicMode: 'paused' as const }, 'paused'],
    ['no announcer microphone', { present: { music: true, mic: false, filter: true } }, 'muted']
  ])('%s -> music %s', (_name, patch, want) => { expect(planAudio(base(patch as Partial<AudioPlanInput>)).music).toBe(want); });

  it('Camera Off never switches music ON, whatever the music mode or the fight state', () => {
    for (const musicMode of ['auto', 'muted', 'paused'] as const) for (const phase of [null, 'quiet', 'armed', 'fightLive', 'post'] as const)
      expect(planAudio(base({ camera: { active: true, medical: false }, musicMode, onAir: { kind: phase ? 'lyst' : 'holding', phase } })).music).not.toBe('on');
  });
  it('the medical hold beats everything that could turn music on; only an explicit change lifts it (the caller clears the lock)', () => {
    for (const onAir of [{ kind: 'holding' as const, phase: null }, { kind: 'break' as const, phase: null }, { kind: 'lyst' as const, phase: 'quiet' as const }])
      expect(planAudio(base({ medicalLock: true, onAir })).music).toBe('muted');
    expect(planAudio(base({ medicalLock: true })).warnings.map(w => w.code)).toContain('medical_hold');
  });
  it('a missing mic mutes the music only when configured to; a missing music source is reported and nothing is controlled', () => {
    const p = planAudio(base({ present: { music: true, mic: false, filter: true }, cfg: { ...CFG, muteMusicWhenMicMissing: false } }));
    expect(p.music).toBe('on'); expect(p.warnings.map(w => w.code)).toContain('mic_missing');
    const m = planAudio(base({ present: { music: false, mic: true, filter: false } }));
    expect(m.music).toBe('none'); expect(m.warnings.map(w => w.code)).toContain('music_source_missing'); expect(m.duckingEnabled).toBeNull();
    expect(planAudio(base({ cfg: { ...CFG, musicSource: null } })).warnings.map(w => w.code)).toContain('music_source_not_set');
    expect(planAudio(base({ cfg: { ...CFG, micSource: null } })).music).toBe('on');                 // no mic chosen at all: nothing to be missing
  });
  it('Auto Duck follows the control and OFF is a warning; a missing filter is reported', () => {
    expect(planAudio(base({ autoDuck: true })).duckingEnabled).toBe(true);
    const off = planAudio(base({ autoDuck: false }));
    expect(off.duckingEnabled).toBe(false); expect(off.warnings.map(w => w.code)).toContain('auto_duck_off');
    const missing = planAudio(base({ present: { music: true, mic: true, filter: false } }));
    expect(missing.duckingEnabled).toBeNull(); expect(missing.warnings.map(w => w.code)).toContain('ducking_filter_missing');
    expect(planAudio(base({ cfg: { ...CFG, duckingFilter: null } })).warnings.map(w => w.code)).toContain('ducking_filter_not_set');
  });
});

describe('mic quiet / speaking summary (raw levels never leave)', () => {
  it('converts and picks the loudest value', () => {
    expect(toDb(1)).toBeCloseTo(0); expect(toDb(0.1)).toBeCloseTo(-20); expect(toDb(0)).toBe(-100);
    expect(loudestMul([[0.01, 0.2, 0.1], [0.05, 0.3, 0.2]])).toBe(0.3);
    expect(loudestMul(undefined)).toBe(0); expect(loudestMul([[NaN, 'x']])).toBe(0);
  });
  it('speaking above the threshold, held for a second after, quiet after that, unknown without meter events', () => {
    const m = new MicSummary(() => -40, 1000, 3000);
    expect(m.summary(0)).toBe('unknown');
    m.push(0.0001, 100); expect(m.summary(200)).toBe('quiet');                 // -80 dB
    m.push(0.2, 300); expect(m.summary(400)).toBe('speaking');                  // -14 dB
    m.push(0.0001, 700); expect(m.summary(1200)).toBe('speaking');              // within the hold
    m.push(0.0001, 1500); expect(m.summary(1500)).toBe('quiet');
    expect(m.summary(5000)).toBe('unknown');                                    // meters stopped (OBS gone)
    m.reset(); expect(m.summary(5000)).toBe('unknown');
  });
});

// ------------------------------------------------------------------------------------------------ the executor, with a recording fake
function fakeObs(init: { muted: boolean; volumeDb: number; media?: string; filterEnabled?: boolean } = { muted: false, volumeDb: -14 }) {
  const calls: string[] = [];
  const st = { ...init, media: init.media ?? 'OBS_MEDIA_STATE_PAUSED', filterEnabled: init.filterEnabled ?? true };
  const obs: AudioObs = {
    getInputList: async () => [{ inputName: 'Music', inputKind: 'ffmpeg_source' }, { inputName: 'Announcer Mic', inputKind: 'wasapi_input_capture' }, { inputName: 'Playlist', inputKind: 'ffmpeg_source' }],
    getInputMute: async () => st.muted,
    setInputMute: async (n: string, m: boolean) => { calls.push(`mute ${n} ${m}`); st.muted = m; return {}; },
    getInputVolume: async () => ({ db: st.volumeDb, mul: 1 }),
    setInputVolumeDb: async (n: string, db: number) => { calls.push(`vol ${n} ${db}`); st.volumeDb = db; return {}; },
    getSourceFilterList: async (s: string) => (s === 'Music' ? [{ filterName: 'Ducking', filterKind: 'compressor_filter', filterEnabled: st.filterEnabled, filterSettings: { sidechain_source: 'Announcer Mic' } }] : [{ filterName: 'Gate', filterKind: 'noise_gate_filter', filterEnabled: true, filterSettings: {} }]),
    setSourceFilterEnabled: async (s: string, f: string, e: boolean) => { calls.push(`filter ${s}/${f} ${e}`); st.filterEnabled = e; return {}; },
    getMediaInputStatus: async () => st.media,
    mediaPlay: async (n: string) => { calls.push(`play ${n}`); st.media = 'OBS_MEDIA_STATE_PLAYING'; return {}; },
    mediaPause: async (n: string) => { calls.push(`pause ${n}`); st.media = 'OBS_MEDIA_STATE_PAUSED'; return {}; }
  } as unknown as AudioObs;
  return { obs, calls, st };
}
const executor = (obs: AudioObs, cfg: Partial<AudioConfig> = {}) => new AudioExecutor(obs, () => ({ ...CFG, fadeMs: 1000, ...cfg }), quietLogger(), { stepMs: 200, sleep: async () => undefined });   // the real step size; only the waiting is skipped

describe('audio executor: commands in the right order, stepped, never per word', () => {
  it('fight starts: a stepped fade out, then mute, then the level is put back ready for later (all while silent)', async () => {
    const { obs, calls } = fakeObs({ muted: false, volumeDb: -14 });
    const ex = executor(obs); await ex.checkSetup();
    await ex.apply({ music: 'muted', reason: 'fight', duckingEnabled: true, warnings: [] });
    const vols = calls.filter(c => c.startsWith('vol')).map(c => Number(c.split(' ').pop()));
    expect(calls.indexOf('mute Music true')).toBeGreaterThan(calls.findIndex(c => c.startsWith('vol')));
    expect(calls[calls.length - 1]).toBe('vol Music -14');                       // normal level restored AFTER the mute, ready for later
    const fade = calls.slice(0, calls.indexOf('mute Music true')).filter(c => c.startsWith('vol')).map(c => Number(c.split(' ').pop()));
    expect(fade.length).toBeGreaterThanOrEqual(2); expect(fade.length).toBeLessThanOrEqual(8);   // a handful of steps, not one per word
    expect(fade).toEqual([...fade].sort((a, b) => b - a));                       // downwards only
    expect(fade[fade.length - 1]).toBe(-60);
    expect(vols.length).toBeLessThanOrEqual(10);
  });
  it('a quiet period begins: unmute from silence and fade UP to the normal level (never a blast)', async () => {
    const { obs, calls } = fakeObs({ muted: true, volumeDb: -14 });
    const ex = executor(obs); await ex.checkSetup();
    await ex.apply({ music: 'on', reason: 'between fights', duckingEnabled: true, warnings: [] });
    expect(calls[0]).toBe('vol Music -60'); expect(calls[1]).toBe('mute Music false');
    const up = calls.slice(2).map(c => Number(c.split(' ').pop()));
    expect(up).toEqual([...up].sort((a, b) => a - b)); expect(up[up.length - 1]).toBe(-14);
  });
  it('is idempotent: the same plan again sends nothing; silence is enforced if someone un-mutes, sound only on a change', async () => {
    const { obs, calls, st } = fakeObs({ muted: false, volumeDb: -14 });
    const ex = executor(obs); await ex.checkSetup();
    await ex.apply({ music: 'on', reason: 'x', duckingEnabled: true, warnings: [] });
    expect(calls).toEqual([]);                                                   // already on at the normal level: nothing to do
    await ex.apply({ music: 'muted', reason: 'fight', duckingEnabled: true, warnings: [] });
    const n = calls.length; await ex.apply({ music: 'muted', reason: 'fight', duckingEnabled: true, warnings: [] }); expect(calls.length).toBe(n);
    ex.noteMute('Music', false); st.muted = false;                               // a person un-mutes during a fight
    await ex.apply({ music: 'muted', reason: 'fight', duckingEnabled: true, warnings: [] }); expect(calls.slice(n).join()).toContain('mute Music true');
    // between fights a person mutes by hand: it stays muted (no fighting the operator), until the state changes
    await ex.apply({ music: 'on', reason: 'between', duckingEnabled: true, warnings: [] });
    const m = calls.length; ex.noteMute('Music', true); st.muted = true;
    await ex.apply({ music: 'on', reason: 'between', duckingEnabled: true, warnings: [] }); expect(calls.length).toBe(m);
  });
  it('Auto Duck: the ducking filter is switched to match, both ways, once', async () => {
    const { obs, calls } = fakeObs({ muted: false, volumeDb: -14, filterEnabled: true });
    const ex = executor(obs); await ex.checkSetup();
    await ex.apply({ music: 'on', reason: 'x', duckingEnabled: false, warnings: [] });
    await ex.apply({ music: 'on', reason: 'x', duckingEnabled: false, warnings: [] });
    await ex.apply({ music: 'on', reason: 'x', duckingEnabled: true, warnings: [] });
    expect(calls.filter(c => c.startsWith('filter'))).toEqual(['filter Music/Ducking false', 'filter Music/Ducking true']);
  });
  it('checkSetup reports sources, the filter, whether it is keyed to the mic and whether the mic has a noise gate', async () => {
    const { obs } = fakeObs();
    const ex = executor(obs); const p = await ex.checkSetup();
    expect(p).toMatchObject({ music: true, mic: true, filter: true, keyedToMic: true, micGate: true });
    const bad = executor(obs, { musicSource: 'Gone', micSource: 'Also Gone', duckingFilter: 'Nope' });
    expect(await bad.checkSetup()).toMatchObject({ music: false, mic: false, filter: false });
  });
  it('a real Media Source: pause means pause (and play when music comes back), checked first so nothing restarts; without one, pause = mute', async () => {
    const real = fakeObs({ muted: false, volumeDb: -14, media: 'OBS_MEDIA_STATE_PLAYING' });
    const ex = executor(real.obs, { mediaSource: 'Playlist' }); await ex.checkSetup();
    await ex.apply({ music: 'paused', reason: 'paused from control', duckingEnabled: true, warnings: [] });
    expect(real.calls).toContain('pause Playlist'); expect(real.calls.some(c => c.startsWith('mute'))).toBe(false);
    await ex.apply({ music: 'on', reason: 'back', duckingEnabled: true, warnings: [] });
    expect(real.calls).toContain('play Playlist');
    const nobody = fakeObs({ muted: false, volumeDb: -14 });
    const ex2 = executor(nobody.obs); await ex2.checkSetup();
    await ex2.apply({ music: 'paused', reason: 'paused', duckingEnabled: true, warnings: [] });
    expect(nobody.calls).toContain('mute Music true'); expect(nobody.calls.some(c => c.startsWith('pause'))).toBe(false);
  });
  it('a newer plan cuts a running fade short, and a failing command is retried on the next plan', async () => {
    const { obs, calls } = fakeObs({ muted: false, volumeDb: -14 });
    let n = 0; const slow: AudioObs = { ...obs, setInputVolumeDb: async (name, db) => { n++; await new Promise(r => setTimeout(r, 5)); return obs.setInputVolumeDb(name, db); } };
    const ex = new AudioExecutor(slow, () => ({ ...CFG, fadeMs: 1000 }), quietLogger(), { stepMs: 200, sleep: async () => undefined });
    await ex.checkSetup();
    const p1 = ex.apply({ music: 'muted', reason: 'fight', duckingEnabled: null, warnings: [] });
    await new Promise(r => setTimeout(r, 12));                                   // the fade out is under way (one step done)
    await ex.apply({ music: 'on', reason: 'quiet', duckingEnabled: null, warnings: [] });
    await p1;
    expect(calls).not.toContain('mute Music true');                              // the fade out was abandoned before the mute
    expect(n).toBeGreaterThan(0);
    expect(ex.actual.volumeDb).toBe(-14);                                        // and the music is back at the normal level
    const failing: AudioObs = { ...obs, setInputMute: async () => { throw new Error('OBS said no'); } };
    const ex2 = executor(failing); await ex2.checkSetup();
    await ex2.apply({ music: 'muted', reason: 'x', duckingEnabled: null, warnings: [] });
    expect(ex2.lastError).toMatch(/OBS said no/); expect(ex2.lastWant).toBeNull();                 // will be retried
  });
});

describe('audio executor against the (stand-in) OBS: only allow-listed requests, only the configured sources', () => {
  it('a full cycle fight -> between -> Camera Off -> medical lock leaves a clean log', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    const policy: ObsPolicy = { ...EMPTY_POLICY, mutableInputs: ['Music'], volumeInput: 'Music', duckingSource: 'Music', duckingFilter: 'Ducking', mediaSource: 'Music' };
    const obs = new ObsClient({ port: so.port, getPassword: async () => OBS_PASSWORD, policy: () => policy, logger: quietLogger(), backoffMs: [20] });
    try {
      obs.start(); await waitFor(() => obs.connected);
      const ex = new AudioExecutor(obs, () => ({ ...CFG, mediaSource: 'Music', fadeMs: 20 }), quietLogger(), { stepMs: 5 });
      await ex.checkSetup();
      so.clearLog();
      for (const music of ['muted', 'on', 'muted', 'on'] as const) await ex.apply({ music, reason: music, duckingEnabled: true, warnings: [] });
      expect(so.state.inputs.get('Music')?.muted).toBe(false);
      expect(so.violations({ mutable: ['Music'], music: 'Music', filter: 'Ducking', media: 'Music' })).toEqual([]);
      expect(so.requests().every(r => ['GetMediaInputStatus', 'TriggerMediaInputAction', 'SetInputMute', 'SetInputVolume', 'SetSourceFilterEnabled'].includes(r.type))).toBe(true);
    } finally { await obs.stop(); await so.close(); }
  });
});

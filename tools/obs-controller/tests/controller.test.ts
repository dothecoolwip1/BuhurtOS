import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, sleep, waitFor, type Harness, type HarnessOptions } from './harness';

// These tests run the real Controller (reader, decision, reconcile loop, audio policy, heartbeat) against the OBS STAND-IN and a fake BuhurtOS.
// They are "stand-in verified": protocol, allow-list, reconcile and recovery behaviour. They say nothing about real OBS.

let h: Harness | null = null;
afterEach(async () => {
  if (!h) return;
  // after EVERY scenario: nothing outside the allow-list was ever requested, and the stream was never started, stopped or read for its key
  const scope = { mutable: ['Music', ...h.files.config.audio.cameraAudioInputs], music: 'Music', filter: 'Ducking', media: h.files.config.audio.mediaSource };
  const bad = h.standin.violations(scope);
  const state = h.standin.state;
  await h.stop();
  expect(bad, 'requests outside the allow-list').toEqual([]);
  expect(state.dangerousSeen).toEqual([]);
  expect(state.everStreamStarted).toBe(false);
  expect(state.everRecordStarted).toBe(false);
  h = null;
});

const setup = async (o: HarnessOptions = {}) => (h = await makeHarness(o));
const show = async (field: string, mode: Parameters<Harness['world']['setField']>[1], o?: { matchId?: string; startedAt?: string }) => {
  const id = h!.world.setField(field, mode, o);
  await waitFor(() => h!.controller.status().fields.find(f => f.key === field.toLowerCase())?.mode === mode, 3000, `${field} to show ${mode}`);
  return id;
};
const program = (scene: string, ms = 3000) => waitFor(() => h!.standin.state.program === scene, ms, `OBS program scene ${scene} (is ${h!.standin.state.program})`);
const stays = async (scene: string, ms = 250) => { await sleep(ms); expect(h!.standin.state.program).toBe(scene); };
const switches = () => h!.standin.count('SetCurrentProgramScene');
const dwell = () => h!.advance(11_000);                       // past the 10 s minimum time on a scene
const status = () => h!.controller.status();
const connected = async () => {
  await waitFor(() => h!.controller.obs.connected && status().obs.scenes.length > 0, 5000, 'OBS connected');
  if (h!.world.online) await waitFor(() => h!.controller.reader.hasData, 5000, 'the first read of BuhurtOS');
};

describe('connect, holding, fight ready, fight live (PLAN 18.5)', () => {
  it('connects, reads the scenes and the program scene, and reconciles to holding when nothing is on', async () => {
    await setup({ program: 'Lyst 3 Live' });
    await program('Holding');                                        // OBS was on Lyst 3: nothing is live, so holding
    expect(status().obs).toMatchObject({ connected: true, version: '32.0.0' });
    expect(status().onAir).toMatchObject({ kind: 'holding', scene: 'Holding' });
    expect(h!.standin.count('GetSceneList')).toBeGreaterThan(0);
    expect(h!.standin.count('GetCurrentProgramScene')).toBeGreaterThan(0);
    expect(switches()).toBe(1);
  });

  it('a fight getting ready, then live, puts that Lyst\'s camera on air; the other Lysts are quiet', async () => {
    await setup(); await connected(); await program('Holding');
    dwell(); await show('field 2', 'ready'); await program('Lyst 2 Live');
    await show('field 2', 'live');
    await stays('Lyst 2 Live');
    expect(status().onAir).toMatchObject({ kind: 'lyst', field: 'field 2', lock: 'field 2' });
  });

  it('score changes, clock ticks and penalties cause ZERO SetCurrentProgramScene calls', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live');
    const before = switches();
    for (let i = 1; i <= 25; i++) { h!.world.bump('field 1', { scoreA: i, scoreB: i * 2, remainingMs: 60_000 - i * 1000 }); await sleep(20); }
    h!.world.setField('field 1', 'disqualified'); await waitFor(() => status().fields.find(f => f.key === 'field 1')?.mode === 'disqualified');
    for (const m of ['live', 'paused', 'live', 'equipment', 'live', 'dq_clock', 'live', 'break', 'live'] as const) { await show('field 1', m); }
    await sleep(300);
    expect(switches()).toBe(before);
    expect(h!.standin.state.program).toBe('Lyst 1 Live');
  });

  it('pause, resume, equipment timeout, DQ countdown and the round break all stay on the same camera', async () => {
    await setup(); await connected();
    dwell(); await show('field 3', 'live'); await program('Lyst 3 Live');
    const n = switches();
    for (const m of ['paused', 'live', 'equipment', 'dq_clock', 'disqualified', 'break', 'live'] as const) { await show('field 3', m); await stays('Lyst 3 Live', 80); }
    expect(switches()).toBe(n);
  });

  it('complete and winner stay on the camera; at the end of the winner presentation it goes to holding', async () => {
    await setup(); await connected();
    dwell(); const m = await show('field 1', 'live'); await program('Lyst 1 Live');
    await show('field 1', 'complete', { matchId: m }); await stays('Lyst 1 Live', 120);
    await show('field 1', 'winner', { matchId: m }); await stays('Lyst 1 Live', 120);
    dwell(); await show('field 1', 'between'); await program('Holding');
  });

  it('next fight on the same Lyst, then on another Lyst', async () => {
    await setup(); await connected();
    dwell(); const m1 = await show('field 1', 'live'); await program('Lyst 1 Live');
    await show('field 1', 'winner', { matchId: m1 }); dwell(); await show('field 1', 'between'); await program('Holding');
    dwell(); await show('field 1', 'ready', { matchId: 'next-1' }); await program('Lyst 1 Live');      // same Lyst again
    await show('field 1', 'live'); await show('field 1', 'winner'); dwell(); await show('field 1', 'between'); await program('Holding');
    dwell(); await show('field 2', 'ready'); await program('Lyst 2 Live');                              // another Lyst
  });

  it('two Lysts live at once: stays on the first, the other is "also live"; moves to it when the first is over', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live', { startedAt: new Date(h!.clock.t).toISOString() }); await program('Lyst 1 Live');
    h!.advance(3000); await show('field 2', 'live');
    await stays('Lyst 1 Live');
    expect(status().alsoLive.map(a => a.field)).toEqual(['field 2']);
    expect(status().alsoLive[0]).toMatchObject({ label: 'Field 2', mapped: true });
    h!.advance(30_000); await show('field 1', 'winner'); await stays('Lyst 1 Live', 150);
    dwell(); await show('field 1', 'between'); await program('Lyst 2 Live');
  });

  it('restart with two fights live lands on the fight that went live first (durable first-live from the database)', async () => {
    await setup(); await connected();
    const a = h!.world.setField('field 1', 'live'), b = h!.world.setField('field 2', 'live');
    h!.world.setFirstLive(a, new Date(h!.clock.t - 5_000).toISOString()); h!.world.setFirstLive(b, new Date(h!.clock.t - 90_000).toISOString());     // field 2 has been live longer
    await waitFor(() => status().fields.filter(f => f.mode === 'live').length === 2);
    dwell(); await program('Lyst 2 Live');
    await h!.restartController(); await connected();
    await stays('Lyst 2 Live', 400);
    expect(status().onAir).toMatchObject({ field: 'field 2' });
    expect(Object.keys(h!.files.state.firstLive)).toEqual(expect.arrayContaining([a, b]));          // kept in the local file
    // a restart in the middle of a fight with NO internet at all: no data yet, so AUTO leaves OBS exactly as it is (it does not fall to holding)
    h!.world.online = false; h!.control.online = false;
    await h!.restartController(); await connected();
    await stays('Lyst 2 Live', 500);
    expect(status().awaitingData).toBe(true);
    // the internet comes back: it reads the truth and carries on, without a 10 s wait
    h!.world.online = true; h!.control.online = true;
    await waitFor(() => !status().awaitingData, 5000, 'first data');
    await stays('Lyst 2 Live', 200);
  });
});

describe('manual control from BuhurtOS and Return to Auto', () => {
  it('Take a Lyst, Holding, Break (from BuhurtOS), nothing automatic moves it; Return to Auto is a fresh decision with no replay', async () => {
    await setup(); await connected();
    await show('field 1', 'live'); dwell(); await program('Lyst 1 Live');
    h!.control.patch({ mode: 'manual', target_kind: 'lyst', target_field: 'field 2' }); await program('Lyst 2 Live');
    expect(status().mode).toMatchObject({ effective: 'manual', controlSource: 'server' });
    h!.advance(40_000); await show('field 1', 'winner'); await show('field 1', 'between'); await stays('Lyst 2 Live', 150);
    h!.control.patch({ target_kind: 'holding', target_field: null }); await program('Holding');
    h!.control.patch({ target_kind: 'break' }); await program('Break');
    // while manual, a fight started and ended; a different one is live now: auto picks from the CURRENT state only
    await show('field 3', 'live'); h!.control.patch({ mode: 'auto' }); await program('Lyst 3 Live');
    expect(status().mode.effective).toBe('auto');
    expect(status().onAir).toMatchObject({ field: 'field 3', lock: 'field 3' });
  });

  it('the laptop\'s own Take / Return to Auto work with no controller code at all (AUTO from public data + local controls)', async () => {
    await setup({ withCode: false }); await connected();
    await show('field 1', 'live'); dwell(); await program('Lyst 1 Live');
    expect(status().bos.session).toBe('no_code');
    await h!.controller.takeLocal('lyst', 'field 3'); await program('Lyst 3 Live');
    await h!.controller.takeLocal('break', null); await program('Break');
    await h!.controller.returnToAuto(); await program('Lyst 1 Live');
    expect(h!.control.heartbeats).toHaveLength(0);            // not monitored: nothing is reported without a code
  });
});

describe('Camera Off (latched)', () => {
  it('a server Camera Off cuts to the Camera Off scene at once, and stays through a new fight, the fight ending and an AUTO change', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live');
    h!.control.setCamera(true, 'privacy'); await program('Camera Off');
    expect(status().camera).toMatchObject({ effective: true, server: true, reason: 'privacy' });
    await show('field 2', 'live'); await show('field 1', 'winner'); h!.advance(40_000); await show('field 1', 'between'); await show('field 3', 'ready');
    await stays('Camera Off', 300);
    h!.control.patch({ mode: 'manual', target_kind: 'lyst', target_field: 'field 3' }); await stays('Camera Off', 150);
    h!.control.patch({ mode: 'auto' }); await stays('Camera Off', 150);
    // released by an authorised person: back to what AUTO would show now (a fresh decision, no dwell wait)
    h!.control.setCamera(false); await program('Lyst 2 Live');
  });

  it('the local button latches it, survives OBS drop / restart and a Companion restart, works with no internet, and only the local clear releases it', async () => {
    await setup(); await connected();
    h!.world.online = false; h!.control.online = false;                        // internet gone
    await h!.controller.setLocalCameraOff(); await program('Camera Off');
    expect(h!.files.state.cameraOffLocal).toBe(true);
    h!.standin.dropConnections(); await waitFor(() => !h!.controller.obs.connected); await waitFor(() => h!.controller.obs.connected); await program('Camera Off');
    await h!.standin.restart({ downMs: 80 }); await waitFor(() => h!.controller.obs.connected); await program('Camera Off');      // OBS came back on its first scene: re-asserted
    await h!.restartController(); await connected(); await program('Camera Off');                                                // new process, same files
    expect(h!.files.state.cameraOffLocal).toBe(true);
    h!.world.online = true; h!.control.online = true;
    h!.control.setCamera(true, 'venue'); await sleep(150); h!.control.setCamera(false); await sleep(300);
    expect(h!.standin.state.program).toBe('Camera Off');                         // a server release does not clear the local latch
    await h!.controller.clearLocalCameraOff(); await program('Holding');
    expect(h!.files.state.cameraOffLocal).toBe(false);
  });

  it('internet loss keeps a server Camera Off (unknown = still off), also across a Companion restart', async () => {
    await setup(); await connected();
    h!.control.setCamera(true, 'medical'); await program('Camera Off');
    await waitFor(() => h!.files.state.lastServerCamera?.active === true);
    h!.control.online = false; h!.world.online = false; h!.advance(60_000); await sleep(200);
    expect(status().camera).toMatchObject({ effective: true, server: null, source: 'unknown_latched' });
    await stays('Camera Off');
    await h!.restartController(); await connected(); await stays('Camera Off', 300);                // restarted with no internet at all
    expect(status().camera.effective).toBe(true);
    h!.control.online = true; h!.world.online = true; h!.control.setCamera(false); await program('Holding');
  });

  it('OBS disconnect, reconnect and restart never un-cut Camera Off; a missing Camera Off scene falls back to holding and mutes the camera audio', async () => {
    await setup({ audio: { cameraAudioInputs: ['Camera 1 Audio'] }, scenes: ['Holding', 'Break', 'Lyst 1 Live', 'Lyst 2 Live', 'Lyst 3 Live'] });       // no Camera Off scene exists
    await connected();
    await show('field 1', 'live'); dwell(); await program('Lyst 1 Live');
    h!.control.setCamera(true, 'camera_problem'); await program('Holding');
    await waitFor(() => h!.standin.state.inputs.get('Camera 1 Audio')?.muted === true, 3000, 'camera audio muted');
    expect(status().mapping.problems.some(p => p.code === 'camera_off_missing' && p.severity === 'error')).toBe(true);
    h!.control.setCamera(false); await program('Lyst 1 Live');
    await waitFor(() => h!.standin.state.inputs.get('Camera 1 Audio')?.muted === false, 3000, 'camera audio back');
  });
});

describe('missing scenes and mapping (never throws)', () => {
  it('a mapped scene that is not in OBS shows holding and reports; when it comes back AUTO shows it', async () => {
    await setup(); await connected();
    h!.standin.removeScene('Lyst 2 Live');
    dwell(); await show('field 2', 'live'); await program('Holding');
    await waitFor(() => status().mapping.problems.some(p => p.code === 'live_scene_missing' && p.field === 'field 2'), 3000, 'the problem is reported');
    await waitFor(() => status().onAir?.field === 'field 2', 3000, 'the decision to want Lyst 2');
    expect(status().onAir).toMatchObject({ kind: 'lyst', field: 'field 2', fallback: 'holding', scene: 'Holding' });
    h!.standin.addScene('Lyst 2 Live'); await program('Lyst 2 Live');
  });

  it('a scene removed WHILE it is on air: OBS moves itself; the Companion notices and keeps the stream sensible', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live');
    h!.standin.removeScene('Lyst 1 Live');
    await program('Holding');
    await waitFor(() => status().mapping.problems.some(p => p.code === 'live_scene_missing'));
  });

  it('a live Lyst with no camera scene is reported ("no camera mapping") and not taken; others still are', async () => {
    await setup({ config: { mapping: { lysts: { 'field 1': { live: 'Lyst 1 Live' } }, holding: 'Holding', break: 'Break', cameraOff: 'Camera Off' } } }); await connected();
    dwell(); await show('field 3', 'live'); await stays('Holding', 200);
    expect(status().alsoLive).toEqual([expect.objectContaining({ field: 'field 3', mapped: false })]);
    expect(status().mapping.problems.some(p => p.code === 'live_scene_unmapped' && p.field === 'field 3')).toBe(true);
    await show('field 1', 'live'); await program('Lyst 1 Live');
  });

  it('no holding scene at all: the scene is kept (nothing to fall back to) and the problem is reported', async () => {
    await setup({ scenes: ['Lyst 1 Live', 'Camera Off'], program: 'Lyst 1 Live' }); await connected();
    await show('field 2', 'live'); dwell(); await sleep(250);
    expect(h!.standin.state.program).toBe('Lyst 1 Live');
    expect(status().mapping.problems.map(p => p.code)).toContain('holding_missing');
  });

  it('a switch OBS refuses is retried and reported, not thrown', async () => {
    await setup(); await connected();
    h!.standin.failNext('SetCurrentProgramScene', 702, 'busy');
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live', 5000);
    expect(h!.logs.some(l => /could not switch/.test(l))).toBe(true);
  });
});

describe('recovery (PLAN section 8)', () => {
  it('OBS closes mid-fight and comes back: "not connected" meanwhile, then it reconciles to the current scene', async () => {
    await setup(); await connected();
    dwell(); await show('field 2', 'live'); await program('Lyst 2 Live');
    await h!.standin.exit();
    await waitFor(() => !h!.controller.obs.connected);
    expect(status().obs.connected).toBe(false); await waitFor(() => /not running|refused/.test(status().obs.problem ?? ''), 3000, 'the reason is shown');
    await sleep(200);
    await h!.standin.start(); h!.standin.state.program = 'Holding';                      // OBS opened on another scene
    await waitFor(() => h!.controller.obs.connected); await program('Lyst 2 Live');
  });

  it('OBS restarts mid-fight (comes back on its first scene): re-identify, validate, reconcile', async () => {
    await setup(); await connected();
    dwell(); await show('field 3', 'live'); await program('Lyst 3 Live');
    await h!.standin.restart({ downMs: 100 });
    await waitFor(() => h!.controller.obs.connected); await program('Lyst 3 Live');
  });

  it('the Companion closes and restarts: OBS keeps its scene; on start it reconciles once from local files and current data', async () => {
    await setup(); await connected();
    dwell(); await show('field 2', 'live'); await program('Lyst 2 Live');
    const n = switches();
    await h!.restartController(); await connected(); await sleep(400);
    expect(h!.standin.state.program).toBe('Lyst 2 Live');
    expect(switches()).toBe(n);                               // already right: no switch at all
  });

  it('internet lost: the scene is kept (never falls to holding because data is stale), the stale warning shows, then recovery re-reads without replay', async () => {
    await setup(); await connected();
    dwell(); const m = await show('field 1', 'live'); await program('Lyst 1 Live');
    const n = switches();
    h!.world.online = false; h!.control.online = false;
    h!.advance(30_000); await sleep(300);
    expect(status().bos.stale).toBe(true);
    await stays('Lyst 1 Live', 300); expect(switches()).toBe(n);
    // while we were offline the fight ended and another began and ended: nothing is replayed
    h!.world.setField('field 1', 'between', { matchId: m }); await show.call(null, 'field 3', 'live').catch(() => undefined);
    h!.world.online = true; h!.control.online = true;
    await waitFor(() => !status().bos.stale, 3000, 'fresh data');
    expect(status().fields.find(f => f.key === 'field 3')?.mode).toBe('live');
    dwell(); await program('Lyst 3 Live');
  });

  it('BuhurtOS data stale and then reconnected: the heartbeat says stale, then not', async () => {
    await setup(); await connected();
    await waitFor(() => h!.control.heartbeats.length > 0, 3000, 'first heartbeat');
    h!.world.online = false; h!.advance(25_000);
    await waitFor(() => h!.control.heartbeats.at(-1)?.stale === true, 3000, 'a stale heartbeat');
    h!.world.online = true;
    await waitFor(() => h!.control.heartbeats.at(-1)?.stale === false, 3000, 'recovered');
  });

  it('the heartbeat reports what the plan lists and nothing secret', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live'); await show('field 2', 'live');
    await waitFor(() => (h!.control.heartbeats.at(-1)?.also_live as unknown[] | undefined)?.length === 1, 3000, 'heartbeat with an also-live Lyst');
    const hb = h!.control.heartbeats.at(-1)!;
    expect(hb).toMatchObject({ obs_connected: true, obs_version: '32.0.0', mode: 'auto', camera_off: false, camera_off_local: false, controller_version: '0.1.0', stale: false });
    expect(hb.on_air).toMatchObject({ kind: 'lyst', field: 'field 1', scene: 'Lyst 1 Live' });
    expect(hb.fight).toMatchObject({ field: 'field 1', mode: 'live' });
    expect(Object.keys(hb)).toEqual(expect.arrayContaining(['obs_connected', 'obs_version', 'mode', 'on_air', 'fight', 'camera_off', 'camera_off_local', 'also_live', 'mapping_problems', 'music', 'controller_version', 'stale']));
    expect(JSON.stringify(h!.control.heartbeats)).not.toMatch(/obs-pass|K7Q2|sess-secret|aaaaaaaaaa/);
    await h!.standin.exit(); await waitFor(() => h!.control.heartbeats.at(-1)?.obs_connected === false, 3000, 'OBS not connected reported');
  });

  it('every OBS error is survivable: slow answers, dropped answers and hung requests do not wedge the loop', async () => {
    await setup({ options: {} }); await connected();
    h!.standin.setLatency(120);
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live', 5000);
    h!.standin.setLatency(0); h!.standin.hangNext('GetCurrentProgramScene');
    dwell(); h!.advance(60_000); await show('field 1', 'between'); await program('Holding', 12_000);
  });
});

describe('audio commands per state (PLAN 18.6; stand-in verified, not physically)', () => {
  const music = () => h!.standin.state.inputs.get('Music')!;
  const calls = (type: string) => h!.standin.count(type);

  it('fight live -> music faded out and muted; between fights -> on at the normal level; break -> on', async () => {
    await setup(); await connected();
    await waitFor(() => !music().muted, 3000);                                  // between fights at the start: on
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live');
    await waitFor(() => music().muted, 3000, 'muted for the fight');
    expect(music().volumeDb).toBe(-14);                                          // level restored while silent, ready for later
    await show('field 1', 'break'); await sleep(150); expect(music().muted).toBe(true);        // a round break is still the fight
    await show('field 1', 'winner'); await sleep(150); expect(music().muted).toBe(true);
    dwell(); await show('field 1', 'between'); await waitFor(() => !music().muted, 3000, 'music back between fights');
    await waitFor(() => music().volumeDb === -14, 3000, 'normal level');
    h!.control.patch({ mode: 'manual', target_kind: 'break' }); await program('Break'); expect(music().muted).toBe(false);
  });

  it('level changes are a short stepped fade, and chatter on the microphone causes no commands at all (never per word)', async () => {
    await setup({ audio: { fadeMs: 1000 }, options: { fadeStepMs: 200 } }); await connected();
    await waitFor(() => !music().muted, 3000);
    h!.standin.clearLog();
    dwell(); await show('field 1', 'live'); await waitFor(() => music().muted, 6000, 'muted');
    const vol = h!.standin.requests('SetInputVolume').map(r => Number((r.data as { inputVolumeDb: number }).inputVolumeDb));
    expect(vol.length).toBeGreaterThanOrEqual(4); expect(vol.length).toBeLessThanOrEqual(10);
    // the announcer talks: lots of meter events, and not one volume / mute / filter command results
    await waitFor(() => status().audio.music.mic !== 'unknown', 3000, 'mic summary');
    const before = [calls('SetInputVolume'), calls('SetInputMute'), calls('SetSourceFilterEnabled'), calls('SetSourceFilterSettings')];
    for (let i = 0; i < 12; i++) { h!.standin.injectMeter('Announcer Mic', { db: -12, ms: 120 }); await sleep(100); h!.standin.injectMeter('Announcer Mic', { db: -70, ms: 120 }); await sleep(100); }
    await waitFor(() => status().audio.music.mic === 'speaking' || status().audio.music.mic === 'quiet');
    expect([calls('SetInputVolume'), calls('SetInputMute'), calls('SetSourceFilterEnabled'), calls('SetSourceFilterSettings')]).toEqual(before);
  });

  it('the mic summary is quiet / speaking, only from meter events, and the raw levels are in no report', async () => {
    await setup(); await connected();
    await waitFor(() => status().audio.music.mic === 'quiet', 3000, 'quiet');
    h!.standin.injectMeter('Announcer Mic', { db: -15, ms: 600 });
    await waitFor(() => status().audio.music.mic === 'speaking', 3000, 'speaking');
    h!.advance(2000); h!.standin.injectMeter('Announcer Mic', { db: -80, ms: 400 });                  // a second or two of silence
    await waitFor(() => status().audio.music.mic === 'quiet', 4000, 'quiet again');
    expect(JSON.stringify(status())).not.toMatch(/inputLevels|levelsMul|inputPeak|peakDb|"peak"/i);
  });

  it('Auto Duck off (from BuhurtOS) switches the ducking filter off and warns; on switches it back', async () => {
    await setup(); await connected();
    await waitFor(() => status().audio.music.ducking === 'on', 3000);
    h!.control.patch({ auto_duck: false });
    await waitFor(() => h!.standin.state.inputs.get('Music')!.filters[0].filterEnabled === false, 3000, 'filter off');
    await waitFor(() => status().audio.plan?.warnings.some(w => w.code === 'auto_duck_off') === true, 3000, 'warning');
    h!.control.patch({ auto_duck: true });
    await waitFor(() => h!.standin.state.inputs.get('Music')!.filters[0].filterEnabled === true, 3000, 'filter back on');
  });

  it('a person who switches the ducking filter off in OBS by hand while Auto Duck is on: it is switched back', async () => {
    await setup(); await connected();
    await waitFor(() => status().audio.music.ducking === 'on', 3000);
    h!.standin.setFilterEnabledByHand('Music', 'Ducking', false);
    await waitFor(() => h!.standin.state.inputs.get('Music')!.filters[0].filterEnabled === true, 3000, 'filter back on');
  });

  it('missing mic: music is muted and the problem reported; mic back: music returns', async () => {
    await setup(); await connected();
    await waitFor(() => !music().muted, 3000);
    h!.standin.removeInput('Announcer Mic');
    await waitFor(() => music().muted, 6000, 'music muted without a mic');
    await waitFor(() => status().audio.plan?.warnings.some(w => w.code === 'mic_missing') === true, 3000);
    expect(status().audio.music.mic).toBe('missing');
    h!.standin.addInput('Announcer Mic');
    await waitFor(() => !music().muted, 15_000, 'music back');
  });

  it('missing music source: reported, no audio command is ever sent for it', async () => {
    await setup(); await connected();
    await waitFor(() => status().audio.presence.music, 3000);
    h!.standin.removeInput('Music');
    await waitFor(() => status().audio.plan?.warnings.some(w => w.code === 'music_source_missing') === true, 15_000, 'the report');
    await sleep(300); h!.standin.clearLog();                                      // anything that was already in flight when the source vanished has finished
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live'); await sleep(300);
    expect(h!.standin.requests().filter(r => ['SetInputMute', 'SetInputVolume', 'SetSourceFilterEnabled'].includes(r.type))).toEqual([]);
  });

  it('Camera Off (any reason) mutes the music and never switches it on; a medical hold stays muted after release until a person resumes it', async () => {
    await setup(); await connected();
    await waitFor(() => !music().muted, 3000);
    h!.control.setCamera(true, 'privacy'); await waitFor(() => music().muted, 3000, 'muted by Camera Off');
    h!.control.setCamera(false); await waitFor(() => !music().muted, 3000, 'non-medical: back after release');
    h!.control.setCamera(true, 'medical'); await waitFor(() => music().muted && !!h!.files.state.medicalMusicLock, 3000, 'medical hold');
    h!.control.setCamera(false); await program('Holding'); await sleep(300);
    expect(music().muted).toBe(true);                                             // cameras are back; the music is NOT
    expect(status().audio.music.locked).toBe(true);
    // a restart and an OBS restart do not lift it either
    await h!.restartController(); await connected(); await h!.standin.restart({ downMs: 50 }); await waitFor(() => h!.controller.obs.connected); await sleep(400);
    expect(music().muted).toBe(true);
    // a person with broadcast control deliberately resumes: Music muted, then Auto again
    h!.control.patch({ music_mode: 'muted' }); await sleep(200); expect(music().muted).toBe(true);
    h!.control.patch({ music_mode: 'auto' });
    await waitFor(() => !music().muted, 3000, 'music resumed');
    expect(h!.files.state.medicalMusicLock).toBeNull();
  });

  it('a medical hold can also be lifted from the laptop', async () => {
    await setup(); await connected();
    h!.control.setCamera(true, 'medical'); await waitFor(() => !!h!.files.state.medicalMusicLock, 3000);
    h!.control.setCamera(false); await sleep(250); expect(music().muted).toBe(true);
    await h!.controller.resumeMusic(); await waitFor(() => !music().muted, 3000, 'resumed');
  });

  it('music muted / paused from BuhurtOS or the laptop; pause is a mute unless a real Media Source is configured', async () => {
    await setup(); await connected();
    h!.control.patch({ music_mode: 'muted' }); await waitFor(() => music().muted, 3000);
    h!.control.patch({ music_mode: 'paused' }); await sleep(200); expect(music().muted).toBe(true);
    h!.control.patch({ music_mode: 'auto' }); await waitFor(() => !music().muted, 3000);
    await h!.controller.setLocalMusic('muted'); await waitFor(() => music().muted, 3000);
    await h!.controller.setLocalMusic('auto'); await waitFor(() => !music().muted, 3000);
    expect(calls('TriggerMediaInputAction')).toBe(0);
  });

  it('with a Media Source: pause and play are real, and only play / pause on that source are ever sent', async () => {
    await setup({ audio: { mediaSource: 'Music' } }); await connected();
    await waitFor(() => status().audio.presence.mediaOk, 3000);
    await waitFor(() => music().media?.state === 'OBS_MEDIA_STATE_PLAYING', 3000, 'playing between fights');
    h!.control.patch({ music_mode: 'paused' }); await waitFor(() => music().media?.state === 'OBS_MEDIA_STATE_PAUSED', 3000, 'paused');
    expect(music().muted).toBe(false);
    h!.control.patch({ music_mode: 'auto' }); await waitFor(() => music().media?.state === 'OBS_MEDIA_STATE_PLAYING', 3000, 'playing again');
    expect(h!.standin.requests('TriggerMediaInputAction').every(r => ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'].includes((r.data as { mediaAction: string }).mediaAction))).toBe(true);
  });

  it('OBS reconnect and a Companion restart restore the audio policy', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live'); await program('Lyst 1 Live'); await waitFor(() => music().muted, 3000);
    h!.standin.setMutedByHand('Music', false);                                    // someone un-mutes during the fight
    await waitFor(() => music().muted, 3000, 're-muted');
    await h!.standin.restart({ downMs: 50 }); h!.standin.setMutedByHand('Music', false);
    await waitFor(() => h!.controller.obs.connected); await waitFor(() => music().muted, 4000, 'muted again after an OBS restart');
    h!.standin.setMutedByHand('Music', false); await h!.restartController(); await connected();
    await waitFor(() => music().muted, 4000, 'muted again after a Companion restart');
  });

  it('the Companion never changes what it was not asked to: the camera audio inputs and the mic are untouched', async () => {
    await setup(); await connected();
    dwell(); await show('field 1', 'live'); await waitFor(() => music().muted, 3000); h!.control.setCamera(true, 'venue'); await program('Camera Off');
    expect(h!.standin.state.inputs.get('Announcer Mic')).toMatchObject({ muted: false, volumeDb: 0 });
    expect(h!.standin.state.inputs.get('Camera 1 Audio')).toMatchObject({ muted: false, volumeDb: 0 });
  });
});

describe('scene test and loopback', () => {
  it('a scene test shows the scene for a few seconds, then AUTO takes over again; Camera Off refuses tests', async () => {
    await setup(); await connected(); await program('Holding');
    expect((await h!.controller.testScene('Lyst 2 Live')).ok).toBe(true); await program('Lyst 2 Live');
    await sleep(200); expect(h!.standin.state.program).toBe('Lyst 2 Live');
    h!.advance(9000); await program('Holding');
    expect((await h!.controller.testScene('No Such Scene')).ok).toBe(false);
    await h!.controller.setLocalCameraOff(); await program('Camera Off');
    expect(await h!.controller.testScene('Lyst 1 Live')).toMatchObject({ ok: false });
  });
});

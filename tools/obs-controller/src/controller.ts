import { decideProgram, INITIAL_STATE, phaseOf, type CameraInput, type ControlInput, type Decision, type DecisionState, type FieldPhase } from '../../../src/lib/broadcast/decide';
import { AudioExecutor, planAudio, type AudioPlan } from './audio';
import type { LocalFiles } from './config';
import type { ControlSource, PublicDataSource } from './datasource';
import { buildHeartbeat } from './heartbeat';
import { loudestMul, MicSummary } from './mic';
import { ObsClient } from './obs/client';
import type { ObsPolicy } from './obs/allowlist';
import type { Logger } from './log';
import { StateReader, STALE_AFTER_MS } from './reader';
import type { ControllerSession } from './session';
import { COMPANION_VERSION } from './version';

/**
 * The Companion's brain. One loop (about once a second) asks the pure AUTO decision what should be on air, and calls SetCurrentProgramScene ONLY when that
 * differs from the scene OBS is really showing: a score, a clock tick or a penalty changes nothing here. Everything that can go wrong (OBS gone, BuhurtOS
 * unreachable, a scene deleted, a setting missing) is reported and handled; nothing throws out of the loop. The tournament never depends on any of this.
 */
export interface ControllerOptions {
  reconcileMs?: number; heartbeatMs?: number; pollMs?: number; sceneRefreshMs?: number; verifyProgramMs?: number; obsBackoffMs?: readonly number[]; fadeStepMs?: number;
  now?: () => number;
}
export interface ControllerDeps {
  files: LocalFiles; logger: Logger; data: PublicDataSource; control: ControlSource | null; session: ControllerSession; getObsPassword: () => Promise<string | null>; options?: ControllerOptions;
}

export const TEST_HOLD_MS = 8000;

export class Controller {
  readonly obs: ObsClient;
  readonly reader: StateReader;
  readonly audio: AudioExecutor;
  readonly mic: MicSummary;
  decision: Decision | null = null;
  private state: DecisionState = INITIAL_STATE;
  private scenes: string[] | null = null;
  private programScene: string | null = null;
  private studioMode: boolean | null = null;
  private streaming: boolean | null = null;
  private testHoldUntil = 0;
  private timers: NodeJS.Timeout[] = [];
  private ticking = false;
  private again = false;
  /** True until BuhurtOS has been read once (and AUTO is in charge): the scene is left alone. */
  awaitingData = false;
  private lastScenesAt = 0;
  private lastVerifyAt = 0;
  private lastCheckSetupAt = 0;
  private cameraAudioMuted = false;
  private lastHeartbeat: { ok: boolean; at: number | null; error: string | null } = { ok: false, at: null, error: null };
  private lastSceneNote = '';
  private lastAudioPlan: AudioPlan | null = null;
  private micState: ReturnType<MicSummary['summary']> = 'unknown';
  readonly now: () => number;
  /** Counts of what the loop did (for tests and the screen). */
  counters = { sceneSwitches: 0, ticks: 0 };

  constructor(private readonly d: ControllerDeps) {
    const o = d.options ?? {};
    this.now = o.now ?? Date.now;
    this.mic = new MicSummary(() => d.files.config.audio.speakingThresholdDb);
    this.obs = new ObsClient({
      port: d.files.config.obsPort, getPassword: d.getObsPassword, logger: d.logger, policy: () => this.policy(), meters: () => !!d.files.config.audio.micSource,
      ...(o.obsBackoffMs ? { backoffMs: o.obsBackoffMs } : {})
    });
    this.reader = new StateReader({ data: d.data, control: d.control, files: d.files, session: d.session, logger: d.logger, pollMs: o.pollMs, now: this.now });
    this.audio = new AudioExecutor(this.obs, () => d.files.config.audio, d.logger, o.fadeStepMs !== undefined ? { stepMs: o.fadeStepMs } : {});
    this.obs.on('state', (s, why) => d.logger.info(`OBS: ${s}${why ? ` (${why})` : ''}`));
    this.obs.on('identified', v => { d.logger.info('OBS connected', { obs: v.obsVersion, websocket: v.obsWebSocketVersion }); void this.onIdentified(); });
    this.obs.on('closed', why => { this.programScene = null; this.scenes = null; this.studioMode = null; this.streaming = null; this.audio.resetKnowledge(); this.cameraAudioMuted = false; d.logger.warn(`OBS connection closed: ${why}`); });
    this.obs.on('event', e => this.onObsEvent(e.eventType, e.eventData ?? {}));
  }

  private cfg() { return this.d.files.config; }

  /** What the Companion may touch in OBS, from the settings. */
  policy(): ObsPolicy {
    const a = this.cfg().audio;
    return { mutableInputs: [a.musicSource, ...a.cameraAudioInputs].filter((x): x is string => !!x), volumeInput: a.musicSource, duckingSource: a.musicSource, duckingFilter: a.duckingFilter, mediaSource: a.mediaSource };
  }

  start(): void {
    const o = this.d.options ?? {};
    this.reader.start();
    this.obs.start();
    this.timers.push(setInterval(() => { void this.tick(); }, o.reconcileMs ?? 1000));
    this.timers.push(setInterval(() => { void this.sendHeartbeat(); }, o.heartbeatMs ?? 5000));
    void this.sendHeartbeat();
  }
  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.reader.stop();
    await this.obs.stop();
  }

  // ------------------------------------------------------------------------------------------- OBS events and (re)identify

  private async onIdentified(): Promise<void> {
    try {
      this.programScene = null; this.audio.resetKnowledge();
      await this.refreshScenes();
      try { this.studioMode = await this.obs.getStudioModeEnabled(); } catch { /* informational */ }
      try { this.streaming = (await this.obs.getStreamStatus()).active; } catch { /* informational */ }
      this.programScene = await this.obs.getCurrentProgramScene().catch(() => null);
      await this.audio.checkSetup(); this.lastCheckSetupAt = this.now();
      await this.tick(true);                                    // reconcile to the CURRENT truth: no replay of anything missed
    } catch (e) { this.d.logger.warn('could not finish connecting to OBS', { message: (e as Error).message }); }
  }

  private onObsEvent(type: string, data: Record<string, unknown>): void {
    switch (type) {
      case 'CurrentProgramSceneChanged': if (typeof data.sceneName === 'string') this.programScene = data.sceneName; break;
      case 'SceneListChanged': if (Array.isArray(data.scenes)) this.scenes = (data.scenes as Array<{ sceneName: string }>).map(s => s.sceneName); break;
      case 'SceneCreated': case 'SceneRemoved': case 'SceneNameChanged': void this.refreshScenes(); break;
      case 'InputMuteStateChanged': this.audio.noteMute(String(data.inputName), data.inputMuted === true); break;
      case 'InputVolumeChanged': this.audio.noteVolume(String(data.inputName), Number(data.inputVolumeDb)); break;
      case 'SourceFilterEnableStateChanged': this.audio.noteFilter(String(data.sourceName), String(data.filterName), data.filterEnabled === true); break;
      case 'MediaInputPlaybackStarted': this.audio.noteMedia(String(data.inputName), 'OBS_MEDIA_STATE_PLAYING'); break;
      case 'MediaInputPlaybackEnded': this.audio.noteMedia(String(data.inputName), 'OBS_MEDIA_STATE_ENDED'); break;
      case 'MediaInputActionTriggered': { const a = String(data.mediaAction); this.audio.noteMedia(String(data.inputName), a.endsWith('_PAUSE') ? 'OBS_MEDIA_STATE_PAUSED' : a.endsWith('_PLAY') ? 'OBS_MEDIA_STATE_PLAYING' : 'OBS_MEDIA_STATE_STOPPED'); break; }
      case 'InputCreated': case 'InputRemoved': case 'InputNameChanged': this.lastCheckSetupAt = 0; break;
      case 'StreamStateChanged': this.streaming = data.outputActive === true; break;
      case 'ExitStarted': this.d.logger.warn('OBS is closing'); break;
      case 'InputVolumeMeters': {
        const mic = this.cfg().audio.micSource;
        if (!mic) break;
        for (const i of (data.inputs ?? []) as Array<{ inputName?: string; inputLevelsMul?: unknown }>) if (i.inputName === mic) this.mic.push(loudestMul(i.inputLevelsMul), this.now());
        break;
      }
      default: break;
    }
  }

  private async refreshScenes(): Promise<void> {
    if (!this.obs.connected) return;
    try { const l = await this.obs.getSceneList(); this.scenes = l.scenes; if (!this.programScene) this.programScene = l.current || null; this.lastScenesAt = this.now(); }
    catch (e) { this.d.logger.debug('could not read the scene list', { message: (e as Error).message }); }
  }

  // ------------------------------------------------------------------------------------------- inputs to the decision

  effectiveControl(): { control: ControlInput; source: 'server' | 'local' | 'none' } {
    const st = this.d.files.state;
    const server = this.reader.serverControl.control;
    if (st.localManual) return { control: { mode: 'manual', targetKind: st.localManual.kind, targetField: st.localManual.field, priorityFields: server.priorityFields }, source: 'local' };
    return { control: { mode: server.mode, targetKind: server.targetKind, targetField: server.targetField, priorityFields: server.priorityFields }, source: this.reader.serverControl.known ? 'server' : 'none' };
  }

  private cameraInput(): CameraInput {
    const st = this.d.files.state, sc = this.reader.serverCamera;
    return { server: sc ? sc.active : null, lastKnownServer: st.lastServerCamera?.active === true, local: st.cameraOffLocal, reason: sc?.reason ?? st.lastServerCamera?.reason ?? null };
  }

  // ------------------------------------------------------------------------------------------- the reconcile loop

  /** One pass. `force` (a reconnect) skips nothing: the loop is idempotent. Never throws. */
  async tick(force = false): Promise<void> {
    if (this.ticking) { if (force) this.again = true; return; }       // a pass is running: a forced one runs again straight after it
    this.ticking = true;
    try {
      const now = this.now();
      this.counters.ticks++;
      const built = this.reader.fields(now);
      const { control } = this.effectiveControl();
      const decision = decideProgram({
        nowMs: now, fields: built.map(b => b.input), control, camera: this.cameraInput(), mapping: this.cfg().mapping,
        existingScenes: this.obs.connected ? this.scenes : null, prev: this.state
      });
      this.decision = decision;
      // Before the first successful read of BuhurtOS, AUTO knows nothing about the fights: it must not take the stream to holding (a restart with no internet
      // in the middle of a fight keeps the scene OBS is showing). The decision's memory is not kept either, so the first real decision is not delayed.
      this.awaitingData = decision.source === 'auto' && !this.reader.hasData;
      if (!this.awaitingData) this.state = decision.state;
      this.trackMedicalLock(decision);
      if (!this.obs.connected) return;
      if (!this.awaitingData) {
        await this.applyScene(decision);
        await this.applyAudio(decision, built.find(b => b.input.field === decision.target.field)?.input.mode ?? null);
      }
      await this.applyCameraAudio(decision);
      await this.housekeeping(now);
    } catch (e) { this.d.logger.warn('reconcile pass failed; will try again', { message: (e as Error).message }); }
    finally { this.ticking = false; if (this.again) { this.again = false; void this.tick(); } }
  }

  private async applyScene(decision: Decision): Promise<void> {
    const now = this.now();
    if (now < this.testHoldUntil && !decision.camera.active) return;       // a scene test is showing: Camera Off still wins
    const wanted = decision.scene;
    if (wanted === null) { this.noteScene(`no usable scene for "${decision.target.kind}${decision.target.field ? ` ${decision.target.field}` : ''}": keeping the current scene`, true); return; }
    if (this.programScene === null) this.programScene = await this.obs.getCurrentProgramScene().catch(() => null);
    if (this.programScene === wanted) return;
    try {
      await this.obs.setCurrentProgramScene(wanted);
      this.d.logger.info(`program scene -> ${wanted}`, { reason: decision.reason, was: this.programScene });
      this.programScene = wanted; this.counters.sceneSwitches++;
    } catch (e) {
      this.d.logger.warn(`could not switch to "${wanted}"`, { message: (e as Error).message });
      this.programScene = null; this.lastScenesAt = 0;                   // read it again next pass
    }
  }

  private noteScene(msg: string, warn: boolean): void { if (msg !== this.lastSceneNote) { this.lastSceneNote = msg; (warn ? this.d.logger.warn : this.d.logger.info).call(this.d.logger, msg); } }

  /** Camera Off with no Camera Off scene: show holding (the decision did) and silence the camera microphones named in the settings. */
  private async applyCameraAudio(decision: Decision): Promise<void> {
    const inputs = this.cfg().audio.cameraAudioInputs;
    if (inputs.length === 0) { this.cameraAudioMuted = false; return; }
    if (decision.muteProgramAudio && !this.cameraAudioMuted) {
      for (const i of inputs) await this.obs.setInputMute(i, true).catch(e => this.d.logger.warn(`could not mute "${i}"`, { message: (e as Error).message }));
      this.cameraAudioMuted = true; this.d.logger.warn('Camera Off has no scene: camera audio muted');
    } else if (!decision.muteProgramAudio && this.cameraAudioMuted) {
      // the cameras are back on (a person released Camera Off): bring the camera audio back, as it was before
      for (const i of inputs) await this.obs.setInputMute(i, false).catch(() => undefined);
      this.cameraAudioMuted = false;
    }
  }

  // ------------------------------------------------------------------------------------------- audio

  private trackMedicalLock(decision: Decision): void {
    const files = this.d.files, srv = this.reader.serverControl;
    const lock = files.state.medicalMusicLock;
    if (decision.camera.medical && !lock) {
      files.updateState(s => { s.medicalMusicLock = { since: new Date(this.now()).toISOString(), controlRev: srv.control.rev, sawNonAuto: srv.known && srv.control.musicMode !== 'auto' }; });
      this.d.logger.warn('medical hold: music is locked off until someone resumes it');
    } else if (lock && srv.known) {
      if (srv.control.musicMode !== 'auto' && !lock.sawNonAuto) files.updateState(s => { if (s.medicalMusicLock) s.medicalMusicLock.sawNonAuto = true; });
      else if (srv.control.musicMode === 'auto' && lock.sawNonAuto) { files.updateState(s => { s.medicalMusicLock = null; }); this.d.logger.info('music resumed by a person with broadcast control: the medical hold is lifted'); }
    }
  }

  private musicModeNow(): 'auto' | 'muted' | 'paused' {
    const local = this.d.files.state.localMusic;
    return local !== 'auto' ? local : this.reader.serverControl.control.musicMode;
  }

  private async applyAudio(decision: Decision, mode: string | null): Promise<void> {
    const cfg = this.cfg().audio;
    const phase: FieldPhase | null = mode ? phaseOf(mode as Parameters<typeof phaseOf>[0]) : null;
    const plan = planAudio({
      onAir: { kind: decision.target.kind, phase }, camera: { active: decision.camera.active, medical: decision.camera.medical }, medicalLock: !!this.d.files.state.medicalMusicLock,
      musicMode: this.musicModeNow(), autoDuck: this.reader.serverControl.control.autoDuck, present: this.audio.presence, cfg
    });
    this.lastAudioPlan = plan;
    await this.audio.apply(plan);
  }

  /** Periodic re-checks: the scene list, the program scene (someone may have switched by hand), the audio setup, the mic summary. */
  private async housekeeping(now: number): Promise<void> {
    const o = this.d.options ?? {};
    this.micState = this.cfg().audio.micSource ? this.mic.summary(now) : 'unknown';
    if (now - this.lastScenesAt > (o.sceneRefreshMs ?? 10_000)) await this.refreshScenes();
    if (now - this.lastVerifyAt > (o.verifyProgramMs ?? 3000)) { this.lastVerifyAt = now; const p = await this.obs.getCurrentProgramScene().catch(() => null); if (p) this.programScene = p; }
    if (now - this.lastCheckSetupAt > 10_000) { this.lastCheckSetupAt = now; await this.audio.checkSetup(); }
  }

  // ------------------------------------------------------------------------------------------- local controls (the laptop screen)

  /** The big local button. Saved to disk BEFORE anything else, then applied at once. It is cleared only by `clearLocalCameraOff`. */
  async setLocalCameraOff(): Promise<void> {
    this.d.files.updateState(s => { if (!s.cameraOffLocal) { s.cameraOffLocal = true; s.cameraOffLocalSince = new Date(this.now()).toISOString(); } });
    this.d.logger.warn('LOCAL CAMERA OFF switched on from this laptop');
    await this.tick(true);
  }
  async clearLocalCameraOff(): Promise<void> {
    this.d.files.updateState(s => { s.cameraOffLocal = false; s.cameraOffLocalSince = null; });
    this.d.logger.warn('local Camera Off cleared on this laptop' + (this.reader.serverCamera?.active ? ' (BuhurtOS still has Camera Off on: cameras stay off)' : ''));
    await this.tick(true);
  }
  async takeLocal(kind: 'lyst' | 'holding' | 'break', field: string | null): Promise<void> {
    this.d.files.updateState(s => { s.localManual = { kind, field: kind === 'lyst' ? (field ?? '').trim().toLowerCase() || null : null }; });
    this.d.logger.info(`local choice: ${kind}${field ? ` ${field}` : ''}`);
    await this.tick(true);
  }
  async returnToAuto(): Promise<void> {
    this.d.files.updateState(s => { s.localManual = null; });
    this.d.logger.info('Return to Auto (this laptop)');
    await this.tick(true);
  }
  async setLocalMusic(m: 'auto' | 'muted' | 'paused'): Promise<void> { this.d.files.updateState(s => { s.localMusic = m; }); await this.tick(true); }
  async resumeMusic(): Promise<void> { this.d.files.updateState(s => { s.medicalMusicLock = null; }); this.d.logger.info('medical hold lifted from this laptop: music follows the normal rules again'); await this.tick(true); }
  /** Show a scene for a few seconds to check it (Camera Off still wins). */
  async testScene(name: string): Promise<{ ok: boolean; message: string }> {
    if (!this.obs.connected) return { ok: false, message: 'OBS is not connected' };
    if (!this.scenes?.includes(name)) return { ok: false, message: `OBS has no scene called "${name}"` };
    if (this.decision?.camera.active) return { ok: false, message: 'Camera Off is on: scenes cannot be tested' };
    try { await this.obs.setCurrentProgramScene(name); this.programScene = name; this.testHoldUntil = this.now() + TEST_HOLD_MS; return { ok: true, message: `Showing "${name}" for a few seconds` }; }
    catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  settingsChanged(prev: { micSource: string | null }): void {
    if (prev.micSource !== this.cfg().audio.micSource) this.obs.reconnect();     // the meter subscription changes: identify again
    this.lastCheckSetupAt = 0; this.lastScenesAt = 0;
    void this.tick(true);
  }
  obsPasswordChanged(): void { this.obs.retryNow(); }

  // ------------------------------------------------------------------------------------------- status and heartbeat

  private musicStatus(): { state: 'on' | 'muted' | 'paused' | 'unknown' | 'none'; ducking: 'on' | 'off' | 'missing' | 'unset'; mic: 'speaking' | 'quiet' | 'missing' | 'unknown' | 'unset'; locked: boolean } {
    const c = this.cfg().audio, a = this.audio, w = a.lastWant;
    const state = !c.musicSource || !a.presence.music ? 'none' : w === 'on' ? 'on' : w === 'paused' ? 'paused' : w === 'muted' ? 'muted' : a.actual.muted === true ? 'muted' : 'unknown';
    const ducking = !c.duckingFilter ? 'unset' : !a.presence.filter ? 'missing' : a.actual.filterEnabled === false ? 'off' : 'on';
    const mic = !c.micSource ? 'unset' : !a.presence.mic ? 'missing' : this.micState;
    return { state, ducking, mic, locked: !!this.d.files.state.medicalMusicLock };
  }

  /** Everything the local screen shows. No secret is in it. */
  status() {
    const f = this.d.files, now = this.now(), dec = this.decision, r = this.reader, s = this.d.session;
    const built = r.fields(now);
    const dataAge = r.status.dataOkAt === null ? null : Math.round((now - r.status.dataOkAt) / 1000);
    const ec = this.effectiveControl();
    const problems = dec?.problems ?? [];
    return {
      version: COMPANION_VERSION, now,
      obs: { state: this.obs.state, connected: this.obs.connected, version: this.obs.version?.obsVersion ?? null, problem: this.obs.lastProblem, scenes: this.scenes ?? [], programScene: this.programScene, studioMode: this.studioMode, streaming: this.streaming },
      bos: {
        session: s.status, sessionProblem: s.lastProblem, label: s.whoami?.label ?? null, hasToken: s.hasToken, dataAgeSeconds: dataAge, dataError: r.status.dataError, controllerError: r.status.controllerError,
        event: { name: r.status.eventName, slug: r.status.eventSlug }, stale: r.stale, hasData: r.hasData, controlRev: r.serverControl.control.rev, controlKnown: r.serverControl.known, lastHeartbeat: this.lastHeartbeat
      },
      awaitingData: this.awaitingData,
      mode: { effective: dec?.source ?? 'auto', controlMode: ec.control.mode, controlSource: ec.source, local: f.state.localManual, held: dec ? { by: dec.heldBy, until: dec.heldUntilMs } : null },
      onAir: dec ? { kind: dec.target.kind, field: dec.target.field, scene: this.programScene ?? dec.scene, wanted: dec.scene, reason: dec.reason, fallback: dec.fallback, lock: dec.lock?.field ?? null } : null,
      alsoLive: dec?.alsoLive ?? [],
      camera: { effective: dec?.camera.active ?? false, source: dec?.camera.source ?? null, reason: dec?.camera.reason ?? null, local: f.state.cameraOffLocal, localSince: f.state.cameraOffLocalSince, server: r.serverCamera ? r.serverCamera.active : null },
      fields: built.map(b => ({ key: b.input.field, label: b.input.label ?? b.input.field, mode: b.input.mode, phase: phaseOf(b.input.mode), summary: b.input.summary ?? null, mapped: !!f.config.mapping.lysts[b.input.field]?.live })),
      mapping: { config: f.config.mapping, problems },
      audio: { config: f.config.audio, inputs: this.audio.inputNames, musicFilters: this.audio.musicFilterNames, music: this.musicStatus(), plan: this.lastAudioPlan, presence: this.audio.presence, lastError: this.audio.lastError, localMusic: f.state.localMusic },
      testHoldSeconds: Math.max(0, Math.ceil((this.testHoldUntil - now) / 1000)),
      counters: this.counters
    };
  }

  private heartbeatBody(): Record<string, unknown> {
    const now = this.now(), dec = this.decision, r = this.reader, c = this.musicStatus();
    const ec = this.effectiveControl();
    const fightField = dec?.target.kind === 'lyst' ? dec.target.field : null;
    const built = fightField ? r.fields(now).find(b => b.input.field === fightField) : undefined;
    const age = r.status.dataOkAt === null ? null : Math.round((now - r.status.dataOkAt) / 1000);
    return buildHeartbeat({
      obsConnected: this.obs.connected, obsVersion: this.obs.version?.obsVersion ?? null, obsProblem: this.obs.connected ? null : this.obs.lastProblem,
      mode: ec.control.mode, modeSource: dec?.camera.active ? 'camera_off' : ec.source,
      onAir: { kind: dec?.target.kind ?? 'holding', field: dec?.target.field ?? null, scene: this.programScene, reason: dec?.reason ?? 'starting' },
      fight: built ? { field: built.input.field, mode: built.input.mode, summary: built.input.summary ?? null } : null,
      cameraOff: dec?.camera.active ?? false, cameraOffLocal: this.d.files.state.cameraOffLocal, cameraOffSource: dec?.camera.source ?? null,
      alsoLive: dec?.alsoLive ?? [], problems: dec?.problems ?? [], music: c, controllerVersion: COMPANION_VERSION,
      stale: r.stale || (r.status.dataError !== null && r.status.dataOkAt === null), staleSeconds: age !== null && age * 1000 > STALE_AFTER_MS ? age : null
    });
  }

  async sendHeartbeat(): Promise<void> {
    const ctl = this.d.control;
    if (!ctl || this.d.session.status === 'no_code' || !this.d.session.hasToken) return;
    try {
      await ctl.heartbeat(this.heartbeatBody());
      if (!this.lastHeartbeat.ok) this.d.logger.info('status report to BuhurtOS is working');
      this.lastHeartbeat = { ok: true, at: this.now(), error: null };
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 100);
      if (this.lastHeartbeat.ok || this.lastHeartbeat.at === null) this.d.logger.warn('could not send the status report to BuhurtOS', { message: msg });
      this.lastHeartbeat = { ok: false, at: this.lastHeartbeat.at, error: msg };
    }
  }
}


import type { FieldPhase, TargetKind } from '../../../src/lib/broadcast/decide';
import type { AudioConfig } from './config';
import type { ObsClient } from './obs/client';
import type { Logger } from './log';

/**
 * Audio policy (plan section 9). The millisecond work, ducking the music under the announcer, is done INSIDE OBS (a Compressor on the music keyed to the
 * microphone, a Noise Gate on the microphone). This module only does the coarse policy, once per change of state, through the allow-listed requests:
 *   fight in progress (and its pauses and round breaks) or its result on screen -> music faded out and muted; between fights, holding, a scheduled break -> music on
 *   Camera Off (any reason) -> music muted, NEVER switched on by Camera Off; a medical hold stays muted and locked until a person deliberately resumes it
 *   music mode muted / paused from BuhurtOS or the laptop; Auto Duck from BuhurtOS switches the ducking filter on or off (off is a warning)
 *   no microphone -> the music cannot be ducked: muted and reported (configurable); no music source -> reported
 *   level changes are a stepped fade of about a second (never per word); Play / Pause is real only for a configured Media Source, otherwise Pause means Mute
 * "Enforce silence continuously, enforce sound only on a change": if someone un-mutes the music by hand during a fight it is muted again; if someone mutes it by hand
 * between fights it stays muted until the state changes.
 */

export type MusicWant = 'on' | 'muted' | 'paused' | 'none';
export interface AudioWarning { code: 'auto_duck_off' | 'mic_missing' | 'mic_not_set' | 'music_source_missing' | 'music_source_not_set' | 'ducking_filter_missing' | 'ducking_filter_not_set' | 'ducking_not_keyed_to_mic' | 'mic_no_noise_gate' | 'medical_hold'; text: string }

export interface AudioPlanInput {
  onAir: { kind: TargetKind; phase: FieldPhase | null };
  camera: { active: boolean; medical: boolean };
  medicalLock: boolean;
  musicMode: 'auto' | 'muted' | 'paused';
  autoDuck: boolean;
  present: { music: boolean; mic: boolean; filter: boolean };
  cfg: AudioConfig;
}
export interface AudioPlan { music: MusicWant; reason: string; duckingEnabled: boolean | null; warnings: AudioWarning[] }

export function planAudio(i: AudioPlanInput): AudioPlan {
  const warnings: AudioWarning[] = [];
  const w = (code: AudioWarning['code'], text: string) => warnings.push({ code, text });
  if (!i.cfg.musicSource) w('music_source_not_set', 'No music source is chosen yet');
  else if (!i.present.music) w('music_source_missing', `The music source "${i.cfg.musicSource}" is not in OBS`);
  if (!i.cfg.micSource) w('mic_not_set', 'No announcer microphone is chosen yet');
  else if (!i.present.mic) w('mic_missing', `The announcer microphone "${i.cfg.micSource}" is not in OBS: music cannot be lowered for announcements`);
  if (!i.cfg.duckingFilter) w('ducking_filter_not_set', 'No ducking filter is chosen yet');
  else if (i.cfg.musicSource && i.present.music && !i.present.filter) w('ducking_filter_missing', `The ducking filter "${i.cfg.duckingFilter}" is not on "${i.cfg.musicSource}"`);
  if (i.medicalLock) w('medical_hold', 'Medical hold: music stays off until someone resumes it');
  const filterUsable = !!(i.cfg.musicSource && i.cfg.duckingFilter && i.present.music && i.present.filter);
  if (filterUsable && !i.autoDuck) w('auto_duck_off', 'Auto Duck is OFF: music will not lower itself when the announcer speaks');
  const duckingEnabled = filterUsable ? i.autoDuck : null;

  const none = (reason: string): AudioPlan => ({ music: 'none', reason, duckingEnabled, warnings });
  if (!i.cfg.musicSource || !i.present.music) return none('no music source to control');
  const plan = (music: Exclude<MusicWant, 'none'>, reason: string): AudioPlan => ({ music, reason, duckingEnabled, warnings });

  if (i.camera.active) return plan('muted', i.camera.medical ? 'Camera Off (medical): music stays off' : 'Camera Off: music stays off');
  if (i.medicalLock) return plan('muted', 'medical hold: music stays off until someone resumes it');
  if (i.musicMode === 'muted') return plan('muted', 'music muted from the control screen');
  if (i.musicMode === 'paused') return plan('paused', 'music paused from the control screen');
  if (i.cfg.micSource && !i.present.mic && i.cfg.muteMusicWhenMicMissing) return plan('muted', 'no announcer microphone: music muted so it cannot drown an announcement');
  if (i.onAir.kind === 'lyst' && (i.onAir.phase === 'fightLive' || i.onAir.phase === 'post')) return plan('muted', i.onAir.phase === 'post' ? 'result on screen: music stays off' : 'fight in progress: music off');
  return plan('on', i.onAir.kind === 'break' ? 'scheduled break: music on' : i.onAir.kind === 'holding' ? 'between fights: music on' : 'no fight in progress: music on');
}

export interface AudioActual { muted: boolean | null; volumeDb: number | null; media: string | null; filterEnabled: boolean | null }
export interface AudioPresence { music: boolean; mic: boolean; filter: boolean; mediaOk: boolean; keyedToMic: boolean | null; micGate: boolean | null }

const FLOOR_DB = -60;
const STEP_MS = 200;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** What the executor needs from OBS: the typed wrappers of ObsClient, so every call still goes through the allow-list. */
export type AudioObs = Pick<ObsClient, 'getInputList' | 'getInputMute' | 'setInputMute' | 'getInputVolume' | 'setInputVolumeDb' | 'getSourceFilterList' | 'setSourceFilterEnabled' | 'getMediaInputStatus' | 'mediaPlay' | 'mediaPause'>;

export class AudioExecutor {
  actual: AudioActual = { muted: null, volumeDb: null, media: null, filterEnabled: null };
  presence: AudioPresence = { music: false, mic: false, filter: false, mediaOk: false, keyedToMic: null, micGate: null };
  lastWant: MusicWant | null = null;
  /** Names OBS has, for the setup screen's pick lists. */
  inputNames: string[] = [];
  musicFilterNames: string[] = [];
  private version = 0;
  private busy: Promise<void> | null = null;
  private pending: AudioPlan | null = null;
  lastError: string | null = null;

  constructor(private readonly obs: AudioObs, private readonly cfg: () => AudioConfig, private readonly logger: Logger, private readonly o: { stepMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {}

  /** Forget what we believe about OBS (after a reconnect): the next apply re-reads and re-applies the policy. */
  resetKnowledge(): void { this.actual = { muted: null, volumeDb: null, media: null, filterEnabled: null }; this.lastWant = null; this.version++; }

  /** Check that the configured sources and the ducking filter exist and read their state. Never throws. */
  async checkSetup(): Promise<AudioPresence> {
    const c = this.cfg();
    const p: AudioPresence = { music: false, mic: false, filter: false, mediaOk: false, keyedToMic: null, micGate: null };
    try {
      const inputs = await this.obs.getInputList();
      this.inputNames = inputs.map(i => i.inputName);
      const names = new Set(this.inputNames);
      p.music = !!c.musicSource && names.has(c.musicSource);
      p.mic = !!c.micSource && names.has(c.micSource);
      p.mediaOk = !!c.mediaSource && names.has(c.mediaSource);
      if (p.music && c.duckingFilter) {
        const filters = await this.obs.getSourceFilterList(c.musicSource as string);
        this.musicFilterNames = filters.map(x => x.filterName);
        const f = filters.find(x => x.filterName === c.duckingFilter);
        p.filter = !!f;
        if (f) {
          this.actual.filterEnabled = f.filterEnabled;
          const sc = f.filterSettings?.sidechain_source;
          p.keyedToMic = typeof sc === 'string' ? sc === c.micSource : null;
        }
      }
      if (p.mic) { try { p.micGate = (await this.obs.getSourceFilterList(c.micSource as string)).some(f => f.filterKind === 'noise_gate_filter' && f.filterEnabled); } catch { p.micGate = null; } }
      if (p.music) {
        this.actual.muted = await this.obs.getInputMute(c.musicSource as string);
        this.actual.volumeDb = (await this.obs.getInputVolume(c.musicSource as string)).db;
      }
      this.lastError = null;
    } catch (e) { this.lastError = (e as Error).message; return this.presence; }
    this.presence = p;
    return p;
  }

  noteMute(input: string, muted: boolean): void { if (input === this.cfg().musicSource) this.actual.muted = muted; }
  noteVolume(input: string, db: number): void { if (input === this.cfg().musicSource) this.actual.volumeDb = db; }
  noteFilter(source: string, filter: string, enabled: boolean): void { const c = this.cfg(); if (source === c.musicSource && filter === c.duckingFilter) this.actual.filterEnabled = enabled; }
  noteMedia(input: string, state: string): void { if (input === this.cfg().mediaSource) this.actual.media = state; }

  /** Ask for a plan to be carried out. Plans are applied one at a time; a newer plan replaces one that is still waiting, and cuts a running fade short. */
  apply(plan: AudioPlan): Promise<void> {
    this.pending = plan;
    this.version++;                                          // a fade that is running notices this at its next step and stops
    this.busy ??= this.pump().finally(() => { this.busy = null; });
    return this.busy;
  }

  private async pump(): Promise<void> {
    while (this.pending) {
      const plan = this.pending; this.pending = null;
      try { await this.carryOut(plan); this.lastError = null; }
      catch (e) { this.lastError = (e as Error).message; this.lastWant = null; this.logger.warn('audio command failed; will retry', { message: this.lastError }); }
    }
  }

  private async carryOut(plan: AudioPlan): Promise<void> {
    const c = this.cfg();
    // the ducking filter follows Auto Duck (both directions)
    if (plan.duckingEnabled !== null && c.musicSource && c.duckingFilter && this.actual.filterEnabled !== plan.duckingEnabled) {
      await this.obs.setSourceFilterEnabled(c.musicSource, c.duckingFilter, plan.duckingEnabled);
      this.actual.filterEnabled = plan.duckingEnabled;
    }
    if (plan.music === 'none' || !c.musicSource) { this.lastWant = plan.music; return; }
    const music = c.musicSource, changed = this.lastWant !== plan.music;
    const ver = ++this.version;
    if (plan.music === 'muted' || plan.music === 'paused') {
      const wantMute = plan.music === 'muted' || !c.mediaSource || !this.presence.mediaOk;      // Pause without a Media Source means Mute
      if (changed || this.actual.muted === false) {
        if (this.actual.muted !== true) await this.fade(music, this.actual.volumeDb ?? c.normalLevelDb, FLOOR_DB, ver);
        if (ver !== this.version) { this.lastWant = null; return; }
        if (wantMute && this.actual.muted !== true) { await this.obs.setInputMute(music, true); this.actual.muted = true; }
        if (this.actual.muted === true || wantMute) { await this.obs.setInputVolumeDb(music, c.normalLevelDb); this.actual.volumeDb = c.normalLevelDb; }   // ready for the next time, while silent
      }
      if (changed && c.mediaSource && this.presence.mediaOk && (plan.music === 'paused' || plan.music === 'muted')) await this.media(c.mediaSource, false);
      this.lastWant = plan.music;
      return;
    }
    // on: only on a change of state (never fight a person who adjusted the music by hand)
    if (changed) {
      if (this.actual.muted !== false) {
        await this.obs.setInputVolumeDb(music, FLOOR_DB); this.actual.volumeDb = FLOOR_DB;
        await this.obs.setInputMute(music, false); this.actual.muted = false;
      }
      if (c.mediaSource && this.presence.mediaOk) await this.media(c.mediaSource, true);
      await this.fade(music, this.actual.volumeDb ?? FLOOR_DB, c.normalLevelDb, ver);
      if (ver !== this.version) { this.lastWant = null; return; }
    }
    this.lastWant = plan.music;
  }

  private async media(input: string, play: boolean): Promise<void> {
    const state = await this.obs.getMediaInputStatus(input);
    this.actual.media = state;
    const playing = state === 'OBS_MEDIA_STATE_PLAYING';
    if (play && !playing) await this.obs.mediaPlay(input);
    if (!play && playing) await this.obs.mediaPause(input);
  }

  /** A stepped fade in dB (about every 200 ms): a handful of requests, never one per word. */
  private async fade(input: string, from: number, to: number, ver: number): Promise<void> {
    const total = this.cfg().fadeMs;
    const stepMs = this.o.stepMs ?? STEP_MS;
    const steps = Math.max(1, Math.round(total / stepMs));
    if (total <= 0 || Math.abs(to - from) < 0.5) { if (Math.abs(to - from) >= 0.5) { await this.obs.setInputVolumeDb(input, to); this.actual.volumeDb = to; } return; }
    for (let s = 1; s <= steps; s++) {
      if (ver !== this.version) return;
      const db = Math.round((from + ((to - from) * s) / steps) * 10) / 10;
      await this.obs.setInputVolumeDb(input, Math.max(-100, Math.min(0, db))); this.actual.volumeDb = db;
      if (s < steps) await (this.o.sleep ?? sleep)(stepMs);
    }
  }
}

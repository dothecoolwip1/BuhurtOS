import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writePrivateFile } from './credentials';
import type { SceneMapping } from '../../../src/lib/broadcast/decide';

/**
 * The Companion's settings and its small local memory, in two owner-only files in one folder (default ~/.buhurtos-broadcast, or BUHURTOS_COMPANION_HOME).
 * Nothing secret is in either file: those go to the credential store. Parsing is forgiving: a damaged file never stops the helper, it just falls back
 * to defaults for what it cannot read.
 */
export const CONFIG_VERSION = 1;
export const LOOPBACK_HOST = '127.0.0.1';

export interface AudioConfig {
  /** The OBS input that plays the music (a Media Source, a captured app or a line-in). */
  musicSource: string | null;
  /** The announcer's microphone input. */
  micSource: string | null;
  /** The name of the ducking filter (a Compressor keyed to the mic) on the music source. */
  duckingFilter: string | null;
  /** Optional: a real OBS Media Source, so Play/Pause is real (otherwise Pause means Mute). */
  mediaSource: string | null;
  /** Where music sits when it is on, in dB (0 = full). */
  normalLevelDb: number;
  /** How long a fade out / in takes. */
  fadeMs: number;
  /** A missing mic means the music cannot be ducked: mute it and say so. */
  muteMusicWhenMicMissing: boolean;
  /** With no Camera Off scene, Camera Off mutes these inputs (the camera microphones) and shows holding. */
  cameraAudioInputs: string[];
  /** Above this level (dB) the mic counts as "speaking" in the status report. */
  speakingThresholdDb: number;
}

export interface Config {
  version: number;
  /** The project address and publishable key identify the project and are public by design. */
  supabaseUrl: string | null;
  supabaseKey: string | null;
  /** Used for AUTO only when there is no controller code (the code itself names the event). */
  eventSlug: string | null;
  obsPort: number;
  uiPort: number;
  mapping: SceneMapping & { lysts: Record<string, { live?: string | null; graphics?: string | null }> };
  audio: AudioConfig;
}

export const DEFAULT_AUDIO: AudioConfig = {
  musicSource: null, micSource: null, duckingFilter: null, mediaSource: null, normalLevelDb: -14, fadeMs: 1000,
  muteMusicWhenMicMissing: true, cameraAudioInputs: [], speakingThresholdDb: -40
};
export const defaultConfig = (): Config => ({
  version: CONFIG_VERSION, supabaseUrl: null, supabaseKey: null, eventSlug: null, obsPort: 4455, uiPort: 4777,
  mapping: { lysts: {}, holding: null, break: null, cameraOff: null }, audio: { ...DEFAULT_AUDIO, cameraAudioInputs: [] }
});

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : null);
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
const port = (v: unknown, d: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : d);
const fieldKeyOf = (k: string): string => k.trim().toLowerCase();

/** Never throws. Unknown keys are dropped; anything invalid becomes the default. The OBS host is not configurable: it is always this laptop. */
export function parseConfig(raw: unknown): Config {
  const d = defaultConfig();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const m = (r.mapping && typeof r.mapping === 'object' ? r.mapping : {}) as Record<string, unknown>;
  const lysts: Config['mapping']['lysts'] = {};
  if (m.lysts && typeof m.lysts === 'object') {
    for (const [k, v] of Object.entries(m.lysts as Record<string, unknown>).slice(0, 64)) {
      const key = str(k, 40); if (!key || !v || typeof v !== 'object') continue;
      const e = v as Record<string, unknown>;
      lysts[fieldKeyOf(key)] = { live: str(e.live), graphics: str(e.graphics) };
    }
  }
  const a = (r.audio && typeof r.audio === 'object' ? r.audio : {}) as Record<string, unknown>;
  return {
    version: CONFIG_VERSION,
    supabaseUrl: (() => { const u = str(r.supabaseUrl, 300); try { return u && /^https?:$/.test(new URL(u).protocol) ? u.replace(/\/+$/, '') : null; } catch { return null; } })(),
    supabaseKey: str(r.supabaseKey, 400),
    eventSlug: str(r.eventSlug, 80),
    obsPort: port(r.obsPort, d.obsPort), uiPort: port(r.uiPort, d.uiPort),
    mapping: { lysts, holding: str(m.holding), break: str(m.break), cameraOff: str(m.cameraOff) },
    audio: {
      musicSource: str(a.musicSource), micSource: str(a.micSource), duckingFilter: str(a.duckingFilter), mediaSource: str(a.mediaSource),
      normalLevelDb: num(a.normalLevelDb, -60, 0, DEFAULT_AUDIO.normalLevelDb), fadeMs: num(a.fadeMs, 0, 10_000, DEFAULT_AUDIO.fadeMs),
      muteMusicWhenMicMissing: a.muteMusicWhenMicMissing === false ? false : true,
      cameraAudioInputs: Array.isArray(a.cameraAudioInputs) ? a.cameraAudioInputs.map(x => str(x)).filter((x): x is string => !!x).slice(0, 16) : [],
      speakingThresholdDb: num(a.speakingThresholdDb, -90, 0, DEFAULT_AUDIO.speakingThresholdDb)
    }
  };
}

/** Environment overrides (used by tests and headless runs). The OBS host cannot be overridden. */
export function applyEnv(c: Config, env: NodeJS.ProcessEnv = process.env): Config {
  const out: Config = { ...c, mapping: { ...c.mapping, lysts: { ...c.mapping.lysts } }, audio: { ...c.audio } };
  if (env.BUHURTOS_SUPABASE_URL) out.supabaseUrl = env.BUHURTOS_SUPABASE_URL.replace(/\/+$/, '');
  if (env.BUHURTOS_SUPABASE_KEY) out.supabaseKey = env.BUHURTOS_SUPABASE_KEY;
  if (env.BUHURTOS_EVENT_SLUG) out.eventSlug = env.BUHURTOS_EVENT_SLUG;
  if (env.OBS_PORT && Number(env.OBS_PORT) > 0) out.obsPort = Number(env.OBS_PORT);
  if (env.BUHURTOS_UI_PORT && Number(env.BUHURTOS_UI_PORT) >= 0) out.uiPort = Number(env.BUHURTOS_UI_PORT);
  return out;
}

export interface LocalState {
  version: number;
  /** The on-laptop Camera Off latch. Cleared only here (the local button), never by the server, OBS or a restart. */
  cameraOffLocal: boolean;
  cameraOffLocalSince: string | null;
  /** The last Camera Off answer BuhurtOS gave: an unreachable server keeps a latched Off. */
  lastServerCamera: { active: boolean; reason: string | null; rev: number | null; at: string } | null;
  /** A medical hold keeps music muted until someone deliberately resumes it. */
  medicalMusicLock: { since: string; controlRev: number | null; sawNonAuto: boolean } | null;
  /** Fights' first-live times as the database reported them (kept so a restart with the database unreachable lands on the same fight). */
  firstLive: Record<string, number>;
  /** The local "Take" / Holding / Break choice from the laptop screen (beats AUTO until "Return to Auto"). */
  localManual: { kind: 'lyst' | 'holding' | 'break'; field: string | null } | null;
  /** Local music choice from the laptop screen. */
  localMusic: 'auto' | 'muted' | 'paused';
  eventId: string | null;
}
export const defaultState = (): LocalState => ({
  version: 1, cameraOffLocal: false, cameraOffLocalSince: null, lastServerCamera: null, medicalMusicLock: null, firstLive: {}, localManual: null, localMusic: 'auto', eventId: null
});
export function parseState(raw: unknown): LocalState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const cam = r.lastServerCamera as Record<string, unknown> | null | undefined;
  const lock = r.medicalMusicLock as Record<string, unknown> | null | undefined;
  const lm = r.localManual as Record<string, unknown> | null | undefined;
  const fl: Record<string, number> = {};
  if (r.firstLive && typeof r.firstLive === 'object') for (const [k, v] of Object.entries(r.firstLive as Record<string, unknown>).slice(0, 300)) if (typeof v === 'number' && Number.isFinite(v)) fl[k.slice(0, 80)] = v;
  return {
    version: 1,
    cameraOffLocal: r.cameraOffLocal === true,
    cameraOffLocalSince: typeof r.cameraOffLocalSince === 'string' ? r.cameraOffLocalSince : null,
    lastServerCamera: cam && typeof cam === 'object' && typeof cam.active === 'boolean' ? { active: cam.active, reason: typeof cam.reason === 'string' ? cam.reason : null, rev: typeof cam.rev === 'number' ? cam.rev : null, at: typeof cam.at === 'string' ? cam.at : '' } : null,
    medicalMusicLock: lock && typeof lock === 'object' && typeof lock.since === 'string' ? { since: lock.since, controlRev: typeof lock.controlRev === 'number' ? lock.controlRev : null, sawNonAuto: lock.sawNonAuto === true } : null,
    firstLive: fl,
    localManual: lm && typeof lm === 'object' && (lm.kind === 'lyst' || lm.kind === 'holding' || lm.kind === 'break') ? { kind: lm.kind, field: lm.kind === 'lyst' ? str(lm.field, 40) : null } : null,
    localMusic: r.localMusic === 'muted' || r.localMusic === 'paused' ? r.localMusic : 'auto',
    eventId: typeof r.eventId === 'string' ? r.eventId : null
  };
}

export const companionHome = (env: NodeJS.ProcessEnv = process.env): string => env.BUHURTOS_COMPANION_HOME || join(homedir(), '.buhurtos-broadcast');

function readJson(path: string): unknown { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; } }

/** Reads and writes config.json and state.json (owner-only, atomic). Writes never throw into the control loop: a failure is reported through `onError`. */
export class LocalFiles {
  config: Config; state: LocalState;
  constructor(readonly home: string, private readonly onError: (msg: string) => void = () => undefined, env: NodeJS.ProcessEnv = process.env) {
    this.config = applyEnv(parseConfig(readJson(join(home, 'config.json'))), env);
    this.state = parseState(readJson(join(home, 'state.json')));
  }
  get configPath() { return join(this.home, 'config.json'); }
  get statePath() { return join(this.home, 'state.json'); }
  saveConfig(next: Config): void { this.config = next; try { writePrivateFile(this.configPath, JSON.stringify(next, null, 2)); } catch (e) { this.onError(`could not save settings: ${(e as Error).message}`); } }
  updateConfig(f: (c: Config) => Config): void { this.saveConfig(parseConfig(f(this.config))); }
  saveState(): void { try { writePrivateFile(this.statePath, JSON.stringify(this.state)); } catch (e) { this.onError(`could not save local state: ${(e as Error).message}`); } }
  updateState(f: (s: LocalState) => void): void { f(this.state); this.saveState(); }
}

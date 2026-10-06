/**
 * Pack 18.1: the Command Centre's Broadcast panel, in words (pure). It does not run OBS and does not decide what is on air: it reads what the
 * database holds (the control row) and what the stream controller last reported (a small heartbeat), and says it plainly. A controller that is
 * missing, silent or reports odd or partial data never breaks the screen; the panel says what it does not know.
 */
import { fieldKey } from './eventDay';
import type { CameraState } from './cameraOff';

export type Mode = 'auto' | 'manual';
export type TargetKind = 'lyst' | 'holding' | 'break';
export type MusicMode = 'auto' | 'muted' | 'paused';

/** `event_broadcast_control` as the database returns it (desired presentation only). */
export interface BroadcastControl {
  mode: Mode; targetKind: TargetKind | null; targetField: string | null; musicMode: MusicMode; autoDuck: boolean;
  priorityFields: string[]; rev: number; updatedAt: string | null; updatedByLabel: string | null;
}
export interface ControllerReport { reportedAt: string; ageSeconds: number; status: unknown }
export interface BroadcastState {
  control: BroadcastControl; camera: CameraState; controller: ControllerReport | null; controllerExists: boolean; canControl: boolean; serverNow: string;
}

/** A report older than this is "silent" (the controller sends one about every 5 s). */
export const CONTROLLER_SILENT_S = 30;

export const DEFAULT_CONTROL: BroadcastControl = { mode: 'auto', targetKind: null, targetField: null, musicMode: 'auto', autoDuck: true, priorityFields: [], rev: 0, updatedAt: null, updatedByLabel: null };

// ---------------------------------------------------------------- loose reading of the heartbeat (it is written by another program: trust nothing about its shape)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** "Field 2" / "field 2" -> "Lyst 2"; any other name stays as it is ("Ring A"). */
export function lystLabel(field: string | null | undefined): string {
  const f = (field ?? '').trim();
  if (!f) return 'a Lyst';
  const m = /^(?:field|lyst)\s*(\d+)$/i.exec(f);
  return m ? `Lyst ${m[1]}` : f;
}

export interface Heartbeat {
  obsConnected: boolean | null;
  mode: Mode | null;
  onAir: { kind: 'lyst' | 'holding' | 'break' | 'camera_off' | 'unknown'; field: string | null; scene: string | null; reason: string | null } | null;
  fight: string | null;
  cameraOff: boolean | null; cameraOffLocal: boolean | null;
  music: { state: 'playing' | 'muted' | 'paused' | null; ducking: boolean | null; mic: 'quiet' | 'speaking' | null } | null;
  alsoLive: string[];
  mappingProblems: string[];
}

function onAirOf(v: unknown): Heartbeat['onAir'] {
  if (typeof v === 'string') {                                  // an older / simpler controller may send just a name ("field 1", "holding")
    const s = v.trim().toLowerCase();
    if (!s) return null;
    if (s === 'holding' || s === 'break' || s === 'camera_off') return { kind: s, field: null, scene: null, reason: null };
    return { kind: 'lyst', field: v.trim().slice(0, 40), scene: null, reason: null };
  }
  const o = obj(v);
  if (!o) return null;
  const k = str(o.kind, 20)?.toLowerCase();
  const kind = k === 'lyst' || k === 'holding' || k === 'break' || k === 'camera_off' ? k : 'unknown';
  return { kind, field: str(o.field, 40), scene: str(o.scene), reason: str(o.reason, 60) };
}
const textOf = (v: unknown): string | null => {
  if (typeof v === 'string') return str(v, 80);
  const o = obj(v);
  if (!o) return null;
  return str(o.title) ?? str(o.label) ?? str(o.name) ?? str(o.fight) ?? null;
};
function alsoLiveOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).flatMap((x): string[] => {
    if (typeof x === 'string') { const s = str(x); return s ? [s] : []; }
    const o = obj(x);
    if (!o) return [];
    const field = str(o.field, 40);
    const what = str(o.title) ?? str(o.fight) ?? str(o.label);
    const round = typeof o.round === 'number' ? `round ${o.round}` : str(o.round, 20);
    const inner = [what, round].filter(Boolean).join(', ');
    return field || inner ? [`${field ? lystLabel(field) : 'Another Lyst'}${inner ? ` (${inner})` : ''}`] : [];
  });
}
function problemsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).flatMap((x): string[] => { const s = typeof x === 'string' ? str(x, 100) : (str(obj(x)?.message, 100) ?? str(obj(x)?.problem, 100)); return s ? [s] : []; });
}

/** Everything the panel may show from a heartbeat, every field optional. Never throws. */
export function parseHeartbeat(status: unknown): Heartbeat | null {
  const o = obj(status);
  if (!o || Object.keys(o).length === 0) return null;
  const music = obj(o.music);
  const state = str(music?.state, 20)?.toLowerCase();
  const mic = str(music?.mic, 20)?.toLowerCase();
  const mode = str(o.mode, 10)?.toLowerCase();
  return {
    obsConnected: bool(o.obs_connected),
    mode: mode === 'auto' || mode === 'manual' ? mode : null,
    onAir: onAirOf(o.on_air),
    fight: textOf(o.fight),
    cameraOff: bool(o.camera_off), cameraOffLocal: bool(o.camera_off_local),
    music: music ? {
      state: state === 'playing' || state === 'muted' || state === 'paused' ? state : null,
      ducking: bool(music.ducking),
      mic: mic === 'quiet' || mic === 'speaking' ? mic : null
    } : null,
    alsoLive: alsoLiveOf(o.also_live),
    mappingProblems: problemsOf(o.mapping_problems)
  };
}

// ---------------------------------------------------------------- how long ago the controller spoke
/** Seconds since the controller's last report, as of `nowMs`: the age the database measured when we read it, plus the time since we read it. */
export function controllerAge(report: ControllerReport | null, readAtMs: number, nowMs: number): number | null {
  if (!report || !Number.isFinite(report.ageSeconds)) return null;
  return Math.max(0, Math.round(report.ageSeconds + (nowMs - readAtMs) / 1000));
}
export const controllerSilent = (ageSeconds: number | null): boolean => ageSeconds !== null && ageSeconds >= CONTROLLER_SILENT_S;
export function ageWords(s: number): string {
  if (s < 5) return 'just now';
  if (s < 90) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// ---------------------------------------------------------------- the status lines
export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export interface StatusLine { id: string; label: string; value: string; tone: Tone; note?: string }
export interface PanelStatus {
  /** the plain headline about the controller itself */
  controller: StatusLine;
  /** the lines to show (always the database's own: Mode, Music, Auto Duck, Camera Safety; plus the controller's when it is reporting) */
  lines: StatusLine[];
  /** "Also live: Lyst 2 (C vs D)" */
  alsoLive: string[];
  /** setup problems the controller reports (a Lyst with no camera, a missing scene...) */
  problems: string[];
  /** the controller's lines are an old report, not live */
  stale: boolean;
  /** nothing is reporting at all */
  noController: boolean;
}

const upper = (m: string) => m.toUpperCase();
export function onAirWord(a: NonNullable<Heartbeat['onAir']>): string {
  switch (a.kind) {
    case 'lyst': return lystLabel(a.field);
    case 'holding': return 'Holding (between fights)';
    case 'break': return 'Break';
    case 'camera_off': return 'Safe screen (cameras off)';
    default: return a.scene ?? 'Not reported';
  }
}
/** What the overlay on the stream is doing, from what is on air (the overlay follows the program; this does not read the overlay itself). */
export function overlayWord(a: Heartbeat['onAir']): { value: string; tone: Tone } {
  if (!a) return { value: 'Not reported', tone: 'muted' };
  if (a.kind === 'lyst') return { value: 'Live', tone: 'ok' };
  if (a.kind === 'holding') return { value: 'Queue and sponsors', tone: 'muted' };
  if (a.kind === 'break') return { value: 'Break screen', tone: 'muted' };
  if (a.kind === 'camera_off') return { value: 'Hidden', tone: 'warn' };
  return { value: 'Not reported', tone: 'muted' };
}

export function panelStatus(input: { control: BroadcastControl; camera: Pick<CameraState, 'active'>; controller: ControllerReport | null; ageSeconds: number | null }): PanelStatus {
  const { control, camera, controller } = input;
  const hb = controller ? parseHeartbeat(controller.status) : null;
  const age = input.ageSeconds;
  const silent = controllerSilent(age);
  const reporting = !!controller && !!hb;
  const noController = !controller;

  const ctl: StatusLine = noController
    ? { id: 'controller', label: 'Stream controller', value: 'Not connected', tone: 'bad' }
    : silent
      ? { id: 'controller', label: 'Stream controller', value: `Silent for ${age} s`, tone: 'bad', note: 'Last report below is old. The stream may not be following BuhurtOS.' }
      : { id: 'controller', label: 'Stream controller', value: `Last seen ${age === null ? 'recently' : ageWords(age)}`, tone: 'ok' };

  const lines: StatusLine[] = [];
  const dim = (t: Tone): Tone => (silent && t === 'ok' ? 'muted' : t);
  if (reporting) {
    lines.push(hb.obsConnected === null ? { id: 'obs', label: 'OBS', value: 'Not reported', tone: 'muted' }
      : { id: 'obs', label: 'OBS', value: hb.obsConnected ? 'Connected' : 'Not connected', tone: hb.obsConnected ? dim('ok') : 'bad' });
  }
  const differs = reporting && hb.mode !== null && hb.mode !== control.mode;
  lines.push({ id: 'mode', label: 'Mode', value: upper(control.mode), tone: control.mode === 'manual' ? 'warn' : 'ok',
    note: control.mode === 'manual' && control.targetKind ? `You are holding ${control.targetKind === 'lyst' ? lystLabel(control.targetField) : control.targetKind === 'holding' ? 'Holding' : 'Break'}` : differs ? `Controller still shows ${upper(hb.mode as string)}` : undefined });
  if (reporting) {
    lines.push({ id: 'onair', label: 'On air', value: hb.onAir ? onAirWord(hb.onAir) : 'Not reported', tone: hb.onAir ? dim('ok') : 'muted', note: hb.onAir?.reason ?? undefined });
    lines.push({ id: 'fight', label: 'Fight', value: hb.fight ?? 'None', tone: 'muted' });
    const cam = hb.onAir?.kind === 'lyst' ? (hb.onAir.scene ?? lystLabel(hb.onAir.field)) : hb.onAir?.kind === 'camera_off' ? 'Cameras off' : null;
    lines.push({ id: 'camera', label: 'Camera', value: cam ?? 'None on air', tone: 'muted' });
    const ov = overlayWord(hb.onAir);
    lines.push({ id: 'overlay', label: 'Overlay', value: ov.value, tone: dim(ov.tone) });
    const ms = hb.music?.state;
    lines.push({ id: 'music', label: 'Music', value: ms === 'playing' ? 'Playing' : ms === 'muted' ? 'Muted' : ms === 'paused' ? 'Paused' : 'Not reported', tone: ms ? 'muted' : 'muted',
      note: control.musicMode !== 'auto' ? `Set to ${control.musicMode === 'muted' ? 'muted' : 'paused'} here` : undefined });
    const mic = hb.music?.mic;
    lines.push({ id: 'mic', label: 'Mic', value: mic === 'speaking' ? 'Speaking' : mic === 'quiet' ? 'Quiet' : 'Not reported', tone: 'muted' });
  } else {
    lines.push({ id: 'music', label: 'Music', value: control.musicMode === 'muted' ? 'Muted (set here)' : control.musicMode === 'paused' ? 'Paused (set here)' : 'Automatic', tone: 'muted' });
  }
  lines.push({ id: 'duck', label: 'Auto Duck', value: control.autoDuck ? 'On' : 'Off', tone: control.autoDuck ? 'ok' : 'warn',
    note: reporting && hb.music?.ducking === true ? 'Ducking now' : undefined });
  const camOff = camera.active || (reporting && hb.cameraOff === true);
  lines.push({ id: 'safety', label: 'Camera Safety', value: camOff ? 'CAMERAS OFF' : 'ON AIR', tone: camOff ? 'bad' : 'ok',
    note: reporting && hb.cameraOffLocal === true ? 'Cut on the laptop' : undefined });

  return { controller: ctl, lines, alsoLive: reporting && !silent ? hb.alsoLive : [], problems: reporting ? hb.mappingProblems : [], stale: silent, noController };
}

// ---------------------------------------------------------------- who may do what
export type BroadcastAccess = 'control' | 'view' | 'none';
/** What the viewer is offered, from the database's own answer (`can_control`). The database decides again on every press (set_broadcast_control): this only avoids showing buttons that would be refused. */
export function broadcastAccess(state: Pick<BroadcastState, 'canControl'> | null): BroadcastAccess {
  return !state ? 'none' : state.canControl ? 'control' : 'view';
}

// ---------------------------------------------------------------- the controls
export interface LystChoice { field: string; label: string }
/** One "Take Lyst N" per field the event has fights on (names as the fights carry them), numbered ones in order. */
export function lystChoices(fieldNames: readonly string[]): LystChoice[] {
  const seen = new Set<string>();
  const out: LystChoice[] = [];
  for (const n of fieldNames) {
    const k = fieldKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ field: n, label: lystLabel(n) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
}
export type Patch = Partial<{ mode: Mode; target_kind: TargetKind; target_field: string; music_mode: MusicMode; auto_duck: boolean }>;
export const patches = {
  auto: (): Patch => ({ mode: 'auto' }),
  takeLyst: (field: string): Patch => ({ mode: 'manual', target_kind: 'lyst', target_field: field }),
  holding: (): Patch => ({ mode: 'manual', target_kind: 'holding' }),
  breakScreen: (): Patch => ({ mode: 'manual', target_kind: 'break' }),
  music: (m: MusicMode): Patch => ({ music_mode: m }),
  duck: (on: boolean): Patch => ({ auto_duck: on })
};
/** "MANUAL" pressed by itself: keep what is on air now (the Lyst or screen the controller reports), or hold the between-fights screen when that is not known. */
export function manualKeepingWhatIsOn(control: BroadcastControl, hb: Pick<Heartbeat, 'onAir'> | null): Patch {
  if (control.targetKind === 'lyst' && control.targetField) return patches.takeLyst(control.targetField);
  if (control.targetKind === 'break') return patches.breakScreen();
  if (control.targetKind === 'holding') return patches.holding();
  const a = hb?.onAir;
  if (a?.kind === 'lyst' && a.field) return patches.takeLyst(a.field);
  if (a?.kind === 'break') return patches.breakScreen();
  return patches.holding();
}
/** Is this the Lyst the control row is holding? (field keys compare case-insensitively, as the database normalises them.) */
export const isTaken = (control: BroadcastControl, field: string): boolean => control.mode === 'manual' && control.targetKind === 'lyst' && fieldKey(control.targetField) === fieldKey(field);

export const STALE_MESSAGE = 'Someone else just changed this; check and try again.';

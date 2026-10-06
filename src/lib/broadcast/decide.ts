import type { SceneMode } from './state';
import { fieldKey } from '../eventDay';

/**
 * Pack 18.1: which scene the stream should be on. A PURE function (no clock, no network, no OBS words): the local broadcast controller and, later,
 * the Command Centre ("AUTO would show...") both call it, so they can never disagree.
 *
 * It never re-derives what a fight is doing. Each field arrives as the Pack 14 `SceneMode` that `broadcastScene` already computed from the same public
 * data the overlay reads, plus a DURABLE first-live time (from the database, so a restart lands on the same fight AUTO already had).
 * The decision depends on the PHASE of each field only: a score, a clock tick or a penalty can never move the camera.
 *
 * Rules (plan section 5), in order:
 *   1. Camera Off (server OR the local latch) beats everything, including a manual choice. Unknown server state keeps a latched Off.
 *   2. MANUAL: the manual target; nothing automatic moves it.
 *   3. AUTO lock: while the Lyst we are on is in a fight (live, paused, round break, equipment, DQ) or showing its result (complete, winner) we STAY
 *      on it, whatever another Lyst does.
 *   4. The lock is released only when that Lyst goes quiet (winner presentation over), its fight is voided, or it is reopened.
 *   5. Pick next: a Lyst in a fight, earliest first-live (ties: the organizer's priority list, then field key); else a Lyst that is armed (fighters walking
 *      on), earliest armed (same ties); else holding.
 *   6. Anti-thrash: 10 s minimum between AUTO switches (never delays Camera Off or an operator's choice); a Lyst we just left cannot be re-taken for 5 s.
 *   7. Other Lysts in a fight are listed as "also live" (the operator can Take one: that is a manual choice).
 *   8. Return to Auto (manual -> auto) is a FRESH decision from the current state: no lock, no dwell, no replay of anything missed.
 */

export type FieldPhase = 'fightLive' | 'armed' | 'post' | 'quiet';
export const PHASE_OF: Readonly<Record<SceneMode, FieldPhase>> = {
  live: 'fightLive', paused: 'fightLive', break: 'fightLive', equipment: 'fightLive', dq_clock: 'fightLive', disqualified: 'fightLive',
  ready: 'armed', intro: 'armed',
  complete: 'post', winner: 'post',
  idle: 'quiet', upcoming: 'quiet', between: 'quiet'
};
export const phaseOf = (mode: SceneMode): FieldPhase => PHASE_OF[mode] ?? 'quiet';

/** The shortest time AUTO stays on a scene before it moves to another one. */
export const MIN_DWELL_MS = 10_000;
/** A Lyst AUTO just left cannot be taken again for this long. */
export const RETAKE_BLOCK_MS = 5_000;

export interface FieldInput {
  /** Field key (lower case, as the database writes it: 'field 1'); it is normalised again here. */
  field: string;
  /** What people call it, for words on screen ('Field 1'). */
  label?: string;
  /** The Pack 14 scene mode for this field, from `broadcastScene`. */
  mode: SceneMode;
  /** The fight on this field (the one being fought, or whose result is showing). Lets the lock notice a different fight. */
  fightId?: string | null;
  /** Short words for "also live" lists: 'A vs B, round 2'. */
  summary?: string | null;
  /** When this fight first went live (epoch ms), from the database (lyst_rounds / timer), not from this process: survives a restart. */
  firstLiveMs?: number | null;
  /** When this field became armed (epoch ms), if known; used only to order armed fields. */
  armedSinceMs?: number | null;
}

export interface SceneMapping {
  /** Per field key: the scene that shows that Lyst's camera (with the overlay), and an optional graphics-only scene. */
  lysts: Readonly<Record<string, { live?: string | null; graphics?: string | null } | undefined>>;
  holding?: string | null;
  break?: string | null;
  cameraOff?: string | null;
}

export interface CameraInput {
  /** The server's Camera Off state, or null when it could not be read (no internet, no controller code). */
  server: boolean | null;
  /** The last server answer this controller saw (kept in its local file): an unknown answer keeps a latched Off. */
  lastKnownServer: boolean;
  /** The local latch (the on-laptop button). Only the laptop clears it. */
  local: boolean;
  reason?: string | null;
}

export interface ControlInput {
  mode: 'auto' | 'manual';
  targetKind?: 'lyst' | 'holding' | 'break' | null;
  targetField?: string | null;
  priorityFields?: readonly string[] | null;
}

export type TargetKind = 'camera_off' | 'break' | 'holding' | 'lyst';
export interface Target { kind: TargetKind; field: string | null }
export type DecisionSource = 'camera_off' | 'manual' | 'auto';
export interface Lock { field: string; fightId: string | null; sinceMs: number; lastPhase: FieldPhase }

/** What the caller hands back on the next call (it is the only memory the function has). */
export interface DecisionState {
  source: DecisionSource | null;
  target: Target | null;
  lock: Lock | null;
  /** When AUTO last moved to a different scene (or began). */
  lastAutoSwitchAtMs: number | null;
  released: { field: string; atMs: number } | null;
}
export const INITIAL_STATE: DecisionState = { source: null, target: null, lock: null, lastAutoSwitchAtMs: null, released: null };

export interface DecideInput {
  nowMs: number;
  fields: readonly FieldInput[];
  control: ControlInput;
  camera: CameraInput;
  mapping: SceneMapping;
  /** The scenes OBS really has, or null when not known (then every mapped scene is taken to exist). */
  existingScenes?: readonly string[] | null;
  prev?: DecisionState | null;
}

export type ProblemCode =
  | 'live_scene_unmapped' | 'live_scene_missing' | 'holding_unmapped' | 'holding_missing' | 'break_unmapped' | 'break_missing'
  | 'camera_off_unmapped' | 'camera_off_missing' | 'graphics_scene_missing';
export interface MappingProblem { code: ProblemCode; field?: string; scene?: string; text: string; severity: 'error' | 'warning' }

export interface AlsoLive { field: string; label: string; summary: string | null; firstLiveMs: number | null; mapped: boolean }

export interface Decision {
  target: Target;
  source: DecisionSource;
  /** The OBS scene to put on air, or null when there is nothing safe to switch to (keep the current scene and report). */
  scene: string | null;
  /** The wanted target had no usable scene and this one is shown instead ('holding'), or null. */
  fallback: 'holding' | null;
  /** Camera Off was wanted but there is no Camera Off scene: the caller should silence the camera audio and show holding. */
  muteProgramAudio: boolean;
  lock: Lock | null;
  /** AUTO wanted to move but is waiting (minimum time on a scene / just-left Lyst), until this time. */
  heldBy: 'dwell' | 'retake' | null;
  heldUntilMs: number | null;
  alsoLive: AlsoLive[];
  problems: MappingProblem[];
  reason: string;
  camera: { active: boolean; source: 'server' | 'local' | 'both' | 'unknown_latched' | null; reason: string | null; medical: boolean };
  state: DecisionState;
}

// ---------------------------------------------------------------------------------------------------------------- Camera Off

/** Camera Off is on if the server says so, the local latch is on, or the server cannot be read and it was last known to be on. */
export function effectiveCameraOff(c: CameraInput): Decision['camera'] {
  const server = c.server === true, local = c.local === true;
  const unknownLatched = c.server === null && c.lastKnownServer === true;
  const active = server || local || unknownLatched;
  const source = server && local ? 'both' : server ? 'server' : local ? 'local' : unknownLatched ? 'unknown_latched' : null;
  const reason = active ? (c.reason ?? (local && !server && !unknownLatched ? 'local' : null)) : null;
  return { active, source, reason, medical: active && c.reason === 'medical' };
}

// ---------------------------------------------------------------------------------------------------------------- mapping

const sceneExists = (name: string | null | undefined, existing: ReadonlySet<string> | null): name is string => !!name && (existing === null || existing.has(name));
const labelOf = (f: { field: string; label?: string }) => f.label?.trim() || f.field;

/** Every problem with the scene mapping, for the heartbeat and the setup screen. Pure; never throws. */
export function validateMapping(mapping: SceneMapping, existing: readonly string[] | null | undefined, fields: readonly { field: string; label?: string }[]): MappingProblem[] {
  const ex = existing ? new Set(existing) : null;
  const out: MappingProblem[] = [];
  const lystOf = (f: string) => mapping.lysts[fieldKey(f)];
  for (const f of fields) {
    const key = fieldKey(f.field), m = lystOf(f.field), name = labelOf(f);
    if (!m?.live) out.push({ code: 'live_scene_unmapped', field: key, text: `${name} has no camera scene yet`, severity: 'warning' });
    else if (!sceneExists(m.live, ex)) out.push({ code: 'live_scene_missing', field: key, scene: m.live, text: `The scene "${m.live}" for ${name} is not in OBS: showing the holding scene instead`, severity: 'error' });
    if (m?.graphics && !sceneExists(m.graphics, ex)) out.push({ code: 'graphics_scene_missing', field: key, scene: m.graphics, text: `The graphics scene "${m.graphics}" for ${name} is not in OBS`, severity: 'warning' });
  }
  if (!mapping.holding) out.push({ code: 'holding_unmapped', text: 'No holding scene is set', severity: 'error' });
  else if (!sceneExists(mapping.holding, ex)) out.push({ code: 'holding_missing', scene: mapping.holding, text: `The holding scene "${mapping.holding}" is not in OBS`, severity: 'error' });
  if (!mapping.break) out.push({ code: 'break_unmapped', text: 'No break scene is set: a break shows the holding scene', severity: 'warning' });
  else if (!sceneExists(mapping.break, ex)) out.push({ code: 'break_missing', scene: mapping.break, text: `The break scene "${mapping.break}" is not in OBS: a break shows the holding scene`, severity: 'warning' });
  if (!mapping.cameraOff) out.push({ code: 'camera_off_unmapped', text: 'No Camera Off scene is set: Camera Off will mute the camera audio and show holding', severity: 'error' });
  else if (!sceneExists(mapping.cameraOff, ex)) out.push({ code: 'camera_off_missing', scene: mapping.cameraOff, text: `The Camera Off scene "${mapping.cameraOff}" is not in OBS: Camera Off will mute the camera audio and show holding`, severity: 'error' });
  return out;
}

interface Resolved { scene: string | null; fallback: 'holding' | null; muteProgramAudio: boolean }

/** Target -> the scene to show, with the fallbacks of plan section 4. Never throws. */
export function resolveScene(target: Target, mapping: SceneMapping, existing: readonly string[] | null | undefined): Resolved {
  const ex = existing ? new Set(existing) : null;
  const holding = sceneExists(mapping.holding, ex) ? mapping.holding! : null;
  switch (target.kind) {
    case 'camera_off': {
      if (sceneExists(mapping.cameraOff, ex)) return { scene: mapping.cameraOff!, fallback: null, muteProgramAudio: false };
      return { scene: holding, fallback: holding ? 'holding' : null, muteProgramAudio: true };
    }
    case 'holding': return { scene: holding, fallback: null, muteProgramAudio: false };
    case 'break': {
      if (sceneExists(mapping.break, ex)) return { scene: mapping.break!, fallback: null, muteProgramAudio: false };
      return { scene: holding, fallback: holding ? 'holding' : null, muteProgramAudio: false };
    }
    case 'lyst': {
      const m = target.field ? mapping.lysts[fieldKey(target.field)] : undefined;
      if (!m?.live) return { scene: null, fallback: null, muteProgramAudio: false };            // unmapped: no action, reported
      if (sceneExists(m.live, ex)) return { scene: m.live, fallback: null, muteProgramAudio: false };
      return { scene: holding, fallback: holding ? 'holding' : null, muteProgramAudio: false };  // mapped but missing in OBS: holding
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- the decision

interface Norm extends FieldInput { key: string; phase: FieldPhase; label: string }

const targetKey = (t: Target | null): string => (t ? `${t.kind}:${t.field ?? ''}` : '');
const alsoLiveOf = (live: readonly Norm[], exceptKey: string | null, mapping: SceneMapping): AlsoLive[] =>
  live.filter(f => f.key !== exceptKey).map(f => ({ field: f.key, label: f.label, summary: f.summary ?? null, firstLiveMs: f.firstLiveMs ?? null, mapped: !!mapping.lysts[f.key]?.live }));

/** Order two fields: earliest time first (unknown last), then the organizer's priority list, then field key. */
function orderFields(time: (f: Norm) => number | null | undefined, priority: readonly string[]) {
  const rank = (k: string) => { const i = priority.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return (a: Norm, b: Norm): number => {
    const ta = time(a) ?? Number.POSITIVE_INFINITY, tb = time(b) ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ra = rank(a.key), rb = rank(b.key);
    if (ra !== rb) return ra - rb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

export function decideProgram(input: DecideInput): Decision {
  const now = input.nowMs;
  const prev: DecisionState = input.prev ?? INITIAL_STATE;
  const priority = (input.control.priorityFields ?? []).map(fieldKey);
  const seen = new Set<string>();
  const fields: Norm[] = [];
  for (const f of input.fields) {
    const key = fieldKey(f.field);
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ ...f, key, phase: phaseOf(f.mode), label: labelOf(f) });
  }
  const byKey = new Map(fields.map(f => [f.key, f]));
  const liveFields = fields.filter(f => f.phase === 'fightLive').sort(orderFields(f => f.firstLiveMs, priority));
  const problems = validateMapping(input.mapping, input.existingScenes, fields);
  const finish = (target: Target, source: DecisionSource, extra: { lock: Lock | null; heldBy?: Decision['heldBy']; heldUntilMs?: number | null; reason: string; state: Partial<DecisionState> }, cam: Decision['camera']): Decision => {
    const r = resolveScene(target, input.mapping, input.existingScenes);
    const state: DecisionState = { source, target, lock: extra.lock, lastAutoSwitchAtMs: prev.lastAutoSwitchAtMs, released: null, ...extra.state };
    return {
      target, source, scene: r.scene, fallback: r.fallback, muteProgramAudio: r.muteProgramAudio, lock: extra.lock,
      heldBy: extra.heldBy ?? null, heldUntilMs: extra.heldUntilMs ?? null,
      alsoLive: alsoLiveOf(liveFields, target.kind === 'lyst' ? target.field : null, input.mapping),
      problems, reason: extra.reason, camera: cam, state
    };
  };

  // 1. Camera Off
  const cam = effectiveCameraOff(input.camera);
  if (cam.active) {
    const why = cam.source === 'unknown_latched' ? 'cannot reach BuhurtOS, last known Off' : cam.source === 'local' ? 'on-laptop latch' : cam.source === 'both' ? 'server and on-laptop latch' : 'server';
    const reasonWord = cam.reason && cam.reason !== 'local' ? ` (${cam.reason.replace(/_/g, ' ')})` : '';
    return finish({ kind: 'camera_off', field: null }, 'camera_off', { lock: null, reason: `Camera Off${reasonWord}: latched, ${why}`, state: { released: null } }, cam);
  }

  // 2. Manual
  const c = input.control;
  if (c.mode === 'manual' && c.targetKind) {
    const t: Target = c.targetKind === 'lyst' ? { kind: 'lyst', field: c.targetField ? fieldKey(c.targetField) : null } : { kind: c.targetKind, field: null };
    const f = t.field ? byKey.get(t.field) : undefined;
    const name = t.kind === 'lyst' ? (f?.label ?? t.field ?? 'a Lyst') : t.kind === 'break' ? 'the break scene' : 'the holding scene';
    return finish(t, 'manual', { lock: null, reason: `Manual: showing ${name}`, state: { released: null } }, cam);
  }

  // 3 + 4. AUTO lock (only a lock taken by AUTO is honoured; coming back from manual / Camera Off is a fresh decision)
  let lock: Lock | null = prev.source === 'auto' ? prev.lock : null;
  let released = prev.source === 'auto' ? prev.released : null;
  let releasedWhy: string | null = null;
  if (lock) {
    const f = byKey.get(lock.field);
    const phase = f?.phase ?? 'quiet';
    const sameFight = !f?.fightId || !lock.fightId || f.fightId === lock.fightId;
    const reopened = lock.lastPhase === 'post' && phase === 'fightLive';
    if (f && (phase === 'fightLive' || phase === 'post') && sameFight && !reopened) lock = { ...lock, lastPhase: phase };
    else {
      releasedWhy = !f || phase === 'quiet' ? 'its result is over' : reopened ? 'its fight was reopened' : !sameFight ? 'that fight is over' : 'the Lyst is getting ready again';
      released = { field: lock.field, atMs: now };
      lock = null;
    }
  }
  if (lock) {
    const f = byKey.get(lock.field)!;
    return finish({ kind: 'lyst', field: lock.field }, 'auto', {
      lock, reason: f.phase === 'post' ? `Staying on ${f.label}: result on screen` : `Staying on ${f.label}: fight in progress`,
      state: { released: null }
    }, cam);
  }

  // 5. pick next
  const selectable = (f: Norm) => !!input.mapping.lysts[f.key]?.live;   // an unmapped Lyst is reported, never taken
  const blockedField = released && now - released.atMs < RETAKE_BLOCK_MS && prev.target?.field !== released.field ? released.field : null;
  const eligible = (f: Norm) => selectable(f) && f.key !== blockedField;
  const pickLive = liveFields.find(eligible);
  const pickArmed = fields.filter(f => f.phase === 'armed' && eligible(f)).sort(orderFields(f => f.armedSinceMs, priority))[0];
  let desired: Target; let why: string;
  if (pickLive) { desired = { kind: 'lyst', field: pickLive.key }; why = `Following ${pickLive.label}: ${liveFields.length > 1 ? 'in a fight longest' : 'in a fight'}`; }
  else if (pickArmed) { desired = { kind: 'lyst', field: pickArmed.key }; why = `Following ${pickArmed.label}: fighters are getting ready`; }
  else {
    desired = { kind: 'holding', field: null };
    const unmappedLive = liveFields.filter(f => !selectable(f));
    why = unmappedLive.length ? `Holding: ${unmappedLive.map(f => f.label).join(', ')} is live but has no camera scene` : releasedWhy ? `Holding: ${released ? (byKey.get(released.field)?.label ?? released.field) : 'the last Lyst'} is finished` : 'Holding: nothing live';
  }
  const blockedWanted = blockedField !== null && liveFields.concat(fields.filter(f => f.phase === 'armed')).some(f => f.key === blockedField && selectable(f)) && desired.field !== blockedField;

  // 6. anti-thrash: hold the scene we are on while the minimum time has not passed
  const sinceSwitch = prev.lastAutoSwitchAtMs === null ? Number.POSITIVE_INFINITY : now - prev.lastAutoSwitchAtMs;
  if (prev.source === 'auto' && prev.target && targetKey(prev.target) !== targetKey(desired) && sinceSwitch < MIN_DWELL_MS) {
    const until = (prev.lastAutoSwitchAtMs as number) + MIN_DWELL_MS;
    return finish(prev.target, 'auto', {
      lock: null, heldBy: 'dwell', heldUntilMs: until, reason: `Waiting ${Math.ceil((until - now) / 1000)} s before changing scene (minimum time on a scene)`,
      state: { released }
    }, cam);
  }

  const switched = !(prev.source === 'auto' && prev.target && targetKey(prev.target) === targetKey(desired));
  const taken = desired.kind === 'lyst' && desired.field ? byKey.get(desired.field) : undefined;
  const newLock: Lock | null = taken && taken.phase === 'fightLive' ? { field: taken.key, fightId: taken.fightId ?? null, sinceMs: now, lastPhase: 'fightLive' } : null;
  return finish(desired, 'auto', {
    lock: newLock, heldBy: blockedWanted && desired.kind !== 'lyst' ? 'retake' : null, heldUntilMs: blockedWanted && released ? released.atMs + RETAKE_BLOCK_MS : null,
    reason: blockedWanted && desired.kind !== 'lyst' ? `${why} (not taking ${byKey.get(blockedField!)?.label ?? blockedField} back for a moment)` : why,
    state: { released, lastAutoSwitchAtMs: switched ? now : prev.lastAutoSwitchAtMs }
  }, cam);
}

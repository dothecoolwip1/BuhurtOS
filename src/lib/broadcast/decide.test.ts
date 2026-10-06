import { describe, expect, it } from 'vitest';
import {
  decideProgram, effectiveCameraOff, INITIAL_STATE, MIN_DWELL_MS, PHASE_OF, phaseOf, resolveScene, RETAKE_BLOCK_MS, validateMapping,
  type CameraInput, type ControlInput, type DecideInput, type Decision, type FieldInput, type SceneMapping
} from './decide';
import { SCENE_LABEL, type SceneMode } from './state';

const T0 = 1_800_000_000_000;
const MAP: SceneMapping = {
  lysts: { 'field 1': { live: 'Lyst 1 Live' }, 'field 2': { live: 'Lyst 2 Live' }, 'field 3': { live: 'Lyst 3 Live' } },
  holding: 'Holding', break: 'Break', cameraOff: 'Camera Off'
};
const SCENES = ['Lyst 1 Live', 'Lyst 2 Live', 'Lyst 3 Live', 'Holding', 'Break', 'Camera Off'];
const AUTO: ControlInput = { mode: 'auto', priorityFields: [] };
const CAM_ON: CameraInput = { server: false, lastKnownServer: false, local: false };
const f = (field: string, mode: SceneMode, o: Partial<FieldInput> = {}): FieldInput => ({ field, mode, label: field.replace('field', 'Field'), fightId: `fight-${field}`, ...o });

/** A little harness: the caller's whole job is to hand the previous state back. */
function run(initial?: Partial<DecideInput>) {
  let state = INITIAL_STATE;
  const base: DecideInput = { nowMs: T0, fields: [], control: AUTO, camera: CAM_ON, mapping: MAP, existingScenes: SCENES, ...initial };
  const step = (at: number, patch: Partial<DecideInput> = {}): Decision => {
    Object.assign(base, patch);
    const d = decideProgram({ ...base, nowMs: T0 + at, prev: state });
    state = d.state;
    return d;
  };
  return { step, base, get state() { return state; } };
}
const onAir = (d: Decision) => (d.target.kind === 'lyst' ? `lyst:${d.target.field}` : d.target.kind);

describe('phase mapping (plan 5: fightLive / armed / post / quiet)', () => {
  it('covers every Pack 14 scene mode exactly as the plan says', () => {
    const want: Record<string, SceneMode[]> = {
      fightLive: ['live', 'paused', 'break', 'equipment', 'dq_clock', 'disqualified'],
      armed: ['ready', 'intro'], post: ['complete', 'winner'], quiet: ['idle', 'upcoming', 'between']
    };
    for (const [phase, modes] of Object.entries(want)) for (const m of modes) expect(phaseOf(m)).toBe(phase);
    // no mode is left unmapped: every mode that broadcastScene can return has a phase
    expect(Object.keys(PHASE_OF).sort()).toEqual(Object.keys(SCENE_LABEL).sort());
  });
});

describe('Camera Off (rule 1)', () => {
  it('effective = server OR local latch OR (server unknown and last known on)', () => {
    expect(effectiveCameraOff({ server: true, lastKnownServer: false, local: false }).active).toBe(true);
    expect(effectiveCameraOff({ server: false, lastKnownServer: false, local: true })).toMatchObject({ active: true, source: 'local' });
    expect(effectiveCameraOff({ server: true, lastKnownServer: true, local: true }).source).toBe('both');
    expect(effectiveCameraOff({ server: null, lastKnownServer: true, local: false })).toMatchObject({ active: true, source: 'unknown_latched' });
    expect(effectiveCameraOff({ server: null, lastKnownServer: false, local: false }).active).toBe(false);
    // a server release does not clear the local latch
    expect(effectiveCameraOff({ server: false, lastKnownServer: true, local: true }).active).toBe(true);
    expect(effectiveCameraOff({ server: false, lastKnownServer: true, local: false }).active).toBe(false);
  });
  it('beats auto, a lock, a manual choice and the dwell, and goes to the Camera Off scene', () => {
    const r = run({ fields: [f('field 1', 'live', { firstLiveMs: T0 })] });
    expect(onAir(r.step(0))).toBe('lyst:field 1');
    const off = r.step(1, { camera: { ...CAM_ON, server: true, reason: 'medical' } });
    expect(off).toMatchObject({ source: 'camera_off', scene: 'Camera Off', lock: null });
    expect(off.target).toEqual({ kind: 'camera_off', field: null });
    expect(off.camera.medical).toBe(true);
    const man = r.step(2, { control: { mode: 'manual', targetKind: 'lyst', targetField: 'field 2' } });
    expect(man.scene).toBe('Camera Off');                       // manual does not beat Camera Off
    expect(decideProgram({ ...r.base, nowMs: T0 + 3, prev: null }).scene).toBe('Camera Off');
  });
  it('stays Off through a new fight, the fight ending, an AUTO change, and the internet going away', () => {
    const r = run({ camera: { server: true, lastKnownServer: true, local: false, reason: 'privacy' }, fields: [f('field 1', 'live', { firstLiveMs: T0 })] });
    const seq: Array<[SceneMode, number]> = [['live', 0], ['complete', 1_000], ['winner', 9_000], ['between', 40_000], ['intro', 50_000], ['live', 60_000]];
    for (const [m, at] of seq) expect(r.step(at, { fields: [f('field 1', m, { firstLiveMs: T0 })] }).scene).toBe('Camera Off');
    expect(r.step(70_000, { fields: [f('field 2', 'live', { firstLiveMs: T0 - 1 })], control: AUTO }).scene).toBe('Camera Off');
    // internet lost: the server answer is unknown, the last known state was Off
    expect(r.step(80_000, { camera: { server: null, lastKnownServer: true, local: false } })).toMatchObject({ scene: 'Camera Off', camera: { source: 'unknown_latched' } });
  });
  it('a local latch alone holds it after a server release; it clears only when the local latch is cleared', () => {
    const r = run({ camera: { server: true, lastKnownServer: true, local: true }, fields: [f('field 1', 'live', { firstLiveMs: T0 })] });
    expect(r.step(0).scene).toBe('Camera Off');
    expect(r.step(1_000, { camera: { server: false, lastKnownServer: true, local: true } }).scene).toBe('Camera Off');
    expect(r.step(2_000, { camera: { server: false, lastKnownServer: false, local: false } }).scene).toBe('Lyst 1 Live');
  });
  it('is never delayed by the 10 s dwell, and leaving Camera Off is a fresh decision (no dwell, no old lock)', () => {
    const r = run({ fields: [f('field 1', 'live', { firstLiveMs: T0 })] });
    r.step(0);
    expect(r.step(1_000, { camera: { ...CAM_ON, local: true } }).scene).toBe('Camera Off');     // 1 s after the last switch
    const back = r.step(2_000, { camera: CAM_ON });
    expect(back.scene).toBe('Lyst 1 Live');
    expect(back.heldBy).toBeNull();
  });
  it('a missing Camera Off scene falls back to holding AND asks for the camera audio to be muted; with no holding either it keeps the scene and still mutes', () => {
    const cam = { ...CAM_ON, local: true };
    const a = decideProgram({ nowMs: T0, fields: [], control: AUTO, camera: cam, mapping: MAP, existingScenes: ['Holding'] });
    expect(a).toMatchObject({ scene: 'Holding', fallback: 'holding', muteProgramAudio: true });
    expect(a.problems.some(p => p.code === 'camera_off_missing' && p.severity === 'error')).toBe(true);
    const b = decideProgram({ nowMs: T0, fields: [], control: AUTO, camera: cam, mapping: { ...MAP, cameraOff: null, holding: null }, existingScenes: [] });
    expect(b).toMatchObject({ scene: null, muteProgramAudio: true });
    expect(b.problems.map(p => p.code)).toEqual(expect.arrayContaining(['camera_off_unmapped', 'holding_unmapped']));
  });
});

describe('manual (rule 2)', () => {
  it('manual beats auto and nothing automatic moves it', () => {
    const r = run({ control: { mode: 'manual', targetKind: 'lyst', targetField: 'Field 2' }, fields: [f('field 1', 'live', { firstLiveMs: T0 }), f('field 2', 'upcoming')] });
    const d = r.step(0);
    expect(d).toMatchObject({ source: 'manual', scene: 'Lyst 2 Live', target: { kind: 'lyst', field: 'field 2' }, lock: null });
    for (const [at, mode] of [[20_000, 'winner'], [60_000, 'live'], [120_000, 'idle']] as const) expect(r.step(at, { fields: [f('field 1', mode, { firstLiveMs: T0 }), f('field 2', 'idle')] }).scene).toBe('Lyst 2 Live');
  });
  it('manual Take is immediate (no dwell), also from a field that is locked, and lists the other live Lyst', () => {
    const r = run({ fields: [f('field 1', 'live', { firstLiveMs: T0 }), f('field 2', 'live', { firstLiveMs: T0 + 5_000, summary: 'C vs D, round 2' })] });
    expect(r.step(0).scene).toBe('Lyst 1 Live');
    expect(r.step(500).alsoLive).toEqual([{ field: 'field 2', label: 'Field 2', summary: 'C vs D, round 2', firstLiveMs: T0 + 5_000, mapped: true }]);
    const take = r.step(1_000, { control: { mode: 'manual', targetKind: 'lyst', targetField: 'field 2' } });
    expect(take).toMatchObject({ scene: 'Lyst 2 Live', source: 'manual' });
    expect(take.alsoLive.map(a => a.field)).toEqual(['field 1']);
  });
  it('manual Holding and Break map to their scenes; a missing break scene shows holding; a manual unmapped Lyst keeps the scene and reports', () => {
    const r = run();
    expect(r.step(0, { control: { mode: 'manual', targetKind: 'holding' } })).toMatchObject({ scene: 'Holding', target: { kind: 'holding', field: null } });
    expect(r.step(1, { control: { mode: 'manual', targetKind: 'break' } })).toMatchObject({ scene: 'Break' });
    expect(r.step(2, { mapping: { ...MAP, break: 'Gone' } })).toMatchObject({ scene: 'Holding', fallback: 'holding' });
    const un = decideProgram({ nowMs: T0, fields: [f('field 4', 'live')], control: { mode: 'manual', targetKind: 'lyst', targetField: 'field 4' }, camera: CAM_ON, mapping: MAP, existingScenes: SCENES });
    expect(un.scene).toBeNull();
    expect(un.problems.some(p => p.code === 'live_scene_unmapped' && p.field === 'field 4')).toBe(true);
  });
  it('a manual control with no target is ignored (auto)', () => {
    expect(decideProgram({ nowMs: T0, fields: [], control: { mode: 'manual', targetKind: null }, camera: CAM_ON, mapping: MAP, existingScenes: SCENES }).source).toBe('auto');
  });
});

describe('AUTO: pick next (rule 5)', () => {
  it('nothing live: holding', () => {
    const d = run({ fields: [f('field 1', 'upcoming'), f('field 2', 'idle')] }).step(0);
    expect(d).toMatchObject({ source: 'auto', scene: 'Holding', target: { kind: 'holding', field: null } });
    expect(d.reason).toMatch(/Holding/);
  });
  it('no fields at all: holding', () => { expect(run().step(0).scene).toBe('Holding'); });
  it('armed (fighters walking on) is taken when nothing is in a fight, earliest armed first', () => {
    const d = run({ fields: [f('field 2', 'ready', { armedSinceMs: T0 - 1_000 }), f('field 1', 'intro', { armedSinceMs: T0 - 500 })] }).step(0);
    expect(d.scene).toBe('Lyst 2 Live');
    expect(d.lock).toBeNull();                                  // an armed Lyst is followed, not locked
  });
  it('a fight in progress beats an armed Lyst', () => {
    const d = run({ fields: [f('field 1', 'ready', { armedSinceMs: T0 - 9_000 }), f('field 2', 'live', { firstLiveMs: T0 - 1_000 })] }).step(0);
    expect(d.scene).toBe('Lyst 2 Live');
  });
  it.each(['live', 'paused', 'break', 'equipment', 'dq_clock', 'disqualified'] as SceneMode[])('a Lyst in %s counts as in a fight', mode => {
    expect(run({ fields: [f('field 3', mode, { firstLiveMs: T0 })] }).step(0)).toMatchObject({ scene: 'Lyst 3 Live', lock: { field: 'field 3' } });
  });
  it('two fights live: earliest first-live wins, whatever order they arrive in', () => {
    const a = f('field 1', 'live', { firstLiveMs: T0 - 1_000 }), b = f('field 2', 'live', { firstLiveMs: T0 - 5_000 });
    expect(run({ fields: [a, b] }).step(0).target.field).toBe('field 2');
    expect(run({ fields: [b, a] }).step(0).target.field).toBe('field 2');
  });
  it('ties: the organizer priority list, then field key ascending; an unknown first-live sorts last', () => {
    const a = f('field 3', 'live', { firstLiveMs: T0 }), b = f('field 1', 'live', { firstLiveMs: T0 }), c = f('field 2', 'live', { firstLiveMs: T0 });
    expect(run({ fields: [a, b, c] }).step(0).target.field).toBe('field 1');                                                    // key order
    expect(run({ fields: [a, b, c], control: { mode: 'auto', priorityFields: ['field 3', 'field 2'] } }).step(0).target.field).toBe('field 3');
    expect(run({ fields: [a, b, c], control: { mode: 'auto', priorityFields: ['Field 2'] } }).step(0).target.field).toBe('field 2'); // priority is normalised
    expect(run({ fields: [f('field 1', 'live', { firstLiveMs: null }), f('field 2', 'live', { firstLiveMs: T0 })] }).step(0).target.field).toBe('field 2');
    // an earlier first-live always beats the priority list
    expect(run({ fields: [a, f('field 2', 'live', { firstLiveMs: T0 - 1 })], control: { mode: 'auto', priorityFields: ['field 3'] } }).step(0).target.field).toBe('field 2');
  });
  it('armed ties use the same tie-breaks', () => {
    const fs = [f('field 3', 'intro'), f('field 2', 'ready')];
    expect(run({ fields: fs }).step(0).target.field).toBe('field 2');
    expect(run({ fields: fs, control: { mode: 'auto', priorityFields: ['field 3'] } }).step(0).target.field).toBe('field 3');
  });
  it('an unmapped live Lyst is reported and never taken; another mapped one is', () => {
    const d = run({ fields: [f('field 4', 'live', { firstLiveMs: T0 - 9_000 }), f('field 2', 'live', { firstLiveMs: T0 })] }).step(0);
    expect(d.scene).toBe('Lyst 2 Live');
    expect(d.alsoLive).toEqual([expect.objectContaining({ field: 'field 4', mapped: false })]);
    expect(d.problems.some(p => p.code === 'live_scene_unmapped' && p.field === 'field 4')).toBe(true);
    const only = run({ fields: [f('field 4', 'live', { firstLiveMs: T0 })] }).step(0);
    expect(only.scene).toBe('Holding');
    expect(only.reason).toMatch(/no camera scene/);
  });
  it('a mapped scene that OBS does not have shows holding and reports (never throws)', () => {
    const d = decideProgram({ nowMs: T0, fields: [f('field 2', 'live', { firstLiveMs: T0 })], control: AUTO, camera: CAM_ON, mapping: MAP, existingScenes: ['Holding', 'Camera Off', 'Break'] });
    expect(d).toMatchObject({ scene: 'Holding', fallback: 'holding', target: { kind: 'lyst', field: 'field 2' } });
    expect(d.problems.find(p => p.code === 'live_scene_missing')).toMatchObject({ field: 'field 2', scene: 'Lyst 2 Live' });
    // holding missing too: nothing safe, keep the current scene
    const e = decideProgram({ nowMs: T0, fields: [f('field 2', 'live', { firstLiveMs: T0 })], control: AUTO, camera: CAM_ON, mapping: MAP, existingScenes: ['Camera Off'] });
    expect(e.scene).toBeNull();
    expect(e.problems.map(p => p.code)).toContain('holding_missing');
    expect(decideProgram({ nowMs: T0, fields: [], control: AUTO, camera: CAM_ON, mapping: { lysts: {} }, existingScenes: null }).scene).toBeNull();
  });
});

describe('AUTO lock (rules 3 and 4)', () => {
  const live1 = (mode: SceneMode, o: Partial<FieldInput> = {}) => f('field 1', mode, { firstLiveMs: T0, ...o });
  it('stays through round break, pause, equipment, DQ countdown, disqualified, complete and winner, even when another Lyst has been live longer or starts', () => {
    const r = run({ fields: [live1('live')] });
    expect(r.step(0).lock).toMatchObject({ field: 'field 1' });
    let at = 1_000;
    for (const mode of ['paused', 'live', 'break', 'live', 'equipment', 'live', 'dq_clock', 'disqualified', 'live', 'complete', 'winner'] as SceneMode[]) {
      const d = r.step(at, { fields: [live1(mode), f('field 2', 'live', { firstLiveMs: T0 - 60_000 })] });   // field 2 live LONGER than field 1
      expect(onAir(d), `mode ${mode}`).toBe('lyst:field 1');
      expect(d.alsoLive.map(a => a.field)).toEqual(['field 2']);
      at += 15_000;
    }
  });
  it('another Lyst starting does not move the camera', () => {
    const r = run({ fields: [live1('live')] });
    r.step(0);
    const d = r.step(30_000, { fields: [live1('live'), f('field 2', 'live', { firstLiveMs: T0 + 29_000 })] });
    expect(onAir(d)).toBe('lyst:field 1');
    expect(d.heldBy).toBeNull();
  });
  it('releases only at quiet: then it picks the other live Lyst, else holding', () => {
    const r = run({ fields: [live1('winner'), f('field 2', 'live', { firstLiveMs: T0 + 1_000 })], mapping: MAP });
    // lock was taken while live
    r.step(-20_000, { fields: [live1('live'), f('field 2', 'live', { firstLiveMs: T0 + 1_000 })] });
    expect(r.step(0, { fields: [live1('winner'), f('field 2', 'live', { firstLiveMs: T0 + 1_000 })] }).scene).toBe('Lyst 1 Live');
    const d = r.step(10_000, { fields: [live1('between'), f('field 2', 'live', { firstLiveMs: T0 + 1_000 })] });
    expect(d).toMatchObject({ scene: 'Lyst 2 Live', lock: { field: 'field 2' } });
    const r2 = run({ fields: [live1('live')] });
    r2.step(0);
    r2.step(15_000, { fields: [live1('winner')] });
    expect(r2.step(45_000, { fields: [live1('idle')] }).scene).toBe('Holding');
  });
  it('releases when the fight is voided (the Lyst is armed or quiet again), when a different fight is on the field, and when a finished fight is reopened', () => {
    const base = () => { const r = run({ fields: [live1('live')] }); r.step(0); return r; };
    expect(base().step(20_000, { fields: [live1('upcoming')] }).scene).toBe('Holding');                // voided: back to waiting
    expect(base().step(20_000, { fields: [live1('intro')] }).lock).toBeNull();                         // got ready again: lock gone (armed is followed, not locked)
    const different = base();
    expect(different.step(20_000, { fields: [live1('live', { fightId: 'other-fight' }), f('field 2', 'live', { firstLiveMs: T0 - 1 })] }).scene).toBe('Lyst 2 Live');
    const reopened = base();
    reopened.step(15_000, { fields: [live1('winner')] });
    // the same fight is shown as in progress again (reopened) while another Lyst has been live longer
    const d = reopened.step(30_000, { fields: [live1('break'), f('field 2', 'live', { firstLiveMs: T0 - 99_000 })] });
    expect(d.scene).toBe('Lyst 2 Live');
  });
  it('a lock taken by AUTO is dropped when the field disappears', () => {
    const r = run({ fields: [live1('live')] });
    r.step(0);
    expect(r.step(20_000, { fields: [] }).scene).toBe('Holding');
  });
  it('score, timer and penalty changes never switch: the decision is the same for the same phases', () => {
    const r = run({ fields: [live1('live')] });
    const first = r.step(0);
    for (let i = 1; i < 40; i++) {
      const d = r.step(i * 500, { fields: [live1('live', { summary: `score ${i} to ${i * 2}` })] });
      expect(d.scene).toBe(first.scene);
      expect(d.state.lastAutoSwitchAtMs).toBe(first.state.lastAutoSwitchAtMs);
    }
  });
});

describe('anti-thrash (rule 6)', () => {
  it('moves at most once per 10 s between AUTO scenes, exactly at the boundary', () => {
    const r = run({ fields: [] });
    expect(r.step(0).scene).toBe('Holding');                                    // AUTO begins on holding at t=0
    const d = r.step(2_000, { fields: [f('field 1', 'ready', { armedSinceMs: T0 })] });
    expect(d).toMatchObject({ scene: 'Holding', heldBy: 'dwell', heldUntilMs: T0 + MIN_DWELL_MS });
    expect(r.step(MIN_DWELL_MS - 1).scene).toBe('Holding');
    expect(r.step(MIN_DWELL_MS)).toMatchObject({ scene: 'Lyst 1 Live', heldBy: null });
    // and again: the next move is not allowed for another 10 s
    expect(r.step(MIN_DWELL_MS + 4_000, { fields: [f('field 1', 'idle')] })).toMatchObject({ scene: 'Lyst 1 Live', heldBy: 'dwell' });
    expect(r.step(2 * MIN_DWELL_MS).scene).toBe('Holding');
  });
  it('a held decision keeps the CURRENT scene, not the previous one', () => {
    const r = run({ fields: [f('field 1', 'live', { firstLiveMs: T0 })] });
    r.step(0);
    r.step(15_000, { fields: [f('field 1', 'idle')] });                         // releases to holding at 15 s (switch)
    const d = r.step(17_000, { fields: [f('field 1', 'idle'), f('field 2', 'live', { firstLiveMs: T0 + 16_000 })] });
    expect(d).toMatchObject({ scene: 'Holding', heldBy: 'dwell' });
  });
  it('a Lyst just left cannot be re-taken for 5 s, a different one can (after the dwell)', () => {
    const r = run({ fields: [f('field 1', 'live', { firstLiveMs: T0 })] });
    r.step(0);
    r.step(60_000, { fields: [f('field 1', 'idle'), f('field 2', 'upcoming')] });   // released at 60 s: holding
    // field 1 is armed again 2 s later: blocked for RETAKE_BLOCK_MS even though the dwell would allow it
    const early = r.step(62_000 + 0, { fields: [f('field 1', 'ready', { armedSinceMs: T0 + 61_000 })] });
    expect(early.scene).toBe('Holding');
    expect(r.step(60_000 + RETAKE_BLOCK_MS - 1, { fields: [f('field 1', 'ready', { armedSinceMs: T0 + 61_000 })] }).scene).toBe('Holding');
    // the dwell (10 s since the switch to holding at 60 s) is the stronger rule here
    expect(r.step(60_000 + MIN_DWELL_MS, { fields: [f('field 1', 'ready', { armedSinceMs: T0 + 61_000 })] }).scene).toBe('Lyst 1 Live');
  });
  it('staying on a Lyst whose new fight starts is not a re-take (no switch needed)', () => {
    const r = run({ fields: [f('field 1', 'live', { firstLiveMs: T0, fightId: 'a' })] });
    r.step(0);
    const d = r.step(60_000, { fields: [f('field 1', 'live', { firstLiveMs: T0 + 59_000, fightId: 'b' })] });
    expect(d).toMatchObject({ scene: 'Lyst 1 Live', heldBy: null });
    expect(d.lock).toMatchObject({ fightId: 'b' });
  });
});

describe('Return to Auto (rule 8) and restart (rule 9)', () => {
  it('Return to Auto is a fresh decision from the current state: no lock, no dwell, no replay', () => {
    const fields = [f('field 1', 'live', { firstLiveMs: T0 + 1_000 }), f('field 2', 'live', { firstLiveMs: T0 - 1_000 })];
    const r = run({ fields, control: { mode: 'manual', targetKind: 'lyst', targetField: 'field 1' } });
    expect(r.step(0).scene).toBe('Lyst 1 Live');
    // many scene changes happen while manual; none of them is replayed afterwards
    r.step(30_000, { fields: [f('field 1', 'winner', { firstLiveMs: T0 + 1_000 }), f('field 2', 'live', { firstLiveMs: T0 - 1_000 })] });
    const back = r.step(30_500, { control: AUTO });                               // 0.5 s after: not delayed by any dwell
    expect(back).toMatchObject({ source: 'auto', scene: 'Lyst 2 Live', heldBy: null, lock: { field: 'field 2' } });
    // the old (manual) field is not treated as locked even if it is still in its winner presentation
    expect(back.state.lock?.field).toBe('field 2');
  });
  it('Return to Auto with nothing live goes to holding immediately', () => {
    const r = run({ control: { mode: 'manual', targetKind: 'lyst', targetField: 'field 2' }, fields: [f('field 2', 'idle')] });
    r.step(0);
    expect(r.step(500, { control: AUTO })).toMatchObject({ scene: 'Holding', heldBy: null });
  });
  it('a restart with two fights live lands on the fight AUTO already had (durable first-live), whatever the order or the clock', () => {
    // continuous run: Field 2 went live first, Field 1 second
    const live2 = f('field 2', 'live', { firstLiveMs: T0 - 8_000 }), live1 = f('field 1', 'live', { firstLiveMs: T0 - 3_000 });
    const continuous = run({ fields: [live2] });
    continuous.step(-8_000);
    const cont = continuous.step(0, { fields: [live1, live2] });
    // a restarted controller has no memory at all
    const restarted = decideProgram({ nowMs: T0, fields: [live1, live2], control: AUTO, camera: CAM_ON, mapping: MAP, existingScenes: SCENES, prev: null });
    expect(onAir(restarted)).toBe(onAir(cont));
    expect(onAir(restarted)).toBe('lyst:field 2');
    expect(restarted.alsoLive.map(a => a.field)).toEqual(['field 1']);
  });
  it('is deterministic and does not modify its input', () => {
    const input: DecideInput = { nowMs: T0, fields: [f('field 2', 'live', { firstLiveMs: T0 }), f('field 1', 'live', { firstLiveMs: T0 })], control: AUTO, camera: CAM_ON, mapping: MAP, existingScenes: SCENES, prev: null };
    const copy = JSON.parse(JSON.stringify(input));
    expect(decideProgram(input)).toEqual(decideProgram(input));
    expect(JSON.parse(JSON.stringify(input))).toEqual(copy);
  });
});

describe('mapping helpers', () => {
  it('validateMapping lists every problem in plain words', () => {
    const p = validateMapping({ lysts: { 'field 1': { live: 'Lyst 1 Live', graphics: 'G1' }, 'field 2': { live: 'Nope' } }, holding: 'Holding', break: 'Nope2', cameraOff: undefined },
      ['Lyst 1 Live', 'Holding'], [{ field: 'Field 1' }, { field: 'field 2' }, { field: 'field 3' }]);
    expect(p.map(x => x.code).sort()).toEqual(['break_missing', 'camera_off_unmapped', 'graphics_scene_missing', 'live_scene_missing', 'live_scene_unmapped'].sort());
    expect(validateMapping(MAP, SCENES, [{ field: 'field 1' }])).toEqual([]);
    expect(validateMapping(MAP, null, [{ field: 'field 1' }])).toEqual([]);                  // OBS not known: nothing can be called missing
  });
  it('resolveScene never throws on odd input', () => {
    expect(resolveScene({ kind: 'lyst', field: null }, { lysts: {} }, null).scene).toBeNull();
    expect(resolveScene({ kind: 'holding', field: null }, {} as SceneMapping, []).scene).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  CONTROLLER_SILENT_S, DEFAULT_CONTROL, ageWords, broadcastAccess, controllerAge, controllerSilent, isTaken, lystChoices, lystLabel, manualKeepingWhatIsOn, panelStatus, parseHeartbeat, patches,
  type BroadcastControl, type ControllerReport
} from './broadcastView';

const control = (over: Partial<BroadcastControl> = {}): BroadcastControl => ({ ...DEFAULT_CONTROL, ...over });
const report = (status: unknown, ageSeconds = 3): ControllerReport => ({ reportedAt: '2026-10-10T20:00:00Z', ageSeconds, status });
const FULL = {
  obs_connected: true, mode: 'auto', on_air: { kind: 'lyst', field: 'field 1', scene: 'Lyst 1 camera', reason: 'first live' }, fight: 'Aldric Stone vs Brann Oakley',
  camera_off: false, music: { state: 'playing', ducking: false, mic: 'quiet' }, also_live: [{ field: 'field 2', title: 'Cael vs Dara', round: 2 }], mapping_problems: ['Lyst 3 has no camera mapping']
};
const line = (s: ReturnType<typeof panelStatus>, id: string) => s.lines.find(l => l.id === id);

describe('reading the controller heartbeat', () => {
  it('turns a full report into plain fields', () => {
    const h = parseHeartbeat(FULL)!;
    expect(h).toMatchObject({ obsConnected: true, mode: 'auto', fight: 'Aldric Stone vs Brann Oakley', cameraOff: false });
    expect(h.onAir).toEqual({ kind: 'lyst', field: 'field 1', scene: 'Lyst 1 camera', reason: 'first live' });
    expect(h.music).toEqual({ state: 'playing', ducking: false, mic: 'quiet' });
    expect(h.alsoLive).toEqual(['Lyst 2 (Cael vs Dara, round 2)']);
    expect(h.mappingProblems).toEqual(['Lyst 3 has no camera mapping']);
  });
  it('is null when nothing reported, and never throws on odd or partial reports', () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat(undefined)).toBeNull();
    expect(parseHeartbeat({})).toBeNull();
    expect(parseHeartbeat('hello')).toBeNull();
    expect(parseHeartbeat([1, 2])).toBeNull();
    const odd = parseHeartbeat({ obs_connected: 'yes', mode: 7, on_air: 12, fight: { nothing: 1 }, music: 'loud', also_live: 'x', mapping_problems: [null, 3, { message: 'Scene missing' }] })!;
    expect(odd).toMatchObject({ obsConnected: null, mode: null, onAir: null, fight: null, music: null, alsoLive: [], mappingProblems: ['Scene missing'] });
    expect(parseHeartbeat({ obs_connected: true })).toMatchObject({ obsConnected: true, onAir: null, music: null });
  });
  it('accepts the simple report an early controller sends (on_air as a name)', () => {
    expect(parseHeartbeat({ obs_connected: true, mode: 'auto', on_air: 'field 1' })!.onAir).toEqual({ kind: 'lyst', field: 'field 1', scene: null, reason: null });
    expect(parseHeartbeat({ on_air: 'holding', obs_connected: true })!.onAir?.kind).toBe('holding');
  });
  it('keeps what it shows short (a report cannot flood the screen)', () => {
    const h = parseHeartbeat({ fight: 'x'.repeat(500), also_live: Array.from({ length: 20 }, (_, i) => `Lyst ${i}`), mapping_problems: Array.from({ length: 20 }, (_, i) => `p${i}`) })!;
    expect(h.fight!.length).toBeLessThanOrEqual(80);
    expect(h.alsoLive).toHaveLength(5);
    expect(h.mappingProblems).toHaveLength(5);
  });
  it('words a field as a Lyst', () => {
    expect(lystLabel('Field 2')).toBe('Lyst 2');
    expect(lystLabel('field 12')).toBe('Lyst 12');
    expect(lystLabel('Ring A')).toBe('Ring A');
    expect(lystLabel(null)).toBe('a Lyst');
  });
});

describe('how long since the controller spoke', () => {
  it('adds the time since we read it to the age the database measured', () => {
    expect(controllerAge(report({}, 4), 1_000_000, 1_000_000)).toBe(4);
    expect(controllerAge(report({}, 4), 1_000_000, 1_026_000)).toBe(30);
    expect(controllerAge(null, 0, 0)).toBeNull();
    expect(controllerAge(report({}, Number.NaN), 0, 0)).toBeNull();
  });
  it('silent from 30 seconds, not before', () => {
    expect(CONTROLLER_SILENT_S).toBe(30);
    expect(controllerSilent(29)).toBe(false);
    expect(controllerSilent(30)).toBe(true);
    expect(controllerSilent(null)).toBe(false);
  });
  it('says the age in words', () => {
    expect(ageWords(2)).toBe('just now');
    expect(ageWords(12)).toBe('12 s ago');
    expect(ageWords(300)).toBe('5 min ago');
  });
});

describe('the status lines', () => {
  const live = panelStatus({ control: control({ mode: 'auto' }), camera: { active: false }, controller: report(FULL, 4), ageSeconds: 4 });
  it('shows the controller\'s report as the short list an organizer reads', () => {
    expect(live.noController).toBe(false);
    expect(live.stale).toBe(false);
    expect(live.controller).toMatchObject({ value: 'Last seen just now', tone: 'ok' });
    expect(line(live, 'obs')).toMatchObject({ label: 'OBS', value: 'Connected', tone: 'ok' });
    expect(line(live, 'mode')?.value).toBe('AUTO');
    expect(line(live, 'onair')?.value).toBe('Lyst 1');
    expect(line(live, 'fight')?.value).toBe('Aldric Stone vs Brann Oakley');
    expect(line(live, 'camera')?.value).toBe('Lyst 1 camera');
    expect(line(live, 'overlay')?.value).toBe('Live');
    expect(line(live, 'music')?.value).toBe('Playing');
    expect(line(live, 'mic')?.value).toBe('Quiet');
    expect(line(live, 'duck')?.value).toBe('On');
    expect(line(live, 'safety')).toMatchObject({ label: 'Camera Safety', value: 'ON AIR', tone: 'ok' });
    expect(live.alsoLive).toEqual(['Lyst 2 (Cael vs Dara, round 2)']);
    expect(live.problems).toEqual(['Lyst 3 has no camera mapping']);
  });
  it('says plainly that no controller is connected, and still shows what the database holds', () => {
    const s = panelStatus({ control: control({ mode: 'manual', targetKind: 'lyst', targetField: 'field 2', musicMode: 'muted', autoDuck: false }), camera: { active: false }, controller: null, ageSeconds: null });
    expect(s.noController).toBe(true);
    expect(s.controller).toMatchObject({ value: 'Not connected', tone: 'bad' });
    expect(s.lines.map(l => l.id)).toEqual(['mode', 'music', 'duck', 'safety']);          // nothing invented about OBS, the fight or the overlay
    expect(line(s, 'mode')).toMatchObject({ value: 'MANUAL', tone: 'warn' });
    expect(line(s, 'mode')?.note).toBe('You are holding Lyst 2');
    expect(line(s, 'music')?.value).toBe('Muted (set here)');
    expect(line(s, 'duck')).toMatchObject({ value: 'Off', tone: 'warn' });
    expect(s.alsoLive).toEqual([]);
  });
  it('warns when the controller has gone quiet and dims what it last said', () => {
    const s = panelStatus({ control: control(), camera: { active: false }, controller: report(FULL, 45), ageSeconds: 45 });
    expect(s.stale).toBe(true);
    expect(s.controller).toMatchObject({ value: 'Silent for 45 s', tone: 'bad' });
    expect(line(s, 'obs')?.tone).toBe('muted');                    // an old "Connected" is not shown as a green tick
    expect(line(s, 'onair')?.tone).toBe('muted');
    expect(s.alsoLive).toEqual([]);                                  // "also live" from an old report would mislead
  });
  it('survives a controller that has reported but says nothing useful', () => {
    const s = panelStatus({ control: control(), camera: { active: false }, controller: report({ controller_version: '1' }, 2), ageSeconds: 2 });
    expect(s.noController).toBe(false);
    expect(line(s, 'obs')?.value).toBe('Not reported');
    expect(line(s, 'onair')?.value).toBe('Not reported');
    expect(line(s, 'music')?.value).toBe('Not reported');
    expect(line(s, 'safety')?.value).toBe('ON AIR');
  });
  it('an empty report counts as no controller data but the controller is still seen', () => {
    const s = panelStatus({ control: control(), camera: { active: false }, controller: report({}, 2), ageSeconds: 2 });
    expect(s.controller.tone).toBe('ok');
    expect(s.lines.map(l => l.id)).toEqual(['mode', 'music', 'duck', 'safety']);
  });
  it('says CAMERAS OFF from the database state, or from the controller\'s own report', () => {
    expect(line(panelStatus({ control: control(), camera: { active: true }, controller: null, ageSeconds: null }), 'safety')).toMatchObject({ value: 'CAMERAS OFF', tone: 'bad' });
    const local = panelStatus({ control: control(), camera: { active: false }, controller: report({ obs_connected: true, camera_off: true, camera_off_local: true }, 1), ageSeconds: 1 });
    expect(line(local, 'safety')).toMatchObject({ value: 'CAMERAS OFF', note: 'Cut on the laptop' });
  });
  it('notes when the controller has not caught up with a MANUAL / AUTO change', () => {
    const s = panelStatus({ control: control({ mode: 'manual', targetKind: 'holding' }), camera: { active: false }, controller: report({ obs_connected: true, mode: 'auto' }, 2), ageSeconds: 2 });
    expect(line(s, 'mode')?.value).toBe('MANUAL');
    const auto = panelStatus({ control: control({ mode: 'auto' }), camera: { active: false }, controller: report({ obs_connected: true, mode: 'manual' }, 2), ageSeconds: 2 });
    expect(line(auto, 'mode')?.note).toBe('Controller still shows MANUAL');
  });
  it('reports OBS not connected and the overlay by what is on air', () => {
    const s = panelStatus({ control: control(), camera: { active: false }, controller: report({ obs_connected: false, on_air: { kind: 'holding' } }, 2), ageSeconds: 2 });
    expect(line(s, 'obs')).toMatchObject({ value: 'Not connected', tone: 'bad' });
    expect(line(s, 'onair')?.value).toBe('Holding (between fights)');
    expect(line(s, 'camera')?.value).toBe('None on air');
    expect(line(s, 'overlay')?.value).toBe('Queue and sponsors');
  });
});

describe('who may control', () => {
  it('only the database\'s own can_control offers the controls; everyone else who can read it sees the status', () => {
    expect(broadcastAccess({ canControl: true })).toBe('control');
    expect(broadcastAccess({ canControl: false })).toBe('view');
    expect(broadcastAccess(null)).toBe('none');
  });
});

describe('the controls', () => {
  it('Take Lyst N is manual mode on that field; Return to Auto is just auto; Camera Off is not among them', () => {
    expect(patches.takeLyst('Field 2')).toEqual({ mode: 'manual', target_kind: 'lyst', target_field: 'Field 2' });
    expect(patches.auto()).toEqual({ mode: 'auto' });
    expect(patches.holding()).toEqual({ mode: 'manual', target_kind: 'holding' });
    expect(patches.breakScreen()).toEqual({ mode: 'manual', target_kind: 'break' });
    expect(patches.music('muted')).toEqual({ music_mode: 'muted' });
    expect(patches.music('auto')).toEqual({ music_mode: 'auto' });
    expect(patches.music('paused')).toEqual({ music_mode: 'paused' });
    expect(patches.duck(false)).toEqual({ auto_duck: false });
    const allowed = new Set(['mode', 'target_kind', 'target_field', 'music_mode', 'auto_duck', 'priority_fields']);      // the keys the database accepts
    for (const p of [patches.auto(), patches.takeLyst('Field 1'), patches.holding(), patches.breakScreen(), patches.music('paused'), patches.duck(true)]) for (const k of Object.keys(p)) expect(allowed.has(k)).toBe(true);
  });
  it('one Take button per field, numbered ones in order, no duplicates, case-insensitive', () => {
    expect(lystChoices(['Field 10', 'Field 2', 'field 2', 'Field 1'])).toEqual([{ field: 'Field 1', label: 'Lyst 1' }, { field: 'Field 2', label: 'Lyst 2' }, { field: 'Field 10', label: 'Lyst 10' }]);
    expect(lystChoices([])).toEqual([]);
  });
  it('MANUAL pressed alone keeps what is on air', () => {
    expect(manualKeepingWhatIsOn(control(), parseHeartbeat({ on_air: { kind: 'lyst', field: 'field 3' } }))).toEqual({ mode: 'manual', target_kind: 'lyst', target_field: 'field 3' });
    expect(manualKeepingWhatIsOn(control(), null)).toEqual({ mode: 'manual', target_kind: 'holding' });
    expect(manualKeepingWhatIsOn(control(), parseHeartbeat({ on_air: { kind: 'break' } }))).toEqual({ mode: 'manual', target_kind: 'break' });
    expect(manualKeepingWhatIsOn(control({ targetKind: 'lyst', targetField: 'field 2' }), null)).toEqual({ mode: 'manual', target_kind: 'lyst', target_field: 'field 2' });
  });
  it('knows which Lyst is being held (the database normalises the field name)', () => {
    const held = control({ mode: 'manual', targetKind: 'lyst', targetField: 'field 2' });
    expect(isTaken(held, 'Field 2')).toBe(true);
    expect(isTaken(held, 'Field 1')).toBe(false);
    expect(isTaken(control({ mode: 'auto', targetKind: 'lyst', targetField: 'field 2' }), 'Field 2')).toBe(false);
  });
});

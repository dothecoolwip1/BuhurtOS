import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideProgram, phaseOf, type SceneMapping } from '../../../src/lib/broadcast/decide';
import { LocalFiles, parseConfig } from '../src/config';
import { MemoryCredentialStore } from '../src/credentials';
import { quietLogger } from '../src/log';
import { StateReader, STALE_AFTER_MS } from '../src/reader';
import { buildFields, fieldNames, newFieldMemory, type RawPublic } from '../src/scenes';
import { ControllerSession } from '../src/session';
import { EVENT_ID, FakeControl, FakeWorld, type FightKind } from './world';

const MAP: SceneMapping = { lysts: { 'field 1': { live: 'L1' }, 'field 2': { live: 'L2' }, 'field 3': { live: 'L3' } }, holding: 'H', break: 'B', cameraOff: 'C' };

async function raw(world: FakeWorld): Promise<RawPublic> {
  const e = (await world.fetchEvent('rumble'))!;
  const c = await world.fetchCompetition('c1');
  const l = await world.fetchLyst(EVENT_ID);
  return { event: { id: EVENT_ID, slug: 'rumble', name: 'R', startsOn: '2000-01-01', endsOn: '2999-12-31', fieldCount: e.event.fieldCount }, competitions: e.competitions.map(k => ({ id: k.id, name: k.name })), matches: c.matches, scores: c.scores, lyst: l.rows };
}
const build = (raw0: RawPublic, now: number) => buildFields(raw0, { nowMs: now, serverNowMs: now, mappedKeys: [], memory: newFieldMemory(), phase: 'current' });

describe('public data -> the Pack 14 scene per field (the SAME derivation the overlay uses)', () => {
  const MODES: FightKind[] = ['idle', 'upcoming', 'intro', 'ready', 'live', 'paused', 'break', 'equipment', 'dq_clock', 'disqualified', 'complete', 'winner', 'between'];
  it.each(MODES)('the fake BuhurtOS shows the scene mode %s through buildArena + broadcastScene', async mode => {
    const w = new FakeWorld(); w.setField('field 1', mode);
    const f = build(await raw(w), Date.now()).find(b => b.input.field === 'field 1')!;
    expect(f.input.mode).toBe(mode);
    expect(f.input.label).toBe('Field 1');
  });

  it('score, clock and penalty changes do not change a field\'s mode, so they cannot change the decision', async () => {
    const w = new FakeWorld(); const id = w.setField('field 1', 'live'); w.setField('field 2', 'live');
    const now = Date.now();
    const input = async () => (await raw(w)) && build(await raw(w), now).map(b => b.input);
    const first = await input();
    const d0 = decideProgram({ nowMs: now, fields: first.map(f => ({ ...f, summary: null })), control: { mode: 'auto' }, camera: { server: false, lastKnownServer: false, local: false }, mapping: MAP, prev: null });
    for (let i = 1; i < 30; i++) {
      w.bump('field 1', { scoreA: i, scoreB: 30 - i, remainingMs: 60_000 - i * 1000 });
      const again = await input();
      expect(again.map(f => [f.field, f.mode, f.fightId])).toEqual(first.map(f => [f.field, f.mode, f.fightId]));
      const d = decideProgram({ nowMs: now + i * 100, fields: again.map(f => ({ ...f, summary: null })), control: { mode: 'auto' }, camera: { server: false, lastKnownServer: false, local: false }, mapping: MAP, prev: d0.state });
      expect(d.scene).toBe(d0.scene); expect(d.state.lastAutoSwitchAtMs).toBe(d0.state.lastAutoSwitchAtMs);
    }
    expect(id).toBeTruthy();
  });

  it('lists every field: those with fights, those mapped, and the event\'s own field count (a Lyst with no fights yet still exists)', async () => {
    const w = new FakeWorld(); w.setField('field 2', 'live'); w.fieldCount = 4;
    const r = await raw(w);
    expect(fieldNames(r, ['field 7'])).toEqual(['Field 1', 'Field 2', 'Field 3', 'Field 4', 'Field 7']);
  });

  it('first-live: the database time wins over what was seen; before it is known the time first seen is used', async () => {
    const w = new FakeWorld(); const id = w.setField('field 1', 'live');
    const mem = newFieldMemory(); const r = await raw(w);
    const seen = buildFields(r, { nowMs: 5000, serverNowMs: 5000, mappedKeys: [], memory: mem, phase: 'current' }).find(b => b.input.field === 'field 1')!;
    expect(seen.input.firstLiveMs).toBe(5000);
    buildFields(r, { nowMs: 9000, serverNowMs: 9000, mappedKeys: [], memory: mem, phase: 'current' });
    expect(mem.observedFirstLive.get(id)).toBe(5000);                               // it does not drift as time passes
    mem.durableFirstLive.set(id, 1234);
    expect(buildFields(r, { nowMs: 9500, serverNowMs: 9500, mappedKeys: [], memory: mem, phase: 'current' }).find(b => b.input.field === 'field 1')!.input.firstLiveMs).toBe(1234);
  });

  it('armed fields remember when they became armed; the time is dropped when they are not', async () => {
    const w = new FakeWorld(); w.setField('field 2', 'ready');
    const mem = newFieldMemory(); const r = await raw(w);
    expect(buildFields(r, { nowMs: 100, serverNowMs: 100, mappedKeys: [], memory: mem, phase: 'current' }).find(b => b.input.field === 'field 2')!.input.armedSinceMs).toBe(100);
    expect(buildFields(r, { nowMs: 900, serverNowMs: 900, mappedKeys: [], memory: mem, phase: 'current' }).find(b => b.input.field === 'field 2')!.input.armedSinceMs).toBe(100);
    w.setField('field 2', 'live'); const r2 = await raw(w);
    expect(buildFields(r2, { nowMs: 950, serverNowMs: 950, mappedKeys: [], memory: mem, phase: 'current' }).find(b => b.input.field === 'field 2')!.input.armedSinceMs).toBeNull();
    expect(phaseOf('live')).toBe('fightLive');
  });
});

describe('the state reader (polling, backoff, staleness)', () => {
  const make = (o: { control?: boolean } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-reader-'));
    const files = new LocalFiles(dir, undefined, {});
    files.saveConfig(parseConfig({ eventSlug: 'rumble', supabaseUrl: 'http://x', supabaseKey: 'k', mapping: MAP }));
    const clock = { t: 1_900_000_000_000 };
    const world = new FakeWorld(() => clock.t), control = new FakeControl();
    const session = new ControllerSession({ baseUrl: () => 'http://x', anonKey: () => 'k', store: new MemoryCredentialStore(), logger: quietLogger(), fetchFn: (async () => new Response('{}', { status: 401 })) as never });
    const reader = new StateReader({ data: world, control: o.control ? control : null, files, session, logger: quietLogger(), now: () => clock.t, pollMs: 10_000 });
    return { reader, world, control, files, clock, dir, done: () => rmSync(dir, { recursive: true, force: true }) };
  };

  it('reads the event slug from config when there is no controller code; reports clearly when it is missing or not public', async () => {
    const t = make();
    try {
      await t.reader.pollNow(); expect(t.reader.hasData).toBe(true); expect(t.reader.status.eventName).toBe('Rumble Rehearsal');
      t.files.updateConfig(c => ({ ...c, eventSlug: 'nope' }));
      const t2 = make(); t2.files.updateConfig(c => ({ ...c, eventSlug: null })); await t2.reader.pollNow();
      expect(t2.reader.hasData).toBe(false); expect(t2.reader.status.dataError).toMatch(/No event set/); t2.done();
      const t3 = make(); t3.files.updateConfig(c => ({ ...c, eventSlug: 'draft-event' })); await t3.reader.pollNow();
      expect(t3.reader.status.notFound).toBe(true); expect(t3.reader.status.dataError).toMatch(/not public/); t3.done();
    } finally { t.done(); }
  });

  it('a failed read keeps the last good data (scenes are rebuilt from it), flags stale after 20 s, and recovers; it never throws', async () => {
    const t = make();
    try {
      t.world.setField('field 1', 'live');
      await t.reader.pollNow();
      expect(t.reader.fields(t.clock.t).find(f => f.input.field === 'field 1')?.input.mode).toBe('live');
      t.world.online = false;
      await expect(t.reader.pollNow()).resolves.toBeUndefined();
      expect(t.reader.status.dataError).toMatch(/cannot read BuhurtOS/); expect(t.reader.stale).toBe(false);
      t.clock.t += STALE_AFTER_MS + 1000;
      expect(t.reader.stale).toBe(true);
      expect(t.reader.fields(t.clock.t).find(f => f.input.field === 'field 1')?.input.mode).toBe('live');      // still what it last knew
      t.world.online = true; await t.reader.pollNow(); expect(t.reader.stale).toBe(false); expect(t.reader.status.dataError).toBeNull();
    } finally { t.done(); }
  });

  it('a result\'s 8 s "complete" and 25 s "winner" windows keep counting while offline (derived from the clock, not from new data)', async () => {
    const t = make();
    try {
      t.world.setField('field 1', 'complete'); await t.reader.pollNow();
      expect(t.reader.fields(t.clock.t).find(f => f.input.field === 'field 1')?.input.mode).toBe('complete');
      t.world.online = false; t.clock.t += 12_000;
      expect(t.reader.fields(t.clock.t).find(f => f.input.field === 'field 1')?.input.mode).toBe('winner');
      t.clock.t += 20_000;
      expect(['between', 'idle', 'upcoming']).toContain(t.reader.fields(t.clock.t).find(f => f.input.field === 'field 1')?.input.mode);
    } finally { t.done(); }
  });

  it('never overlaps: two polls at once make one set of reads', async () => {
    const t = make();
    try { await Promise.all([t.reader.pollNow(), t.reader.pollNow(), t.reader.pollNow()]); expect(t.world.calls.competition).toBe(1); expect(t.world.calls.lyst).toBe(1); } finally { t.done(); }
  });

  it('learns each fight\'s first-live time from the database, keeps it in the local file, and falls back to what was seen when the database cannot answer', async () => {
    const t = make();
    try {
      const a = t.world.setField('field 1', 'live'); t.world.setFirstLive(a, new Date(t.clock.t - 60_000).toISOString());
      const b = t.world.setField('field 2', 'live'); t.world.failFirstRounds = false;
      await t.reader.pollNow();
      const f = t.reader.fields(t.clock.t);
      expect(f.find(x => x.input.field === 'field 1')?.input.firstLiveMs).toBe(t.clock.t - 60_000);
      expect(f.find(x => x.input.field === 'field 2')?.input.firstLiveMs).toBe(t.clock.t);               // unknown to the database: when first seen
      expect(t.files.state.firstLive[a]).toBe(t.clock.t - 60_000); expect(t.files.state.firstLive[b]).toBeUndefined();
      t.world.setFirstLive(b, new Date(t.clock.t - 120_000).toISOString()); await t.reader.pollNow();
      expect(t.reader.fields(t.clock.t).find(x => x.input.field === 'field 2')?.input.firstLiveMs).toBe(t.clock.t - 120_000);   // the database value takes over
      const again = new LocalFiles(t.dir, undefined, {});
      expect(again.state.firstLive[b]).toBe(t.clock.t - 120_000);                                           // and survives a restart
    } finally { t.done(); }
  });

  it('reads controller_state when it has a session, keeps the last answer when BuhurtOS is unreachable, and treats a failed Camera Off read as UNKNOWN (never "off")', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-reader-'));
    try {
      const files = new LocalFiles(dir, undefined, {});
      files.saveConfig(parseConfig({ eventSlug: 'rumble', mapping: MAP }));
      const store = new MemoryCredentialStore(); await store.set('controller_code', 'K7Q2-M9XD-4TRH');
      const clock = { t: 1_900_000_000_000 };
      const session = new ControllerSession({ baseUrl: () => 'http://x', anonKey: () => 'k', store, logger: quietLogger(), now: () => clock.t, fetchFn: (async () => new Response(JSON.stringify({ access_token: 'a.b.c', expires_at: clock.t / 1000 + 600, session_secret: 's'.repeat(43), whoami: { event: { slug: 'rumble', id: 'e', name: 'R', timezone: 'UTC' }, label: 'L' } }), { status: 200 })) as never });
      const world = new FakeWorld(() => clock.t), control = new FakeControl();
      const reader = new StateReader({ data: world, control, files, session, logger: quietLogger(), now: () => clock.t });
      control.patch({ mode: 'manual', target_kind: 'lyst', target_field: 'field 2', priority_fields: ['field 3'] });
      control.setCamera(true, 'medical');
      await reader.pollNow();
      expect(reader.serverControl).toMatchObject({ known: true, control: { mode: 'manual', targetKind: 'lyst', targetField: 'field 2', priorityFields: ['field 3'] } });
      expect(reader.serverCamera).toEqual({ active: true, reason: 'medical', rev: 1 });
      expect(files.state.lastServerCamera).toMatchObject({ active: true, reason: 'medical' });
      control.online = false; await reader.pollNow();
      expect(reader.serverCamera).toBeNull();                                          // unknown, not false
      expect(reader.serverControl.control.mode).toBe('manual');                       // the last control is kept
      expect(files.state.lastServerCamera?.active).toBe(true);                         // and the last known Camera Off survives for the decision
      control.online = true; control.sessionOk = false; await reader.pollNow();
      expect(reader.status.controllerError).toMatch(/does not accept/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

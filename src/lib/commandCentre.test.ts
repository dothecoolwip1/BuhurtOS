import { describe, expect, it } from 'vitest';
import type { CompetitionMatch } from '../data/matches';
import type { LystPublic } from '../data/lyst';
import { buildFieldBoards, competitionProgress } from './eventDay';
import { commandAttention, eventProgress, fieldSummaries, fightsOverview, freshness, overallState, unassignedRoles, type CommandSnapshot } from './commandCentre';

const NOW = new Date('2026-10-10T17:00:00Z');
const m = (id: string, over: Partial<CompetitionMatch>): CompetitionMatch => ({
  id, competitionId: 'c1', stage: 'round_robin', roundLabel: 'Round 1', position: 0, pool: null, field: 'Field 1', scheduledAt: null, queueState: 'scheduled',
  entryA: `${id}a`, entryB: `${id}b`, nameA: `${id.toUpperCase()} Red`, nameB: `${id.toUpperCase()} Blue`, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
  scoreA: null, scoreB: null, detail: {}, version: 1, finalizedAt: null, ...over
});
const lyst = (match_id: string, timer_status: LystPublic['timer_status'], round = 1): LystPublic => ({
  match_id, event_id: 'e', field_key: 'field 1', queue_state: 'active', timer_mode: 'fight', timer_status, timer_duration_ms: 60000, timer_remaining_ms: 30000,
  timer_started_at: null, timer_rev: 1, timer_round: round, round_no: round, round_status: null, official_a: 0, official_b: 0, rounds_confirmed: 0, discipline: [], server_now: NOW.toISOString()
});
const snap = (over: Partial<CommandSnapshot> = {}): CommandSnapshot => ({
  serverNow: NOW.toISOString(), event: { id: 'e', slug: 'rumble', name: 'Rumble', status: 'published', timezone: 'America/Edmonton', startsOn: '2026-10-10', endsOn: '2026-10-10', closed: false },
  viewer: { organizer: true, announce: true, operator: true, cameraOff: true, cameraRelease: true, broadcast: true },
  readiness: { fighters: 0, volunteers: 0, missing: 0, arrived: 0, checkedIn: 0, ready: 0, notReady: 0, needsInspection: 0, needsCorrection: 0, failed: 0, overrides: 0, adminBlocked: 0, pendingRegistrations: 0 },
  notReady: [], overrides: [], fightWarnings: [], staff: [], broadcast: { configured: false }, ...over
});
const sorts = new Map([['c1', 0]]);
const healthy = [m('m1', { queueState: 'active' }), m('m2', { queueState: 'on_deck' }), m('m3', { field: 'Field 2', queueState: 'active' })];
const input = (matches: CompetitionMatch[], s: CommandSnapshot, l: LystPublic[] = [], conflicts: { matchId: string; competitionName: string }[] = []) => {
  const boards = buildFieldBoards(matches, sorts, new Set());
  const fields = fieldSummaries(boards, l, s.fightWarnings, NOW);
  return { snapshot: s, boards, progress: [competitionProgress({ id: 'c1', name: 'Longsword' }, matches)], clashes: [], conflicts, fields, withdrawn: new Set<string>(),
    competitionNames: new Map([['c1', 'Longsword']]), now: NOW, links: { slug: 'rumble', organizer: s.viewer.organizer } };
};

describe('freshness: old data is never shown as live', () => {
  it('live, stale after a minute, offline', () => {
    expect(freshness(NOW.getTime() - 5000, NOW.getTime(), true)).toBe('live');
    expect(freshness(NOW.getTime() - 61000, NOW.getTime(), true)).toBe('stale');
    expect(freshness(null, NOW.getTime(), true)).toBe('stale');
    expect(freshness(NOW.getTime(), NOW.getTime(), false)).toBe('offline');
  });
});

describe('attention: only real, actionable problems', () => {
  it('a healthy event with both clocks running says "All good"', () => {
    const items = commandAttention(input(healthy, snap(), [lyst('m1', 'running'), lyst('m3', 'running')]));
    expect(items).toEqual([]);
    expect(overallState(items)).toEqual({ tone: 'ok', headline: 'All good: nothing needs you right now' });
  });
  it('a paused clock, a fighter called but not ready, armour issues and a result conflict, each with what / who / where / link', () => {
    const s = snap({
      readiness: { ...snap().readiness, fighters: 6, needsCorrection: 1, arrived: 1, missing: 2 },
      notReady: [
        { registrationId: 'r1', fighterId: 'f1', name: 'Brann Oakley', team: null, attendance: 'checked_in', inspection: 'conditional', reasons: ['Armour needs correction'] },
        { registrationId: 'r2', fighterId: 'f2', name: 'Dara Voss', team: null, attendance: 'arrived', inspection: 'not_inspected', reasons: ['Arrived, not checked in'] }
      ],
      fightWarnings: [{ matchId: 'm2', side: 'b', fighterId: 'f1', name: 'Brann Oakley', reasons: ['Armour needs correction'] }]
    });
    const items = commandAttention(input(healthy, s, [lyst('m1', 'running'), lyst('m3', 'paused', 2)], [{ matchId: 'm3', competitionName: 'Longsword' }]));
    const byId = new Map(items.map(i => [i.id, i]));
    expect(byId.get('result-conflicts')).toMatchObject({ urgency: 'now', where: 'Field 2', href: '/events/rumble/control?mode=live' });
    expect(byId.get('not-ready-in-play')).toMatchObject({ urgency: 'now', who: 'Brann Oakley (armour needs correction)', where: 'Field 1', href: '/events/rumble/checkin?f=not_ready' });
    expect(byId.get('armour-issues')).toMatchObject({ who: 'Brann Oakley', href: '/events/rumble/checkin?f=issues' });
    expect(byId.get('arrived-not-in')).toMatchObject({ who: 'Dara Voss', href: '/events/rumble/checkin?f=arrived' });
    expect(byId.get('paused-field 2')).toMatchObject({ what: 'Field 2: clock paused', href: '/events/rumble/field/Field%202' });
    expect(items[0].urgency).toBe('now');
    expect(overallState(items)).toEqual({ tone: 'urgent', headline: '6 things need attention (2 now)' });
  });
  it('the head marshal is sent to the field screen, never to organizer-only pages', () => {
    const s = snap({ viewer: { organizer: false, announce: false, operator: false, cameraOff: true, cameraRelease: true, broadcast: false }, readiness: { ...snap().readiness, pendingRegistrations: 3 } });
    const items = commandAttention(input([m('m1', { queueState: 'scheduled' }), m('m2', { field: 'Field 2', queueState: 'active' })], s, [lyst('m2', 'running')], [{ matchId: 'm2', competitionName: 'Longsword' }]));
    expect(items.find(i => i.id === 'result-conflicts')?.href).toBe('/events/rumble/field/Field%202');
    expect(items.some(i => i.href.includes('/manage'))).toBe(false);
    expect(items.some(i => i.id === 'pending' || i.id.startsWith('idle-'))).toBe(false);
  });
  it('a field behind schedule (factual, from the scheduled time) and an idle field with a fight ready', () => {
    const late = [m('m1', { queueState: 'on_deck', scheduledAt: '2026-10-10T16:30:00Z' })];
    const items = commandAttention(input(late, snap()));
    expect(items.find(i => i.id === 'behind-field 1')).toMatchObject({ what: 'Field 1 is 30 min behind schedule' });
    expect(items.find(i => i.id === 'idle-field 1')).toMatchObject({ what: 'Field 1 has no fight on', href: '/events/rumble/control?mode=live' });
    // a fight that is on with its clock running is not "behind", even if it started late
    const running = commandAttention(input([m('m1', { queueState: 'active', scheduledAt: '2026-10-10T16:30:00Z' })], snap(), [lyst('m1', 'running')]));
    expect(running.some(i => i.id.startsWith('behind-'))).toBe(false);
  });
  it('an override is information, not a problem', () => {
    const s = snap({ readiness: { ...snap().readiness, overrides: 1 }, overrides: [{ registrationId: 'r', name: 'Ed', reason: 'Loaner kit' }] });
    const items = commandAttention(input(healthy, s, [lyst('m1', 'running'), lyst('m3', 'running')]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ urgency: 'info', who: 'Ed (Loaner kit)' });
    expect(overallState(items).tone).toBe('ok');
  });
});

describe('fields, fights, progress and staff', () => {
  it('per field: state words from Pack 13 (no second clock), current and next fight, queue depth', () => {
    const boards = buildFieldBoards(healthy, sorts, new Set());
    const f = fieldSummaries(boards, [lyst('m1', 'running', 2), lyst('m3', 'paused')], [], NOW);
    expect(f.map(x => [x.name, x.state, x.clock, x.round, x.current?.id, x.next?.id ?? null, x.queueDepth])).toEqual([
      ['Field 1', 'running', 'running', 2, 'm1', 'm2', 1], ['Field 2', 'paused', 'paused', 1, 'm3', null, 0]
    ]);
    expect(Object.keys(f[0])).not.toContain('remainingMs');
  });
  it('fights on, called, and next (not the whole bracket)', () => {
    const many = [...healthy, ...Array.from({ length: 10 }, (_, i) => m(`u${i}`, { scheduledAt: `2026-10-10T18:${String(i).padStart(2, '0')}:00Z` }))];
    const o = fightsOverview(buildFieldBoards(many, sorts, new Set()), 4);
    expect([o.on.length, o.called.length, o.later.length]).toEqual([2, 1, 4]);
  });
  it('progress is counted, never estimated', () => {
    const p = eventProgress([competitionProgress({ id: 'c1', name: 'A' }, [m('a', { queueState: 'final' }), m('b', {})]), competitionProgress({ id: 'c2', name: 'B' }, [m('c', { queueState: 'final' })])]);
    expect(p).toMatchObject({ total: 3, final: 2, remaining: 1, done: 1, running: 1 });
    expect(Object.keys(p).some(k => /finish|eta|estimate/i.test(k))).toBe(false);
  });
  it('unassigned key roles are a fact about assignments, not presence', () => {
    expect(unassignedRoles([{ role: 'organizer', names: ['A'] }, { role: 'scorekeeper', names: ['B'] }])).toEqual(['head_marshal', 'check_in', 'inspector', 'medic']);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESETS, ServerClock, formatClock, nextMode, presetOf, remainingMs, timerFor, timerTone, timerWord, type LystTimer } from './timer';
import { leadRule, roundSeconds, activeDiscipline, allRoundsConfirmed, bump, clampScore, currentRound, describeDiscipline, disciplineCounts, entryStart, hasDq, isChange, officialTotals, resultSupportedByTotals, type LystRound } from './rounds';
import { JOIN_CODE_LENGTH, TapQueue, counterBanner, counterInputFor, flushTaps, nextStep, onlyField, parseJoinCode, sideLabel, standingLeft, trainingUrl, type CountAction } from './counters';

const T0 = Date.parse('2026-10-07T12:00:00.000Z');
const timer = (o: Partial<LystTimer> = {}): LystTimer => ({ event_id: 'e', field_key: 'field 1', match_id: 'm', round_no: 1, mode: 'fight', status: 'running', duration_ms: 60000, remaining_ms: 60000, started_at: new Date(T0).toISOString(), rev: 1, ...o });

describe('timer: the display is derived from server state', () => {
  it('counts down from the server start, whatever the device clock says', () => {
    expect(remainingMs(timer(), T0)).toBe(60000);
    expect(remainingMs(timer(), T0 + 12_345)).toBe(47_655);
    expect(remainingMs(timer(), T0 + 61_000)).toBe(0);   // never negative
  });
  it('a paused or idle clock shows exactly the stored time and does not move', () => {
    expect(remainingMs(timer({ status: 'paused', remaining_ms: 41_200, started_at: null }), T0 + 99_000)).toBe(41_200);
    expect(remainingMs(timer({ status: 'idle', remaining_ms: 60_000, started_at: null }), T0 + 99_000)).toBe(60_000);
  });
  it('a refresh shows the same time as before (derived, not counted)', () => {
    const t = timer();
    const before = remainingMs(t, T0 + 20_000);
    expect(remainingMs({ ...t }, T0 + 20_000)).toBe(before);
  });
  it('a clock reading from the future of the start never adds time', () => {
    expect(remainingMs(timer(), T0 - 5000)).toBe(60000);
  });
  it('formats M:SS rounding up, so the screen never shows 0:00 while time remains', () => {
    expect(formatClock(60000)).toBe('1:00');
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-50)).toBe('0:00');
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(3_599_000)).toBe('59:59');
  });
  it('tone is a warning only in the last ten seconds of a running clock', () => {
    expect(timerTone(timer(), 30_000)).toBe('calm');
    expect(timerTone(timer(), 9_000)).toBe('low');
    expect(timerTone(timer(), 0)).toBe('zero');
    expect(timerTone(timer({ status: 'paused' }), 3_000)).toBe('calm');
  });
  it('words carry the state for people who cannot see colours', () => {
    expect(timerWord(timer({ status: 'paused' }), 5000)).toBe('Round paused');
    expect(timerWord(timer({ mode: 'break', status: 'running' }), 5000)).toBe('Break running');
    expect(timerWord(timer({ mode: 'dq', status: 'idle' }), 5000)).toBe('DQ countdown ready');
  });
  it('a clock for another match on the field is not this match\'s clock', () => {
    expect(timerFor(timer({ match_id: 'x' }), 'm')).toBeNull();
    expect(timerFor(timer(), 'm')).not.toBeNull();
    expect(timerFor(null, 'm')).toBeNull();
  });
  it('presets: the event\'s own value wins, a fallback exists for every kind', () => {
    expect(presetOf([{ key: 'b', label: 'Break', seconds: 45, kind: 'break' }], 'break').seconds).toBe(45);
    expect(presetOf(undefined, 'fight').seconds).toBe(60);
    expect(presetOf([], 'extended_break').seconds).toBe(180);
    expect(DEFAULT_PRESETS.map(p => p.kind)).toEqual(['fight', 'break', 'extended_break', 'dq', 'equipment']);
    expect(presetOf([], 'custom').kind).toBe('custom');
  });
  it('fight leads to a break, a break leads to a round', () => {
    expect(nextMode('fight')).toBe('break');
    expect(nextMode('break')).toBe('fight');
    expect(nextMode('extended_break')).toBe('fight');
    expect(nextMode('dq')).toBe('dq');
  });
});

describe('server clock offset', () => {
  it('a device that is 5 minutes slow still shows the server\'s time', () => {
    const c = new ServerClock();
    const server = T0 + 1000;
    c.sample(server, T0 - 300_000 - 40, T0 - 300_000 + 40);   // device clock 5 min behind, 80 ms round trip
    expect(Math.abs(c.now(T0 - 300_000 + 40) - (server + 40))).toBeLessThan(60);
    expect(c.known).toBe(true);
  });
  it('prefers the sharper (shorter round trip) sample', () => {
    const c = new ServerClock();
    c.sample(T0 + 500, T0, T0 + 1000);          // 1 s round trip: loose
    c.sample(T0 + 5000 + 20, T0 + 5000, T0 + 5040);   // 40 ms: sharp
    expect(Math.abs(c.offset - 0)).toBeLessThan(25);
  });
  it('ignores a garbage answer', () => { const c = new ServerClock(); c.sample(NaN, 0, 1); expect(c.known).toBe(false); expect(c.now(1000)).toBe(1000); });
});

const round = (n: number, status: LystRound['status'], a: number | null, b: number | null, da = 0, db = 0): LystRound => ({ match_id: 'm', round_no: n, status, rev: 1, awarded_a: a, awarded_b: b, deduct_a: da, deduct_b: db, official_a: a === null ? null : Math.max(0, a - da), official_b: b === null ? null : Math.max(0, b - db) });

describe('official rounds: only the marshal\'s call', () => {
  it('totals come from confirmed rounds, with deductions already taken off', () => {
    const rs = [round(1, 'confirmed', 6, 5), round(2, 'confirmed', 7, 4, 2, 0), round(3, 'running', null, null)];
    expect(officialTotals(rs)).toEqual({ a: 11, b: 9, rounds: 2 });
  });
  it('a round being confirmed contributes nothing yet', () => { expect(officialTotals([round(1, 'confirming', null, null)])).toEqual({ a: 0, b: 0, rounds: 0 }); });
  it('the result is only supported once every round is confirmed', () => {
    expect(resultSupportedByTotals([round(1, 'confirmed', 6, 5), round(2, 'confirming', null, null)])).toBeNull();
    expect(resultSupportedByTotals([round(1, 'confirmed', 6, 5)])).toBe('a');
    expect(resultSupportedByTotals([round(1, 'confirmed', 2, 5)])).toBe('b');
    expect(resultSupportedByTotals([round(1, 'confirmed', 3, 3)])).toBe('draw');
    expect(resultSupportedByTotals([])).toBeNull();
    expect(allRoundsConfirmed([])).toBe(false);
  });
  it('stepper values are bounded like the database', () => {
    expect(bump(0, -1)).toBe(0);
    expect(bump(98, 5)).toBe(99);
    expect(bump(4, 1)).toBe(5);
    expect(clampScore(NaN)).toBe(0);
    expect(clampScore(12.9)).toBe(12);
    expect(clampScore(-3)).toBe(0);
  });
  it('a stepper starts at zero for a new round and at the recorded score for a correction', () => {
    expect(entryStart(null)).toEqual({ a: 0, b: 0 });
    expect(entryStart(round(1, 'confirming', null, null))).toEqual({ a: 0, b: 0 });
    expect(entryStart(round(1, 'confirmed', 6, 5))).toEqual({ a: 6, b: 5 });
  });
  it('a reason is needed only when a confirmed round is actually changed', () => {
    expect(isChange(round(1, 'confirmed', 6, 5), 6, 5)).toBe(false);
    expect(isChange(round(1, 'confirmed', 6, 5), 7, 5)).toBe(true);
    expect(isChange(round(1, 'confirming', null, null), 7, 5)).toBe(false);
    expect(isChange(null, 1, 1)).toBe(false);
  });
  it('the current round is the highest number', () => { expect(currentRound([round(1, 'confirmed', 1, 1), round(2, 'running', null, null)])?.round_no).toBe(2); expect(currentRound([])).toBeNull(); });
});

describe('duel rounds as settings', () => {
  const cfg = { regular_rounds: 2, extra_round_seconds: 30 };
  it('regular rounds run at the full length, later ones at the extra length', () => {
    expect(roundSeconds(1, cfg, 60)).toBe(60);
    expect(roundSeconds(2, cfg, 60)).toBe(60);
    expect(roundSeconds(3, cfg, 60)).toBe(30);
    expect(roundSeconds(3, { regular_rounds: 3, extra_round_seconds: 20 }, 90)).toBe(90);
    expect(roundSeconds(4, { regular_rounds: 3, extra_round_seconds: 20 }, 90)).toBe(20);
  });
  it('the lead rule is a suggestion based only on confirmed rounds', () => {
    expect(leadRule([round(1, 'confirmed', 6, 5)], cfg)).toEqual({ decided: false, winner: null, extraRound: false });
    expect(leadRule([round(1, 'confirmed', 6, 5), round(2, 'confirmed', 7, 4)], cfg)).toEqual({ decided: true, winner: 'a', extraRound: false });
    expect(leadRule([round(1, 'confirmed', 5, 6), round(2, 'confirmed', 5, 5)], cfg)).toEqual({ decided: false, winner: null, extraRound: true });
    expect(leadRule([round(1, 'confirmed', 6, 5), round(2, 'confirming', null, null)], cfg).decided).toBe(false);
    expect(leadRule([round(1, 'confirmed', 6, 5), round(2, 'confirmed', 4, 4)], cfg, 2).decided).toBe(false);
  });
});

describe('discipline', () => {
  const d = (o: object) => ({ id: 'x', round_no: 2, side: 'a' as const, kind: 'warning' as const, label: null, amount: 0, voided_at: null, ...o });
  const names = { a: 'Alex', b: 'Blake' };
  it('speaks plainly and uses the event\'s own card words', () => {
    expect(describeDiscipline(d({ kind: 'card', label: 'Yellow card' }), names)).toBe('Yellow card · Round 2 · Alex');
    expect(describeDiscipline(d({ kind: 'deduction', amount: 1, side: 'b' }), names)).toBe('−1 point · Round 2 · Blake');
    expect(describeDiscipline(d({ kind: 'deduction', amount: 2 }), names)).toBe('−2 points · Round 2 · Alex');
    expect(describeDiscipline(d({ kind: 'dq' }), names)).toBe('Disqualification · Round 2 · Alex');
  });
  it('voided records do not count, and the tallies are per side', () => {
    const list = [d({ id: '1', kind: 'warning' }), d({ id: '2', kind: 'deduction', amount: 2 }), d({ id: '3', kind: 'deduction', amount: 1, voided_at: 'x' }), d({ id: '4', kind: 'card', label: 'Red', side: 'b' }), d({ id: '5', kind: 'dq', side: 'b' })];
    expect(activeDiscipline(list)).toHaveLength(4);
    expect(disciplineCounts(list, 'a')).toEqual({ warnings: 1, cards: 0, deducted: 2, dq: false });
    expect(disciplineCounts(list, 'b')).toEqual({ warnings: 0, cards: 1, deducted: 0, dq: true });
    expect(hasDq(list, 'b')).toBe(true);
    expect(hasDq(list, 'a')).toBe(false);
  });
});

describe('counter phone', () => {
  it('reads a code from a bare code, a pasted link or messy text; nothing else', () => {
    expect(parseJoinCode('ab12cd34ef')).toBe('AB12CD34EF');
    expect(parseJoinCode('https://x.test/BuhurtOS/lyst/join/AB12CD34EF?x=1')).toBe('AB12CD34EF');
    expect(parseJoinCode('https://x.test/BuhurtOS/lyst/train/AB12CD34EF')).toBe('AB12CD34EF');
    expect(parseJoinCode(' ab12-cd34-ef ')).toBe('AB12CD34EF');
    expect(parseJoinCode('short')).toBeNull();
    expect(parseJoinCode('')).toBeNull();
    expect(parseJoinCode(null)).toBeNull();
    expect('AB12CD34EF'.length).toBe(JOIN_CODE_LENGTH);
  });
  it('builds the TRAINING QR address under the app\'s base path (Pack 25: the Lyst code is for trainees)', () => {
    expect(trainingUrl('https://x.test', '/BuhurtOS/', 'AB12CD34EF')).toBe('https://x.test/BuhurtOS/lyst/train/AB12CD34EF');
    expect(trainingUrl('http://localhost:5173', '/', 'AB12CD34EF')).toBe('http://localhost:5173/lyst/train/AB12CD34EF');
    expect(trainingUrl('https://x.test', '/BuhurtOS', 'AB12CD34EF')).toBe('https://x.test/BuhurtOS/lyst/train/AB12CD34EF');
  });
  it('the first-run steps: who, which Lyst (only with more than one), which side; then count', () => {
    const two = [{ key: 'field 1' }, { key: 'field 2' }], one = [{ key: 'field 1' }];
    expect(nextStep(null, two)).toBe('operator');
    expect(nextStep({ operator: 'Garrett' }, two)).toBe('field');
    expect(nextStep({ operator: 'Garrett' }, one)).toBe('side');
    expect(nextStep({ operator: 'Garrett', field_key: 'field 1' }, two)).toBe('side');
    expect(nextStep({ operator: 'Garrett', field_key: 'field 1', side: 'a' }, two)).toBe('count');
    expect(onlyField(one)).toBe('field 1'); expect(onlyField(two)).toBeNull();
  });
  it('a team fight counts fighters standing: a tap is a fighter down, never below zero', () => {
    expect(counterInputFor('5v5', 'auto')).toBe('standing');
    expect(counterInputFor('longsword', 'auto', 'buhurt')).toBe('standing');
    expect(counterInputFor('longsword', 'auto', 'duels')).toBe('weighted');
    expect(standingLeft(5, 2)).toBe(3); expect(standingLeft(5, 9)).toBe(0); expect(standingLeft(null, 1)).toBe(0);
    expect(sideLabel('a')).toBe('Red'); expect(sideLabel('b')).toBe('Blue'); expect(sideLabel(null)).toBe('Side');
  });
  it('every tap answers at once: the display is the server total plus what is waiting', () => {
    let n = 0; const q = new TapQueue(() => `id${++n}`);
    q.tap(1); q.tap(1); q.tap(1, 2);
    expect(q.display(5, 1)).toBe(9);
    q.undo(1);
    expect(q.display(5, 1)).toBe(8);
    expect(q.display(5, 2)).toBe(5);   // another round is unaffected
    expect(q.pending.map(p => p.id)).toEqual(['id1', 'id2', 'id3', 'id4']);
  });
  it('each tap has its own id, made once: a retry is the same id', () => {
    let n = 0; const q = new TapQueue(() => `id${++n}`);
    const a = q.tap(1);
    expect(q.pending[0].id).toBe(a.id);
    expect(q.pending[0].id).toBe(a.id);
    expect(n).toBe(1);
  });
  it('flushes in order and stops cleanly offline, keeping everything unsent', async () => {
    let n = 0; const q = new TapQueue(() => `id${++n}`);
    for (let i = 0; i < 5; i++) q.tap(1);
    const seen: string[] = [];
    let calls = 0;
    const r = await flushTaps(q, async (a: CountAction) => { calls++; if (calls === 3) return { status: 'offline' as const }; seen.push(a.id); return { status: 'ok' as const, total: calls }; });
    expect(r).toMatchObject({ sent: 2, stopped: 'offline', total: 2 });
    expect(seen).toEqual(['id1', 'id2']);
    expect(q.size).toBe(3);
    const again = await flushTaps(q, async () => ({ status: 'duplicate' as const, total: 9 }));
    expect(again).toMatchObject({ sent: 3, stopped: 'empty', total: 9 });
    expect(q.size).toBe(0);
  });
  it('a thrown network error is "offline", not a lost tap', async () => {
    const q = new TapQueue(() => 'x'); q.tap(1);
    const r = await flushTaps(q, async () => { throw new Error('Failed to fetch'); });
    expect(r.stopped).toBe('offline');
    expect(q.size).toBe(1);
  });
  it('a round that ended refuses the tap for good: waiting taps for that round are set aside, not retried forever', async () => {
    const q = new TapQueue(() => crypto.randomUUID()); q.tap(1); q.tap(1); q.tap(2);
    const r = await flushTaps(q, async () => ({ status: 'refused' as const, reason: 'ROUND_ENDED' as const, message: 'ended' }));
    expect(r.stopped).toBe('refused');
    expect(q.pending.map(p => p.round)).toEqual([2]);
  });
  it('the banner tells a counter what to do in each situation', () => {
    expect(counterBanner({ seat: null })).toMatch(/choose your lyst and side/i);
    expect(counterBanner({ seat: null, binding: { field_key: 'field 1', side: null } })).toMatch(/red or blue/i);
    expect(counterBanner({ seat: { status: 'expired' } })).toMatch(/run out/i);
    expect(counterBanner({ seat: { status: 'active' }, waiting: true })).toMatch(/waiting for the next fight/i);
    expect(counterBanner({ seat: { status: 'active' }, final: true })).toMatch(/finished/i);
    expect(counterBanner({ seat: { status: 'active' }, round: { status: 'confirming' } })).toMatch(/confirming/i);
    expect(counterBanner({ seat: { status: 'active' }, round: { status: 'running' }, can_count: true })).toMatch(/tap count/i);
    expect(counterBanner({ seat: { status: 'active' }, round: { status: 'running' }, can_count: true, counter_input: 'standing' })).toMatch(/fighter down/i);
  });
});

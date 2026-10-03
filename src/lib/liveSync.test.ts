import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_DEBOUNCE_MS, LIVE_POLL_MS, LiveSync, realtimeFilter, type Connection } from './liveSync';

const ids = Array.from({ length: 17 }, (_, i) => `c${i + 1}`);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const make = (opts: { fetchOne?: (id: string) => Promise<string> } = {}) => {
  const patches: { patch: Record<string, string>; full: boolean }[] = [];
  const conns: Connection[] = [];
  const s = new LiveSync<string>({
    ids, fetchOne: opts.fetchOne ?? (async id => `data-${id}`), onData: (patch, full) => patches.push({ patch, full }), onConnection: c => conns.push(c)
  });
  return { s, patches, conns };
};
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('realtimeFilter', () => {
  it('filters on the server by competition, one value or a list', () => {
    expect(realtimeFilter(['a'])).toBe('competition_id=eq.a');
    expect(realtimeFilter(['a', 'b'])).toBe('competition_id=in.(a,b)');
    expect(realtimeFilter([])).toBeUndefined();
    expect(realtimeFilter(Array.from({ length: 101 }, (_, i) => String(i)))).toBeUndefined();   // realtime allows 100 values
  });
});

describe('targeted refetch', () => {
  it('a change in one competition re-reads that competition only (17 competitions: 1 read, not 17)', async () => {
    const { s, patches } = make();
    s.start(); await flush();
    expect(s.fetches).toBe(17);                 // the initial load
    s.change('c3');
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(s.fetches).toBe(18);
    expect(patches.at(-1)).toEqual({ patch: { c3: 'data-c3' }, full: false });
    s.stop();
  });
  it('a burst of changes in the same competition costs one read', async () => {
    const { s } = make();
    s.start(); await flush();
    for (let i = 0; i < 25; i++) s.change('c3');
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(s.fetches).toBe(18);
    s.stop();
  });
  it('changes in two competitions cost two reads', async () => {
    const { s, patches } = make();
    s.start(); await flush();
    s.change('c3'); s.change('c9'); s.change('c3');
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(s.fetches).toBe(19);
    expect(Object.keys(patches.at(-1)!.patch).sort()).toEqual(['c3', 'c9']);
    s.stop();
  });
  it('ignores changes for competitions that are not on screen', async () => {
    const { s } = make();
    s.start(); await flush();
    s.change('some-other-event-competition');
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS * 3);
    expect(s.fetches).toBe(17);
    s.stop();
  });
  it('a change that arrives while a read is running is picked up by exactly one follow-up read', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    let slow = false;
    const { s } = make({ fetchOne: async id => { if (slow && id === 'c3') await gate; return `data-${id}`; } });
    s.start(); await flush();
    slow = true;
    s.change('c3'); await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);   // read starts, blocked
    s.change('c3'); await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);   // arrives meanwhile
    expect(s.fetches).toBe(18);
    release(); await flush(); await flush();
    expect(s.fetches).toBe(19);
    s.stop();
  });
  it('a delete event with no competition id refreshes everything once', async () => {
    const { s, patches } = make();
    s.start(); await flush();
    s.change(undefined);
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(s.fetches).toBe(34);
    expect(patches.at(-1)!.full).toBe(true);
    s.stop();
  });
});

describe('LIVE is only claimed after an authoritative fetch', () => {
  it('connecting -> polling fallback -> live only after subscribe AND a full re-read', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    let block = false;
    const { s, conns } = make({ fetchOne: async id => { if (block) await gate; return `data-${id}`; } });
    s.start(); await flush();
    expect(s.connection).toBe('connecting');
    await s.status('SUBSCRIBED');
    expect(s.connection).toBe('live');
    // dead zone
    await s.status('CHANNEL_ERROR');
    expect(s.connection).toBe('polling');
    // coming back: subscribed, but the re-read is still in progress, so NOT live yet
    block = true;
    const reconnect = s.status('SUBSCRIBED');
    await flush();
    expect(s.connection).toBe('polling');
    release(); await reconnect;
    expect(s.connection).toBe('live');
    expect(conns).toEqual(['live', 'polling', 'live']);
    s.stop();
  });
  it('the reconnect re-reads every competition before claiming live', async () => {
    const { s } = make();
    s.start(); await flush();
    await s.status('SUBSCRIBED');
    const before = s.fetches;
    await s.status('CLOSED');
    await s.status('SUBSCRIBED');
    expect(s.fetches - before).toBe(17);
    s.stop();
  });
  it('a failed re-read keeps it out of live and keeps polling', async () => {
    let fail = false;
    const { s } = make({ fetchOne: async id => { if (fail) throw new Error('no signal'); return `data-${id}`; } });
    s.start(); await flush();
    fail = true;
    await s.status('SUBSCRIBED');
    expect(s.connection).toBe('polling');
    fail = false;
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 1);
    await s.status('SUBSCRIBED');
    expect(s.connection).toBe('live');
    s.stop();
  });
  it('if the channel drops again while the re-read is running it never reports live', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    let block = false;
    const { s, conns } = make({ fetchOne: async id => { if (block) await gate; return `data-${id}`; } });
    s.start(); await flush();
    block = true;
    const p = s.status('SUBSCRIBED'); await flush();
    await s.status('CLOSED');
    release(); await p;
    expect(conns).not.toContain('live');
    s.stop();
  });
  it('polls only while not live', async () => {
    const { s } = make();
    s.start(); await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 1);
    expect(s.fetches).toBe(34);     // initial + one poll
    await s.status('SUBSCRIBED');
    const n = s.fetches;
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    expect(s.fetches).toBe(n);      // no polling while live
    s.stop();
  });
});

describe('measurement: requests per change burst, before and after (17 competitions, 3 requests to read a competition)', () => {
  it('a typical stretch of play costs a small fraction of what the old refetch-everything code cost', async () => {
    const REQUESTS_PER_COMPETITION = 3;   // matches + entries + standings, as in loadOne
    // 30 realtime events over about 12 seconds, spread over 4 busy competitions; events more than 400 ms apart are separate debounce windows
    const events = Array.from({ length: 30 }, (_, i) => ({ at: i * 400, id: `c${(i % 4) + 1}` }));
    // BEFORE (old useLiveMatches): every debounce window re-read all 17 competitions, and every event from the whole database woke the page up.
    const before = events.length * ids.length * REQUESTS_PER_COMPETITION;       // events 400 ms apart each close their own window: 30 x 51 = 1530
    // AFTER: run the real coordinator
    const { s } = make();
    s.start(); await flush();
    const initial = s.fetches;
    for (const e of events) { await vi.advanceTimersByTimeAsync(e === events[0] ? 0 : 400); s.change(e.id); }
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    const after = (s.fetches - initial) * REQUESTS_PER_COMPETITION;
    console.log(`realtime measurement: before ${before} requests, after ${after} requests for the same ${events.length} change events (initial load ${initial * REQUESTS_PER_COMPETITION} requests in both)`);
    expect(after).toBeLessThan(before / 8);
    s.stop();
  });
});
